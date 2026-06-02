-- Migration: decouple the team's event code from the TBA event key.
--
-- Background
-- ----------
-- Until now a single string, `event_code`, did double duty:
--   1. Sync namespace  — session_id = sha256(event_code). Everyone on the same
--      code shares data.
--   2. TBA lookup key   — the schedule fetch hit /event/{event_code}/matches,
--      so the code had to match TBA's canonical key (e.g. 2027nyny).
--
-- This forced the whole team to memorize/type TBA's dense key. We now let the
-- team pick any memorable code (e.g. 2027nyc) for sync, while the manager
-- stores the canonical TBA key separately for fetching.
--
-- Where the TBA key lives
-- -----------------------
-- On the `schedules` row, NOT `event_meta`. Two reasons:
--   * The `schedules` row is created on the very first publish, gated by the
--     same has_manager_token() bootstrap rule — no passphrase required. The
--     `event_meta` row, by contrast, only exists once a passphrase is set, and
--     its INSERT policy is bootstrap-only (NOT EXISTS), so writing the TBA key
--     there early would collide with the later passphrase-setting INSERT.
--   * The key and the schedule it produced belong together; a second manager
--     device pulls the schedules row and learns the key for re-fetching.
--
-- This migration is additive and idempotent. The column is nullable; clients
-- that predate it (and events published before it) simply leave it NULL, and
-- the app falls back to using the event_code as the TBA key — exactly today's
-- behavior. Safe to re-run.

BEGIN;

ALTER TABLE public.schedules
    ADD COLUMN IF NOT EXISTS tba_event_key text;

COMMENT ON COLUMN public.schedules.tba_event_key IS
    'Canonical TBA event key used to fetch this schedule (e.g. 2027nyny). '
    'Distinct from event_code, which is the team-chosen sync namespace. '
    'NULL on events published before the code/key split — callers fall back '
    'to event_code for the TBA fetch when this is unset.';

COMMIT;
