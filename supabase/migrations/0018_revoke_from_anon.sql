-- Migration: stop handing `anon` everything by default
--
-- Supabase's security advisor flagged nine SECURITY DEFINER functions as
-- anon-callable on the live project. Asking the database why turned up
-- something bigger than the functions.
--
-- ─── measured on production, 2026-08-14 ────────────────────────────────────
--
-- pg_default_acl for schema `public`:
--
--     tables      anon=arwdDxtm     ALL privileges. Including DELETE.
--     functions   anon=X
--     sequences   anon=rwU
--
-- Every new table created in `public` is automatically granted ALL privileges
-- to anon, and every new function EXECUTE. This project was created 2026-05-04,
-- before Supabase changed that default to always-revoked.
--
-- That is why 0009_picklist.sql contains no GRANT statements at all and
-- `picklist` still ended up reachable by anon, and why 0008's
--
--     REVOKE ALL ON FUNCTION public.app_role() FROM PUBLIC;
--
-- reads like a lockdown and is not one: the grant it needs to remove is an
-- explicit `anon=X/postgres` ACL entry, not the PUBLIC one. profile_for_name is
-- the only function actually closed, and 0010 is the only migration that names
-- the role:
--
--     REVOKE ALL ON FUNCTION public.profile_for_name(text) FROM anon, authenticated;
--
-- ─── the part that matters more than the fix ───────────────────────────────
--
-- The local stack does NOT have these default privileges. `supabase start`
-- uses the current always-revoked default — supabase/config.toml says so, in
-- the auto_expose_new_tables note. A probe there shows REVOKE ... FROM PUBLIC
-- closing anon correctly, because anon never had an explicit grant to begin
-- with.
--
-- So no local rehearsal can see this class of bug, including
-- scripts/rebuild_prod_replica.sh, which reproduces production's TABLES and not
-- its privilege defaults. That is the same failure as rehearsing on `db reset`:
-- the replica was right about the schema and wrong about the environment. The
-- script now sets these defaults too — see the note in live_baseline.sql.
--
-- ─── is anything actually open right now? ──────────────────────────────────
--
-- No. RLS is enabled on all ten tables and every one has policies, so the wide
-- grants are gated. Each flagged function checks its own caller too: app_role()
-- returns NULL without a profile, is_manager() false, create_invite() raises,
-- redeem_invite() raises without an auth.uid().
--
-- What failed is that the grants claimed a boundary nobody was enforcing, on a
-- project where the default is to grant everything. One table shipped without a
-- policy and it stops being theoretical.

BEGIN;

-- ─── the root fix: new objects stop being public by default ────────────────
--
-- Affects FUTURE objects only; existing ACLs are untouched. This is deliberately
-- ahead of Phase 4, which creates `events` and `event_scouts` — without it those
-- arrive anon-writable and only a policy stands in the way, which is precisely
-- how picklist happened.
--
-- The failure direction flips too. A migration that forgets its grants now
-- produces "permission denied" rather than a silently over-permissive table.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ─── and close the functions that are already open ─────────────────────────
--
-- Naming the role, because that is what the ACL holds.
--
-- Reached only from an authenticated session (create_invite and redeem_invite
-- both go through getAuthClient()) or only from policies that are already
-- `TO authenticated` (app_role, is_manager and is_super are called by the six
-- profiles/invites policies from 0008, and by nothing else).

REVOKE EXECUTE ON FUNCTION public.app_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_invite(public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_invite(text, text, text, text, text) FROM anon;

-- ─── five must STAY reachable by anon ──────────────────────────────────────
--
-- Checked against the policies and the client rather than assumed, because the
-- pre-cutover app performs manager writes AS ANON with a passphrase header, and
-- closing one of these breaks the live app:
--
--   current_session_header  every event-data policy calls it, and those policies
--                           carry no TO clause, so anon evaluates them
--   has_manager_token       every manager-write policy on schedules, assignments,
--                           reminders, overrides, picklist and event_meta
--   reset_event_data        the Archive button — event-meta.js calls it through
--                           createSupabaseClient(), anon key plus x-manager-token,
--                           not through an authenticated session
--   peek_invite             /register shows what a code is for BEFORE signup
--   email_for_username      /login resolves an address BEFORE there is a session
--
-- "Stay" means pre-cutover. 0011 revokes both from anon itself and 0012 drops
-- has_manager_token outright, which is correct — after the cutover there is no
-- anon manager left to hold a passphrase.
--
-- ─── and this migration sorts AFTER 0011, so: does it undo the cutover? ────
--
-- No, and it was checked rather than assumed, because 0013 sorted after 0011
-- and re-granted anon exactly this way. Every statement here only narrows. The
-- single GRANT is current_session_header, whose grants 0011 never touches — it
-- only calls the function from policies. Verified in both orderings: a full
-- `supabase db reset` and a pre-0011 production replica.

-- ─── pin the one search_path that was never set ────────────────────────────
--
-- current_session_header() is SECURITY INVOKER, so it runs with the caller's
-- privileges and the risk is smaller than for the definers — but an unpinned
-- search_path on a function every RLS policy in the database calls is not worth
-- leaving. Body verbatim from 0001; only the setting is added.

CREATE OR REPLACE FUNCTION public.current_session_header() RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT (current_setting('request.headers', true)::json ->> 'x-session-id')
$$;

-- CREATE OR REPLACE PRESERVES the ACL — measured, not assumed:
--
--     REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon;  →  postgres=X anon=X
--     CREATE OR REPLACE the body                      →  postgres=X anon=X
--
-- so these two statements are not repair work. They are the actual narrowing.
-- 0001 created this function and never revoked PUBLIC, and Postgres grants
-- EXECUTE to PUBLIC on every new function — which is the OTHER half of why
-- 0008's `REVOKE ... FROM PUBLIC` looked like a lockdown. Both halves have to
-- go: PUBLIC's implicit grant AND the anon entry the default privileges added.
-- Removing either alone leaves the function reachable.
--
-- anon KEEPS this one; the point is that PUBLIC does not, so a future role
-- cannot inherit it.
REVOKE ALL ON FUNCTION public.current_session_header() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_session_header() TO anon, authenticated;

-- Corollary, since 0016 and 0017 are still unapplied on the live project and
-- 0016 does CREATE OR REPLACE redeem_invite: applying them after this migration
-- will NOT re-open anything, because the replace keeps the ACL. Order is free.

COMMIT;
