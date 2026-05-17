-- Migration: reminders table.
--
-- Managers can post short, time-bounded messages to scouts ("Q15 starts
-- soon — get to position", "remember to scout 1234 next"). Scouts see
-- them as a banner at the top of every page until they dismiss locally.
-- Auto-generated reminders (computed client-side from match predicted_time)
-- share the same banner slot but are NOT stored in this table — they're
-- synthesized on the fly so they don't burn server storage.
--
-- Reads: open within an event (x-session-id header). Writes: manager-only
-- via has_manager_token().

BEGIN;

CREATE TABLE IF NOT EXISTS public.reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    event_code text NOT NULL,
    -- null = broadcast to every scout in the event.
    scout_name text,
    -- Optional context: which qual match this reminder relates to. Used by
    -- the client to derive a sensible default expires_at if the manager
    -- doesn't specify (predicted_time + 30 min).
    match_number integer,
    message text NOT NULL,
    author text,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Past expires_at means clients hide it. Server-side cleanup is a
    -- future cron; the client filters at read time so cruft doesn't show.
    expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS reminders_session_idx
    ON public.reminders (session_id, expires_at);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminders_session_select ON public.reminders;
CREATE POLICY reminders_session_select ON public.reminders
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

DROP POLICY IF EXISTS reminders_manager_insert ON public.reminders;
CREATE POLICY reminders_manager_insert ON public.reminders
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

DROP POLICY IF EXISTS reminders_manager_update ON public.reminders;
CREATE POLICY reminders_manager_update ON public.reminders
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

DROP POLICY IF EXISTS reminders_manager_delete ON public.reminders;
CREATE POLICY reminders_manager_delete ON public.reminders
    FOR DELETE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO anon, authenticated;

-- Extend reset_event_data() so an event archive also clears reminders. The
-- function body re-uses the same has_manager_token() check that gates
-- everything else.
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
    DELETE FROM public.reminders WHERE session_id = hdr_sid;
    DELETE FROM public.assignments WHERE session_id = hdr_sid;
    DELETE FROM public.schedules WHERE session_id = hdr_sid;
    DELETE FROM public.event_meta WHERE session_id = hdr_sid;
END;
$$;

COMMIT;
