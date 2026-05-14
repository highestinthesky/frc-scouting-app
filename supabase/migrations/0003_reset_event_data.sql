-- Migration: reset_event_data() helper.
--
-- The "reset" use case is: a manager who *knows* the current passphrase
-- wants to wipe scheduling state for an event so the next manager device
-- can start over (set a fresh passphrase, fetch a fresh schedule, etc.).
--
-- This deletes rows from event_meta, schedules, and assignments for the
-- session_id supplied in the x-session-id header. It does NOT touch the
-- entries table — scout-collected data is separate and surviving a reset
-- of the scheduling state is the right behavior.
--
-- Gating: the same has_manager_token() check the table-level policies use,
-- so a passphrase is still required. (For the truly-lost-the-passphrase
-- case, an admin clears the event_meta row directly from Supabase Studio;
-- the app surfaces those instructions in the UI.)

BEGIN;

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
    DELETE FROM public.assignments WHERE session_id = hdr_sid;
    DELETE FROM public.schedules WHERE session_id = hdr_sid;
    DELETE FROM public.event_meta WHERE session_id = hdr_sid;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_event_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_event_data() TO anon, authenticated;

COMMIT;
