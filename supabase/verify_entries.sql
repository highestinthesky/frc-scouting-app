-- Schema drift check for public.entries. Read-only.
--
-- This ASSERTS rather than describes. Every row is PASS or FAIL, failures sort
-- first. If the top row says PASS you are in a known state; if anything says
-- FAIL, the live database and 0001_entries.sql disagree and one of them is
-- lying to you.
--
-- Run it:
--   · after applying 0001_entries.sql
--   · after anyone touches the database through the dashboard
--   · before each season, and before shipping anything that changes policies
--
-- The whole reason this file exists: the entries table was built in the
-- dashboard and drifted from the repo for months without anyone noticing,
-- because noticing required someone to sit down and compare by eye. Nobody
-- ever does. A check only prevents recurrence if it answers yes/no.
--
-- One query on purpose — the Supabase SQL editor shows only the last
-- statement's result set and silently discards the rest.
--
-- ─── it has to know which stage the database is at ─────────────────────────
--
-- `entries` legitimately changes shape twice on the way to accounts: 0008 adds
-- submitted_by, and 0011 replaces the three event-scoped policies with the
-- membership-scoped set. Checked against 0001 alone, this file reports seven
-- FAILs on a perfectly correct post-cutover database — sorted to the top, and
-- read minutes after someone applied a one-way door. That is the worst possible
-- moment to be told a lie, and the likeliest moment for someone to roll back a
-- migration that was fine. So it detects the stage and expects the right shape
-- for it, the way verify_migrations.sql already does.

WITH stage AS (
    SELECT
        -- 0008: accounts exist, so entries carries an attribution column.
        to_regclass('public.profiles') IS NOT NULL AS has_accounts,
        -- 0011: the cutover installs this trigger and swaps the policy set.
        -- No other migration creates it, which is what makes it a usable marker.
        EXISTS (
            SELECT 1
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'entries'
              AND t.tgname = 'entries_stamp_submitted_by'
        ) AS cutover_done
),
expected(column_name, data_type, is_nullable, column_default) AS (
    VALUES
        ('id',             'uuid',                        'NO',  'gen_random_uuid()'),
        ('session_id',     'uuid',                        'NO',  NULL),
        ('event_code',     'text',                        'NO',  NULL),
        ('match_number',   'integer',                     'NO',  NULL),
        ('team_number',    'integer',                     'NO',  NULL),
        ('alliance_color', 'text',                        'NO',  NULL),
        ('scout_name',     'text',                        'NO',  NULL),
        ('observations',   'jsonb',                       'NO',  '''{}''::jsonb'),
        ('schema_version', 'integer',                     'NO',  NULL),
        ('client_id',      'text',                        'YES', NULL),
        ('created_at',     'timestamp with time zone',    'NO',  NULL),
        -- Server-set watermark for the incremental pull. Unlike created_at
        -- this one SHOULD have a default; it is not part of the dedupe key.
        ('updated_at',     'timestamp with time zone',    'NO',  'now()')
    UNION ALL
    -- 0008. Nullable and without a default on purpose: an entry recorded before
    -- accounts existed has no submitter and never will, and 0011 stamps this
    -- from auth.uid() in a trigger rather than from a column default.
    SELECT 'submitted_by', 'uuid', 'YES', NULL::text FROM stage WHERE has_accounts
),
actual AS (
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entries'
),
expected_policies(policyname) AS (
    SELECT unnest(CASE WHEN cutover_done
        -- 0011: membership plus event scope, and a scout may correct only their
        -- own row unless they are a manager.
        THEN ARRAY['entries_read', 'entries_insert', 'entries_update']
        -- 0001: the event code alone is the boundary.
        ELSE ARRAY['entries_session_select', 'entries_session_insert', 'entries_session_update']
    END)
    FROM stage
),
checks AS (

    -- ── RLS must be on ─────────────────────────────────────────────────────
    -- Off + policies present still means fully open, and the dashboard looks
    -- entirely normal in that state.
    SELECT CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS status,
           'RLS enabled' AS check_name,
           CASE WHEN relrowsecurity THEN 'on'
                ELSE 'OFF — anon key can read and write everything' END AS detail
    FROM pg_class WHERE oid = 'public.entries'::regclass

    UNION ALL

    -- ── the two defaults that must not exist ───────────────────────────────
    -- created_at is part of the dedupe key and carries the CLIENT's timestamp.
    -- A server default silently produces a duplicate instead of an error.
    SELECT CASE WHEN column_default IS NULL THEN 'PASS' ELSE 'FAIL' END,
           'created_at has no default',
           COALESCE('default is ' || column_default || ' — dedupe will miss and duplicate', 'none')
    FROM actual WHERE column_name = 'created_at'

    UNION ALL

    -- schema_version distinguishes "never collected" from "recorded zero".
    -- A default lets an omission become a plausible lie. This one already bit.
    SELECT CASE WHEN column_default IS NULL THEN 'PASS' ELSE 'FAIL' END,
           'schema_version has no default',
           COALESCE('default is ' || column_default || ' — omissions become a false version stamp', 'none')
    FROM actual WHERE column_name = 'schema_version'

    UNION ALL

    -- ── column set matches the migration, both directions ──────────────────
    SELECT 'FAIL', 'column missing or wrong',
           e.column_name || ' — expected ' || e.data_type || '/null=' || e.is_nullable ||
           ', found ' || COALESCE(a.data_type || '/null=' || a.is_nullable, '(absent)')
    FROM expected e LEFT JOIN actual a USING (column_name)
    WHERE a.column_name IS NULL OR a.data_type <> e.data_type OR a.is_nullable <> e.is_nullable

    UNION ALL

    SELECT 'FAIL', 'unexpected column',
           a.column_name || ' (' || a.data_type || ') is in no migration this table should have'
    FROM actual a LEFT JOIN expected e USING (column_name)
    WHERE e.column_name IS NULL

    UNION ALL

    SELECT 'PASS', 'column set matches', count(*)::text || ' columns as specified'
    FROM actual
    WHERE NOT EXISTS (
        SELECT 1 FROM expected e FULL JOIN actual a USING (column_name)
        WHERE a.column_name IS NULL OR e.column_name IS NULL
           OR a.data_type <> e.data_type OR a.is_nullable <> e.is_nullable
    )

    UNION ALL

    -- ── dedupe index ───────────────────────────────────────────────────────
    -- Load-bearing: sync relies on it raising 23505 and adopting the existing
    -- row's id. Without it a peer's copy and ours both insert.
    SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
           'dedupe unique index',
           CASE WHEN count(*) = 1 THEN 'present'
                ELSE 'MISSING — duplicate entries will be stored silently' END
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'entries'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%session_id, event_code, match_number, team_number, scout_name, created_at%'

    UNION ALL

    -- ── policies: exactly the expected set, no extras ──────────────────────
    -- Permissive policies combine with OR, so an extra one is not additive
    -- clutter — it is a hole.
    SELECT 'FAIL', 'unexpected policy',
           p.policyname || ' is not in the expected set — permissive policies OR together'
    FROM pg_policies p LEFT JOIN expected_policies e USING (policyname)
    WHERE p.schemaname = 'public' AND p.tablename = 'entries' AND e.policyname IS NULL

    UNION ALL

    SELECT 'FAIL', 'policy missing', e.policyname || ' expected but absent'
    FROM expected_policies e
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = 'entries'
          AND p.policyname = e.policyname
    )

    UNION ALL

    SELECT 'PASS', 'policy set matches', string_agg(policyname, ', ' ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'entries'
      AND NOT EXISTS (
          SELECT 1 FROM expected_policies e
          FULL JOIN (
              SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'entries'
          ) a USING (policyname)
          WHERE a.policyname IS NULL OR e.policyname IS NULL
      )

    UNION ALL

    -- ── informational ──────────────────────────────────────────────────────
    -- Say which shape was expected. A PASS means nothing if this file guessed
    -- the wrong stage, so the guess is reported rather than left implicit.
    SELECT 'INFO', 'stage',
           CASE WHEN cutover_done THEN 'post-cutover — 0011 policy set expected'
                WHEN has_accounts THEN 'accounts applied, cutover not — 0001 policy set expected'
                ELSE 'pre-accounts — 0001 shape expected' END
    FROM stage

    UNION ALL

    SELECT 'INFO', 'contents',
           (SELECT count(*) FROM public.entries)::text || ' rows across ' ||
           (SELECT count(DISTINCT event_code) FROM public.entries)::text || ' event(s)'
)
SELECT status, check_name, detail
FROM checks
ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'PASS' THEN 1 ELSE 2 END, check_name;
