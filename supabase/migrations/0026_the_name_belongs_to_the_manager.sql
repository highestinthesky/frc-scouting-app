-- 0026 — a scout's name is the manager's to set, and only the manager's to change.
--
-- `scout_name` is a JOIN KEY, not a label. Assignments, overrides and reminders
-- are all addressed to it, so a name that changes silently detaches a person
-- from every row aimed at them — and the person best placed to notice is not the
-- one who changed it.
--
-- 0023 made the invite carry the name the manager typed and made redeem_invite
-- prefer it over anything the redeemer sends, so the name is right at the moment
-- the profile is created. This closes the two ways it could still drift
-- afterwards.
--
-- ─── neither hole was reachable through the UI, and that is the point ────────
--
-- Settings shows a signed-in scout their name as text, not an input. The invite
-- form refuses to mint without a first and last name — in `auth.createInvite`,
-- in the browser. Both are real, and neither is a rule: a client that does not
-- offer something is not a server that refuses it. This is the 0021 lesson
-- exactly, where a comment asserting "a scout is deliberately NOT given this"
-- sat above a grant that gave it.
--
-- ─── this replaces 0016's body, not 0008's ──────────────────────────────────
--
-- guard_profile_update has been defined twice. The first draft of this migration
-- extended 0008's, which still asserted that the profile username matched
-- `<username>@scout.invalid` — an assertion 0016 deliberately DELETED when real
-- addresses arrived. CREATE OR REPLACE does not merge, so that draft silently
-- reverted 0016 and broke invite redemption outright. Filename order is
-- semantic in both directions: check for the LATEST definition, not the first.
--
-- Verified against the live schema before writing: guard_profile_update() checks
-- the id, the username and the role, and says nothing about first_name or
-- last_name; profiles carries a table-wide `GRANT UPDATE ... TO authenticated`,
-- so every column is writable by anyone who passes a policy — and
-- profiles_self_update passes every row where id = auth.uid().

-- ─── 1. a scout may not rename themselves ───────────────────────────────────
--
-- A trigger and not a column grant, because a column grant cannot tell a manager
-- from a scout: both are `authenticated`, so REVOKE UPDATE (first_name) would
-- take the ability away from the person who is supposed to have it. Only a
-- trigger can compare OLD to NEW and ask who is asking.
--
-- Managers may still rename themselves. profiles_manager_update carries
-- `id <> auth.uid()`, so a manager's own row is only reachable through
-- profiles_self_update — block that unconditionally and a manager's own typo
-- becomes permanent, with nobody able to fix it.
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
        -- The username/email assertion 0008 had is deliberately ABSENT: 0016
        -- removed it when real addresses arrived, because the username is stored
        -- rather than encoded in the email and there is nothing left to compare.
        -- This body is 0016's, extended — the first draft of this migration was
        -- built on 0008's instead and silently reverted 0016. The RLS suite
        -- caught it on the first run.
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Profile ids are immutable.' USING ERRCODE = '42501';
    END IF;

    IF NEW.username IS DISTINCT FROM OLD.username THEN
        RAISE EXCEPTION 'Usernames are immutable.' USING ERRCODE = '42501';
    END IF;

    -- New in 0026.
    IF (NEW.first_name IS DISTINCT FROM OLD.first_name
        OR NEW.last_name IS DISTINCT FROM OLD.last_name)
       AND OLD.id = auth.uid()
       AND NOT public.is_manager() THEN
        RAISE EXCEPTION 'Your name is set by your manager. Ask them to change it.'
            USING ERRCODE = '42501';
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

-- ─── 2. an invite must carry a name ─────────────────────────────────────────
--
-- The name is only "set by the manager" if there is one. 0023 left p_first and
-- p_last defaulting to NULL so an older client kept working through the rollout;
-- that window is closed, and a nameless invite is the one remaining way a
-- redeemer ends up typing their own name into their own profile.
--
-- The arguments keep their defaults rather than becoming NOT NULL parameters, so
-- a stale cached bundle calling create_invite(p_role) gets a clear error instead
-- of "function does not exist" — which is what a 404 on the RPC would look like
-- to a manager standing at a table.
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
    v_code  text;
    v_first text := nullif(btrim(coalesce(p_first, '')), '');
    v_last  text := nullif(btrim(coalesce(p_last,  '')), '');
BEGIN
    IF NOT public.is_manager() THEN
        RAISE EXCEPTION 'Only a manager can create invites.';
    END IF;
    IF p_role IN ('manager', 'super') AND NOT public.is_super() THEN
        RAISE EXCEPTION 'Only a super user can invite a manager or another super user.';
    END IF;
    IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'An invite carries the name you type. Enter a first and last name.'
            USING ERRCODE = '22023';
    END IF;

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
    VALUES (v_code, p_role, auth.uid(), v_first, v_last);
    RETURN v_code;
END;
$$;

-- CREATE OR REPLACE preserves the ACL — measured, and recorded in CLAUDE.md —
-- so neither function's grants are restated here. Restating them is how a
-- migration that meant to change a body quietly changes a permission.
