-- Migration: drop the two column defaults that were never supposed to exist
--
-- Confirmed live 2026-08-07:
--
--     created_at      default now()
--     schema_version  default 2
--
-- These are the last two rows of the drift table in supabase/README.md. The
-- third — the stray DELETE policy — went with 0013. 0001_entries.sql specifies
-- both columns with no default and can never run, so like everything else 0001
-- was meant to repair, this has sat unreachable.
--
-- ─── these are not currently firing ────────────────────────────────────────
--
-- Worth being precise, because it changes how urgent this is. The client always
-- supplies both: db.js stamps createdAt and schemaVersion on every new entry,
-- and sync.svelte.js sends `schema_version: local.schemaVersion ?? SCHEMA_VERSION`.
-- No default can fire while that holds. Unlike the missing UPDATE policy 0013
-- fixed, nothing is being lost today.
--
-- What they are is a trap armed for the next writer who forgets, and one of
-- them has already sprung once.
--
-- ─── why schema_version = 2 is the dangerous one ───────────────────────────
--
-- That column exists to tell "never collected" apart from "recorded zero" —
-- the blank-is-not-zero invariant that readMetric() enforces and eight tests
-- defend. SCHEMA_VERSION is 3.
--
-- An entry defaulted to 2 claims to predate every counter metric added in 3.
-- readMetric() then reads those metrics as never collected and excludes the
-- entry from their sample. The row looks completely normal, the app reports no
-- error, and a scout's observations quietly stop counting toward the averages
-- an alliance pick is made from.
--
-- This exact failure already happened once: the client hardcoded 2 while
-- form-config.js had moved to 3. It was fixed in the client. The default that
-- made it possible is still here.
--
-- ─── why created_at matters ────────────────────────────────────────────────
--
-- It is part of the dedupe key
-- [session_id, event_code, match_number, team_number, scout_name, created_at]
-- and it carries the CLIENT's timestamp, not the server's. Two devices holding
-- one observation agree on it, which is what lets the second push raise 23505
-- and adopt the first row instead of storing a copy.
--
-- A server default breaks that agreement: an insert that omits the column gets
-- the server's clock, a fingerprint no peer can match, and a duplicate. Not an
-- error — a duplicate, counted twice in every metric.
--
-- ─── on dropping a default from a NOT NULL column ──────────────────────────
--
-- Safe here, and deliberately chosen. If some future path does omit one of
-- these, it now fails loudly with a NOT NULL violation instead of silently
-- inserting a plausible lie. A visible error is the better outcome; that is the
-- same reasoning 0010 uses for leaving an ambiguous profile_id null rather than
-- guessing.
--
-- Existing rows keep the values they already have. A default only applies to
-- inserts that omit the column, so nothing is rewritten.

BEGIN;

ALTER TABLE public.entries ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.entries ALTER COLUMN schema_version DROP DEFAULT;

COMMIT;
