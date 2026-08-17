-- Migration: the event code stops being a credential, permanently
--
-- The contract half of v0.6 Phase 4, and the cutover CLAUDE.md's tripwire was
-- waiting for. `AUTH_ENFORCED` flips to true in the same deploy as this file,
-- and neither half is safe alone:
--
--   the flag alone   locks the UI while the data stays readable by anyone who
--                    knows the event code, which is published on The Blue
--                    Alliance
--   this alone       locks the data while the UI still offers a passphrase and
--                    every manager write silently fails
--
-- 0019 was expand: it added membership policies BESIDE the session_id ones, and
-- Postgres ORs permissive policies together, so anon has kept full access this
-- whole time through the `x-session-id` header. That is what this closes.
--
-- ─── this is a one-way door ────────────────────────────────────────────────
--
-- After it, there is no anonymous path to any event data. A device that has not
-- signed in can still RECORD — that has never depended on the server and does
-- not now — but it cannot read or push. Every scout needs an account before the
-- next event, not during it.
--
-- ─── what is dropped, and why each is safe ─────────────────────────────────
--
-- 29 legacy policies   every one keys on current_session_header(), which is the
--                      event code hashed. 0019's <table>_evt_* policies already
--                      cover the same tables keyed on membership, and the RLS
--                      suite has exercised them since v0.66.
-- has_manager_token()  one shared passphrase for a whole team, typed into a
--                      form, with no way to tell who used it and no way to
--                      revoke it for one person. manages_event() replaced it.
-- event_meta.manager_token  where that hash was stored.
-- session_id           eight columns. event_id has carried the same uuid on
--                      every write since v0.68, and 0019 backfilled the rest.

BEGIN;

-- ─── every row must have an event before the column it depends on becomes the
--     only key ─────────────────────────────────────────────────────────────
--
-- 0019 deliberately left event_id NULL where a row's event_code failed the
-- shape check, so nothing was orphaned while session_id still worked. That
-- reprieve ends here: those rows are about to lose their only other key.
--
-- They are given an event rather than deleted. A row whose code was malformed
-- is still a scout's observation, and losing match data to a tidy-up is worse
-- than carrying an oddly-named event.

INSERT INTO public.events (id, code, name)
SELECT DISTINCT ON (session_id)
       session_id,
       'salvaged-' || left(replace(session_id::text, '-', ''), 8),
       'Salvaged event (' || coalesce(nullif(btrim(event_code), ''), 'no code') || ')'
  FROM (
        SELECT session_id, event_code FROM public.entries              WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.event_meta       WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.schedules        WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.assignments      WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.assignment_overrides WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.reminders        WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.picklist         WHERE event_id IS NULL
  UNION ALL SELECT session_id, event_code FROM public.picklist_prefs   WHERE event_id IS NULL
  ) AS orphaned
 WHERE session_id IS NOT NULL
 ORDER BY session_id
ON CONFLICT (id) DO NOTHING;

-- Everyone who has a profile can see a salvaged event, same reasoning as 0019's
-- membership backfill: access before this migration was "knows the code", which
-- everyone did, and silently revoking it based on a guess is worse.
INSERT INTO public.event_scouts (event_id, profile_id)
SELECT e.id, p.id
  FROM public.events e CROSS JOIN public.profiles p
 WHERE e.code LIKE 'salvaged-%'
ON CONFLICT (event_id, profile_id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'entries', 'event_meta', 'schedules', 'assignments',
        'assignment_overrides', 'reminders', 'picklist', 'picklist_prefs'
    ] LOOP
        EXECUTE format(
            'UPDATE public.%I SET event_id = session_id WHERE event_id IS NULL', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN event_id SET NOT NULL', t);
    END LOOP;
END $$;

-- ─── the primary keys move ─────────────────────────────────────────────────
--
-- Four tables are keyed on session_id, so the column cannot be dropped until
-- they are keyed on event_id instead. The values are identical for every
-- backfilled row, so this re-keys rather than re-shapes.

ALTER TABLE public.event_meta     DROP CONSTRAINT IF EXISTS event_meta_pkey;
ALTER TABLE public.event_meta     ADD PRIMARY KEY (event_id);
ALTER TABLE public.schedules      DROP CONSTRAINT IF EXISTS schedules_pkey;
ALTER TABLE public.schedules      ADD PRIMARY KEY (event_id);
ALTER TABLE public.picklist_prefs DROP CONSTRAINT IF EXISTS picklist_prefs_pkey;
ALTER TABLE public.picklist_prefs ADD PRIMARY KEY (event_id);
ALTER TABLE public.picklist       DROP CONSTRAINT IF EXISTS picklist_pkey;
ALTER TABLE public.picklist       ADD PRIMARY KEY (event_id, team_number);

-- ─── the legacy policies go ────────────────────────────────────────────────
--
-- Named explicitly rather than dropped by pattern. A loop over pg_policies
-- would also catch the 0019 policies this migration depends on, and a
-- DROP-everything-then-recreate leaves a window with no policy at all.

DROP POLICY IF EXISTS entries_session_select              ON public.entries;
DROP POLICY IF EXISTS entries_session_insert              ON public.entries;
DROP POLICY IF EXISTS entries_session_update              ON public.entries;
DROP POLICY IF EXISTS event_meta_session_select           ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_insert           ON public.event_meta;
DROP POLICY IF EXISTS event_meta_session_update           ON public.event_meta;
DROP POLICY IF EXISTS schedules_session_select            ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_insert            ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_update            ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_delete            ON public.schedules;
DROP POLICY IF EXISTS assignments_session_select          ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_insert          ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_update          ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_delete          ON public.assignments;
DROP POLICY IF EXISTS overrides_session_select            ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_insert            ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_update            ON public.assignment_overrides;
DROP POLICY IF EXISTS overrides_manager_delete            ON public.assignment_overrides;
DROP POLICY IF EXISTS reminders_session_select            ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_insert            ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_update            ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_delete            ON public.reminders;
DROP POLICY IF EXISTS picklist_session_select             ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_insert             ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_update             ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_delete             ON public.picklist;
DROP POLICY IF EXISTS picklist_prefs_session_select       ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_insert       ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_update       ON public.picklist_prefs;

-- 0011 named its policies differently and is no longer in migrations/ — it was
-- superseded by 0019 and moved out of the sequence the way 0013 was. These
-- drops are here so a database that DID receive it still converges.
DROP POLICY IF EXISTS entries_read              ON public.entries;
DROP POLICY IF EXISTS entries_insert            ON public.entries;
DROP POLICY IF EXISTS entries_update            ON public.entries;
DROP POLICY IF EXISTS schedules_read            ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_write   ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_edit    ON public.schedules;
DROP POLICY IF EXISTS schedules_manager_remove  ON public.schedules;
DROP POLICY IF EXISTS assignments_read          ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_write ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_edit  ON public.assignments;
DROP POLICY IF EXISTS assignments_manager_remove ON public.assignments;
DROP POLICY IF EXISTS reminders_read            ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_write   ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_edit    ON public.reminders;
DROP POLICY IF EXISTS reminders_manager_remove  ON public.reminders;
DROP POLICY IF EXISTS picklist_read             ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_write    ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_edit     ON public.picklist;
DROP POLICY IF EXISTS picklist_manager_remove   ON public.picklist;
DROP POLICY IF EXISTS picklist_prefs_read       ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_write ON public.picklist_prefs;
DROP POLICY IF EXISTS picklist_prefs_manager_edit  ON public.picklist_prefs;
DROP POLICY IF EXISTS event_meta_read           ON public.event_meta;
DROP POLICY IF EXISTS overrides_read            ON public.assignment_overrides;

-- ─── the archive RPC stops reading a header ────────────────────────────────
--
-- It took the event from `x-session-id` and the authority from a passphrase.
-- Both are gone: the event is an argument, and manages_event() decides.
--
-- picklist is NOT deleted here, matching what this function has always done.
-- Widening what the one destructive operation destroys is not a change to make
-- in passing.

CREATE OR REPLACE FUNCTION public.reset_event_data(p_event uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event uuid := p_event;
BEGIN
    -- The client used to identify the event with a header. Accept that shape for
    -- one release so a cached PWA that has not reloaded yet still works.
    IF v_event IS NULL THEN
        v_event := ((current_setting('request.headers', true))::json ->> 'x-session-id')::uuid;
    END IF;
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'No event given.' USING ERRCODE = '22004';
    END IF;
    IF NOT public.manages_event(v_event) THEN
        RAISE EXCEPTION 'Only a manager on this event can archive it.' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.assignment_overrides WHERE event_id = v_event;
    DELETE FROM public.reminders            WHERE event_id = v_event;
    DELETE FROM public.assignments          WHERE event_id = v_event;
    DELETE FROM public.schedules            WHERE event_id = v_event;
    DELETE FROM public.event_meta           WHERE event_id = v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_event_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_event_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_event_data(uuid) TO authenticated;
-- The no-argument form is what the old client calls. Drop it so there is exactly
-- one, and the default parameter serves both shapes.
DROP FUNCTION IF EXISTS public.reset_event_data();


-- ─── the planning policies, written out ────────────────────────────────────
--
-- 0019 built these seven tables' policies inside a DO block with format(). That
-- ran correctly, and it defeated src/lib/auth-policies.test.mjs, which parses
-- CREATE POLICY statements out of the migration source: a policy that only
-- exists as a format() template is invisible to static review, and this project
-- keeps those checks precisely because the bugs they catch have shipped before.
--
-- So they are re-created here as literal statements, identical in effect, and a
-- reviewer can now grep for the boundary on any table. DROP-then-CREATE is
-- idempotent and converges a database that already received 0019's versions.

DROP POLICY IF EXISTS event_meta_evt_select ON public.event_meta;
CREATE POLICY event_meta_evt_select ON public.event_meta
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS event_meta_evt_insert ON public.event_meta;
CREATE POLICY event_meta_evt_insert ON public.event_meta
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS event_meta_evt_update ON public.event_meta;
CREATE POLICY event_meta_evt_update ON public.event_meta
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS event_meta_evt_delete ON public.event_meta;
CREATE POLICY event_meta_evt_delete ON public.event_meta
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS schedules_evt_select ON public.schedules;
CREATE POLICY schedules_evt_select ON public.schedules
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS schedules_evt_insert ON public.schedules;
CREATE POLICY schedules_evt_insert ON public.schedules
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS schedules_evt_update ON public.schedules;
CREATE POLICY schedules_evt_update ON public.schedules
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS schedules_evt_delete ON public.schedules;
CREATE POLICY schedules_evt_delete ON public.schedules
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS assignments_evt_select ON public.assignments;
CREATE POLICY assignments_evt_select ON public.assignments
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS assignments_evt_insert ON public.assignments;
CREATE POLICY assignments_evt_insert ON public.assignments
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS assignments_evt_update ON public.assignments;
CREATE POLICY assignments_evt_update ON public.assignments
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS assignments_evt_delete ON public.assignments;
CREATE POLICY assignments_evt_delete ON public.assignments
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS assignment_overrides_evt_select ON public.assignment_overrides;
CREATE POLICY assignment_overrides_evt_select ON public.assignment_overrides
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS assignment_overrides_evt_insert ON public.assignment_overrides;
CREATE POLICY assignment_overrides_evt_insert ON public.assignment_overrides
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS assignment_overrides_evt_update ON public.assignment_overrides;
CREATE POLICY assignment_overrides_evt_update ON public.assignment_overrides
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS assignment_overrides_evt_delete ON public.assignment_overrides;
CREATE POLICY assignment_overrides_evt_delete ON public.assignment_overrides
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS reminders_evt_select ON public.reminders;
CREATE POLICY reminders_evt_select ON public.reminders
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS reminders_evt_insert ON public.reminders;
CREATE POLICY reminders_evt_insert ON public.reminders
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS reminders_evt_update ON public.reminders;
CREATE POLICY reminders_evt_update ON public.reminders
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS reminders_evt_delete ON public.reminders;
CREATE POLICY reminders_evt_delete ON public.reminders
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS picklist_evt_select ON public.picklist;
CREATE POLICY picklist_evt_select ON public.picklist
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS picklist_evt_insert ON public.picklist;
CREATE POLICY picklist_evt_insert ON public.picklist
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS picklist_evt_update ON public.picklist;
CREATE POLICY picklist_evt_update ON public.picklist
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS picklist_evt_delete ON public.picklist;
CREATE POLICY picklist_evt_delete ON public.picklist
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS picklist_prefs_evt_select ON public.picklist_prefs;
CREATE POLICY picklist_prefs_evt_select ON public.picklist_prefs
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS picklist_prefs_evt_insert ON public.picklist_prefs;
CREATE POLICY picklist_prefs_evt_insert ON public.picklist_prefs
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS picklist_prefs_evt_update ON public.picklist_prefs;
CREATE POLICY picklist_prefs_evt_update ON public.picklist_prefs
    FOR UPDATE TO authenticated
    USING (public.manages_event(event_id))
    WITH CHECK (public.manages_event(event_id));
DROP POLICY IF EXISTS picklist_prefs_evt_delete ON public.picklist_prefs;
CREATE POLICY picklist_prefs_evt_delete ON public.picklist_prefs
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

DROP POLICY IF EXISTS entries_evt_select ON public.entries;
CREATE POLICY entries_evt_select ON public.entries
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));
DROP POLICY IF EXISTS entries_evt_insert ON public.entries;
CREATE POLICY entries_evt_insert ON public.entries
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_event_member(event_id)
        AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
    );
DROP POLICY IF EXISTS entries_evt_update ON public.entries;
CREATE POLICY entries_evt_update ON public.entries
    FOR UPDATE TO authenticated
    USING (
        public.is_event_member(event_id)
        AND (submitted_by = (SELECT auth.uid()) OR public.manages_event(event_id))
    )
    WITH CHECK (public.is_event_member(event_id));

-- RLS was enabled by 0001/0009; restated so this file is self-contained for
-- review and so a table that somehow arrived without it converges.
ALTER TABLE public.entries              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_meta           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picklist             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picklist_prefs       ENABLE ROW LEVEL SECURITY;

-- ─── attribution is stamped, not asked for ─────────────────────────────────
--
-- 0019 enforced this with a WITH CHECK: submitted_by had to be null or the
-- caller. That rejects a forgery but permits a NULL, so a signed-in client that
-- simply omits the column creates an unattributed row — and "an immutable
-- account id on the row, stamped server-side" is the model this whole phase is
-- for.
--
-- 0011 had the right answer and never reached production; it is borrowed back
-- here. A BEFORE trigger fires ahead of the WITH CHECK, so a forged value is
-- corrected and then passes rather than being refused — the two mechanisms
-- agree instead of racing.
--
-- ─── INSERT ONLY, and that is not an oversight ─────────────────────────────
--
-- The first draft of this migration also handled UPDATE, pinning
-- NEW.submitted_by := OLD.submitted_by so attribution could never be revised.
-- src/lib/auth-policies.test.mjs caught it, because this project already
-- learned the lesson and left an assertion behind:
--
--   entries.submitted_by is ON DELETE SET NULL. Revoking a profile makes
--   Postgres issue an internal UPDATE setting the column to null — and a
--   BEFORE UPDATE trigger that restores OLD would undo the referential action.
--   Revoking anyone with historical entries would start failing, months later,
--   for a reason nobody would connect to this.
--
-- So UPDATE is protected by column privilege instead, below. That is checked
-- before any trigger runs, cannot be reasoned around, and referential actions
-- run as the table owner rather than as `authenticated`, so ON DELETE SET NULL
-- keeps working.

CREATE OR REPLACE FUNCTION public.stamp_submitted_by() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Null when there is no session. Recording never depends on auth, and a row
    -- can arrive from a device that was signed out when it was written; the
    -- client claims those locally on sign-in and pushes them attributed.
    NEW.submitted_by := (SELECT auth.uid());
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_submitted_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entries_stamp_submitted_by ON public.entries;
CREATE TRIGGER entries_stamp_submitted_by
    BEFORE INSERT ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.stamp_submitted_by();

-- ─── corrections are per column ────────────────────────────────────────────
--
-- A scout may fix what they observed. They may not rewrite who observed it, and
-- neither may the manager the UPDATE policy lets correct someone else's row.
-- session_id is absent from this list because this migration drops it.

REVOKE UPDATE ON public.entries FROM authenticated;
GRANT UPDATE (
    event_id, event_code, match_number, team_number, alliance_color,
    scout_name, observations, schema_version, client_id, created_at
) ON public.entries TO authenticated;
-- Belt and braces: an earlier wholesale grant must not survive a partial re-run.
REVOKE UPDATE (submitted_by) ON public.entries FROM PUBLIC, anon, authenticated;

-- ─── the passphrase is deleted, not disabled ───────────────────────────────
--
-- Left inert it would be a dead credential mechanism that still looks live,
-- which is how someone later mistakes it for protection.

DROP FUNCTION IF EXISTS public.has_manager_token() CASCADE;
ALTER TABLE public.event_meta DROP COLUMN IF EXISTS manager_token;

-- ─── session_id goes ───────────────────────────────────────────────────────
--
-- The entries dedupe index is rebuilt on event_id first. It is a CONTENT
-- fingerprint and sync depends on it raising 23505 so it can adopt the existing
-- row's id — so it must never be absent, and identity must never enter it.
-- 0019 already created the event_id form; this drops the session_id one.

DROP INDEX IF EXISTS public.entries_dedupe_idx;
DROP INDEX IF EXISTS public.entries_session_idx;
DROP INDEX IF EXISTS public.entries_session_updated_idx;
DROP INDEX IF EXISTS public.entries_submitted_by_idx;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'entries', 'event_meta', 'schedules', 'assignments',
        'assignment_overrides', 'reminders', 'picklist', 'picklist_prefs'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS session_id', t);
    END LOOP;
END $$;

-- current_session_header() survives with no callers left in this schema. It is
-- three lines, harmless, and 0001 creates it — dropping it would make 0001
-- non-re-runnable against a database that has had this migration.

-- ─── anon loses every table ────────────────────────────────────────────────
--
-- The policies are already `TO authenticated`, so this is belt to that braces.
-- It matters anyway: a future policy written without a TO clause would hand anon
-- access again, and the grant is the backstop that stops it.

REVOKE ALL ON public.entries, public.event_meta, public.schedules,
              public.assignments, public.assignment_overrides, public.reminders,
              public.picklist, public.picklist_prefs
    FROM anon;

REVOKE EXECUTE ON FUNCTION public.current_session_header() FROM anon;

COMMIT;
