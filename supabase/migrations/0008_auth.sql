-- 0008 · accounts, roles and invites.
--
-- Implements docs/adr-001-auth.md. ADDITIVE ONLY: nothing here changes an
-- existing policy, so the app keeps working exactly as it does today while
-- accounts are built and tested alongside. The cutover — swapping every table
-- to `to authenticated` and deleting the passphrase machinery — is 0011, and
-- is deliberately a separate step you run once accounts demonstrably work.
--
-- Two parallel authorisation systems is how you end up with a hole in one, so
-- this state is temporary by design, not a resting place.
--
-- ─── why invite codes ──────────────────────────────────────────────────────
--
-- The v6 plan had managers create accounts with temporary passwords. That
-- needs auth.admin.createUser(), which needs the service_role key, which can
-- never appear in a bundle served from GitHub Pages. Inverting it — managers
-- mint a code, scouts self-register — removes the requirement and with it the
-- temp-password generation, the delivery problem, the activation flag and the
-- forced first-login change. "Has this person signed up yet" becomes
-- invites.redeemed_at.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── role ──────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('scout', 'manager', 'super');
    END IF;
END $$;

-- ─── profiles ──────────────────────────────────────────────────────────────
--
-- One row per person. Deleting it revokes access completely, because every
-- policy keys off it — the orphaned auth.users row can sign in and see
-- nothing. That is the revoke path, and it needs no admin API.

CREATE TABLE IF NOT EXISTS public.profiles (
    id             uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    username       text        NOT NULL,
    first_name     text        NOT NULL,
    last_name      text        NOT NULL,
    role           public.app_role NOT NULL DEFAULT 'scout',
    -- Optional, and only ever used for password recovery. Not an identifier,
    -- and not how anyone signs in.
    recovery_email text,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT username_shape CHECK (username ~ '^[a-z0-9._-]{3,24}$')
);

-- Uniqueness is a DATABASE guarantee, not a UI one. The registration form
-- checks availability as a courtesy, but that check has a race window between
-- read and insert; this index is what actually holds. Case-insensitive, so
-- "HaolunZ" and "haolunz" cannot both exist — a confusion vector rather than a
-- security one, but the kind that generates a support request at 7am.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower
    ON public.profiles (lower(username));

-- ─── invites ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invites (
    code        text PRIMARY KEY,
    role        public.app_role NOT NULL DEFAULT 'scout',
    created_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
    redeemed_at timestamptz,
    redeemed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS invites_open_idx
    ON public.invites (expires_at) WHERE redeemed_at IS NULL;

-- ─── accountability on entries ─────────────────────────────────────────────
--
-- Nullable, and existing rows stay null. Null means "recorded before accounts
-- existed" — nothing is deleted and nothing is backfilled with a guess.
--
-- scout_name stays: it is the display name on a row and what the assignment
-- editor matches on. submitted_by is the accountability link. Two jobs.

ALTER TABLE public.entries
    ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- ─── role helpers ──────────────────────────────────────────────────────────
--
-- SECURITY DEFINER so the lookup isn't blocked by RLS on profiles itself, with
-- `search_path = ''` and fully-qualified names — the hardened form. The
-- existing has_manager_token() uses `search_path = public`, which is still
-- resolvable; 0011 retires that function entirely.

CREATE OR REPLACE FUNCTION public.app_role() RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_manager() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(public.app_role() IN ('manager', 'super'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_super() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(public.app_role() = 'super', false)
$$;

REVOKE ALL ON FUNCTION public.app_role()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super()   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_role()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super()   TO authenticated;

-- RLS decides which ROW a caller may update; it cannot safely express which
-- columns may change because WITH CHECK sees only the proposed row. Keep the
-- immutable identity and the role hierarchy in a trigger, where OLD and NEW are
-- both available. SQL-owner/service-role maintenance has no auth.uid() and is
-- deliberately left alone; these checks protect authenticated API callers.

CREATE OR REPLACE FUNCTION public.guard_profile_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_auth_email text;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'A profile must belong to the signed-in user.'
                USING ERRCODE = '42501';
        END IF;

        SELECT lower(u.email) INTO v_auth_email
          FROM auth.users u
         WHERE u.id = auth.uid();
        IF v_auth_email IS DISTINCT FROM lower(NEW.username) || '@scout.invalid' THEN
            RAISE EXCEPTION 'Profile username must match the signed-in account.'
                USING ERRCODE = '42501';
        END IF;
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

DROP TRIGGER IF EXISTS profiles_guard_identity ON public.profiles;
CREATE TRIGGER profiles_guard_identity
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

DROP TRIGGER IF EXISTS profiles_guard_insert_identity ON public.profiles;
CREATE TRIGGER profiles_guard_insert_identity
    BEFORE INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- ─── redeeming an invite ───────────────────────────────────────────────────
--
-- signUp() creates the auth user; this creates the profile and burns the code
-- in one transaction. No profile means no access, so an auth user created
-- without a valid invite can sign in and see nothing.

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
    v_auth_email text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign up before redeeming an invite.';
    END IF;

    SELECT lower(u.email) INTO v_auth_email
      FROM auth.users u
     WHERE u.id = auth.uid();
    IF v_auth_email IS DISTINCT FROM v_username || '@scout.invalid' THEN
        RAISE EXCEPTION 'That username does not match the signed-in account.'
            USING ERRCODE = '42501';
    END IF;

    -- FOR UPDATE is the point: without the lock, two scouts redeeming the same
    -- code at the same moment would both succeed.
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

-- ─── minting an invite ─────────────────────────────────────────────────────
--
-- Managers may invite scouts and managers; only a super may mint a super.
-- Enforced here rather than in the UI, because hiding a button is not
-- enforcement.

CREATE OR REPLACE FUNCTION public.create_invite(p_role public.app_role DEFAULT 'scout')
RETURNS text
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
    IF p_role = 'super' AND NOT public.is_super() THEN
        RAISE EXCEPTION 'Only a super user can invite another super user.';
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

    INSERT INTO public.invites (code, role, created_by) VALUES (v_code, p_role, auth.uid());
    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invite(public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invite(public.app_role) TO authenticated;

-- ─── looking up an invite before signing up ────────────────────────────────
--
-- /register shows what a code is for before the scout commits to creating an
-- account. Returns only the role and validity — never who created it, and
-- never anything about other codes.

CREATE OR REPLACE FUNCTION public.peek_invite(p_code text)
RETURNS TABLE (valid boolean, role public.app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (i.code IS NOT NULL AND i.redeemed_at IS NULL AND i.expires_at > now()) AS valid,
        i.role
    FROM (SELECT 1) dummy
    LEFT JOIN public.invites i ON i.code = upper(trim(p_code))
$$;

REVOKE ALL ON FUNCTION public.peek_invite(text) FROM PUBLIC;
-- anon needs this: the scout has not signed up yet when they type the code.
GRANT EXECUTE ON FUNCTION public.peek_invite(text) TO anon, authenticated;

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT tablename, policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename IN ('profiles', 'invites')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Every signed-in TEAM MEMBER can read the roster: the assignment editor and
-- reminder picker both need names. An auth.users row without a profile is an
-- unredeemed or revoked account, not membership.
CREATE POLICY profiles_read ON public.profiles
    FOR SELECT TO authenticated USING (public.app_role() IS NOT NULL);

-- You may edit yourself. guard_profile_update() keeps username immutable and
-- prevents this policy from becoming a self-promotion path.
CREATE POLICY profiles_self_update ON public.profiles
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- A manager may edit another scout/manager. Only a super may touch a row that
-- is or will become super; USING checks the old row, WITH CHECK the new one.
CREATE POLICY profiles_manager_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        public.is_manager()
        AND id <> auth.uid()
        AND (role <> 'super' OR public.is_super())
    )
    WITH CHECK (
        public.is_manager()
        AND id <> auth.uid()
        AND (role <> 'super' OR public.is_super())
    );

-- Revoking access = deleting the profile. A manager cannot delete themselves,
-- and cannot delete a super.
CREATE POLICY profiles_manager_delete ON public.profiles
    FOR DELETE TO authenticated
    USING (public.is_manager() AND id <> auth.uid() AND role <> 'super');

-- Insert happens only through redeem_invite(), which is SECURITY DEFINER and
-- bypasses this. No policy means no direct inserts.

CREATE POLICY invites_manager_read ON public.invites
    FOR SELECT TO authenticated USING (
        public.is_manager()
        AND (role <> 'super' OR public.is_super())
    );

CREATE POLICY invites_manager_delete ON public.invites
    FOR DELETE TO authenticated USING (
        public.is_manager()
        AND redeemed_at IS NULL
        AND (role <> 'super' OR public.is_super())
    );

-- Insert goes through create_invite() only.

-- recovery_email is reserved metadata for a future trusted recovery service;
-- it does not belong in the team roster. RLS filters rows, not columns, so a
-- table-wide SELECT would expose it to every member through direct REST calls.
REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (recovery_email) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, first_name, last_name, role, created_at)
    ON public.profiles TO authenticated;
GRANT UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, DELETE ON public.invites TO authenticated;

-- ─── bootstrap ─────────────────────────────────────────────────────────────
--
-- Chicken and egg: the first super needs an invite, and invites need a
-- creator. Once, by hand:
--
--   1. Dashboard → Authentication → Add user
--        email:    <username>@scout.invalid   ← MUST match the username below
--        password: (anything, 6+ characters)
--        auto-confirm: yes
--   2. Here, with that user's uuid and THE SAME username:
--
--        INSERT INTO public.profiles (id, username, first_name, last_name, role)
--        VALUES ('<uuid>', '<username>', 'First', 'Last', 'super');
--
--   The email is not a contact address and is not arbitrary. There is no
--   username → email lookup table anywhere, by design: signIn() computes
--   `username || '@scout.invalid'` and asks Supabase for exactly that. If the
--   local part of the email is not the username, the account is unreachable and
--   the only symptom is "that username and password do not match", which reads
--   like a typo. Every account created through /register gets this right
--   automatically; only this hand-made first one can get it wrong.
--   verify_migrations.sql asserts the two agree.
--
-- Also required, once: Confirm email: OFF.
--
--   REGISTRATION IS IMPOSSIBLE WITHOUT THIS. Not slow — impossible. GoTrue's
--   mailer validates the recipient before sending a confirmation, and
--   <username>@scout.invalid fails that check, so signup returns
--   'Email address "..." is invalid' and no account is created. The error names
--   the address, which sends you to look at the address; the address is fine.
--   With confirmation off nothing is sent, so nothing validates the recipient.
--
--   Accounts made through the dashboard's "Add user" work regardless, because
--   the admin API skips the mailer entirely. That is what made this look
--   verified when it was not.
--
--   Check it: GET /auth/v1/settings -> mailer_autoconfirm should be true.
--   See supabase/README.md § Project settings the migrations cannot set.

COMMIT;
