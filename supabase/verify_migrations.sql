-- Did 0007 through 0010 land, and is the database consistently before or after
-- the 0011 auth cutover? Read-only.
--
-- The Supabase SQL editor shows you the result of the LAST statement and
-- silently discards the rest. A 173-statement script that fails at statement 40
-- looks exactly like one that succeeded — you get a green tick from whatever
-- ran last. This asserts the end state instead of trusting that.
--
-- Every row is PASS or FAIL, failures sort to the top. If the first row says
-- PASS you are in a known state. Anything else names the object that is
-- missing and the migration it should have come from.
--
-- One query on purpose, for the reason above.
--
-- What it does NOT check: whether the policies are CORRECT. Existence is not
-- behaviour — a policy can be present and permit the wrong thing. That needs
-- signing in as two different users and trying, which no SQL script can do.

WITH expected(migration, kind, name, why) AS (
    VALUES
        -- ── 0007: the sync watermark ───────────────────────────────────────
        ('0007', 'column',   'entries.updated_at',
         'the pull watermark — sync errors on every tick without it'),
        ('0007', 'function', 'touch_updated_at',
         'sets updated_at server-side; a client clock cannot be trusted to'),
        ('0007', 'trigger',  'entries_touch_updated_at',
         'without it updated_at never moves and edits never propagate'),
        ('0007', 'index',    'entries_session_updated_idx',
         'the incremental pull is a sequential scan without it'),

        -- ── 0008: accounts, roles, invites ─────────────────────────────────
        ('0008', 'table',    'profiles',      'one row per person: username, name, role'),
        ('0008', 'table',    'invites',       'single-use codes; redeemed_at is the signup signal'),
        ('0008', 'column',   'entries.submitted_by', 'accountability link to a profile'),
        ('0008', 'function', 'app_role',      'reads the caller role without recursing through RLS'),
        ('0008', 'function', 'is_manager',    'the role check every manager policy will call'),
        ('0008', 'function', 'is_super',      'only a super may mint a super'),
        ('0008', 'function', 'guard_profile_update',
         'keeps profile ids and usernames immutable and blocks role escalation'),
        ('0008', 'trigger',  'profiles_guard_identity',
         'enforces the profile security fields on every API update'),
        ('0008', 'function', 'redeem_invite', 'the only path from an invite code to an account'),
        ('0008', 'function', 'create_invite', 'manager-side invite minting'),
        ('0008', 'function', 'peek_invite',   'lets the register form validate before asking for a password'),
        ('0008', 'index',    'profiles_username_lower',
         'THE uniqueness guarantee — the form check is a courtesy with a race'),

        -- ── 0009: picklist + alliances ─────────────────────────────────────
        ('0009', 'table',    'picklist',       'one row per team, so a stale device cannot erase the list'),
        ('0009', 'table',    'picklist_prefs', 'shared metric weights'),
        ('0009', 'column',   'schedules.alliances',
         'lets a device without a TBA key see who has been picked'),
        ('0009', 'column',   'schedules.alliances_fetched_at',
         'how old the alliance answer is — distinct from the schedule fetch'),
        ('0009', 'trigger',  'picklist_touch_updated_at',
         'per-team merge resolves on updated_at; it must move on write'),
        ('0009', 'trigger',  'picklist_prefs_touch_updated_at',
         'same, for weights'),
        ('0009', 'index',    'picklist_session_updated_idx', 'the pull index'),
        ('0009', 'index',    'picklist_session_rank_idx',    'ordering the list'),

        -- ── 0010: real identity beside the typed name ──────────────────────
        ('0010', 'column',   'assignments.profile_id',
         'who is assigned, as an account rather than a typed string'),
        ('0010', 'column',   'assignment_overrides.profile_id', 'same, per match'),
        ('0010', 'column',   'reminders.profile_id',  'who a reminder targets'),
        ('0010', 'function', 'profile_for_name',
         'conservative name -> account resolution; ambiguity returns null'),
        ('0010', 'index',    'assignments_profile_idx',        'the "what am I assigned" read'),
        -- Not UNIQUE, and not named *_dedupe_idx. 0010 backfills profile_id by
        -- guessing from a typed name, so two historical spellings can resolve to
        -- one account and a unique index would abort the whole expansion. These
        -- make that collision cheap to audit; the constraint comes later, in a
        -- contract migration, once the duplicate report is empty.
        ('0010', 'index',    'assignments_profile_team_idx',   'audits one-team-per-person collisions'),
        ('0010', 'index',    'overrides_profile_idx',          'per-match override lookup'),
        ('0010', 'index',    'overrides_profile_team_idx',     'audits one-override-per-person-per-match collisions'),
        ('0010', 'index',    'reminders_profile_idx',          'reminder targeting'),
        ('0010', 'index',    'entries_submitted_by_idx',       'attribution lookup')
),

-- ── what is actually there ─────────────────────────────────────────────────

live_tables AS (
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
),
live_columns AS (
    SELECT table_name || '.' || column_name AS name
    FROM information_schema.columns WHERE table_schema = 'public'
),
live_functions AS (
    SELECT p.proname AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
),
live_triggers AS (
    SELECT t.tgname AS name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
),
live_indexes AS (
    SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'
),
live AS (
    SELECT 'table'    AS kind, name FROM live_tables
    UNION ALL SELECT 'column',   name FROM live_columns
    UNION ALL SELECT 'function', name FROM live_functions
    UNION ALL SELECT 'trigger',  name FROM live_triggers
    UNION ALL SELECT 'index',    name FROM live_indexes
),

-- Tables that must have RLS switched on. Off with policies present still means
-- fully open, and the dashboard looks completely normal in that state.
rls_expected(name) AS (
    VALUES ('entries'), ('schedules'), ('assignments'),
           ('assignment_overrides'), ('reminders'), ('event_meta'),
           ('profiles'), ('invites'), ('picklist'), ('picklist_prefs')
),

-- How much of each migration is actually here. Three states, not two: all of
-- it, none of it, or some of it.
migration_state AS (
    SELECT e.migration,
           count(*) AS expected_count,
           count(*) FILTER (
               WHERE EXISTS (SELECT 1 FROM live l WHERE l.kind = e.kind AND l.name = e.name)
           ) AS present_count
    FROM expected e
    GROUP BY e.migration
),

checks AS (

    -- ── every expected object exists ───────────────────────────────────────
    --
    -- Only for a migration that has started. One nobody has run yet is a fact,
    -- not a fault: before 0010 is applied this listed its ten objects as FAIL,
    -- sorting ten non-problems above every real finding, and a check that cries
    -- wolf is one people learn to scroll past — which is precisely the habit
    -- that let the entries table drift for months.
    --
    -- Half a migration is the genuinely dangerous state, because it means a
    -- transaction did not finish, so those still fail loudly.
    SELECT 'FAIL' AS status,
           e.migration || ' ' || e.kind || ' missing' AS check_name,
           e.name || ' — ' || e.why AS detail
    FROM expected e
    JOIN migration_state m ON m.migration = e.migration
    WHERE m.present_count > 0
      AND NOT EXISTS (SELECT 1 FROM live l WHERE l.kind = e.kind AND l.name = e.name)

    UNION ALL

    SELECT 'PASS', migration || ' complete',
           expected_count::text || ' object(s) present'
    FROM migration_state
    WHERE present_count = expected_count

    UNION ALL

    SELECT 'INFO', migration || ' not applied',
           expected_count::text || ' object(s) absent — expected until you run it'
    FROM migration_state
    WHERE present_count = 0

    UNION ALL

    -- ── RLS actually enabled ───────────────────────────────────────────────
    SELECT CASE WHEN COALESCE(c.relrowsecurity, false) THEN 'PASS' ELSE 'FAIL' END,
           'RLS on ' || r.name,
           CASE
               WHEN c.relname IS NULL THEN 'table absent'
               WHEN c.relrowsecurity THEN 'on'
               ELSE 'OFF — the anon key can read and write every row'
           END
    FROM rls_expected r
    LEFT JOIN (
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
    ) c ON c.relname = r.name

    UNION ALL

    -- ── each table has at least one policy ─────────────────────────────────
    -- RLS on with no policies denies everything, which is safe and also breaks
    -- the app. Worth telling apart from RLS off.
    SELECT CASE WHEN count(p.policyname) > 0 THEN 'PASS' ELSE 'FAIL' END,
           'policies on ' || r.name,
           CASE WHEN count(p.policyname) > 0
                THEN count(p.policyname)::text || ': ' ||
                     string_agg(p.policyname, ', ' ORDER BY p.policyname)
                ELSE 'NONE — RLS is on, so every read and write is denied' END
    FROM rls_expected r
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public' AND p.tablename = r.name
    GROUP BY r.name

    UNION ALL

    -- ── the search_path pin on SECURITY DEFINER functions ──────────────────
    -- A SECURITY DEFINER function without `SET search_path` runs with the
    -- caller's search_path and can be hijacked by a same-named object in a
    -- schema they control. 0008 pins every one of them; if that pin is missing
    -- the function is a privilege-escalation path, not just untidy.
    SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
           'SECURITY DEFINER functions pin search_path',
           CASE WHEN count(*) = 0 THEN 'all pinned'
                ELSE 'UNPINNED: ' || string_agg(proname, ', ') END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=%'
      )

    UNION ALL

    -- ── the username index is UNIQUE and on lower() ────────────────────────
    -- The shape matters, not just the name. A non-unique index of the right
    -- name would pass an existence check and guarantee nothing, and duplicate
    -- usernames are unrecoverable once two people have them.
    SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
           'username uniqueness is enforced',
           CASE WHEN count(*) = 1 THEN 'unique index on lower(username)'
                ELSE 'MISSING — two people can take the same username' END
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%lower(username%'

    UNION ALL

    -- ── which side of the cutover is this database on? ─────────────────────
    --
    -- The signal is whether has_manager_token() can still AUTHORISE anything,
    -- not whether it exists and not whether event_meta.manager_token exists.
    -- 0011 leaves both objects in place on purpose — a PWA running cached JS
    -- should get a denial, not "function does not exist" — and 0012 removes
    -- them after the soak window. Either object's mere presence is therefore
    -- true on both sides of the cutover, and keying off it would silently skip
    -- every post-cutover check below, which are all conditional on the same
    -- predicate. A verifier that quietly stops checking is the one failure mode
    -- this file exists to prevent.
    --
    -- "Live" means executable by an API role, or a body that is not the
    -- always-false stub. 0011 makes it neither.
    SELECT CASE WHEN gate_is_live = old_policies_present THEN 'PASS' ELSE 'FAIL' END,
           'auth cutover state is internally consistent',
           CASE
               WHEN gate_is_live AND old_policies_present
                   THEN 'pre-cutover — passphrase gate live, session policies in place'
               WHEN NOT gate_is_live AND NOT old_policies_present
                   THEN 'post-cutover — passphrase inert; deployed AUTH_ENFORCED must be true'
               WHEN gate_is_live
                   THEN 'PARTIAL — policies were replaced but the passphrase gate still grants'
               ELSE 'PARTIAL — passphrase gate disabled but session policies remain'
           END
    FROM (
        SELECT
            EXISTS (
                SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
                  AND (
                      has_function_privilege('anon', p.oid, 'EXECUTE')
                      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
                  )
            ) AS gate_is_live,
            -- The header-scoped policies 0001-0009 created and 0011 replaces.
            EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND policyname IN ('entries_session_select', 'entries_session_insert',
                                     'assignments_session_select', 'schedules_session_select')
            ) AS old_policies_present
    ) cutover

    UNION ALL

    -- Once 0011 has removed the passphrase helper, unauthenticated table access
    -- must be gone as well. Conditional so a healthy pre-cutover database still
    -- passes this verifier.
    SELECT CASE WHEN count(*) FILTER (WHERE has_anon_access) = 0 THEN 'PASS' ELSE 'FAIL' END,
           'post-cutover anon table grants are revoked',
           CASE WHEN count(*) FILTER (WHERE has_anon_access) = 0
                THEN 'anon has no event-data table privileges'
                ELSE string_agg(name, ', ' ORDER BY name) FILTER (WHERE has_anon_access) END
    FROM (
        SELECT r.name,
               has_table_privilege('anon', 'public.' || quote_ident(r.name), 'SELECT')
               OR has_table_privilege('anon', 'public.' || quote_ident(r.name), 'INSERT')
               OR has_table_privilege('anon', 'public.' || quote_ident(r.name), 'UPDATE')
               OR has_table_privilege('anon', 'public.' || quote_ident(r.name), 'DELETE')
                   AS has_anon_access
        FROM rls_expected r
        WHERE r.name NOT IN ('profiles', 'invites')
    ) grants
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    -- Catalog-level policy audit for the post-cutover state. Static repository
    -- tests inspect the source; this checks what Postgres actually installed.
    SELECT CASE WHEN count(*) = 29 AND count(*) FILTER (WHERE unsafe) = 0
                THEN 'PASS' ELSE 'FAIL' END,
           'post-cutover event policies keep membership and session scope',
           count(*)::text || ' policy/policies installed; ' ||
           count(*) FILTER (WHERE unsafe)::text || ' unsafe'
    FROM (
        SELECT p.*,
               array_to_string(p.roles, ',') <> 'authenticated'
               OR CASE upper(p.cmd)
                    WHEN 'SELECT' THEN p.qual IS NULL
                        OR p.qual NOT ILIKE '%app_role()%IS NOT NULL%'
                        OR p.qual NOT ILIKE '%current_session_header()%'
                    WHEN 'DELETE' THEN p.qual IS NULL
                        OR p.qual NOT ILIKE '%app_role()%IS NOT NULL%'
                        OR p.qual NOT ILIKE '%current_session_header()%'
                    WHEN 'INSERT' THEN p.with_check IS NULL
                        OR p.with_check NOT ILIKE '%app_role()%IS NOT NULL%'
                        OR p.with_check NOT ILIKE '%current_session_header()%'
                    WHEN 'UPDATE' THEN p.qual IS NULL OR p.with_check IS NULL
                        OR p.qual NOT ILIKE '%app_role()%IS NOT NULL%'
                        OR p.qual NOT ILIKE '%current_session_header()%'
                        OR p.with_check NOT ILIKE '%app_role()%IS NOT NULL%'
                        OR p.with_check NOT ILIKE '%current_session_header()%'
                    ELSE true
                  END AS unsafe
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'entries', 'schedules', 'assignments', 'assignment_overrides',
              'reminders', 'picklist', 'picklist_prefs', 'event_meta'
          )
    ) policy_state
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    SELECT CASE WHEN count(*) = 19 AND count(*) FILTER (WHERE unsafe) = 0
                THEN 'PASS' ELSE 'FAIL' END,
           'post-cutover planning writes require manager role',
           count(*)::text || ' mutation policy/policies installed; ' ||
           count(*) FILTER (WHERE unsafe)::text || ' missing a manager check'
    FROM (
        SELECT p.*,
               CASE upper(p.cmd)
                   WHEN 'INSERT' THEN p.with_check IS NULL
                       OR p.with_check NOT ILIKE '%is_manager()%'
                   WHEN 'DELETE' THEN p.qual IS NULL
                       OR p.qual NOT ILIKE '%is_manager()%'
                   WHEN 'UPDATE' THEN p.qual IS NULL OR p.with_check IS NULL
                       OR p.qual NOT ILIKE '%is_manager()%'
                       OR p.with_check NOT ILIKE '%is_manager()%'
                   ELSE true
               END AS unsafe
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'schedules', 'assignments', 'assignment_overrides', 'reminders',
              'picklist', 'picklist_prefs', 'event_meta'
          )
          AND upper(p.cmd) IN ('INSERT', 'UPDATE', 'DELETE')
    ) manager_policies
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    SELECT CASE WHEN count(*) = 1
                     AND bool_and(with_check ILIKE '%submitted_by%auth.uid()%')
                THEN 'PASS' ELSE 'FAIL' END,
           'post-cutover entry inserts bind the submitter',
           CASE WHEN count(*) = 1
                     AND bool_and(with_check ILIKE '%submitted_by%auth.uid()%')
                THEN 'submitted_by is checked against auth.uid()'
                ELSE 'entries_insert is missing or does not bind submitted_by' END
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'entries'
      AND p.policyname = 'entries_insert' AND upper(p.cmd) = 'INSERT'
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    -- Exactly one trigger, and specifically NOT the other.
    --
    -- An earlier draft protected attribution with a BEFORE UPDATE trigger
    -- pinning NEW.submitted_by := OLD.submitted_by. entries.submitted_by
    -- carries ON DELETE SET NULL, so revoking a profile makes Postgres issue an
    -- internal UPDATE setting that column to null — which the trigger would
    -- undo, breaking the referential action. Revoking anyone with historical
    -- entries would start failing, months after the cutover, for no visible
    -- reason. Column-level privilege does the same job without touching
    -- referential actions; 0011 drops the trigger and withholds
    -- UPDATE (submitted_by) from every API role instead.
    SELECT CASE
               WHEN count(*) FILTER (WHERE t.tgname = 'entries_stamp_submitted_by') = 1
                AND count(*) FILTER (WHERE t.tgname = 'entries_preserve_submitted_by') = 0
               THEN 'PASS' ELSE 'FAIL'
           END,
           'post-cutover entry attribution trigger',
           CASE
               WHEN count(*) FILTER (WHERE t.tgname = 'entries_stamp_submitted_by') = 0
                   THEN 'entries_stamp_submitted_by is MISSING — inserts carry no attribution'
               WHEN count(*) FILTER (WHERE t.tgname = 'entries_preserve_submitted_by') > 0
                   THEN 'entries_preserve_submitted_by is back — it breaks ON DELETE SET NULL'
               ELSE 'stamp trigger installed; no preserve trigger, as intended'
           END
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'entries'
      AND NOT t.tgisinternal
      AND t.tgname IN ('entries_stamp_submitted_by', 'entries_preserve_submitted_by')
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    -- The mechanism that replaced that trigger. If a later migration issues a
    -- bare GRANT UPDATE on entries, this is the only thing that notices.
    SELECT CASE
               WHEN NOT has_column_privilege('authenticated', 'public.entries', 'submitted_by', 'UPDATE')
               THEN 'PASS' ELSE 'FAIL'
           END,
           'post-cutover attribution is not client-writable',
           CASE
               WHEN has_column_privilege('authenticated', 'public.entries', 'submitted_by', 'UPDATE')
                   THEN 'authenticated may UPDATE entries.submitted_by — a correction can forge the submitter'
               ELSE 'UPDATE (submitted_by) withheld from authenticated'
           END
    HAVING NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) NOT LIKE '%select false%'
          )
    )

    UNION ALL

    SELECT CASE
               WHEN NOT has_function_privilege('anon', 'public.reset_event_data()', 'EXECUTE')
                AND has_function_privilege('authenticated', 'public.reset_event_data()', 'EXECUTE')
               THEN 'PASS' ELSE 'FAIL'
           END,
           'post-cutover archive RPC grant',
           'anon=' || has_function_privilege('anon', 'public.reset_event_data()', 'EXECUTE')::text ||
           ', authenticated=' ||
           has_function_privilege('authenticated', 'public.reset_event_data()', 'EXECUTE')::text
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_meta'
          AND column_name = 'manager_token'
    )

    UNION ALL

    SELECT CASE
               WHEN NOT has_function_privilege('anon', 'public.profile_for_name(text)', 'EXECUTE')
                AND NOT has_function_privilege('authenticated', 'public.profile_for_name(text)', 'EXECUTE')
               THEN 'PASS' ELSE 'FAIL'
           END,
           'identity backfill helper is not client-callable',
           'anon=' || has_function_privilege('anon', 'public.profile_for_name(text)', 'EXECUTE')::text ||
           ', authenticated=' ||
           has_function_privilege('authenticated', 'public.profile_for_name(text)', 'EXECUTE')::text
    WHERE EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'profile_for_name'
    )

    UNION ALL

    -- ── every profile is reachable by its own username ─────────────────────
    --
    -- There is no username → email lookup table, by design: signIn() computes
    -- `username || '@scout.invalid'` and asks Supabase for exactly that
    -- address. So a profile whose auth user has a different email is an account
    -- nobody can log into, and the only symptom is "that username and password
    -- do not match" — which reads like a typo and sends you looking at the
    -- password.
    --
    -- /register cannot get this wrong; it derives the email the same way. The
    -- hand-made bootstrap super user can, and did.
    SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
           'every profile is reachable by its username',
           CASE WHEN count(*) = 0 THEN 'username matches the auth email on every profile'
                ELSE 'UNREACHABLE: ' || string_agg(detail, '; ') END
    FROM (
        SELECT p.username || ' expects ' || p.username || '@scout.invalid but the auth user is ' ||
               COALESCE(u.email, '(no auth user)') AS detail
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        WHERE u.email IS DISTINCT FROM p.username || '@scout.invalid'
    ) bad

    UNION ALL

    -- ── unconfirmed accounts ───────────────────────────────────────────────
    --
    -- Every address here is <username>@scout.invalid. `.invalid` is reserved by
    -- RFC 2606 as permanently unroutable, deliberately — the address is an
    -- identifier, not a mailbox. So a confirmation email goes nowhere, arrives
    -- never, and the account waits forever for a click that cannot happen.
    --
    -- The cause is a dashboard toggle no migration can set or read:
    -- Authentication → Providers → Email → Confirm email. If it is on, someone
    -- has to confirm every scout by hand, which is the kind of per-person chore
    -- that quietly stops a system being used. This surfaces the symptom.
    SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
           'every account is confirmed',
           CASE WHEN count(*) = 0 THEN 'no account is waiting on a confirmation'
                ELSE count(*)::text || ' unconfirmed: ' || string_agg(email, ', ') ||
                     ' — turn OFF Authentication → Providers → Email → Confirm email' END
    FROM auth.users
    WHERE email_confirmed_at IS NULL

    UNION ALL

    -- ── how much of the typed-name history resolved to an account ──────────
    --
    -- Informational, not a failure. Rows recorded before accounts existed have
    -- no profile and never will, and a name nobody has registered stays null
    -- by design — profile_for_name is deliberately conservative, because a
    -- wrong match silently attributes one scout's work to another while a null
    -- is at least visible.
    --
    -- Re-run 0010's four UPDATEs once everyone has signed up.
    SELECT 'INFO', 'identity backfill',
           (SELECT count(*) FROM public.assignments a
             WHERE to_jsonb(a) ->> 'profile_id' IS NULL)::text ||
           ' assignment(s) and ' ||
           (SELECT count(*) FROM public.entries e
             WHERE to_jsonb(e) ->> 'submitted_by' IS NULL)::text ||
           ' entry(s) still on a typed name only'
    WHERE EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'assignments'
          AND column_name = 'profile_id'
    )

    UNION ALL

    -- ── informational ──────────────────────────────────────────────────────
    SELECT 'INFO', 'accounts',
           (SELECT count(*) FROM public.profiles)::text || ' profile(s), ' ||
           (SELECT count(*) FROM public.invites WHERE redeemed_at IS NULL)::text ||
           ' unused invite(s)'
    WHERE EXISTS (SELECT 1 FROM live_tables WHERE name = 'profiles')

    UNION ALL

    SELECT 'INFO', 'bootstrap',
           CASE
               WHEN (SELECT count(*) FROM public.profiles WHERE role = 'super') > 0
                   THEN (SELECT count(*) FROM public.profiles WHERE role = 'super')::text || ' super user(s)'
               ELSE 'NO super user yet — see the bottom of 0008_auth.sql'
           END
    WHERE EXISTS (SELECT 1 FROM live_tables WHERE name = 'profiles')
)
SELECT status, check_name, detail
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'PASS' THEN 1 ELSE 2 END, check_name;
