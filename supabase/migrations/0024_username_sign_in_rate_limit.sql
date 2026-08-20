-- Migration: server-side rate limiting for private username sign-in
--
-- `email_for_username()` exists because Supabase password auth accepts an email
-- while scouts are handed usernames. It is callable by anon today, which means
-- anyone can exchange a guessed username for a real address. The replacement is
-- the `username-sign-in` Edge Function: it resolves the address with service_role,
-- performs the password exchange, and returns only a session after the password
-- has been proven.
--
-- This migration deliberately DOES NOT revoke email_for_username yet. Production
-- still has cached PWA clients which call it. The safe order is:
--
--   1. apply this migration;
--   2. deploy and verify username-sign-in;
--   3. deploy the client that uses it;
--   4. after old-client adoption, run rollout/revoke_email_for_username.sql.
--
-- The rate key is an HMAC of IP + username, produced by the Edge Function. That
-- scopes bad guesses to one account on one network: a school or venue NAT cannot
-- lock out every scout because ten people mistyped different passwords.

BEGIN;

CREATE TABLE public.username_sign_in_limits (
    bucket text PRIMARY KEY,
    window_started timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 1,
    CONSTRAINT username_sign_in_limits_bucket_shape
        CHECK (bucket ~ '^[0-9a-f]{64}$'),
    CONSTRAINT username_sign_in_limits_attempts_positive
        CHECK (attempts > 0)
);

CREATE INDEX username_sign_in_limits_window_idx
    ON public.username_sign_in_limits (window_started);

ALTER TABLE public.username_sign_in_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.username_sign_in_limits FROM PUBLIC, anon, authenticated;

-- The existing lookup is already SECURITY DEFINER because auth.users is not a
-- client-readable table. Give only the trusted Edge Function's role the same
-- bridge. The staged rollout leaves the old browser grants in place for cached
-- clients; rollout/revoke_email_for_username.sql later removes those grants but
-- deliberately leaves this service_role grant intact.
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO service_role;

-- Count before authenticating. One INSERT ... ON CONFLICT makes concurrent
-- attempts atomic; a read followed by an update would let a burst race the cap.
CREATE FUNCTION public.consume_username_sign_in_attempt(
    p_bucket text,
    p_limit integer DEFAULT 10,
    p_window_seconds integer DEFAULT 900
) RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_attempts integer;
    v_started timestamptz;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF p_bucket IS NULL OR p_bucket !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid rate-limit bucket.' USING ERRCODE = '22023';
    END IF;
    IF p_limit < 1 OR p_limit > 100 OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION 'Invalid rate-limit policy.' USING ERRCODE = '22023';
    END IF;

    -- Bound storage left by invalid usernames without needing a scheduled job.
    DELETE FROM public.username_sign_in_limits
     WHERE window_started < v_now - interval '1 day';

    INSERT INTO public.username_sign_in_limits AS limits
        (bucket, window_started, attempts)
    VALUES (p_bucket, v_now, 1)
    ON CONFLICT (bucket) DO UPDATE
       SET attempts = CASE
               WHEN limits.window_started <= v_now - make_interval(secs => p_window_seconds)
                   THEN 1
               ELSE limits.attempts + 1
           END,
           window_started = CASE
               WHEN limits.window_started <= v_now - make_interval(secs => p_window_seconds)
                   THEN v_now
               ELSE limits.window_started
           END
    RETURNING limits.attempts,
              limits.window_started
         INTO v_attempts, v_started;

    allowed := v_attempts <= p_limit;
    retry_after_seconds := CASE
        WHEN allowed THEN 0
        ELSE greatest(
            1,
            ceil(extract(epoch FROM
                (v_started + make_interval(secs => p_window_seconds) - v_now)
            ))::integer
        )
    END;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION public.clear_username_sign_in_attempt(p_bucket text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    DELETE FROM public.username_sign_in_limits WHERE bucket = p_bucket;
$$;

REVOKE ALL ON FUNCTION public.consume_username_sign_in_attempt(text, integer, integer)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_username_sign_in_attempt(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_username_sign_in_attempt(text, integer, integer)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_username_sign_in_attempt(text)
    TO service_role;

COMMIT;
