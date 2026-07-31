-- 0007 · entries.updated_at — make edits visible to the sync layer.
--
-- The sync layer was INSERT-only, so an entry edited on /edit never reached
-- its cloud row. Fixing the push half alone is not enough, because the pull
-- half watermarks on created_at:
--
--     if (lastSeenAt) q = q.gt('created_at', lastSeenAt)
--
-- created_at does not change when a row is edited, so an edited row sorts
-- below every watermark and is never returned again. A teammate would never
-- see the correction — and the editing device would show it saved and synced,
-- which is worse than a visible failure.
--
-- So: a second timestamp that moves on every write, and the pull watermarks on
-- that instead.
--
-- SAFE TO RE-RUN.

-- ─── column ────────────────────────────────────────────────────────────────
-- Defaults to now() so existing rows get a sane value and new INSERTs need not
-- supply one. Unlike created_at, this is SERVER time on purpose: it is a
-- watermark compared across devices, and phone clocks at an event disagree by
-- enough to drop rows from an incremental pull.

ALTER TABLE public.entries
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── trigger ───────────────────────────────────────────────────────────────
-- A trigger rather than trusting every caller to set the column. A client that
-- forgets would produce a row that is silently invisible to peers, which is
-- the exact failure this migration exists to remove.

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entries_touch_updated_at ON public.entries;
CREATE TRIGGER entries_touch_updated_at
    BEFORE UPDATE ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── index ─────────────────────────────────────────────────────────────────
-- Every pull is "rows for this event with updated_at above my watermark".

CREATE INDEX IF NOT EXISTS entries_session_updated_idx
    ON public.entries (session_id, updated_at);

COMMENT ON COLUMN public.entries.updated_at IS
    'Server-set on every write. The sync layer''s incremental-pull watermark. '
    'created_at is the client''s record time and part of the dedupe key; this '
    'is neither, and exists so edits propagate.';
