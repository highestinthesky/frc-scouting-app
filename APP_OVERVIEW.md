# FRC Scout — application overview

Audited 2026-08-03. This describes the source tree and the live database
separately; a migration being present in Git does not mean it is deployed.

## What it is

FRC Scout is an offline-first PWA for FRC team 3419. Scouts record match
observations on phones; managers publish the event schedule, assign scouts and
use the combined data for alliance-selection decisions. It is a static SvelteKit
site deployed to GitHub Pages, with IndexedDB as the local write target and
Supabase as the shared mirror.

**Stack:** Svelte 5 (runes), SvelteKit 2 with `adapter-static`, Vite 5,
`vite-plugin-pwa`, Dexie and `@supabase/supabase-js`. The project uses JavaScript
with JSDoc rather than TypeScript.

## The core model

The event code still defines the data partition:

- `deriveSessionId(eventCode)` hashes it into a UUID.
- Every event-data request carries that UUID in `x-session-id`.
- Each shared row also stores the same value as `session_id`.

IndexedDB remains the source of truth for scouting entries. A save succeeds
locally even without a network or valid access token; the polling sync layer
pushes it later and pulls peers' changes. `updated_at` is the edit watermark, so
corrections propagate without overwriting a local row that still has unpushed
changes.

The repository also contains the account upgrade: Supabase Auth, invite-based
registration, `profiles` roles and `/login`, `/register` and `/accounts`.
However, `AUTH_ENFORCED` is still `false`. The deployed authorization path is
therefore still the legacy one: event-scoped reads and a manager passphrase for
privileged writes. Accounts are not yet the production security boundary.

## Current routes

| Route | Purpose |
|---|---|
| `/` | Entry history, sync status and next-match guidance |
| `/scouting` | Published schedule, assignments, coverage and manager event controls |
| `/scouting/new` | Record a match observation |
| `/scouting/edit` | Correct a saved observation |
| `/insights` | Aggregated team metrics, filters and CSV export |
| `/insights/team/[teamNumber]` | One team's match history |
| `/insights/compare` | Side-by-side team comparison |
| `/insights/picklist` | Ranked picklist and alliance-selection state |
| `/settings` | Local identity, role, theme and data controls |
| `/login`, `/register` | Account sign-in and invite redemption; optional before cutover |
| `/accounts` | Manager account and invite administration |

The former `/schedule`, `/new`, `/edit` and `/manager/*` routes have already
been moved. The large scouting screen is split into components under
`src/lib/components/scouting/`.

## Key modules

- **`db.js`** — Dexie database and the offline-first entry write path. Its
  current schema also stores row-based picklist data.
- **`sync.svelte.js` / `sync-rules.js`** — entry push/pull, edit conflict rules
  and throttled schedule/assignment refreshes.
- **`form-config.js`** — shared field definitions for the form, export and
  insights surfaces.
- **`metrics.js` / `aggregate.js`** — numeric summaries and team rollups. Blank
  means “not recorded”; zero means a recorded zero.
- **`auto-assign.js` / `assignments.js` / `coverage.js`** — DSATUR assignment,
  overrides and coverage calculations.
- **`tba.js` / `alliances.js`** — The Blue Alliance schedule and alliance data.
- **`picklist.js` / `picklist-store.js`** — per-team ranked-list persistence and
  merge behavior.
- **`auth.svelte.js`** — account state, invite registration and role/profile
  management. Profile reads are scoped to the signed-in user's UUID.

## Database state

The migration files are the rebuild source of truth, but the live project is
currently between stages:

| Migration | Live state |
|---|---|
| `0001`–`0006` | Existing baseline; not individually re-verified in this audit |
| `0007_entry_updated_at.sql` | Applied |
| `0008_auth.sql` | Applied; account objects exist, but enforcement is off |
| `0009_picklist.sql` | Applied |
| `0010_identity.sql` | Not applied |
| `0011_policies.sql` | Not applied |

The local, unapplied migration work now guards immutable profile identity and
role transitions, requires both team membership and matching event scope in the
cutover policies, stamps and preserves entry attribution, and rewrites the
archive/reset RPC to use manager roles. Static tests pin those invariants. This
is hardening work, not a deployment: no migration was run by this change.

## Upgrade boundary

The auth cutover is not ready to deploy yet. Before `0011` and
`AUTH_ENFORCED = true` can ship together, the client must stop using
`managerToken`, dual-write `profile_id`/`submitted_by`, read assignments and
targeted reminders by profile UUID, and pass live Postgres tests with anon,
orphaned, scout, manager and super identities.

`profiles.recovery_email` is only stored metadata today. Supabase password
recovery sends to the email in `auth.users`; it does not consult this column.
Working self-service recovery therefore needs an Edge Function or another
trusted server-side admin flow.

`ROADMAP.md` is the single dependency-ordered plan. `docs/adr-001-auth.md`
records the auth decisions and `supabase/README.md` is the migration runbook.
