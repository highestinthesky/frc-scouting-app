-- FINAL ROLLOUT GATE — do not add this file to supabase/migrations yet.
--
-- Run only after all of these are true:
--   1. migration 0024 is live;
--   2. username-sign-in is deployed and its production smoke test passes;
--   3. the client using username-sign-in is deployed;
--   4. cached PWA adoption has been observed for the agreed compatibility window.
--
-- Keeping this outside migrations makes `supabase db push` unable to revoke the
-- legacy RPC merely because the preparatory migration shipped.

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
