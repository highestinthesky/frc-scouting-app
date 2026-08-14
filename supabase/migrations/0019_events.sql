-- Migration: events become real rows, and membership decides who sees them
--
-- This is the expand half of v0.6 Phase 4. Nothing is dropped here; `session_id`
-- keeps working exactly as it does today and `event_id` arrives beside it. The
-- contract migration removes the old key once the client no longer sends it.
--
-- ROADMAP calls Phase 4 "one migration". That reasoning was about doing events
-- and identity together rather than migrating `entries` twice, and that still
-- holds — both land here. It was not an argument for a flag day. 0010 used the
-- same expand shape for `profile_id`, and the alternative is a deploy where the
-- database and the bundle have to land in the same instant, which is the exact
-- shape of the AUTH_ENFORCED/0011 problem CLAUDE.md warns about.
--
-- ─── what this replaces, and why it is not a tidy-up ───────────────────────
--
-- `session_id` is SHA-256("frc-scout:event:" || code) folded into a UUID. It is
-- derived, not stored, so it was never an identifier the database issued — it
-- was the event code wearing a UUID costume. Two consequences, both real:
--
--   The code is published on The Blue Alliance, so the "secret" scoping every
--   policy depends on is public. Anyone with the URL can read the event.
--
--   "Which events may I see" was circular. You needed the code to read
--   `event_meta`, so there was no way to ask the database what you had access
--   to — only to assert access you already claimed.
--
-- Membership dissolves both. The server knows who you are from the JWT and which
-- events you belong to from `event_scouts`, so a device can ask "what are my
-- events" and get an answer, and knowing a code grants nothing.
--
-- ─── the event code does not disappear ─────────────────────────────────────
--
-- It stays on `events.code` because The Blue Alliance's API is keyed on it and
-- the schedule import needs it. What changes is its job: a label the app looks
-- things up with, never a credential.

BEGIN;

-- ─── events ────────────────────────────────────────────────────────────────
--
-- The code check is permissive on purpose. TBA codes are `2026onto`, but this
-- has to accept whatever is already in the eight tables being backfilled below,
-- including the hyphenated codes the RLS harness seeds. A migration that fails
-- on its own backfill is worse than a loose constraint.

CREATE TABLE IF NOT EXISTS public.events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL,
    name        text NOT NULL,
    starts_on   date,
    ends_on     date,
    created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT events_code_shape CHECK (code ~ '^[a-z0-9._-]{2,32}$')
);

COMMENT ON TABLE public.events IS
    'One row per scouting event. The id is issued here; events.code is the TBA '
    'code, kept because the schedule import needs it, and is a label rather '
    'than a credential.';

-- Partial, so archiving an event frees its code for a rerun next season without
-- destroying the rows recorded under it.
CREATE UNIQUE INDEX IF NOT EXISTS events_active_code_idx
    ON public.events (lower(code)) WHERE archived_at IS NULL;

-- ─── membership ────────────────────────────────────────────────────────────
--
-- The join a manager fills by dragging people onto an event. It is also the
-- entire authorization story for event data, which is why the index below is
-- not optional: every policy in this file goes through it, once per statement.

CREATE TABLE IF NOT EXISTS public.event_scouts (
    event_id   uuid NOT NULL REFERENCES public.events(id)   ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, profile_id)
);

-- The PK covers (event_id, profile_id). Membership is asked the other way round
-- — "is THIS user in that event" — so it needs the reverse.
CREATE INDEX IF NOT EXISTS event_scouts_profile_idx
    ON public.event_scouts (profile_id, event_id);

-- ─── backfill: one event per distinct (session_id, code) already in use ────
--
-- All eight tables carry both columns, so the pairs can be read straight out of
-- them. DISTINCT across the union rather than per-table, because the same event
-- appears in several.

-- The suffix on `code` is defensive rather than expected. session_id is
-- SHA-256 of the normalised code, so one code means one session_id and the two
-- can only disagree in hand-written rows — which the RLS harness does seed. If
-- that ever happens, the second event gets `code-2` instead of aborting the
-- migration on the unique index below. Failing here would leave a half-expanded
-- schema over something cosmetic.

INSERT INTO public.events (id, code, name)
SELECT session_id,                      -- keep the old uuid AS the event id
       CASE WHEN dup = 1 THEN code ELSE code || '-' || dup END,
       code                             -- no display name existed; the code is it
  FROM (
        SELECT DISTINCT ON (session_id)
               session_id,
               lower(btrim(event_code)) AS code,
               row_number() OVER (
                   PARTITION BY lower(btrim(event_code)) ORDER BY session_id
               ) AS dup
          FROM (
                SELECT session_id, event_code FROM public.entries
          UNION ALL SELECT session_id, event_code FROM public.event_meta
          UNION ALL SELECT session_id, event_code FROM public.schedules
          UNION ALL SELECT session_id, event_code FROM public.assignments
          UNION ALL SELECT session_id, event_code FROM public.assignment_overrides
          UNION ALL SELECT session_id, event_code FROM public.reminders
          UNION ALL SELECT session_id, event_code FROM public.picklist
          UNION ALL SELECT session_id, event_code FROM public.picklist_prefs
          ) AS used
         WHERE session_id IS NOT NULL
           AND btrim(coalesce(event_code, '')) <> ''
           AND lower(btrim(event_code)) ~ '^[a-z0-9._-]{2,32}$'
         ORDER BY session_id
  ) AS one_per_session
ON CONFLICT (id) DO NOTHING;

-- Reusing session_id as events.id is deliberate. It makes the backfill of the
-- eight tables a copy rather than a join, and it means a device holding a
-- half-synced queue keyed on the old uuid is still talking about the same event
-- after the cutover. The value stops being derived from the code the moment
-- this migration runs — new events get gen_random_uuid() — so the property that
-- mattered (knowing the code lets you compute the key) is already gone.

-- ─── event_id on all eight tables ──────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'entries', 'event_meta', 'schedules', 'assignments',
        'assignment_overrides', 'reminders', 'picklist', 'picklist_prefs'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS event_id uuid', t);
        -- Only where an event row exists. A row whose code failed the shape check
        -- keeps a null event_id and stays reachable through session_id until the
        -- contract migration, rather than being silently orphaned now.
        EXECUTE format(
            'UPDATE public.%I t SET event_id = t.session_id
               WHERE t.event_id IS NULL
                 AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = t.session_id)', t);
        EXECUTE format(
            'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_event_id_fkey');
        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (event_id)
                 REFERENCES public.events(id) ON DELETE CASCADE', t, t || '_event_id_fkey');
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (event_id)', t || '_event_idx', t);
    END LOOP;
END $$;

-- entries is read by event and ordered by time on every screen that matters, so
-- it gets the composite forms rather than the bare event_id index above.
CREATE INDEX IF NOT EXISTS entries_event_created_idx ON public.entries (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entries_event_updated_idx ON public.entries (event_id, updated_at);
CREATE INDEX IF NOT EXISTS entries_event_submitter_idx ON public.entries (event_id, submitted_by);

-- ─── the dedupe fingerprint gains event_id and keeps everything else ───────
--
-- CLAUDE.md: this index is a CONTENT fingerprint and identity stays out of it,
-- because sync relies on it raising 23505 so it can adopt the existing row's id.
-- Adding submitted_by would turn two devices' record of one observation into two
-- rows. event_id is not identity — it is the same scoping session_id already
-- provided, under its new name — so it goes in and scout_name stays.
--
-- The old index is kept until the contract migration. Two overlapping unique
-- indexes are consistent here: event_id is a copy of session_id for every
-- backfilled row, so anything violating one violates the other.

CREATE UNIQUE INDEX IF NOT EXISTS entries_event_dedupe_idx
    ON public.entries (event_id, event_code, match_number, team_number, scout_name, created_at);

-- ─── membership backfill ───────────────────────────────────────────────────
--
-- Everyone who already has a profile joins every event that already exists.
--
-- That is deliberately generous, and it is the only correct answer: before this
-- migration, access was "knows the event code", which every team member did.
-- Anything narrower would revoke access people currently have, mid-season, based
-- on a guess about who was at which event. Managers prune from the Studio.

INSERT INTO public.event_scouts (event_id, profile_id)
SELECT e.id, p.id FROM public.events e CROSS JOIN public.profiles p
ON CONFLICT (event_id, profile_id) DO NOTHING;

-- ─── who is a member, and who runs the event ───────────────────────────────
--
-- SECURITY DEFINER because event_scouts is itself RLS-protected and a policy
-- that reads it directly would recurse. STABLE so it is evaluated once per
-- statement rather than once per row.

CREATE OR REPLACE FUNCTION public.is_event_member(p_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.event_scouts
         WHERE event_id = p_event
           AND profile_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.is_event_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_event_member(uuid) TO authenticated;

-- A super runs every event without being dragged onto it — they are the account
-- that fixes things, and needing to add themselves first is how "the person who
-- can fix it cannot reach it" happens at 11pm before a competition. A manager
-- runs the events they belong to.
CREATE OR REPLACE FUNCTION public.manages_event(p_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.is_super()
        OR (public.is_event_member(p_event) AND public.app_role() = 'manager');
$$;

REVOKE ALL ON FUNCTION public.manages_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manages_event(uuid) TO authenticated;

-- ─── creating an event ─────────────────────────────────────────────────────
--
-- An RPC rather than a bare INSERT, because creating an event and joining it are
-- one act. A manager who created an event they were not a member of would have
-- made something they cannot see — the INSERT would succeed and every subsequent
-- read would return nothing, which reads as data loss.

CREATE OR REPLACE FUNCTION public.create_event(
    p_code text,
    p_name text,
    p_starts_on date DEFAULT NULL,
    p_ends_on date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_actor uuid := (SELECT auth.uid());
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to create an event.' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_manager() OR public.is_super()) THEN
        RAISE EXCEPTION 'Only a manager can create an event.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.events (code, name, starts_on, ends_on, created_by)
    VALUES (lower(btrim(p_code)), btrim(p_name), p_starts_on, p_ends_on, v_actor)
    RETURNING id INTO v_id;

    INSERT INTO public.event_scouts (event_id, profile_id, added_by)
    VALUES (v_id, v_actor, v_actor);

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event(text, text, date, date) TO authenticated;

-- ─── RLS ───────────────────────────────────────────────────────────────────
--
-- These sit ALONGSIDE the session_id policies rather than replacing them.
-- Postgres ORs permissive policies together, so during the expand window a
-- request is allowed if the old header path OR the new membership path permits
-- it. The old path is removed by the contract migration, and until then nothing
-- in the running app changes.
--
-- Every one is `TO authenticated`. anon reaches none of them, which is the whole
-- point of the change.

ALTER TABLE public.events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_scouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_member_select ON public.events;
CREATE POLICY events_member_select ON public.events
    FOR SELECT TO authenticated
    USING (public.is_event_member(id) OR public.is_manager() OR public.is_super());

-- Managers see every event so they can staff one they are not on yet. Scouts see
-- only theirs, which is the question that had no answer before this migration.

DROP POLICY IF EXISTS events_manager_update ON public.events;
CREATE POLICY events_manager_update ON public.events
    FOR UPDATE TO authenticated
    USING (public.manages_event(id)) WITH CHECK (public.manages_event(id));

DROP POLICY IF EXISTS events_super_delete ON public.events;
CREATE POLICY events_super_delete ON public.events
    FOR DELETE TO authenticated
    USING (public.is_super());

-- Deleting an event cascades to every row recorded at it. Supers only, and the
-- app should archive instead — archived_at exists so deletion stays rare.

-- INSERT has no policy: create_event() is the only way in, and it is SECURITY
-- DEFINER so it does not need one. A direct INSERT therefore fails, which is
-- what keeps "created it" and "belongs to it" from drifting apart.

DROP POLICY IF EXISTS event_scouts_select ON public.event_scouts;
CREATE POLICY event_scouts_select ON public.event_scouts
    FOR SELECT TO authenticated
    USING (profile_id = (SELECT auth.uid()) OR public.manages_event(event_id));

DROP POLICY IF EXISTS event_scouts_manager_write ON public.event_scouts;
CREATE POLICY event_scouts_manager_write ON public.event_scouts
    FOR INSERT TO authenticated
    WITH CHECK (public.manages_event(event_id));

DROP POLICY IF EXISTS event_scouts_manager_delete ON public.event_scouts;
CREATE POLICY event_scouts_manager_delete ON public.event_scouts
    FOR DELETE TO authenticated
    USING (public.manages_event(event_id));

-- ─── event data, keyed on membership ───────────────────────────────────────
--
-- Every policy created here is named `<table>_evt_*`.
--
-- That prefix is not decoration. The first draft used `<table>_manager_write`,
-- which is EXACTLY what 0011 calls its INSERT policies, so the DROP ... IF
-- EXISTS below quietly deleted the cutover's policies and replaced them with
-- membership-only ones. The expand guarantee — old path and new path both live —
-- was broken by the migration that promised it, and it broke silently, because
-- dropping a policy you did not create is not an error.
--
-- This is the 0013 failure wearing a different hat: a later migration undoing an
-- earlier one because of a name. check_rls.mjs caught it, which is the argument
-- for that suite in one line.

DROP POLICY IF EXISTS entries_evt_select ON public.entries;
CREATE POLICY entries_evt_select ON public.entries
    FOR SELECT TO authenticated
    USING (public.is_event_member(event_id));

-- A scout records their own observations and nobody else's. submitted_by is
-- forced to the caller rather than trusted from the payload — the same rule
-- 0011 wrote, kept because it is still right.
DROP POLICY IF EXISTS entries_evt_insert ON public.entries;
CREATE POLICY entries_evt_insert ON public.entries
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_event_member(event_id)
        AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
    );

-- Corrections: your own row, or anyone's if you run the event.
DROP POLICY IF EXISTS entries_evt_update ON public.entries;
CREATE POLICY entries_evt_update ON public.entries
    FOR UPDATE TO authenticated
    USING (
        public.is_event_member(event_id)
        AND (submitted_by = (SELECT auth.uid()) OR public.manages_event(event_id))
    )
    WITH CHECK (public.is_event_member(event_id));

-- Planning tables: members read, managers write.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'event_meta', 'schedules', 'assignments',
        'assignment_overrides', 'reminders', 'picklist', 'picklist_prefs'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_evt_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                 USING (public.is_event_member(event_id))', t || '_evt_select', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_evt_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                 WITH CHECK (public.manages_event(event_id))', t || '_evt_insert', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_evt_update', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                 USING (public.manages_event(event_id))
                 WITH CHECK (public.manages_event(event_id))', t || '_evt_update', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_evt_delete', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                 USING (public.manages_event(event_id))', t || '_evt_delete', t);
    END LOOP;
END $$;

-- ─── grants ────────────────────────────────────────────────────────────────
--
-- 0018 narrowed the schema defaults, so these two tables arrived with no grants
-- to anyone. That is the intended behaviour and this is the first migration to
-- feel it: without the lines below, every policy above is unreachable and the
-- failure is a loud "permission denied" rather than a silently anon-writable
-- table. anon is named nowhere on purpose.

GRANT SELECT, UPDATE, DELETE ON public.events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.event_scouts TO authenticated;
-- INSERT on events is withheld: create_event() owns that path.

COMMIT;
