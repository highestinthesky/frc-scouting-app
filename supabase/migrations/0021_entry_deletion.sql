-- Migration: a manager can delete an entry, and everyone else finds out
--
-- Two bugs, one cause. `entries` has never had a DELETE policy — 0001 says so
-- deliberately, because the live table had an unscoped `entries_session_delete`
-- that let anyone holding the event code empty the table. So deleting was
-- refused server-side, and the client's deleteEntry() only ever touched
-- IndexedDB: the row vanished from one phone and came straight back on the next
-- pull, or stayed on every other device for the rest of the event.
--
-- ─── why this is a tombstone and not a DELETE ──────────────────────────────
--
-- The pull is a watermark:
--
--     .from('entries').select('*').eq('event_id', …).gt('updated_at', lastSeen)
--
-- A hard-deleted row simply stops being returned, which is *indistinguishable
-- from nothing having changed*. Every device that already holds it would keep it
-- forever, and the manager who deleted it would be the only person who could
-- tell. Offline-first sync cannot learn a negative from an incremental query.
--
-- So deletion is `deleted_at`: an UPDATE, which moves `updated_at`, which the
-- existing watermark already picks up. The client sees the stamp and removes its
-- local copy. No new pull path, no reconcile, no full-table scan on a phone.
--
-- ─── why the row is kept rather than scrubbed ──────────────────────────────
--
-- A deleted entry is usually a duplicate or a misfiled match, not something that
-- must cease to exist. Keeping the row means a manager who deletes the wrong one
-- can be un-deleted by clearing the stamp, and it keeps the dedupe fingerprint
-- honest: hard-deleting would let the same observation be re-inserted and become
-- a second row, which is exactly what that index exists to prevent.

BEGIN;

ALTER TABLE public.entries
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.entries.deleted_at IS
    'Tombstone. Set by a manager to withdraw an entry; the row is kept so the '
    'deletion can propagate through the updated_at watermark and be undone.';

-- The pull asks for "everything that changed", tombstones included, so this
-- index carries the same shape the watermark query already uses. Partial,
-- because live rows are the overwhelming majority and the index only has to
-- answer "which of these are withdrawn".
CREATE INDEX IF NOT EXISTS entries_deleted_idx
    ON public.entries (event_id, updated_at)
    WHERE deleted_at IS NOT NULL;

-- ─── who may withdraw one ──────────────────────────────────────────────────
--
-- Managers and supers, and only within an event they run. entries_evt_update
-- (0019/0020) already expresses exactly that — `manages_event(event_id)` — so no
-- new policy is needed. What was missing is the column grant: 0020 lists the
-- updatable columns explicitly, and a column absent from that list is refused
-- however permissive the policy is.
--
-- A scout is deliberately NOT given this. They can already correct their own
-- entry, which is the fix for the mistake they actually make; withdrawing a
-- record of a match is an event-operations decision.
--
-- Note this is a grant to `authenticated`, not to managers — Postgres has no
-- role for that. The policy is what restricts it, and the RLS suite asserts a
-- scout is refused rather than trusting this line to say so.
GRANT UPDATE (deleted_at) ON public.entries TO authenticated;

-- ─── and the fingerprint has to tolerate a withdrawal ──────────────────────
--
-- entries_event_dedupe_idx is UNIQUE over the content fingerprint. With
-- tombstones kept, a scout who re-records an observation a manager withdrew
-- would collide with the withdrawn row and the insert would fail with 23505 —
-- which sync interprets as "the server already has this" and adopts the
-- tombstone's id, resurrecting nothing and losing the new entry.
--
-- Making the index partial on live rows fixes that: a withdrawn row stops
-- occupying its fingerprint, so the same observation can be recorded again.
DROP INDEX IF EXISTS public.entries_event_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS entries_event_dedupe_idx
    ON public.entries (event_id, event_code, match_number, team_number, scout_name, created_at)
    WHERE deleted_at IS NULL;

COMMIT;
