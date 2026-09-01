-- Migration: correcting a scout's auto recording, without clobbering the rest
--
-- A scout who reads the field the wrong way round records every position 180°
-- from the truth. The result is a plausible auto at the wrong end of the field
-- and it looks entirely fine — and it cannot be re-recorded, because the match
-- is over. `flipTrack()` on the client is the repair.
--
-- ─── this does NOT grant a manager anything ────────────────────────────────
--
-- Say that plainly, because the first draft of this header said the opposite and
-- the database disagreed with it. `entries_evt_update` (0019) is:
--
--     is_event_member(event_id)
--     AND (submitted_by = auth.uid() OR manages_event(event_id))
--
-- A manager can already UPDATE any entry at their event, and check_rls.mjs has
-- asserted so since 0019 — "a manager can correct any entry in the event". A
-- migration written to grant a permission that already exists would be a
-- mechanism nobody needs, and the comment claiming otherwise is exactly the
-- shape of the 0021 mistake this file is trying not to repeat.
--
-- ─── what it is actually for: one key, merged server-side ──────────────────
--
-- A manager correcting the recording through the ordinary UPDATE has to send the
-- WHOLE observations blob, from their own copy of the row. Two things follow,
-- and both are real:
--
--   * That copy can be stale. Sync is a watermark on updated_at, so a manager's
--     device may not yet hold an edit the scout made a moment ago — and writing
--     the whole blob back silently reverts it. Merging one key server-side
--     cannot.
--   * It is a much larger act than the problem needs. Fixing where a robot was
--     DRAWN should not be able to change what it SCORED, and a full-blob write
--     can do that by accident with no record but `updated_at` moving.
--
-- So this narrows an authority that already exists rather than granting one. An
-- UPDATE policy cannot express that: it sees the row, never which key inside a
-- jsonb column moved.
--
-- ─── why the payload is computed on the client ─────────────────────────────
--
-- The flip is a geometric transform over a base64 sample buffer. Postgres can
-- do it — `get_byte`, `255 - b`, `set_byte` — and it would be a second
-- implementation of a rotation that already exists in `auto-track.js` behind
-- eleven assertions, in a language where it cannot be tested next to them. Two
-- implementations of one rotation is how the picture and the data start to
-- disagree.
--
-- ─── what is NOT validated, deliberately ──────────────────────────────────
--
-- The track's shape beyond "is an object". `decodeTrack()` refuses any version
-- it does not know and returns null, so a malformed payload reads as "no
-- recording" rather than as a plausible path in the wrong places — the failure
-- is visible and it is already the defence. Re-stating the byte layout as a
-- CHECK here would freeze v1 into the database and make a future sample rate a
-- migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.correct_entry_track(p_id uuid, p_track jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event uuid;
BEGIN
    SELECT event_id INTO v_event FROM public.entries WHERE id = p_id;

    -- A missing row and an unreachable row report the same thing on purpose:
    -- "which entry ids exist in an event I am not on" is not a question this
    -- should answer. Same reasoning as withdraw_entry().
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'No such entry.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.manages_event(v_event) THEN
        RAISE EXCEPTION 'Only a manager on this event can correct a recording.'
            USING ERRCODE = '42501';
    END IF;

    -- Anything that is not a json object is refused rather than stored. null is
    -- the one non-object accepted, and it means "remove the recording" — which a
    -- manager needs when a track is wrong in a way no rotation fixes.
    IF p_track IS NOT NULL AND jsonb_typeof(p_track) <> 'object' THEN
        RAISE EXCEPTION 'A recording must be an object, or null to remove it.'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.entries
       SET observations = CASE
               WHEN p_track IS NULL
                   -- The KEY goes, not an empty value written into it. Blank is
                   -- not zero: readTrack() reports an absent key as "not
                   -- recorded", and an `autoTrack: null` would still be a key.
                   THEN coalesce(observations, '{}'::jsonb) - 'autoTrack'
                   ELSE coalesce(observations, '{}'::jsonb)
                        || jsonb_build_object('autoTrack', p_track)
           END
     WHERE id = p_id;
END;
$$;

-- Both halves. 0021 granted a column and left the function open, and the RPC
-- being right is exactly what made the grant look fine; closing one is not
-- closing the other.
REVOKE ALL ON FUNCTION public.correct_entry_track(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_entry_track(uuid, jsonb) TO authenticated;

COMMIT;
