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
        ('0009', 'index',    'picklist_session_rank_idx',    'ordering the list')
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
    -- run 0010 — and AUTH_ENFORCED in src/lib/auth.svelte.js must move with it.
    SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
           'passphrase gate still present (expected until 0010)',
           CASE WHEN count(*) = 1 THEN 'has_manager_token() exists — pre-cutover, as expected'
                ELSE 'ABSENT — 0010 has run. AUTH_ENFORCED must be true in the same deploy' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_manager_token'

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
