-- Did production receive the 2026-08-07 re-run of 0001 and the corrected 0008?
--
-- Read-only. Each row is a fact on which the two possible histories disagree,
-- measured by building both on the local stack and diffing pg_dump:
--
--   script-only   live_baseline, 0002-0007, pre-hardening 0008 (d5cb14e), 0009,
--                 0010, 0013, then 0015-0027
--   with re-run   the same, with 0001 and the current 0008 between 0013 and 0015
--
-- `expected` is the re-run's answer. Production returned 9 PASS on 2026-10-04,
-- and the script-only build returns 9 FAIL. The guard triggers are the row that
-- matters most: without them 0026's rename guard is defined and never called.

WITH facts(fact, actual, expected) AS (
  SELECT 'profiles guard triggers',
         coalesce((SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
                    WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
                      AND tgname LIKE 'profiles_guard%'), '(none)'),
         'profiles_guard_identity,profiles_guard_insert_identity'
  UNION ALL
  SELECT 'profiles_read is role-gated',
         (SELECT (qual <> 'true')::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_read'),
         'true'
  UNION ALL
  SELECT 'invites_manager_read guards super',
         (SELECT (qual LIKE '%is_super()%')::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'invites' AND policyname = 'invites_manager_read'),
         'true'
  UNION ALL
  SELECT 'invites_manager_delete guards super',
         (SELECT (qual LIKE '%is_super()%')::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'invites' AND policyname = 'invites_manager_delete'),
         'true'
  UNION ALL
  SELECT 'profiles_manager_update guards super',
         (SELECT (qual LIKE '%is_super()%' AND with_check LIKE '%is_super()%')::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_manager_update'),
         'true'
  UNION ALL
  SELECT 'entries column defaults (schema_version, created_at)',
         coalesce((SELECT string_agg(column_name || '=' || column_default, ',' ORDER BY column_name)
                     FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'entries'
                      AND column_name IN ('schema_version', 'created_at')
                      AND column_default IS NOT NULL), '(none)'),
         '(none)'
  UNION ALL
  SELECT 'entries.alliance_color nullable',
         (SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'entries' AND column_name = 'alliance_color'),
         'NO'
  UNION ALL
  SELECT 'entries table privileges for authenticated',
         (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
            FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = 'entries' AND grantee = 'authenticated'),
         'INSERT,SELECT'
  UNION ALL
  SELECT 'profiles SELECT for authenticated is per-column',
         (NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
          AND has_column_privilege('authenticated', 'public.profiles', 'username', 'SELECT'))::text,
         'true'
)
SELECT CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE 'FAIL' END AS result,
       fact, actual, expected
  FROM facts
 ORDER BY result, fact;
