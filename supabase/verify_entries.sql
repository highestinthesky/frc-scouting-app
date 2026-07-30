-- Run this in the Supabase SQL editor BEFORE applying 0001_entries.sql.
-- Nothing here modifies anything.
--
-- Written as ONE query on purpose. The Supabase SQL editor displays only the
-- last statement's result set, so a script of six SELECTs silently shows you
-- the sixth and throws away the rest — which is exactly how you conclude
-- "there are no policies" when you simply never saw them.

SELECT check_name, detail FROM (

    -- ── 1 · is RLS actually on? ────────────────────────────────────────────
    -- The single most important line in this output.
    --   ENABLED  + 0 policies → nobody can read or write. Locked shut.
    --   DISABLED + 0 policies → anyone with the anon key can read and write
    --                           everything. Wide open, and the dashboard
    --                           looks entirely normal.
    SELECT 1 AS sort_key,
           '1 · RLS' AS check_name,
           CASE WHEN c.relrowsecurity
                THEN 'ENABLED'
                ELSE 'DISABLED  <-- table is fully open to the anon key'
           END AS detail
    FROM pg_class c WHERE c.oid = 'public.entries'::regclass

    UNION ALL

    -- ── 2 · policies ───────────────────────────────────────────────────────
    -- Permissive policies combine with OR, so any leftover dashboard policy
    -- defeats a restrictive one. 0001 drops the whole set before recreating,
    -- so this is informational — but worth seeing.
    SELECT 2,
           '2 · policy',
           policyname || '  [' || cmd || ']  ' || COALESCE(qual, '(no using clause)')
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'entries'

    UNION ALL

    SELECT 2, '2 · policy', '(none found)'
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'entries'
    )

    UNION ALL

    -- ── 3 · columns ────────────────────────────────────────────────────────
    -- Compare against 0001_entries.sql. CREATE TABLE IF NOT EXISTS cannot fix
    -- drift — it silently no-ops — so a mismatch here means the migration file
    -- would start lying about reality.
    --
    -- Specifically check: created_at must have NO default. It is part of the
    -- dedupe unique index, so a default turns a missing value into a silent
    -- duplicate rather than a loud error.
    SELECT 3,
           '3 · column',
           rpad(column_name, 16) || rpad(data_type, 28) ||
           'null=' || rpad(is_nullable, 5) ||
           'default=' || COALESCE(column_default, '(none)')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entries'

    UNION ALL

    -- ── 4 · indexes ────────────────────────────────────────────────────────
    -- The dedupe unique index is load-bearing: the sync layer relies on it
    -- raising 23505 and then adopting the existing row's id. Without it, a
    -- peer's copy and ours both insert and the entry counts twice.
    SELECT 4, '4 · index', indexname || '  ' || indexdef
    FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entries'

    UNION ALL

    SELECT 4, '4 · index', '(none found)'
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entries'
    )

    UNION ALL

    -- ── 5 · would the dedupe index build? ──────────────────────────────────
    SELECT 5, '5 · dedupe blockers',
           COALESCE((
               SELECT count(*)::text || ' duplicate group(s) — index will FAIL'
               FROM (
                   SELECT 1 FROM public.entries
                   GROUP BY session_id, event_code, match_number,
                            team_number, scout_name, created_at
                   HAVING count(*) > 1
               ) d
               HAVING count(*) > 0
           ), 'none — safe to build')

    UNION ALL

    -- ── 6 · contents ───────────────────────────────────────────────────────
    SELECT 6, '6 · contents',
           (SELECT count(*) FROM public.entries)::text || ' rows across ' ||
           (SELECT count(DISTINCT event_code) FROM public.entries)::text || ' event(s)'

) report
ORDER BY sort_key, detail;
