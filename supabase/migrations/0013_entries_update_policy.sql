-- Migration: give entries the UPDATE policy it was always supposed to have
--
-- ═══════════════════════════════════════════════════════════════════════════
--  This fixes a live data-loss bug. Apply it before the next event.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Production has exactly three policies on `entries`:
--
--     entries_session_delete   DELETE   -- should not exist
--     entries_session_insert   INSERT
--     entries_session_select   SELECT
--
-- There is no UPDATE policy. With RLS enabled and no permissive UPDATE policy,
-- every UPDATE matches zero rows — no error, just nothing.
--
-- 0001_entries.sql already fixes both halves of this. It says so in its own
-- comments: "required by the sync UPDATE path ... without it an /edit change
-- can never reach its cloud row — the current data-loss bug", and "the live
-- table had entries_session_delete; it is dropped above and not recreated".
--
-- But 0001 was written retroactively to describe a table that had been built by
-- clicking, and it CREATEs that table, so it can never be run against the
-- database it describes. Its repairs have therefore never reached production.
-- This migration carries just those two changes forward.
--
-- ─── what the missing policy actually does to a scout's correction ──────────
--
-- pushUpdate() in sync.svelte.js reads a zero-row UPDATE as "the remote row was
-- deleted server-side" and re-inserts. That is the right call for the case it
-- was written for, and the wrong one here, because the row is present and the
-- policy is what is missing. Both outcomes lose the edit:
--
--   · Correcting observations only — a miscounted cycle, an added note — leaves
--     the dedupe fingerprint untouched, so the insert hits 23505, the client
--     adopts the existing row's id and marks the entry clean. The correction is
--     discarded and the UI reports success.
--
--   · Correcting a wrong match or team number changes the fingerprint, so the
--     insert succeeds and the event gains a duplicate: the corrected row beside
--     the original nobody fixed. Both then count toward that team's metrics.
--
-- The dedupe index is a content fingerprint
-- [session_id, event_code, match_number, team_number, scout_name, created_at],
-- which is why editing what a scout SAW is silent and editing WHO they were
-- watching duplicates.
--
-- ─── why verify_entries.sql did not catch it ───────────────────────────────
--
-- It does catch it. It asserts exactly {select, insert, update} and flags both
-- the stray DELETE and the missing UPDATE. It had never been run against
-- production — supabase/README.md says to run it after any dashboard change,
-- and the dashboard change that caused this predates the file.
--
-- ─── interaction with 0011 ─────────────────────────────────────────────────
--
-- None to worry about. 0011 drops every policy on entries and rebuilds the set
-- from scratch, so it supersedes this migration rather than conflicting with
-- it. Applying this one now does not make the cutover harder, and not applying
-- it means waiting for a one-way door to fix a bug losing data today.

BEGIN;

-- ─── the helper 0001 defines and production has never had ──────────────────
--
-- First attempt at this migration failed on the live project with
--
--     42883: function public.current_session_header() does not exist
--
-- because 0001 is what creates it and 0001 has never run. Every other
-- pre-cutover migration inlines the expression instead — 0001 says so itself:
-- "the other migrations inline this expression across a dozen policies" — which
-- is exactly why 0002 through 0010 applied to production without noticing the
-- function was absent. Production's existing entries policies carry the inlined
-- form, which is why they work.
--
-- That matters well beyond this file. 0011 calls this function 38 times. The
-- cutover would have failed on its first policy, inside its own transaction, in
-- the middle of the release window it is supposed to be a one-way door for.
-- Creating it here means 0011 stops depending on a migration that can never run.
--
-- CREATE OR REPLACE, so this is a no-op wherever it already exists.

CREATE OR REPLACE FUNCTION public.current_session_header() RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT (current_setting('request.headers', true)::json ->> 'x-session-id')
$$;

-- A policy calls this as the querying role, so without EXECUTE every read and
-- write would fail with "permission denied for function" — a worse outcome than
-- the missing function, because it looks like an auth problem.
REVOKE ALL ON FUNCTION public.current_session_header() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_session_header() TO anon, authenticated;

-- Idempotent: safe to re-run, and safe on a database where someone has already
-- fixed this by hand through the dashboard.
DROP POLICY IF EXISTS entries_session_update ON public.entries;

-- Same shape as every other pre-cutover policy on this table: the event code
-- hashed into x-session-id is the scope. WITH CHECK as well as USING, so an
-- edit cannot move a row from one event into another.
CREATE POLICY entries_session_update ON public.entries
    FOR UPDATE
    USING (session_id::text = public.current_session_header())
    WITH CHECK (session_id::text = public.current_session_header());

-- Deliberately no delete policy, per 0001. deleteEntry() is local Dexie only
-- and reset_event_data() preserves entries by design, so this was reachable
-- capability nobody used — and scouting data is the one thing worth being
-- conservative about.
DROP POLICY IF EXISTS entries_session_delete ON public.entries;

-- A policy grants nothing without the table privilege behind it. Re-asserted
-- rather than assumed, because the same dashboard session that produced the
-- policy drift may have produced grant drift, and GRANT is idempotent.
GRANT SELECT, INSERT, UPDATE ON public.entries TO anon, authenticated;

COMMIT;
