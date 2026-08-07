-- Migration: remove the inert passphrase objects
--
-- ─── Preconditions ─────────────────────────────────────────────────────────
--
--   1. 0011 has been applied, and `verify_migrations.sql` reports
--      "post-cutover — passphrase inert".
--   2. The AUTH_ENFORCED client has been live long enough that every installed
--      PWA has fetched it. A service worker serves the cached bundle first and
--      updates in the background, so "we deployed it" and "everyone is running
--      it" are days apart, not minutes. Two weeks of ordinary use is a
--      reasonable soak; a competition weekend in the middle is not.
--   3. Nobody has reported a write failing since the cutover.
--
-- ─── What this removes, and why it waited ──────────────────────────────────
--
-- 0011 disabled the passphrase without deleting it: `has_manager_token()` was
-- replaced with an always-false stub and `event_meta.manager_token` was left
-- in place. Neither grants anything — 0011 revoked EXECUTE from every API role
-- and no policy calls the function — but both still resolve.
--
-- That was deliberate. A cached client sending `x-manager-token` against a
-- database where the object is gone gets an error naming a missing function;
-- against the stub it gets a clean denial, which the client already handles as
-- "you are not a manager". The difference matters for exactly one release, and
-- then the compatibility shim is just a dead security mechanism sitting in the
-- schema looking live. That is how someone in a later season mistakes it for
-- protection.
--
-- Nothing here is reversible in any useful sense — the hash it drops is not
-- recoverable and nothing wants it back — but nothing depends on it either, so
-- the risk is the opposite shape from 0011's. This one is safe and dull.

BEGIN;

-- RESTRICT, not CASCADE. If any policy still references the function, this
-- fails loudly and names it. CASCADE would drop that policy along with the
-- function and leave a table with one fewer rule than its author intended —
-- which, for a permissive policy set, means quietly denying, and for a
-- restrictive one means quietly permitting. Neither is worth discovering in
-- March.
DROP FUNCTION IF EXISTS public.has_manager_token() RESTRICT;

-- The passphrase hash itself. `event_meta` keeps its remaining columns:
-- reset_event_data() still deletes from the table, and session_id/event_code
-- remain a cheap record that an event exists.
ALTER TABLE public.event_meta DROP COLUMN IF EXISTS manager_token;

COMMIT;

-- ─── afterwards ────────────────────────────────────────────────────────────
--
-- Run supabase/verify_migrations.sql. It should report
-- "post-cutover, 0012 applied — passphrase gate fully removed", and every
-- post-cutover check should still be running rather than skipped — those
-- checks key on whether the gate can still authorise, which is false whether
-- the function is inert or absent.
--
-- Then delete the passphrase UI from the client. `ManagerPassphrase.svelte`,
-- `event-meta.js`, `session.managerToken` and the `x-manager-token` header in
-- `supabase.js` all become dead code at this point, and
-- `auth.managerCredentials()` can lose its pre-cutover branch and return an
-- empty bag unconditionally. `check_components.mjs` enforces that nobody
-- derives manager rights outside `auth.svelte.js`, so that removal is one file
-- plus the deletions.
