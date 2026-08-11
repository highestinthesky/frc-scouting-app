-- Migration: real email addresses, so password recovery exists at all
--
-- Every account's login address is currently `<username>@scout.invalid`,
-- computed from the username so nothing has to be looked up. RFC 2606 reserves
-- `.invalid` as permanently unroutable, which is the point — it is an
-- identifier, not a mailbox.
--
-- The consequence is that **password recovery is impossible**. Supabase sends
-- recovery to `auth.users.email`, and that address cannot receive anything.
-- `profiles.recovery_email` was added to hold a real address but nothing reads
-- it, because GoTrue does not consult it. The first person to forget a password
-- was locked out with no self-service path, which is exactly what happened.
--
-- Real addresses fix it with no Edge Function and no admin flow: Supabase's
-- built-in recovery works the moment `auth.users.email` is routable.
--
-- Verification stays OFF. `mailer_autoconfirm` stamps `email_confirmed_at` at
-- signup without sending anything, so the account is confirmed as far as GoTrue
-- is concerned and `/auth/v1/recover` still delivers. Registration keeps its
-- no-round-trip flow AND recovery works.
--
-- ─── what has to give ──────────────────────────────────────────────────────
--
-- Two places assert that the auth email equals `username@scout.invalid`. Both
-- become false the moment an address is real, so both come out. They were not
-- arbitrary — they existed because the username WAS the address, so a mismatch
-- made an account permanently unreachable with "that username and password do
-- not match" as the only symptom. Once the mapping is stored rather than
-- derived, there is no longer a relationship to assert.
--
-- ─── the lookup, and what it costs ─────────────────────────────────────────
--
-- signIn() can no longer compute the address, so it asks for it. email_for_username()
-- is that lookup, and it must be callable before anyone is signed in.
--
-- Be clear about the trade this makes, because it is a real one and it was
-- taken deliberately. An anonymous caller can pass a username and receive a
-- scout's real email address. Usernames are short and generated, so they are
-- guessable, and someone patient can walk the space and harvest addresses. The
-- alternative was signing in with the email itself, which needs no lookup and
-- exposes nothing; username sign-in was chosen with this understood.
--
-- Two things follow, and neither is optional:
--
--   1. Generated usernames need enough entropy that walking the space is not
--      cheap. The v0.6 draft suggests three digits after two initials; that is
--      ~676k combinations for a roster of 20, which is a weekend of requests.
--      Phase 3 owns username generation and should widen it.
--
--   2. When Phase 3's Edge Function exists, move this lookup inside it and
--      REVOKE it from anon. The function can resolve a username and sign in
--      without ever returning an address to the browser, which closes this
--      entirely. Until then the exposure is live and documented rather than
--      accidental.
--
-- Exact match only, deliberately: no prefix search, no listing, no wildcard.
-- One username in, at most one address out.

BEGIN;

-- ─── the guard stops asserting a relationship that no longer exists ────────
--
-- Unchanged otherwise: ids and usernames stay immutable, nobody changes their
-- own role, and only a super may promote or demote a super. Reproduced in full
-- because CREATE OR REPLACE cannot patch a body.

CREATE OR REPLACE FUNCTION public.guard_profile_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'A profile must belong to the signed-in user.'
                USING ERRCODE = '42501';
        END IF;
        -- The username/email assertion was here. With a real address there is
        -- nothing to compare: the username is stored, not encoded in the email.
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Profile ids are immutable.' USING ERRCODE = '42501';
    END IF;

    IF NEW.username IS DISTINCT FROM OLD.username THEN
        RAISE EXCEPTION 'Usernames are immutable.' USING ERRCODE = '42501';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF OLD.id = auth.uid() THEN
            RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '42501';
        END IF;

        IF (OLD.role = 'super' OR NEW.role = 'super') AND NOT public.is_super() THEN
            RAISE EXCEPTION 'Only a super user may promote or demote a super user.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_update() FROM PUBLIC;

-- ─── redemption stops checking the address too ─────────────────────────────
--
-- Everything else is byte-for-byte 0008's, including the FOR UPDATE lock that
-- stops two scouts redeeming one code at the same moment.

CREATE OR REPLACE FUNCTION public.redeem_invite(
    p_code text, p_username text, p_first text, p_last text, p_recovery_email text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.app_role;
    v_code text := upper(trim(p_code));
    v_username text := lower(trim(p_username));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign up before redeeming an invite.';
    END IF;

    SELECT role INTO v_role
      FROM public.invites
     WHERE code = v_code
       AND redeemed_at IS NULL
       AND expires_at > now()
     FOR UPDATE;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'That invite code is not valid, has expired, or has already been used.';
    END IF;

    INSERT INTO public.profiles (id, username, first_name, last_name, role, recovery_email)
    VALUES (
        auth.uid(),
        v_username,
        trim(p_first),
        trim(p_last),
        v_role,
        nullif(trim(coalesce(p_recovery_email, '')), '')
    );

    UPDATE public.invites
       SET redeemed_at = now(), redeemed_by = auth.uid()
     WHERE code = v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text, text, text, text, text) TO authenticated;

-- ─── the lookup ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u.email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE lower(p.username) = lower(btrim(p_username));
$$;

REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC;
-- anon by necessity: this is called BEFORE anyone has a session, which is the
-- whole reason it exists. See the exposure note at the top of this file, and
-- revoke this the moment Phase 3's Edge Function can do the lookup server-side.
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;

COMMIT;
