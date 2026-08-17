-- Migration: withdrawing an entry becomes a named operation
--
-- 0021 added `deleted_at` and granted UPDATE on that column to `authenticated`,
-- with a comment claiming "a scout is deliberately NOT given this". The comment
-- was wrong, and check_rls.mjs said so on the first run:
--
--     FAIL: a scout cannot withdraw an entry — UPDATE reported success
--
-- entries_evt_update permits a row where `submitted_by = auth.uid()`, so a scout
-- editing their own entry was already inside the policy. The column grant simply
-- let that reach `deleted_at` too. Nothing was protecting the distinction — the
-- migration asserted it in prose and the database never enforced it.
--
-- ─── why this is an RPC and not a cleverer policy ──────────────────────────
--
-- An UPDATE policy sees the row, not which columns moved. Expressing "you may
-- edit your own entry but not withdraw it" as RLS means a trigger comparing OLD
-- and NEW — a second mechanism, invisible from the policy, that has to be found
-- by whoever next reads why an update was refused.
--
-- A named function says it once. It is the same shape create_event() and
-- create_managed_profile() already use here: a fixed argument list, one
-- authority check, and a failure that names the rule rather than a constraint.
--
-- ─── why a scout keeps the edit but loses the withdrawal ───────────────────
--
-- Correcting an entry is the mistake a scout actually makes, and they should fix
-- it without finding a manager mid-event. Removing the record of a match is a
-- different act: it is the event's data, not the scout's, and a scout who can
-- quietly delete their own observations can quietly delete the ones that made
-- their coverage look thin.

BEGIN;

-- The grant 0021 should not have made. The policy still lets a scout edit their
-- own entry; it can no longer reach the tombstone.
REVOKE UPDATE (deleted_at) ON public.entries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_entry(p_id uuid, p_undo boolean DEFAULT false)
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
    -- should answer.
    IF v_event IS NULL THEN
        RAISE EXCEPTION 'No such entry.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.manages_event(v_event) THEN
        RAISE EXCEPTION 'Only a manager on this event can delete an entry.'
            USING ERRCODE = '42501';
    END IF;

    -- Undo is the same authority as the withdrawal, and it is the reason the row
    -- is kept rather than destroyed.
    UPDATE public.entries
       SET deleted_at = CASE WHEN p_undo THEN NULL ELSE now() END
     WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_entry(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_entry(uuid, boolean) TO authenticated;

COMMIT;
