-- Migration: profile_id alongside scout_name — the expand step
--
-- `scout_name` is a free-text string that four tables use as an identity key:
--
--     entries.scout_name              NOT NULL, and part of the dedupe index
--     assignments.scout_name          NOT NULL, and part of the dedupe index
--     assignment_overrides.scout_name NOT NULL, and part of the dedupe index
--     reminders.scout_name            nullable — null means broadcast
--
-- Nothing guarantees two devices spell it the same way. "Ning", "ning" and
-- "Haolun" are three different scouts to the coverage board, to auto-assign,
-- to the reminder targeting and to the CSV export. The client already knows
-- this: assignments.js matches on trim().toLowerCase() in six separate places,
-- which is a workaround for the key being wrong, not a fix.
--
-- It is also the same failure that took out scout-added teams — someone typed
-- something on one phone and no other device agreed.
--
-- profiles.id is the real identity. This migration adds it everywhere and
-- backfills what it can. It does NOT remove scout_name and does NOT touch a
-- single policy.
--
-- ─── Why this is separate from the cutover ─────────────────────────────────
--
-- The obvious move is one migration that swaps the key and the policies
-- together. Don't. They are independent changes with different risk, and
-- combining them means a single irreversible step where a failure is
-- ambiguous — did the policy break, or did the join?
--
-- Expand / migrate / contract instead:
--
--     0010  (this)  add profile_id, backfill, change nothing else
--                   → the client dual-writes and prefers profile_id on read
--                   → safe to apply TODAY, mid-season, nothing depends on it
--     0011          swap the policies to `to authenticated`, drop the
--                   passphrase, make profile_id the key, drop scout_name
--                   → the one-way door, between seasons
--
-- After 0010, every new row carries a real identity while the old key still
-- works. By the time 0011 runs there is nothing left to migrate, and it is a
-- policy change only.
--
-- ─── What the backfill can and cannot do ───────────────────────────────────
--
-- Matching typed names to accounts is a guess. This one is deliberately
-- CONSERVATIVE: it matches only where the answer is unambiguous, and leaves
-- everything else null for a human. A wrong match silently attributes one
-- scout's work to another, which is worse than no match at all — a null is
-- visible, a wrong uuid is not.
--
-- So: exact match on username, or on "first last", case-insensitively, and
-- only when exactly ONE profile matches. Two profiles matching leaves null.

BEGIN;

-- ─── the columns ───────────────────────────────────────────────────────────
--
-- Nullable, every one. A row recorded before accounts existed has no profile
-- and never will; NOT NULL here would make this migration impossible to apply
-- to real data. 0011 does not change that either — history keeps its nulls.

-- entries already has submitted_by from 0008. Same concept, existing name.
ALTER TABLE public.entries
    ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.assignments
    ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.assignment_overrides
    ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE public.reminders
    ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE;

-- ON DELETE differs on purpose. Revoking someone should take their assignments
-- and their targeted reminders with them — those describe a person who is no
-- longer on the team. It must NOT take their scouting entries: those are the
-- team's data, recorded about robots, and losing them because a senior
-- graduated would be indefensible. Hence SET NULL on entries, CASCADE
-- elsewhere.

-- ─── resolve a typed name to an account ────────────────────────────────────
--
-- Returns a profile id only when the answer is unambiguous. Ambiguity returns
-- null, which the caller must treat as "unknown", not "nobody".

CREATE OR REPLACE FUNCTION public.profile_for_name(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    -- Exactly one candidate, or nothing. Two people called "Alex" must not
    -- silently become one of them, so the count is carried alongside each
    -- candidate and the row is only returned when it is the only one.
    --
    -- Written with a window function rather than HAVING count(*) = 1 because
    -- selecting a bare column beside an aggregate with no GROUP BY is invalid
    -- — it parses, so `npm run check:sql` accepts it, and it fails at run time.
    -- And not with min(id) either: there is no min() aggregate for uuid before
    -- PostgreSQL 18, which Supabase does not run.
    SELECT c.id
    FROM (
        SELECT p.id, count(*) OVER () AS matches
        FROM public.profiles p
        WHERE lower(btrim(p_name)) IN (
            lower(p.username),
            lower(btrim(p.first_name || ' ' || p.last_name)),
            lower(btrim(p.first_name))
        )
    ) c
    WHERE c.matches = 1;
$$;

REVOKE ALL ON FUNCTION public.profile_for_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_for_name(text) TO authenticated;

-- ─── backfill ──────────────────────────────────────────────────────────────
--
-- Idempotent: only fills nulls, so re-running after more people register picks
-- up the newly-resolvable rows and leaves the rest alone. Worth re-running
-- once everyone has an account.

UPDATE public.entries
   SET submitted_by = public.profile_for_name(scout_name)
 WHERE submitted_by IS NULL
   AND public.profile_for_name(scout_name) IS NOT NULL;

UPDATE public.assignments
   SET profile_id = public.profile_for_name(scout_name)
 WHERE profile_id IS NULL
   AND public.profile_for_name(scout_name) IS NOT NULL;

UPDATE public.assignment_overrides
   SET profile_id = public.profile_for_name(scout_name)
 WHERE profile_id IS NULL
   AND public.profile_for_name(scout_name) IS NOT NULL;

UPDATE public.reminders
   SET profile_id = public.profile_for_name(scout_name)
 WHERE profile_id IS NULL
   AND scout_name IS NOT NULL          -- null scout_name means broadcast
   AND public.profile_for_name(scout_name) IS NOT NULL;

-- ─── indexes ───────────────────────────────────────────────────────────────
--
-- "what am I assigned" and "what is targeted at me" are the two hot reads, and
-- both are about to key on profile_id.

CREATE INDEX IF NOT EXISTS assignments_profile_idx
    ON public.assignments (session_id, profile_id);

CREATE INDEX IF NOT EXISTS overrides_profile_idx
    ON public.assignment_overrides (session_id, match_number, profile_id);

CREATE INDEX IF NOT EXISTS reminders_profile_idx
    ON public.reminders (session_id, profile_id);

CREATE INDEX IF NOT EXISTS entries_submitted_by_idx
    ON public.entries (session_id, submitted_by);

-- A person cannot be assigned the same team twice in one event. The existing
-- dedupe index is on scout_name and stays until 0011; this is its counterpart,
-- partial so it ignores the rows that have no profile yet.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_profile_dedupe_idx
    ON public.assignments (session_id, profile_id, team_number)
    WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS overrides_profile_dedupe_idx
    ON public.assignment_overrides (session_id, match_number, profile_id, team_number)
    WHERE profile_id IS NOT NULL;

-- entries.submitted_by is deliberately NOT added to entries_dedupe_idx.
--
-- That index is what stops the sync layer storing a row twice: pushOutbox()
-- relies on it raising 23505 and adopting the existing row's id, and the
-- column list has to stay in step with the lookup there. Adding a nullable
-- column to a unique index also changes its semantics — in Postgres NULLs are
-- distinct, so every unattributed row would stop deduping against every other.
-- The dedupe key is a content fingerprint, not an identity claim. Leave it.

-- ─── how to read this afterwards ───────────────────────────────────────────
--
--   SELECT scout_name, count(*) FILTER (WHERE submitted_by IS NULL) AS unmatched,
--          count(*) AS total
--     FROM public.entries GROUP BY scout_name ORDER BY unmatched DESC;
--
-- Anything with unmatched > 0 is a name no account claims — either a scout who
-- has not registered yet, or a spelling nobody uses any more. Re-run the four
-- UPDATEs above once everyone has signed up.

COMMIT;
