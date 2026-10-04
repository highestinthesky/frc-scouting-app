-- 0028 — knowing a username stops buying an email address, for everyone.
--
-- 0024 built the service-only path (username-sign-in resolves the address and
-- returns only tokens) and deliberately left the legacy grant open so cached
-- PWAs could still sign in. This closes it. It lived in supabase/rollout/ until
-- it ran, so `supabase db push` could not revoke the legacy RPC merely because
-- the preparatory migration had shipped.
--
-- The gate's four conditions, as they stood when it ran on 2026-10-04:
--   1. 0024 live                      — yes, since 2026-08-20; the DO block
--                                       below still refuses without it
--   2. username-sign-in deployed      — ACTIVE, smoke-tested 2026-08-20
--   3. its client deployed            — v0.75, 2026-08-20; the served bundle
--                                       references username-sign-in and never
--                                       email_for_username
--   4. cached-client adoption         — 45 days, and the PWA is autoUpdate +
--                                       skipWaiting, so a stale bundle replaces
--                                       itself on its first online open. Not
--                                       observed directly: the auth audit log
--                                       is off. The user made the call.
--
-- It was open to `authenticated` too, not only anon, so any signed-in scout
-- could resolve a teammate's address. Both close here, along with PUBLIC.

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.consume_username_sign_in_attempt(text,integer,integer)') IS NULL THEN
        RAISE EXCEPTION '0024 is not applied; refusing to remove the legacy login path.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC, anon, authenticated;

-- The Edge Function still needs the narrow SECURITY DEFINER bridge into
-- auth.users. State it again so the postcondition is explicit and auditable.
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO service_role;

COMMIT;
