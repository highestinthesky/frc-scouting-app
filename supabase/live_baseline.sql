-- The entries table as PRODUCTION actually had it, before 0013.
--
-- Not a migration. Never run this against the live project. It exists so a
-- disposable database can be built to production's real shape, because
-- `supabase db reset --version 0007` does not do that and quietly pretends to.
--
-- ─── why this file had to exist ────────────────────────────────────────────
--
-- 0001_entries.sql is a fiction. It was written retroactively to describe a
-- table that had been created by clicking, and it CREATEs that table, so it has
-- never run and can never run. Every rehearsal that started from
-- `db reset --version 0007` therefore started from a database where 0001 HAD
-- run: with current_session_header() defined, with an UPDATE policy on entries,
-- without the stray DELETE policy, and without the two column defaults.
--
-- Production had none of that. So a rehearsal built that way tests the repo's
-- idea of production, not production, and it will keep reporting success for
-- migrations that fail the moment they touch the real thing. That is exactly
-- what happened with 0013: rehearsed clean, then died on the live project with
--
--     42883: function public.current_session_header() does not exist
--
-- ─── confirmed against the live project on 2026-08-07 ──────────────────────
--
--   · public.current_session_header()  ABSENT
--   · entries policies                 entries_session_delete (DELETE)
--                                      entries_session_insert (INSERT)
--                                      entries_session_select (SELECT)
--                                      — no UPDATE policy, all TO public, and
--                                        each inlining the header expression
--                                        rather than calling a function
--   · entries_dedupe_idx               present
--   · created_at                       DEFAULT now()
--   · schema_version                   DEFAULT 2
--   · RLS                              enabled
--
-- Not confirmed, and therefore not asserted below: whether entries_session_idx
-- exists. 0001 creates it; nothing has ever checked production for it. Add it
-- here once somebody looks.
--
-- ─── how to build a production-shaped database ─────────────────────────────
--
--   supabase db reset --version 0000     # empty; 0001 must NOT run
--   psql < supabase/live_baseline.sql    # this file: entries as it really is
--   psql < supabase/migrations/0002_schedule_and_assignments.sql
--   ... 0003 through 0007 ...
--   psql < <the pre-hardening 0008 from d5cb14e>
--   psql < supabase/migrations/0009_picklist.sql
--
-- Then rehearse against that. A migration that survives this has been tested;
-- one that only survives `db reset` has not.

BEGIN;

CREATE TABLE IF NOT EXISTS public.entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid NOT NULL,
    event_code      text NOT NULL,
    match_number    integer NOT NULL,
    team_number     integer NOT NULL,
    alliance_color  text NOT NULL,
    scout_name      text NOT NULL,
    observations    jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The two defaults that should not be here. Reproduced deliberately: a
    -- rehearsal that omits them cannot catch what they break, and 0014 exists
    -- to remove them.
    schema_version  integer NOT NULL DEFAULT 2,
    client_id       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS entries_dedupe_idx
    ON public.entries (session_id, event_code, match_number, team_number, scout_name, created_at);

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Inlined, not calling a helper — production has no current_session_header(),
-- and reproducing the call here would hide the very gap this file documents.
DROP POLICY IF EXISTS entries_session_select ON public.entries;
CREATE POLICY entries_session_select ON public.entries
    FOR SELECT
    USING (session_id::text = (current_setting('request.headers', true)::json ->> 'x-session-id'));

DROP POLICY IF EXISTS entries_session_insert ON public.entries;
CREATE POLICY entries_session_insert ON public.entries
    FOR INSERT
    WITH CHECK (session_id::text = (current_setting('request.headers', true)::json ->> 'x-session-id'));

-- The stray one 0001 drops and 0013 finally did. No UPDATE policy, on purpose:
-- its absence is the bug being reproduced.
DROP POLICY IF EXISTS entries_session_delete ON public.entries;
CREATE POLICY entries_session_delete ON public.entries
    FOR DELETE
    USING (session_id::text = (current_setting('request.headers', true)::json ->> 'x-session-id'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries TO anon, authenticated;

COMMIT;
