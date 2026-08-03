-- Did 0007, 0008 and 0009 actually land? Read-only.
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
        ('0010', 'index',    'assignments_profile_dedupe_idx', 'one team per person per event'),
        ('0010', 'index',    'overrides_profile_idx',          'per-match override lookup'),
        ('0010', 'index',    'overrides_profile_dedupe_idx',   'one override per person per match'),
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
    VALUES ('profiles'), ('invites'), ('picklist'), ('picklist_prefs')
),

checks AS (

    -- ── every expected object exists ───────────────────────────────────────
    SELECT 'FAIL' AS status,
           e.migration || ' ' || e.kind || ' missing' AS check_name,
           e.name || ' — ' || e.why AS detail
    FROM expected e
    WHERE NOT EXISTS (SELECT 1 FROM live l WHERE l.kind = e.kind AND l.name = e.name)

    UNION ALL

    SELECT 'PASS',
           e.migration || ' complete',
           count(*)::text || ' object(s) present'
    FROM expected e
    WHERE NOT EXISTS (
        SELECT 1 FROM expected x
        WHERE x.migration = e.migration
          AND NOT EXISTS (SELECT 1 FROM live l WHERE l.kind = x.kind AND l.name = x.name)
    )
    GROUP BY e.migration

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

    -- ── the cutover has NOT happened yet ───────────────────────────────────
    -- 0007/0008/0009 are additive. If has_manager_token() is gone, someone has
    -- run 0011 — and AUTH_ENFORCED in src/lib/auth.svelte.js must move with it.
    SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
           'passphrase gate still present (expected until 0011)',
           CASE WHEN count(*) = 1 THEN 'has_manager_token() exists — pre-cutover, as expected'
                ELSE 'ABSENT — 0011 has run. AUTH_ENFORCED must be true in the same deploy' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'

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
           (SELECT count(*) FROM public.assignments WHERE profile_id IS NULL)::text ||
           ' assignment(s) and ' ||
           (SELECT count(*) FROM public.entries WHERE submitted_by IS NULL)::text ||
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
