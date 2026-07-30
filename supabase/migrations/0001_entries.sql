-- 0001 · entries — the scouting data itself.
--
-- Written retroactively. This table was created by hand in the Supabase
-- dashboard before migrations existed, so the repo could not rebuild the
-- database and nobody could review its RLS policies in a diff. Migrations
-- started at 0002, which meant the most important table in the app was the
-- only one not under version control.
--
-- Numbered 0001 because entries logically precedes everything else.
--
-- SAFE TO RE-RUN. Idempotent, and *corrective*: the ALTERs below fix an
-- existing table rather than silently skipping it. CREATE TABLE IF NOT EXISTS
-- on its own is not enough — it no-ops when the table exists, so drift between
-- this file and reality would go unnoticed, which is the exact failure this
-- migration was written to end.
--
-- Run supabase/verify_entries.sql afterwards. It asserts, not describes.
--
-- ─── the session_id convention ─────────────────────────────────────────────
--
-- There is no login yet. Scope is the FRC event code, hashed client-side into a
-- UUID (deriveSessionId in src/lib/supabase.js) and sent as the `x-session-id`
-- header. RLS compares the header to the row; no header means zero rows.
--
-- Documented trade-off: the event code is public on TBA, so anyone who knows it
-- can read this team's scouting and write junk to it. ADR 001 closes that by
-- requiring an authenticated session. Until then this policy set is faithful to
-- current behaviour rather than aspirational.

-- ─── helper: the event scope from the request header ───────────────────────
-- The other migrations inline this expression across a dozen policies. One
-- function is one place to change when ADR 001 swaps the boundary.

CREATE OR REPLACE FUNCTION public.current_session_header() RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT (current_setting('request.headers', true)::json ->> 'x-session-id')
$$;

REVOKE ALL ON FUNCTION public.current_session_header() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_session_header() TO anon, authenticated;

-- ─── table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.entries (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event scope. session_id is the hashed event code; event_code is kept
    -- alongside in plain text because it is readable in the dashboard and the
    -- hash is not reversible.
    session_id     uuid        NOT NULL,
    event_code     text        NOT NULL,

    match_number   integer     NOT NULL,
    team_number    integer     NOT NULL,
    -- NOT NULL because allianceColor is `required: true` in form-config.js.
    alliance_color text        NOT NULL,
    scout_name     text        NOT NULL,

    -- Every form field, keyed by the `key` in form-config.js. Deliberately
    -- schemaless: retuning counters each January must not need a migration.
    observations   jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Which form shape produced this row. NO DEFAULT — see below.
    schema_version integer     NOT NULL,

    -- Which physical device wrote it. Lets sync skip its own echo.
    client_id      text,

    -- Client-supplied. NO DEFAULT — see below.
    created_at     timestamptz NOT NULL
);

-- ─── corrective ALTERs ─────────────────────────────────────────────────────
-- These fix the two defaults the dashboard-created table carried. Both are
-- no-ops on a table that never had them, so this stays idempotent.

-- created_at defaulted to now(). It is part of the dedupe unique index below,
-- and its value is the *client's* record time, not the server's. If a client
-- ever omitted it, Postgres would quietly stamp now() — which never matches
-- the local timestamp, so the dedupe key would miss and the same entry would
-- be stored twice. Removing the default turns a silent duplicate into a loud
-- insert error.
ALTER TABLE public.entries ALTER COLUMN created_at DROP DEFAULT;

-- schema_version defaulted to 2. That default is how this went wrong once
-- already: the client hardcoded 2 while form-config.js moved to 3, so entries
-- containing counter metrics claimed to predate them. The column exists to
-- distinguish "this metric was never collected" from "a scout recorded zero" —
-- the invariant lib/metrics.js and eight of its tests defend. A default lets a
-- caller omit the field and get a plausible lie; no default makes it an error.
ALTER TABLE public.entries ALTER COLUMN schema_version DROP DEFAULT;

-- Bring an older table up to the current shape. No-ops once applied.
ALTER TABLE public.entries ALTER COLUMN alliance_color SET NOT NULL;

-- ─── dedupe ────────────────────────────────────────────────────────────────
-- Two devices can hold the same entry: a peer pushed it, or our own previous
-- tick raced the round-trip. The sync layer relies on this firing 23505 and
-- then adopting the existing row's id, so this column list must stay in step
-- with the lookup in pushOutbox().
--
-- Name matches the live index so re-running doesn't build a second copy.

CREATE UNIQUE INDEX IF NOT EXISTS entries_dedupe_idx
    ON public.entries (session_id, event_code, match_number, team_number, scout_name, created_at);

-- Every pull is "rows for this event since a watermark".
CREATE INDEX IF NOT EXISTS entries_session_idx
    ON public.entries (session_id, created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Drop EVERY existing policy on this table, whatever it is named, before
-- defining ours.
--
-- Dropping only our own names is not enough. This table predates migrations,
-- so it may carry policies created in the dashboard under other names.
-- Postgres combines permissive policies with OR, so one forgotten permissive
-- policy beside a restrictive one silently wins — the table reads as locked
-- down and is not. Clearing the set is what makes this file authoritative
-- rather than additive.
DO $$
DECLARE pol record;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'entries'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.entries', pol.policyname);
    END LOOP;
END $$;

-- Read: anyone scoped to this event.
CREATE POLICY entries_session_select ON public.entries
    FOR SELECT
    USING (session_id::text = public.current_session_header());

-- Insert: anyone scoped to this event. A scout with no signal writes to
-- IndexedDB and the row arrives later; nothing here may depend on identity
-- until ADR 001 lands.
CREATE POLICY entries_session_insert ON public.entries
    FOR INSERT
    WITH CHECK (session_id::text = public.current_session_header());

-- Update: required by the sync UPDATE path (ROADMAP Phase 0). Without it an
-- /edit change can never reach its cloud row — the current data-loss bug.
CREATE POLICY entries_session_update ON public.entries
    FOR UPDATE
    USING (session_id::text = public.current_session_header())
    WITH CHECK (session_id::text = public.current_session_header());

-- Deliberately NO delete policy. The live table had entries_session_delete;
-- it is dropped above and not recreated. Nothing in the app deletes a remote
-- entry (deleteEntry() is local Dexie only, and reset_event_data() preserves
-- entries by design), so the grant was reachable capability nobody used.
-- Scouting data is the one thing worth being conservative about.

REVOKE ALL ON public.entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.entries TO anon, authenticated;
