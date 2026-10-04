-- 0027 — one function anon may call, so the keepalive can ask a real question.
--
-- scripts/keepalive.mjs pings the project twice a week so the free tier is not
-- paused over the offseason. Until this file, the only thing anon could do was
-- be refused: since 0020 it reaches no table, so the ping read `events` and
-- counted Postgres's own 42501 as proof of life. That is a real round trip into
-- the database, but it is a refusal, and Supabase does not publish what it
-- counts as activity. A query that SUCCEEDS is the unambiguous version.
--
-- ─── it answers nothing ─────────────────────────────────────────────────────
--
-- It reads no table and returns a constant, so granting it to anon reopens no
-- part of the 0020 cutover: holding the anon key still buys no row of anything.
-- SECURITY INVOKER (the default, written out) because it has nothing to borrow
-- authority for — a DEFINER function here would be a privilege nobody needs.
--
-- ─── the grant, both halves ─────────────────────────────────────────────────
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and production's
-- default ACL predates 0018. REVOKE from PUBLIC and then GRANT to the two roles
-- that should have it, by name, so the result is the same on production and on
-- the local stack regardless of which defaults each one started with.

CREATE OR REPLACE FUNCTION public.keepalive() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT true
$$;

COMMENT ON FUNCTION public.keepalive() IS
    'Called by scripts/keepalive.mjs so the project is not paused for inactivity. Reads nothing.';

REVOKE ALL ON FUNCTION public.keepalive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keepalive() TO anon, authenticated;
