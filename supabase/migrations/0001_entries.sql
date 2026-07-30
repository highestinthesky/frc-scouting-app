-- 0001 · entries — the scouting data itself.
--
-- Written retroactively. This table was created by hand in the Supabase
-- dashboard before migrations existed, so the repo could not rebuild the
-- database and nobody could review its RLS policies in a diff. Migrations
-- started at 0002, which meant the most important table in the app was the
-- only one not under version control.
--
-- Numbered 0001 because entries logically precede everything else: a fresh
-- environment must create this before the scheduling tables reference the same
-- session_id convention.
--
-- ─── the session_id convention ─────────────────────────────────────────────
--
-- There is no login yet. Scope is the FRC event code, hashed client-side into a
-- UUID (see deriveSessionId in src/lib/supabase.js) and sent as the
-- `x-session-id` header on every request. RLS compares the header to the row.
-- No header means zero rows.
--
-- The documented trade-off: the event code is public on TBA, so anyone who
-- knows it can read this team's scouting and write junk to it. ADR 001 closes
-- that by requiring an authenticated session; until then this policy set is
-- faithful to the current behaviour rather than aspirational.

-- ─── helper: the event scope from the request header ───────────────────────
-- Existing migrations inline this expression in a dozen policies. One function
-- means one place to change when ADR 001 lands.

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
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event scope. session_id is the hashed event code; event_code is kept
    -- alongside it in plain text because it is human-readable in the dashboard
    -- and the hash is not reversible.
    session_id     uuid        NOT NULL,
    event_code     text        NOT NULL,

    match_number   integer     NOT NULL,
    team_number    integer     NOT NULL,
    alliance_color text,
    scout_name     text        NOT NULL,

    -- Every form field lives here, keyed by the `key` in form-config.js.
    -- Deliberately schemaless: adding a counter or a note field each January
    -- must not require a migration.
    observations   jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Which form shape produced this row. Read it before trusting the absence
    -- of a field: a missing counter on a v2 entry means "the field did not
    -- exist yet", not "the scout saw zero". lib/metrics.js depends on that
    -- distinction.
    schema_version integer     NOT NULL,

    -- Which physical device wrote it. Lets the sync layer skip its own writes
    -- echoing back, and breaks ties between otherwise-identical rows.
    client_id      text,

    -- Client-supplied, NOT defaulted on purpose. This column is part of the
    -- dedupe key below, so a row arriving without it would silently create a
    -- duplicate instead of colliding. No default means an omission is a loud
    -- error at insert time.
    created_at     timestamptz NOT NULL
);

-- ─── dedupe ────────────────────────────────────────────────────────────────
-- Two devices can hold the same entry: a peer pushed it, or our own previous
-- tick raced the round-trip. The sync layer relies on this constraint firing
-- 23505 and then adopting the existing row's id, so the column list here must
-- stay in step with the lookup in pushOutbox().

CREATE UNIQUE INDEX IF NOT EXISTS entries_dedupe
    ON public.entries (session_id, event_code, match_number, team_number, scout_name, created_at);

-- Every pull is "rows for this event, newest first, since a watermark".
CREATE INDEX IF NOT EXISTS entries_session_created_idx
    ON public.entries (session_id, created_at);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Drop EVERY existing policy on this table before defining ours, by name,
-- whatever it happens to be called.
--
-- Dropping only our own names is not enough. This table predates migrations,
-- so it may carry policies created in the dashboard under names like
-- "Enable read access for all users". Postgres combines permissive policies
-- with OR, so one forgotten permissive policy sitting next to a restrictive
-- one silently wins — the table reads as locked down and isn't. Clearing the
-- set first is what makes this file authoritative rather than additive.
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
DROP POLICY IF EXISTS entries_session_select ON public.entries;
CREATE POLICY entries_session_select ON public.entries
    FOR SELECT
    USING (session_id::text = public.current_session_header());

-- Insert: anyone scoped to this event. A scout with no signal writes to
-- IndexedDB and the row arrives later; nothing here may depend on identity
-- until ADR 001 lands.
DROP POLICY IF EXISTS entries_session_insert ON public.entries;
CREATE POLICY entries_session_insert ON public.entries
    FOR INSERT
    WITH CHECK (session_id::text = public.current_session_header());

-- Update: needed by the sync UPDATE path (ROADMAP Phase 0) so an /edit change
-- reaches its cloud row instead of staying local forever.
DROP POLICY IF EXISTS entries_session_update ON public.entries;
CREATE POLICY entries_session_update ON public.entries
    FOR UPDATE
    USING (session_id::text = public.current_session_header())
    WITH CHECK (session_id::text = public.current_session_header());

-- No DELETE policy. Nothing in the app deletes a remote entry, and scouting
-- data is the one thing worth being conservative about. reset_event_data()
-- (migration 0003) clears scheduling state and deliberately leaves entries
-- alone.

GRANT SELECT, INSERT, UPDATE ON public.entries TO anon, authenticated;
