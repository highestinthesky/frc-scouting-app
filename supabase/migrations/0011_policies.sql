-- Migration: the auth cutover — accounts replace the manager passphrase
--
-- ═══════════════════════════════════════════════════════════════════════════
--  DO NOT RUN THIS UNTIL EVERY CONDITION BELOW IS TRUE. IT IS A ONE-WAY DOOR.
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. Every person on the team has an account and has signed in at least
--      once, on every device they will use.
--   2. At least one super user exists.
--   3. 0010 has been applied and its unmatched/collision reports reviewed.
--      Those UUID columns remain an expansion surface; this migration does not
--      require them to be complete or use them as an authorization key.
--   4. `AUTH_ENFORCED = true` ships in the SAME deploy. Not before, not after.
--   5. It is the off-season, with a week of ordinary use ahead of it before
--      anything matters.
--
-- Applying this while the client still has AUTH_ENFORCED = false leaves an app
-- that offers passphrase entry, accepts the passphrase, and silently rejects
-- every write. Flipping the flag without applying this locks the UI while the
-- data stays open to anyone with the event code. Both are worse than today.
-- `src/lib/auth.test.mjs` fails when the flag moves, which is the reminder.
--
-- ─── What changes ──────────────────────────────────────────────────────────
--
-- Today every write is gated by has_manager_token(): a SHA-256 of a passphrase,
-- sent as a header. It works, and it has two problems that no amount of care
-- fixes. A shared secret cannot say WHO did something — the first stated reason
-- for wanting accounts. And `session_id` is derived from the event code, which
-- is published on The Blue Alliance, so the security boundary is public
-- knowledge.
--
-- After this, `to authenticated` is the boundary and `is_manager()` is the
-- gate. `session_id` stays exactly where it is and keeps doing the job it is
-- good at — partitioning data by event. It stops being the thing that keeps
-- strangers out, because it never really was.
--
-- ─── What does NOT change ──────────────────────────────────────────────────
--
-- `scout_name` stays on every table. 0010 added `profile_id` beside it and
-- backfilled what it could unambiguously, but the planning client still reads
-- and writes the text key. No policy below depends on profile_id. UUID
-- dual-write/read and any eventual text-column cleanup remain later work.
--
-- The entries dedupe index is untouched. It is a content fingerprint that the
-- sync layer relies on raising 23505; identity is not part of it.

BEGIN;

-- ─── profile security is repeated at the cutover ───────────────────────────
--
-- 0008 is already applied on the live project, so fixes added to that
-- corrective migration do not arrive merely because 0010 and this file are run
-- later. Repeating the guard and policies here makes the still-unapplied
-- cutover self-contained. Re-run the corrected 0008 before the cutover too;
-- otherwise its original broad UPDATE policy remains exploitable until this
-- transaction lands.

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Permissive policies combine with OR. Remove every policy, including an
-- unknown dashboard-created one, before installing the complete known set.
DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('profiles', 'invites')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

CREATE POLICY profiles_read ON public.profiles
    FOR SELECT TO authenticated USING (public.app_role() IS NOT NULL);

CREATE POLICY profiles_self_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

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

CREATE POLICY profiles_manager_delete ON public.profiles
    FOR DELETE TO authenticated
    USING (public.is_manager() AND id <> auth.uid() AND role <> 'super');

-- RLS does not hide columns. Keep the reserved recovery address out of the
-- roster response until a trusted recovery service actually exists.
REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (recovery_email) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, first_name, last_name, role, created_at)
    ON public.profiles TO authenticated;
GRANT UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, DELETE ON public.invites TO authenticated;

-- A manager who can list a super invite can redeem it into a second account
-- and bypass create_invite()'s role check. Only supers may see or cancel super
-- invites; ordinary managers retain the scout/manager invite workflow.
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

-- ─── entries ───────────────────────────────────────────────────────────────
--
-- Any signed-in team member may read and record within an event. `submitted_by` is
-- stamped server-side from auth.uid() rather than trusted from the client:
-- a client-supplied identity column is a claim, not a fact, and this one is
-- the accountability record.

CREATE OR REPLACE FUNCTION public.stamp_submitted_by() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.submitted_by := auth.uid();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_submitted_by() FROM PUBLIC;

DROP TRIGGER IF EXISTS entries_stamp_submitted_by ON public.entries;
CREATE TRIGGER entries_stamp_submitted_by
    BEFORE INSERT ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.stamp_submitted_by();

-- Older drafts protected attribution with a BEFORE UPDATE trigger. That blocks
-- the entries.submitted_by foreign key's ON DELETE SET NULL action and makes
-- revoking any profile with historical entries fail. Remove it; the grants at
-- the bottom exclude submitted_by from client UPDATE capability instead, while
-- allowing referential actions to maintain the foreign key.
DROP TRIGGER IF EXISTS entries_preserve_submitted_by ON public.entries;
DROP FUNCTION IF EXISTS public.preserve_submitted_by();

-- Corrective, not merely additive: permissive policies combine with OR, so an
-- old dashboard policy left beside these rules defeats them. Drop every policy
-- on the event-data tables before rebuilding the complete known set. This also
-- makes 0011 safe to re-run after a partially completed deployment.
DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN (
               'entries', 'schedules', 'assignments', 'assignment_overrides',
               'reminders', 'picklist', 'picklist_prefs', 'event_meta'
           )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Policies are inert when RLS is disabled. Re-enable it here rather than
-- assuming every earlier migration (or dashboard edit) left the tables in the
-- expected state; the cutover itself must establish its security boundary.
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picklist_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entries_session_select ON public.entries;
DROP POLICY IF EXISTS entries_session_insert ON public.entries;
DROP POLICY IF EXISTS entries_session_update ON public.entries;
DROP POLICY IF EXISTS entries_session_delete ON public.entries;

CREATE POLICY entries_read ON public.entries
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );

CREATE POLICY entries_insert ON public.entries
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND submitted_by = auth.uid()
    );

-- A scout may correct their own entry; a manager may correct any entry. Letting
-- every member rewrite every row while preserving the original submitted_by
-- would make the attribution actively misleading after someone else's edit.
CREATE POLICY entries_update ON public.entries
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND (submitted_by = auth.uid() OR public.is_manager())
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND (submitted_by = auth.uid() OR public.is_manager())
    );

-- Still no DELETE policy, deliberately. Removing an entry from a phone is a
-- local operation; the team's copy stays. That is the existing behaviour and
-- accounts do not change the reasoning.

-- ─── schedules ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS schedules_session_select ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_insert ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_update ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_delete ON public.schedules;

CREATE POLICY schedules_read ON public.schedules
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY schedules_manager_write ON public.schedules
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY schedules_manager_edit ON public.schedules
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY schedules_manager_remove ON public.schedules
    FOR DELETE TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- ─── assignments ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS assignments_session_select ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_insert ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_update ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_delete ON public.assignments;

-- Every scout reads the whole assignment list, not just their own row: the
-- coverage board and the "who else is watching this match" view both need it,
-- and there is nothing sensitive about who is scouting which robot.
CREATE POLICY assignments_read ON public.assignments
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY assignments_manager_write ON public.assignments
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY assignments_manager_edit ON public.assignments
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY assignments_manager_remove ON public.assignments
    FOR DELETE TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- ─── assignment_overrides ──────────────────────────────────────────────────

DROP POLICY IF EXISTS overrides_session_select ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_insert ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_update ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_delete ON public.assignment_overrides;

CREATE POLICY overrides_read ON public.assignment_overrides
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY overrides_manager_write ON public.assignment_overrides
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY overrides_manager_edit ON public.assignment_overrides
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY overrides_manager_remove ON public.assignment_overrides
    FOR DELETE TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- ─── reminders ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS reminders_session_select ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_insert ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_update ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_delete ON public.reminders;

CREATE POLICY reminders_read ON public.reminders
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY reminders_manager_write ON public.reminders
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY reminders_manager_edit ON public.reminders
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY reminders_manager_remove ON public.reminders
    FOR DELETE TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- ─── picklist ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS picklist_session_select ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_insert ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_update ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_delete ON public.picklist;

CREATE POLICY picklist_read ON public.picklist
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY picklist_manager_write ON public.picklist
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY picklist_manager_edit ON public.picklist
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY picklist_manager_remove ON public.picklist
    FOR DELETE TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

DROP POLICY IF EXISTS picklist_prefs_session_select ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_insert ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_update ON public.picklist_prefs;

CREATE POLICY picklist_prefs_read ON public.picklist_prefs
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY picklist_prefs_manager_write ON public.picklist_prefs
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY picklist_prefs_manager_edit ON public.picklist_prefs
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- ─── event_meta compatibility shell ────────────────────────────────────────
--
-- The table held one thing that mattered: the passphrase hash. Everything else
-- on it (session_id, event_code, timestamps) is derivable or duplicated. The
-- hash is no longer an authorization input after this transaction, but the
-- column remains for one compatibility release: a cached PWA can still mention
-- it in a shaped request. 0012 removes the inert schema after the cache/soak
-- window instead of making that cleanup part of the security cutover.

DROP POLICY IF EXISTS event_meta_session_select ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_insert ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_update ON public.event_meta;

CREATE POLICY event_meta_read ON public.event_meta
    FOR SELECT TO authenticated USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
    );
CREATE POLICY event_meta_manager_write ON public.event_meta
    FOR INSERT TO authenticated WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );
CREATE POLICY event_meta_manager_edit ON public.event_meta
    FOR UPDATE TO authenticated
    USING (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    )
    WITH CHECK (
        public.app_role() IS NOT NULL
        AND session_id::text = public.current_session_header()
        AND public.is_manager()
    );

-- Archive/reset is a SECURITY DEFINER RPC, so its own checks are the security
-- boundary. Replace the passphrase-era body before disabling the helper it
-- called. Entries are deliberately preserved; all event planning state goes.
CREATE OR REPLACE FUNCTION public.reset_event_data() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    hdr_sid uuid;
BEGIN
    IF NOT public.is_manager() THEN
        RAISE EXCEPTION 'manager role required to archive event data'
            USING ERRCODE = '42501';
    END IF;

    hdr_sid := NULLIF(public.current_session_header(), '')::uuid;
    IF hdr_sid IS NULL THEN
        RAISE EXCEPTION 'session id required to archive event data'
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.assignment_overrides WHERE session_id = hdr_sid;
    DELETE FROM public.reminders WHERE session_id = hdr_sid;
    DELETE FROM public.assignments WHERE session_id = hdr_sid;
    DELETE FROM public.schedules WHERE session_id = hdr_sid;
    DELETE FROM public.picklist WHERE session_id = hdr_sid;
    DELETE FROM public.picklist_prefs WHERE session_id = hdr_sid;
    DELETE FROM public.event_meta WHERE session_id = hdr_sid;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_event_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_event_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_event_data() TO authenticated;

-- 0010 uses this SECURITY DEFINER helper for its one-time backfill. The client
-- never needs it, and leaving it executable would let a revoked/orphaned auth
-- user probe the roster by name after the cutover.
REVOKE ALL ON FUNCTION public.profile_for_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_for_name(text) FROM anon;
REVOKE ALL ON FUNCTION public.profile_for_name(text) FROM authenticated;

-- ─── the passphrase gate is disabled ───────────────────────────────────────
--
-- Keep the function signature briefly so an old prepared/schema-cached request
-- does not fail because the object vanished. It always denies, has no table
-- access, and is not executable by API roles. No policy or RPC above calls it;
-- accounts and is_manager() are the only live authorization path. 0012 drops
-- this inert compatibility object with RESTRICT after the PWA soak window.
CREATE OR REPLACE FUNCTION public.has_manager_token() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT false
$$;

REVOKE ALL ON FUNCTION public.has_manager_token() FROM PUBLIC, anon, authenticated;

-- ─── grants ────────────────────────────────────────────────────────────────
--
-- RLS decides which ROWS; grants decide whether the role may touch the table at
-- all. Both are needed, and `anon` keeps none of them — an unauthenticated
-- request now sees nothing anywhere, which is the entire point of the cutover.

REVOKE ALL ON public.entries, public.schedules, public.assignments,
              public.assignment_overrides, public.reminders,
              public.picklist, public.picklist_prefs, public.event_meta
       FROM anon;

-- 0001 granted table-wide UPDATE to authenticated. Revoke it before granting
-- only the columns the sync correction path legitimately changes. In
-- particular, submitted_by is absent: it is stamped on INSERT and remains the
-- original author. Column privileges do not interfere with the foreign key's
-- internal ON DELETE SET NULL action when a profile is revoked.
REVOKE UPDATE ON public.entries FROM authenticated;
REVOKE UPDATE (submitted_by) ON public.entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.entries TO authenticated;
GRANT UPDATE (
    session_id, event_code, match_number, team_number, alliance_color,
    scout_name, observations, schema_version, client_id, created_at
) ON public.entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.picklist TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.picklist_prefs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.event_meta TO authenticated;

COMMIT;

-- ─── afterwards ────────────────────────────────────────────────────────────
--
-- Ship the AUTH_ENFORCED client in the same release and run
-- supabase/verify_migrations.sql. During the compatibility window the old
-- column/function still exist, but neither grants authority. After cached PWA
-- clients have aged out and the auth build has soaked successfully, apply
-- 0012_passphrase_cleanup.sql and run the verifier again.
