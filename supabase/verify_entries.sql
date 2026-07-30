-- Run this in the Supabase SQL editor BEFORE applying 0001_entries.sql.
--
-- 0001 is idempotent and safe to re-run: it drops every existing policy by
-- name and recreates a known set, and CREATE OR REPLACE handles the helper
-- function. The one thing it cannot fix is column drift — CREATE TABLE IF NOT
-- EXISTS silently no-ops when the table already exists, so if the live shape
-- differs from the file, the file starts lying and nobody notices.
--
-- This script reports the live shape. Compare it against 0001_entries.sql.
-- Nothing here modifies anything.

-- ─── 1 · columns ───────────────────────────────────────────────────────────
-- Expect exactly: id, session_id, event_code, match_number, team_number,
-- alliance_color, scout_name, observations, schema_version, client_id,
-- created_at.
--
-- Watch for: created_at carrying a DEFAULT (it must not — it is part of the
-- dedupe key, and a default turns a missing value into a silent duplicate
-- instead of a loud error).
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'entries'
ORDER BY ordinal_position;

-- ─── 2 · policies ──────────────────────────────────────────────────────────
-- Anything here NOT named entries_session_{select,insert,update} was created
-- outside migrations. Permissive policies combine with OR, so a leftover
-- "Enable read access for all users" defeats everything else on the table.
-- 0001 now drops the whole set first, so this is informational — but it is
-- worth seeing what was there.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'entries'
ORDER BY policyname;

-- ─── 3 · RLS actually on? ──────────────────────────────────────────────────
-- rowsecurity must be true. A table with policies but RLS disabled is fully
-- open and looks fine in the dashboard.
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = 'public.entries'::regclass;

-- ─── 4 · indexes ───────────────────────────────────────────────────────────
-- The dedupe unique index is load-bearing: the sync layer relies on it raising
-- 23505 and then adopting the existing row's id. Without it, a peer's row and
-- ours both insert and the entry is counted twice.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'entries'
ORDER BY indexname;

-- ─── 5 · would the dedupe index even build? ────────────────────────────────
-- If rows already violate it, CREATE UNIQUE INDEX fails. Expect zero rows.
SELECT session_id, event_code, match_number, team_number, scout_name, created_at,
       count(*) AS duplicates
FROM public.entries
GROUP BY 1, 2, 3, 4, 5, 6
HAVING count(*) > 1;

-- ─── 6 · how much is actually in here ──────────────────────────────────────
SELECT count(*) AS total_entries,
       count(DISTINCT event_code) AS events,
       min(created_at) AS oldest,
       max(created_at) AS newest
FROM public.entries;
