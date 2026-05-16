-- Migration: assignment_overrides table.
--
-- Per-match overrides on top of the base assignments table. If any override
-- rows exist for (session_id, match_number, scout_name), they REPLACE the
-- scout's base assignment for that one match. Otherwise base applies.
--
-- Multiple rows per (match, scout) are allowed — a scout can be told to
-- watch two teams in one match, then revert to their base assignments in
-- every other match.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assignment_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    event_code text NOT NULL,
    match_number integer NOT NULL,
    scout_name text NOT NULL,
    team_number integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS assignment_overrides_dedupe_idx
    ON public.assignment_overrides (session_id, match_number, scout_name, team_number);

CREATE INDEX IF NOT EXISTS assignment_overrides_lookup_idx
    ON public.assignment_overrides (session_id, match_number, scout_name);

ALTER TABLE public.assignment_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS overrides_session_select ON public.assignment_overrides;
CREATE POLICY overrides_session_select ON public.assignment_overrides
    FOR SELECT
    USING ((session_id)::text = ((current_setting('request.headers', true))::json ->> 'x-session-id'));

DROP POLICY IF EXISTS overrides_manager_insert ON public.assignment_overrides;
CREATE POLICY overrides_manager_insert ON public.assignment_overrides
    FOR INSERT
    WITH CHECK (
        (session_id)::text = ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

DROP POLICY IF EXISTS overrides_manager_update ON public.assignment_overrides;
CREATE POLICY overrides_manager_update ON public.assignment_overrides
    FOR UPDATE
    USING (
        (session_id)::text = ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    )
    WITH CHECK (
        (session_id)::text = ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS overrides_manager_delete ON public.assignment_overrides;
CREATE POLICY overrides_manager_delete ON public.assignment_overrides
    FOR DELETE
    USING (
        (session_id)::text = ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_overrides TO anon, authenticated;

-- Extend reset_event_data() so archiving an event also wipes overrides.
CREATE OR REPLACE FUNCTION public.reset_event_data() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    hdr_sid uuid;
BEGIN
    IF NOT public.has_manager_token() THEN
        RAISE EXCEPTION 'manager token required to reset event data';
    END IF;
    hdr_sid := ((current_setting('request.headers', true))::json ->> 'x-session-id')::uuid;
    IF hdr_sid IS NULL THEN
        RAISE EXCEPTION 'session id required';
    END IF;
    DELETE FROM public.assignment_overrides WHERE session_id = hdr_sid;
    DELETE FROM public.reminders WHERE session_id = hdr_sid;
    DELETE FROM public.assignments WHERE session_id = hdr_sid;
    DELETE FROM public.schedules WHERE session_id = hdr_sid;
    DELETE FROM public.event_meta WHERE session_id = hdr_sid;
END;
$$;

COMMIT;
