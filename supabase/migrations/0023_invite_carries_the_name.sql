-- Migration: the manager types the name, and the invite carries it
--
-- Until now an invite carried a role and nothing else. The person redeeming it
-- typed their own first and last name, and that string became the join key for
-- every assignment, override and reminder addressed to them.
--
-- ─── why that was the wrong place to ask ───────────────────────────────────
--
-- The manager assigns "Haolun Ning" a team. The scout registers as "haolun",
-- or "Haolun N", or "Ning". Nothing rejects it — there is nothing to compare
-- against — so the assignment silently addresses a person who does not exist,
-- and the scout opens the app to an empty Your Teams with no way to tell why.
--
-- scout-identity.js exists because that mismatch was already happening between
-- call sites; this is the same failure one level earlier, between two humans.
-- Normalising harder does not fix it. The only fix is to stop asking twice.
--
-- So the name is typed once, by the person who is also typing the assignments,
-- and the invite carries it. Whatever username the scout picks — and they still
-- pick their own — the name on the profile is the manager's spelling.
--
-- ─── what this deliberately does not do ────────────────────────────────────
--
-- It does not make the name an identifier. `submitted_by` is the identity;
-- scout_name is a label, and the whole direction of v0.6 was to stop joining on
-- it. This closes the gap for the releases where both are still true, and it
-- makes the label right rather than making it load-bearing again.

BEGIN;

ALTER TABLE public.invites
    ADD COLUMN IF NOT EXISTS first_name text,
    ADD COLUMN IF NOT EXISTS last_name  text;

COMMENT ON COLUMN public.invites.first_name IS
    'The name the MANAGER typed. redeem_invite uses this, not what the person '
    'redeeming sends, so an assignment cannot be addressed to a spelling the '
    'scout never used.';

-- ─── creating an invite now names the person ───────────────────────────────
--
-- Nullable and defaulted, so an invite minted by an older client still works and
-- falls back to what the scout types. That matters for exactly one release: a
-- manager's phone may be running the previous bundle while this migration is
-- live, and refusing their invites would strand them mid-event.

-- 0008's body, unchanged except for the two new columns and the manager rule.
-- An earlier draft rewrote it and broke it twice over: gen_random_bytes() is
-- pgcrypto and unqualified under `search_path = ''`, and the collision retry
-- loop was dropped. Minimal delta on a working function beats a rewrite that
-- looks tidier.
CREATE OR REPLACE FUNCTION public.create_invite(
    p_role public.app_role DEFAULT 'scout',
    p_first text DEFAULT NULL,
    p_last  text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code text;
BEGIN
    IF NOT public.is_manager() THEN
        RAISE EXCEPTION 'Only a manager can create invites.';
    END IF;
    -- Widened from 'super' to both elevated roles: a manager who can mint a peer
    -- above themselves is not really below one. Same rule create_managed_profile
    -- already enforces.
    IF p_role IN ('manager', 'super') AND NOT public.is_super() THEN
        RAISE EXCEPTION 'Only a super user can invite a manager or another super user.';
    END IF;

    -- Six characters from an alphabet with no 0/O/1/I/L: these get read aloud
    -- across a workshop and typed on a phone.
    LOOP
        v_code := (
            SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                                     (floor(random() * length('ABCDEFGHJKMNPQRSTUVWXYZ23456789')) + 1)::int,
                                     1), '')
            FROM generate_series(1, 6)
        );
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invites WHERE code = v_code);
    END LOOP;

    INSERT INTO public.invites (code, role, created_by, first_name, last_name)
    VALUES (
        v_code,
        p_role,
        auth.uid(),
        nullif(btrim(coalesce(p_first, '')), ''),
        nullif(btrim(coalesce(p_last, '')), '')
    );
    RETURN v_code;
END;
$$;

-- Adding defaulted parameters OVERLOADS rather than replaces, so 0008's
-- create_invite(app_role) survived alongside this one. PostgREST resolves an RPC
-- by the keys in the JSON body, so a client sending only p_role would bind to the
-- old function and mint an invite with no name on it — succeeding, silently,
-- while doing the exact thing this migration exists to prevent.
DROP FUNCTION IF EXISTS public.create_invite(public.app_role);

REVOKE ALL ON FUNCTION public.create_invite(public.app_role, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invite(public.app_role, text, text) TO authenticated;

-- ─── redeeming uses the invite's name, not the redeemer's ──────────────────
--
-- The p_first/p_last arguments stay in the signature so an older client still
-- calls this successfully — they are simply the fallback now, used only when the
-- invite carries no name. The username is still the scout's own choice.

CREATE OR REPLACE FUNCTION public.redeem_invite(
    p_code text, p_username text, p_first text, p_last text, p_recovery_email text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.app_role;
    v_first text;
    v_last text;
    v_code text := upper(trim(p_code));
    v_username text := lower(trim(p_username));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign up before redeeming an invite.';
    END IF;

    SELECT role, first_name, last_name INTO v_role, v_first, v_last
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
        -- The invite wins. What the redeemer sent is the fallback for invites
        -- minted before this migration, and nothing else.
        coalesce(v_first, trim(p_first)),
        coalesce(v_last, trim(p_last)),
        v_role,
        nullif(trim(coalesce(p_recovery_email, '')), '')
    );

    UPDATE public.invites
       SET redeemed_at = now(), redeemed_by = auth.uid()
     WHERE code = v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text, text, text, text, text) TO authenticated;

-- ─── and the registration form can show whose invite it is ─────────────────
--
-- peek_invite already tells an anonymous caller what role a code is for, before
-- there is a session. It now also returns the name, so /register can say "you
-- are joining as Haolun Ning" instead of asking a question whose answer is
-- already decided.
--
-- This widens what an anonymous caller learns from a code they hold: a name, not
-- just a role. That is the same exposure the code already was — an invite is a
-- credential handed to one person — and it is the point: the person redeeming it
-- has to be able to see that they were given the wrong one.

-- CREATE OR REPLACE cannot change a return type, so this is a drop and rebuild.
-- The `valid` column stays: /register's effect reads data[0].valid, and the
-- original returns a row even for an unknown code (a LEFT JOIN against a dummy)
-- so the form can say "that code is not valid" rather than showing nothing. The
-- caller does default to {valid:false} on zero rows, but changing a contract
-- that has a reason, for no reason, is how the next person gets surprised.
DROP FUNCTION IF EXISTS public.peek_invite(text);

CREATE FUNCTION public.peek_invite(p_code text)
RETURNS TABLE (valid boolean, role public.app_role, first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (i.code IS NOT NULL AND i.redeemed_at IS NULL AND i.expires_at > now()) AS valid,
        i.role,
        i.first_name,
        i.last_name
    FROM (SELECT 1) dummy
    LEFT JOIN public.invites i ON i.code = upper(trim(p_code))
$$;

REVOKE ALL ON FUNCTION public.peek_invite(text) FROM PUBLIC;
-- anon needs this: the scout has not signed up yet when they type the code.
GRANT EXECUTE ON FUNCTION public.peek_invite(text) TO anon, authenticated;

COMMIT;
