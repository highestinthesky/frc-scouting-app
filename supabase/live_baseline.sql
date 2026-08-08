-- The entries table as PRODUCTION actually had it, before 0013.
--
-- Not a migration. Never run this against the live project. It exists so a
-- disposable database can be built to production's real shape, because
-- `supabase db reset --version 0007` does not do that and quietly pretends to.
--
-- ─── why this file had to exist ────────────────────────────────────────────
--
-- 0001_entries.sql was written retroactively to repair a table created by
-- clicking, and it is genuinely re-runnable against it — CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, and a DO block
-- that drops every policy by name first. It had simply never been run.
--
-- The problem is what that does to rehearsals. `db reset --version 0007` applies
-- 0001, so every rehearsal started from a database where the repairs had already
-- happened: current_session_header() defined, an UPDATE policy on entries, no
-- stray DELETE policy, no column defaults.
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
-- Not confirmed, and therefore assumed pessimistically below:
--   · whether entries_session_idx exists — 0001 creates it IF NOT EXISTS
--   · whether alliance_color is nullable — 0001 SETs NOT NULL on it
--
-- ─── measured against this baseline, 2026-08-07 ────────────────────────────
--
-- Rebuilt to this shape, then 0002-0007, the pre-hardening 0008, 0009, 0010 and
-- 0013 applied on top. The result matched production on every observable: same
-- policy set, same two column defaults, same two 0008 FAILs, same 0010 complete.
--
-- Then, on that replica:
--
--   0001            applied clean. Dropped both defaults, created
--                   entries_session_idx, revoked DELETE from anon and
--                   authenticated, left every seeded row intact.
--   0008 corrected  applied clean on top, installed both guard triggers,
--                   left every seeded row intact.
--   verify_migrations.sql / verify_entries.sql   zero FAILs, both.
--
-- With one NULL alliance_color present, 0001 stops at SET NOT NULL with
-- "column alliance_color of relation entries contains null values". It is not
-- transactional, so the function and both DROP DEFAULTs are already applied and
-- the indexes, policies and grants are not. Fixing the rows and re-running
-- completes it — every statement before the failure is idempotent.
--
-- ─── how to build a production-shaped database ─────────────────────────────
--
--   -- `db reset --version 0000` does NOT work; it needs a matching file. Empty
--   -- the schema directly instead, which leaves auth intact for 0008:
--   psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;
--            GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--            GRANT ALL ON SCHEMA public TO postgres;"
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
    -- Nullable, deliberately. 0001 does ALTER COLUMN alliance_color SET NOT NULL
    -- under the comment "bring an older table up to the current shape", which
    -- only makes sense if the dashboard-built column was nullable. Nobody has
    -- checked production. Declaring it NOT NULL here would make 0001's one
    -- genuinely risky statement a silent no-op in every rehearsal — which is
    -- exactly the class of mistake this whole file exists to stop.
    alliance_color  text,
    scout_name      text NOT NULL,
    observations    jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The two defaults that should not be here. Reproduced deliberately: a
    -- rehearsal that omits them cannot catch what they break, and 0001 is what
    -- removes them.
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
