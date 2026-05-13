-- Migration: schedule + assignments + manager-token gate
--
-- Adds three tables that ride the existing x-session-id RLS pattern used by
-- entries:
--
--   event_meta  -- one row per event, holds the hashed manager passphrase
--   schedules   -- one row per event, holds the cached TBA match list
--   assignments -- many rows per event, mapping scout_name -> team_number
--
-- Reads on all three are open within an event (x-session-id matches). Writes
-- on schedules and assignments are gated by has_manager_token(), which checks
-- that the client also sent x-manager-token matching the hash stored in
-- event_meta. If no event_meta row exists yet (first-run bootstrap), writes
-- are temporarily open so the first manager device can publish without
-- chicken-and-egg. After the manager sets a passphrase, the gate kicks in.

BEGIN;

-- ─── event_meta ─────────────────────────────────────────────────────────────
-- One row per event. manager_token is a client-computed hash
-- (SHA-256 of passphrase + ':' + event_code, hex). The raw passphrase never
-- leaves the manager's device.

CREATE TABLE IF NOT EXISTS public.event_meta (
    session_id uuid PRIMARY KEY,
    event_code text NOT NULL,
    -- Hex-encoded SHA-256(passphrase || ':' || event_code). Set on first
    -- manager-publish; rotation requires sending the current token.
    manager_token text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_meta_event_idx
    ON public.event_meta (event_code);

-- ─── schedules ──────────────────────────────────────────────────────────────
-- One row per event with the full TBA match list. Replaced wholesale on each
-- manager publish (no diffing needed; the array is small and re-fetches are
-- rare).

CREATE TABLE IF NOT EXISTS public.schedules (
    session_id uuid PRIMARY KEY,
    event_code text NOT NULL,
    matches jsonb NOT NULL DEFAULT '[]'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    fetched_by text
);

CREATE INDEX IF NOT EXISTS schedules_event_idx
    ON public.schedules (event_code);

-- ─── assignments ────────────────────────────────────────────────────────────
-- Many rows per event. A scout's "assignment" is the set of team_numbers
-- where scout_name matches theirs. Manager-only writes.

CREATE TABLE IF NOT EXISTS public.assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    event_code text NOT NULL,
    scout_name text NOT NULL,
    team_number integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_dedupe_idx
    ON public.assignments (session_id, scout_name, team_number);

CREATE INDEX IF NOT EXISTS assignments_session_idx
    ON public.assignments (session_id);

-- ─── manager token helper ──────────────────────────────────────────────────
-- Returns true when either:
--   (a) the session has no manager passphrase set yet (bootstrap), OR
--   (b) the request supplied x-manager-token matches the stored hash.
-- Runs as SECURITY DEFINER so RLS on event_meta doesn't recursively block it.

CREATE OR REPLACE FUNCTION public.has_manager_token() RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    hdr_sid text;
    hdr_tok text;
    stored_tok text;
BEGIN
    hdr_sid := (current_setting('request.headers', true)::json ->> 'x-session-id');
    hdr_tok := (current_setting('request.headers', true)::json ->> 'x-manager-token');
    IF hdr_sid IS NULL OR hdr_sid = '' THEN
        RETURN false;
    END IF;
    SELECT manager_token INTO stored_tok
    FROM public.event_meta
    WHERE session_id::text = hdr_sid;
    -- No passphrase configured for this event yet: allow.
    IF stored_tok IS NULL THEN
        RETURN true;
    END IF;
    RETURN stored_tok = COALESCE(hdr_tok, '');
END;
$$;

REVOKE ALL ON FUNCTION public.has_manager_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_manager_token() TO anon, authenticated;

-- ─── RLS: event_meta ───────────────────────────────────────────────────────

ALTER TABLE public.event_meta ENABLE ROW LEVEL SECURITY;

-- Read: any client scoped to this event can see whether a passphrase is set.
DROP POLICY IF EXISTS event_meta_session_select ON public.event_meta;
CREATE POLICY event_meta_session_select ON public.event_meta
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

-- Insert: bootstrap only. Allowed if no row exists for this session_id yet.
-- After that, INSERT is blocked; the manager rotates via UPDATE.
DROP POLICY IF EXISTS event_meta_session_insert ON public.event_meta;
CREATE POLICY event_meta_session_insert ON public.event_meta
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND NOT EXISTS (
            SELECT 1 FROM public.event_meta em
            WHERE em.session_id = event_meta.session_id
        )
    );

-- Update: rotation, only when the current manager-token is presented.
DROP POLICY IF EXISTS event_meta_session_update ON public.event_meta;
CREATE POLICY event_meta_session_update ON public.event_meta
    FOR UPDATE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    )
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

-- Deletes are intentionally not allowed via the API. If a team forgets the
-- passphrase, an admin clears the row from Supabase Studio.

-- ─── RLS: schedules ────────────────────────────────────────────────────────

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedules_session_select ON public.schedules;
CREATE POLICY schedules_session_select ON public.schedules
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS schedules_manager_insert ON public.schedules;
CREATE POLICY schedules_manager_insert ON public.schedules
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

DROP POLICY IF EXISTS schedules_manager_update ON public.schedules;
CREATE POLICY schedules_manager_update ON public.schedules
    FOR UPDATE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    )
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS schedules_manager_delete ON public.schedules;
CREATE POLICY schedules_manager_delete ON public.schedules
    FOR DELETE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

-- ─── RLS: assignments ──────────────────────────────────────────────────────

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignments_session_select ON public.assignments;
CREATE POLICY assignments_session_select ON public.assignments
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS assignments_manager_insert ON public.assignments;
CREATE POLICY assignments_manager_insert ON public.assignments
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

DROP POLICY IF EXISTS assignments_manager_update ON public.assignments;
CREATE POLICY assignments_manager_update ON public.assignments
    FOR UPDATE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    )
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS assignments_manager_delete ON public.assignments;
CREATE POLICY assignments_manager_delete ON public.assignments
    FOR DELETE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

-- ─── Grants ────────────────────────────────────────────────────────────────
-- The anon role talks through PostgREST. Grant table-level privileges; RLS
-- still gates which rows it sees.

GRANT SELECT, INSERT, UPDATE ON public.event_meta TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO anon, authenticated;

COMMIT;
