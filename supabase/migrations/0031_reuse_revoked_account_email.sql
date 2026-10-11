-- 0031 — a manager can reuse an email left on an orphaned Auth user
--
-- Revocation deletes the profile so the Auth identity can still sign in but
-- sees no team data. When a manager creates a fresh account with that email,
-- this operation removes the old identity only while it still has no profile.
-- The check and deletion share a transaction; returning an id to the Edge
-- Function for a later Admin API deletion would race invite redemption.
-- Service-role only, with the account-creation authority checked again here.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_orphan_auth_user_for_email(
    p_actor uuid,
    p_email text,
    p_role public.app_role
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_role public.app_role;
    v_orphan_id uuid;
BEGIN
    SELECT role INTO v_actor_role
      FROM public.profiles
     WHERE id = p_actor
       FOR SHARE;

    IF v_actor_role IS NULL THEN
        RAISE EXCEPTION 'Only a team member can create accounts.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_role NOT IN ('manager', 'super') THEN
        RAISE EXCEPTION 'Only a manager can create accounts.'
            USING ERRCODE = '42501';
    END IF;

    IF p_role IS NULL THEN
        RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '42501';
    END IF;

    IF p_role IN ('manager', 'super') AND v_actor_role <> 'super' THEN
        RAISE EXCEPTION 'Only a super user can create a manager or another super user.'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.id INTO v_orphan_id
      FROM auth.users u
     WHERE lower(u.email) = lower(btrim(p_email))
       FOR UPDATE;

    IF v_orphan_id IS NULL THEN
        RETURN false;
    END IF;

    -- A profile insert takes KEY SHARE on its auth.users parent through the
    -- FK. FOR UPDATE conflicts with that lock, so redemption and deletion
    -- cannot commit together. Check the profile in a separate statement AFTER
    -- acquiring the lock: if we waited for redemption, its committed profile
    -- is now visible under READ COMMITTED, rather than the lookup's snapshot.
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_orphan_id) THEN
        RETURN false;
    END IF;

    DELETE FROM auth.users WHERE id = v_orphan_id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_orphan_auth_user_for_email(uuid, text, public.app_role)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_orphan_auth_user_for_email(uuid, text, public.app_role)
    TO service_role;

-- Remove the unsafe lookup if an earlier local draft was rehearsed.
DROP FUNCTION IF EXISTS public.orphan_auth_user_for_email(uuid, text, public.app_role);

COMMIT;
