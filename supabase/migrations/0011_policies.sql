-- Migration: the auth cutover — accounts replace the manager passphrase
--
-- ═══════════════════════════════════════════════════════════════════════════
--  DO NOT RUN THIS UNTIL EVERY CONDITION BELOW IS TRUE. IT IS A ONE-WAY DOOR.
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. Every person on the team has an account and has signed in at least
--      once, on every device they will use.
--   2. At least one super user exists.
--   3. 0010 has been applied AND its backfill re-run, so profile_id is
--      populated. Check:
--          SELECT count(*) FROM public.assignments WHERE profile_id IS NULL;
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
-- backfilled what it could unambiguously; this migration makes profile_id the
-- key the policies care about, but dropping the text column is data loss for
-- every row recorded before accounts existed, and it buys nothing today.
-- That is a later cleanup, once the null count is zero and stays zero.
--
-- The entries dedupe index is untouched. It is a content fingerprint that the
-- sync layer relies on raising 23505; identity is not part of it.

BEGIN;

-- ─── entries ───────────────────────────────────────────────────────────────
--
-- Anyone signed in may read and record within an event. `submitted_by` is
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

DROP TRIGGER IF EXISTS entries_stamp_submitted_by ON public.entries;
CREATE TRIGGER entries_stamp_submitted_by
    BEFORE INSERT ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.stamp_submitted_by();

DROP POLICY IF EXISTS entries_session_select ON public.entries;
DROP POLICY IF EXISTS entries_session_insert ON public.entries;
DROP POLICY IF EXISTS entries_session_update ON public.entries;
DROP POLICY IF EXISTS entries_session_delete ON public.entries;

CREATE POLICY entries_read ON public.entries
    FOR SELECT TO authenticated USING (true);

CREATE POLICY entries_insert ON public.entries
    FOR INSERT TO authenticated WITH CHECK (true);

-- Correcting an entry is a normal part of scouting — a scout mistypes a match
-- number and fixes it. Anyone signed in may edit, because the alternative is a
-- scout who can see their own mistake and cannot repair it, and because
-- submitted_by records who wrote it originally either way.
CREATE POLICY entries_update ON public.entries
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Still no DELETE policy, deliberately. Removing an entry from a phone is a
-- local operation; the team's copy stays. That is the existing behaviour and
-- accounts do not change the reasoning.

-- ─── schedules ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS schedules_session_select ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_insert ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_update ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_delete ON public.schedules;

CREATE POLICY schedules_read ON public.schedules
    FOR SELECT TO authenticated USING (true);
CREATE POLICY schedules_manager_write ON public.schedules
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY schedules_manager_edit ON public.schedules
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY schedules_manager_remove ON public.schedules
    FOR DELETE TO authenticated USING (public.is_manager());

-- ─── assignments ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS assignments_session_select ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_insert ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_update ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_delete ON public.assignments;

-- Every scout reads the whole assignment list, not just their own row: the
-- coverage board and the "who else is watching this match" view both need it,
-- and there is nothing sensitive about who is scouting which robot.
CREATE POLICY assignments_read ON public.assignments
    FOR SELECT TO authenticated USING (true);
CREATE POLICY assignments_manager_write ON public.assignments
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY assignments_manager_edit ON public.assignments
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY assignments_manager_remove ON public.assignments
    FOR DELETE TO authenticated USING (public.is_manager());

-- ─── assignment_overrides ──────────────────────────────────────────────────

DROP POLICY IF EXISTS overrides_session_select ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_insert ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_update ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_delete ON public.assignment_overrides;

CREATE POLICY overrides_read ON public.assignment_overrides
    FOR SELECT TO authenticated USING (true);
CREATE POLICY overrides_manager_write ON public.assignment_overrides
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY overrides_manager_edit ON public.assignment_overrides
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY overrides_manager_remove ON public.assignment_overrides
    FOR DELETE TO authenticated USING (public.is_manager());

-- ─── reminders ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS reminders_session_select ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_insert ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_update ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_delete ON public.reminders;

CREATE POLICY reminders_read ON public.reminders
    FOR SELECT TO authenticated USING (true);
CREATE POLICY reminders_manager_write ON public.reminders
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY reminders_manager_edit ON public.reminders
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY reminders_manager_remove ON public.reminders
    FOR DELETE TO authenticated USING (public.is_manager());

-- ─── picklist ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS picklist_session_select ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_insert ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_update ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_delete ON public.picklist;

CREATE POLICY picklist_read ON public.picklist
    FOR SELECT TO authenticated USING (true);
CREATE POLICY picklist_manager_write ON public.picklist
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY picklist_manager_edit ON public.picklist
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY picklist_manager_remove ON public.picklist
    FOR DELETE TO authenticated USING (public.is_manager());

DROP POLICY IF EXISTS picklist_prefs_session_select ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_insert ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_update ON public.picklist_prefs;

CREATE POLICY picklist_prefs_read ON public.picklist_prefs
    FOR SELECT TO authenticated USING (true);
CREATE POLICY picklist_prefs_manager_write ON public.picklist_prefs
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY picklist_prefs_manager_edit ON public.picklist_prefs
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());

-- ─── event_meta loses its reason to exist ──────────────────────────────────
--
-- The table held one thing that mattered: the passphrase hash. Everything else
-- on it (session_id, event_code, timestamps) is derivable or duplicated. The
-- column goes; the table stays, empty of purpose but referenced by 0003's
-- reset function, and removing it is a separate tidy-up rather than part of a
-- security change.

DROP POLICY IF EXISTS event_meta_session_select ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_insert ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_update ON public.event_meta;

CREATE POLICY event_meta_read ON public.event_meta
    FOR SELECT TO authenticated USING (true);
CREATE POLICY event_meta_manager_write ON public.event_meta
    FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY event_meta_manager_edit ON public.event_meta
    FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());

ALTER TABLE public.event_meta DROP COLUMN IF EXISTS manager_token;

-- ─── the passphrase gate is gone ───────────────────────────────────────────
--
-- Dropped last, and with RESTRICT rather than CASCADE on purpose: if any policy
-- still references it, this migration fails loudly here instead of quietly
-- dropping that policy along with the function and leaving a table wide open.
-- A failure at this line means a policy was missed above — fix it, re-run.

DROP FUNCTION IF EXISTS public.has_manager_token() RESTRICT;

-- ─── grants ────────────────────────────────────────────────────────────────
--
-- RLS decides which ROWS; grants decide whether the role may touch the table at
-- all. Both are needed, and `anon` keeps none of them — an unauthenticated
-- request now sees nothing anywhere, which is the entire point of the cutover.

REVOKE ALL ON public.entries, public.schedules, public.assignments,
              public.assignment_overrides, public.reminders,
              public.picklist, public.picklist_prefs, public.event_meta
       FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.entries TO authenticated;
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
-- Run supabase/verify_migrations.sql. Its "passphrase gate still present" check
-- is expected to FAIL from here on — that check exists to tell you the cutover
-- has happened, and it will need inverting once this is applied.
--
-- Then, in the client, remove the managerToken plumbing. Nine files still send
-- a header nothing reads:
--
--     src/lib/supabase.js          the header itself
--     src/lib/session.svelte.js    stores the hash
--     src/lib/event-meta.js        the whole passphrase flow
--     src/lib/assignments.js       src/lib/tba.js
--     src/lib/reminders.js         src/lib/picklist-store.js
--     src/routes/scouting/+page.svelte
--     src/routes/insights/picklist/+page.svelte
--
-- Leaving them costs nothing functionally — the header is ignored — but a
-- security mechanism that looks live and is not is exactly the kind of thing
-- someone later mistakes for protection.
