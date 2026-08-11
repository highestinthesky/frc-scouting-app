-- Migration: accounts a manager creates, rather than invites a scout redeems
--
-- The v0.6 draft: a super or manager enters someone's name, an account is
-- created with a temporary password, and that gets handed over. The scout signs
-- in and is made to choose a real password.
--
-- This is the database half. The other half is an Edge Function, because
-- creating an `auth.users` row needs the Auth admin API and `service_role`, and
-- a static GitHub Pages bundle cannot hold that key. That constraint is the
-- whole reason invite codes exist; see ROADMAP.md.
--
-- ─── why the function cannot just INSERT ───────────────────────────────────
--
-- `service_role` holds no DML on any table in `public` on this project — only
-- REFERENCES, TRIGGER and TRUNCATE, which is the default for a new table here.
-- The Edge Function can therefore create the auth user and nothing else.
--
-- So it calls create_managed_profile() instead: SECURITY DEFINER, granted to
-- service_role alone. That is better than widening the grants anyway. The
-- function is a named, reviewable operation with its own argument list, where
-- `GRANT INSERT ON profiles TO service_role` would be a standing capability
-- nothing constrains.
--
-- ─── the temporary password has to be visible as temporary ─────────────────
--
-- A handed-over password is known to at least two people, so the app has to
-- know it is provisional and make the scout replace it. `must_change_password`
-- is that flag. It is on `profiles` rather than in auth metadata because every
-- other thing the app asks about a person lives there, and because a policy can
-- read it.
--
-- The scout clears it themselves — profiles_self_update already allows a person
-- to update their own row, and guard_profile_update already blocks the fields
-- that matter (id, username, role). Nothing else needs adding.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS
    'Set when a manager created this account with a temporary password. The app '
    'forces a change at next sign-in and the scout clears it themselves.';

-- Managers see who has activated and who is still on the handed-over password,
-- which is the onboarding question with 20+ scouts registering over weeks.
GRANT SELECT (must_change_password) ON public.profiles TO authenticated;
GRANT UPDATE (must_change_password) ON public.profiles TO authenticated;

-- ─── the profile half of account creation ──────────────────────────────────
--
-- Called by the Edge Function AFTER it has created the auth user, with that
-- user's id. It re-checks the caller's authority rather than trusting the
-- function to have done it: this runs as SECURITY DEFINER, so it is the last
-- place the rules can be enforced, and "the caller already checked" is how a
-- privileged helper becomes a hole.
--
-- p_actor is the manager's id, passed explicitly. auth.uid() is NULL here —
-- the Edge Function authenticates with service_role, not with the manager's
-- token — so the actor cannot be inferred and has to be supplied and verified.

CREATE OR REPLACE FUNCTION public.create_managed_profile(
    p_actor uuid,
    p_id uuid,
    p_username text,
    p_first text,
    p_last text,
    p_role public.app_role DEFAULT 'scout'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_role public.app_role;
BEGIN
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = p_actor;

    IF v_actor_role IS NULL THEN
        RAISE EXCEPTION 'Only a team member can create accounts.' USING ERRCODE = '42501';
    END IF;

    IF v_actor_role NOT IN ('manager', 'super') THEN
        RAISE EXCEPTION 'Only a manager can create accounts.' USING ERRCODE = '42501';
    END IF;

    -- The same rule create_invite() enforces, and for the same reason: a manager
    -- who can mint a peer above themselves is not really below one.
    IF p_role IN ('manager', 'super') AND v_actor_role <> 'super' THEN
        RAISE EXCEPTION 'Only a super user can create a manager or another super user.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.profiles (id, username, first_name, last_name, role, must_change_password)
    VALUES (p_id, lower(btrim(p_username)), btrim(p_first), btrim(p_last), p_role, true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_managed_profile(uuid, uuid, text, text, text, public.app_role)
    FROM PUBLIC, anon, authenticated;
-- service_role only. A browser must never reach this: it names the account
-- holder's id as an argument, so anyone who could call it could attach a profile
-- of any role to any auth user.
GRANT EXECUTE ON FUNCTION public.create_managed_profile(uuid, uuid, text, text, text, public.app_role)
    TO service_role;

-- ─── is a username already taken? ──────────────────────────────────────────
--
-- The Edge Function generates a username and needs to know whether to try
-- again. It cannot SELECT from profiles — no DML, no SELECT — so it asks.
--
-- Returns only a boolean, never a row. That matters: email_for_username()
-- already lets an anonymous caller turn a username into an address, and this
-- must not become a second, richer way to enumerate the roster.

CREATE OR REPLACE FUNCTION public.username_taken(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE lower(username) = lower(btrim(p_username))
    );
$$;

REVOKE ALL ON FUNCTION public.username_taken(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.username_taken(text) TO service_role;

COMMIT;
