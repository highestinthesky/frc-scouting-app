-- Migration: picklist rows + weights
--
-- The picklist has lived in one phone's IndexedDB since it was built. That is
-- the wrong place for the document alliance selection runs on: it dies with the
-- device, and nobody else at the table can see it.
--
-- ─── One row per team, not one document per event ──────────────────────────
--
-- The cheap version of this migration is a single jsonb column holding
-- { primary: [...], avoid: [...] }, matching how `schedules` stores its match
-- array. It is also last-write-wins over the entire list, which fails like
-- this:
--
--   09:00  a phone opens the picklist and holds the morning's copy
--   14:00  the strategy lead spends five hours ranking 40 teams on a laptop
--   14:05  someone taps a button on that phone; it writes ITS copy
--          five hours gone, no error, nothing to roll back to
--
-- One row per (session_id, team_number) removes that entirely. The stale phone
-- pushes only the row it touched. Two managers editing different teams never
-- collide at all.
--
-- ─── rank is a double, and positions are never stored ──────────────────────
--
-- With integer positions, moving a team from 8th to 1st rewrites seven rows —
-- reintroducing exactly the concurrent-write problem we just designed out. A
-- fractional rank makes a move the midpoint of its new neighbours, so every
-- reorder is a ONE-ROW write. Display position is derived by sorting.
--
-- Precision runs out after ~50 halvings into the same gap; the client detects
-- that (`needsRebalance` in src/lib/picklist.js) and renumbers. See that file
-- for the full reasoning and src/lib/picklist.test.mjs for the proof.
--
-- Writes are manager-gated by has_manager_token(), same as schedules and
-- assignments. Reads are open within the event: scouts benefit from seeing
-- which teams the strategy table is watching, and nothing here is secret from
-- your own team.

BEGIN;

-- ─── picklist ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.picklist (
    session_id   uuid NOT NULL,
    team_number  integer NOT NULL,
    event_code   text NOT NULL,
    -- 'pick'  — on the ranked list
    -- 'avoid' — explicitly do not pick
    -- Two states in one column rather than two tables: a team moves between
    -- them constantly, and a move that is one UPDATE cannot half-fail.
    status       text NOT NULL DEFAULT 'pick',
    -- Sort key. Meaningless in isolation; only the ordering matters.
    -- Unconstrained on purpose — it goes negative when a team is moved to the
    -- front of the list, which is normal and correct.
    rank         double precision NOT NULL,
    note         text,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text,
    PRIMARY KEY (session_id, team_number),
    CONSTRAINT picklist_status_check CHECK (status IN ('pick', 'avoid'))
);

-- Corrective, for a table that already exists from an earlier run.
ALTER TABLE public.picklist
    ADD COLUMN IF NOT EXISTS note text,
    ADD COLUMN IF NOT EXISTS updated_by text;

-- The pull is "everything in this event changed since my watermark", exactly
-- as entries does. Without this index that is a sequential scan on every tick.
CREATE INDEX IF NOT EXISTS picklist_session_updated_idx
    ON public.picklist (session_id, updated_at);

-- Ordering the list is the most frequent read on the page.
CREATE INDEX IF NOT EXISTS picklist_session_rank_idx
    ON public.picklist (session_id, status, rank);

-- ─── picklist_prefs ────────────────────────────────────────────────────────
-- Metric weights for the suggested ordering. Genuinely document-scoped — a
-- weight set is only meaningful as a whole — and low-contention, so a single
-- row with last-write-wins is the right shape here even though it is the wrong
-- shape for the list itself.

CREATE TABLE IF NOT EXISTS public.picklist_prefs (
    session_id  uuid PRIMARY KEY,
    event_code  text NOT NULL,
    weights     jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

-- ─── updated_at triggers ───────────────────────────────────────────────────
-- Set server-side. A client clock is not trustworthy enough to be the thing
-- that decides whose edit wins, and every phone at the table has its own.
-- touch_updated_at() comes from 0007.

DROP TRIGGER IF EXISTS picklist_touch_updated_at ON public.picklist;
CREATE TRIGGER picklist_touch_updated_at
    BEFORE UPDATE ON public.picklist
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS picklist_prefs_touch_updated_at ON public.picklist_prefs;
CREATE TRIGGER picklist_prefs_touch_updated_at
    BEFORE UPDATE ON public.picklist_prefs
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Drop every existing policy by name first. Adding a policy next to one that
-- is already there ORs the two together, so a stricter new policy next to a
-- looser old one is exactly as loose as the old one — silently.

DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('picklist', 'picklist_prefs')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

ALTER TABLE public.picklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picklist_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY picklist_session_select ON public.picklist
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

CREATE POLICY picklist_manager_insert ON public.picklist
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

CREATE POLICY picklist_manager_update ON public.picklist
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

-- Removing a team from the list is a real operation, unlike deleting an entry.
CREATE POLICY picklist_manager_delete ON public.picklist
    FOR DELETE
    USING (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

CREATE POLICY picklist_prefs_session_select ON public.picklist_prefs
    FOR SELECT
    USING (
        (session_id)::text =
        ((current_setting('request.headers', true))::json ->> 'x-session-id')
    );

CREATE POLICY picklist_prefs_manager_insert ON public.picklist_prefs
    FOR INSERT
    WITH CHECK (
        (session_id)::text =
            ((current_setting('request.headers', true))::json ->> 'x-session-id')
        AND public.has_manager_token()
    );

CREATE POLICY picklist_prefs_manager_update ON public.picklist_prefs
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

COMMIT;

-- ─── After applying ────────────────────────────────────────────────────────
--
-- Nothing to backfill. The first manager device to open /insights/picklist
-- pushes whatever it has in IndexedDB, and every other device pulls it. A
-- team with two different local picklists will end up with the union, per team,
-- newest write winning — which is the correct answer and also the only one
-- available, since neither copy is more authoritative than the other.
