# FRC Scout — application overview

A brief map of what this app is and how it's put together. Written 2026-07-26.

## What it is

A PWA for FRC team 3419 that lets scouts record match observations on their
phones and lets a manager aggregate everything for alliance-selection decisions.
Static SvelteKit site deployed to GitHub Pages; Supabase is the sync bus.

**Stack:** Svelte 5 (runes) + SvelteKit 2, `adapter-static`, Vite 5, PWA
plugin, Dexie (IndexedDB), `@supabase/supabase-js`. No TypeScript (JSDoc types
only). One test file, `src/lib/metrics.test.mjs`, run with
`node src/lib/metrics.test.mjs`.

## The core model

Everything hangs off one string: the **event code**.

- `deriveSessionId(eventCode)` hashes it into a UUID (`sha256("frc-scout:event:" + code)`).
- Every Supabase request carries that UUID in an `x-session-id` header.
- RLS policies compare the header to the row's `session_id`. No header → zero rows.

Two devices typing the same event code share data. There is no login and no
per-user auth — this is a deliberate, documented trade-off (the event code is
public on TBA). Write access to *scheduling* tables is gated separately by
`x-manager-token`, a client-side SHA-256 of a manager passphrase + event code,
checked by the `has_manager_token()` Postgres function.

**IndexedDB is the source of truth.** Supabase is a mirror. The sync layer
(`sync.svelte.js`) polls every 3s, pushing unsynced local rows and pulling
peers' rows; schedule and assignment data is checked every 10th tick (30s).
A scout with no signal can still save; the entry flushes on reconnect. That
matters because a venue is a few hundred phones on one access point.

## Two roles, one codebase

Stored as a local setting (`role.svelte.js`) — it only changes which UI shows.

- **Scout** — records entries, sees their assigned teams and next match.
- **Manager** — same, plus the aggregation views and schedule publishing.

## Routes

| Route | Purpose |
|---|---|
| `/` | Entry list, next-match suggestion |
| `/new` | The entry form — counts, then notes (schedule pre-fill, mismatch warnings) |
| `/edit` | Edit a saved entry |
| `/schedule` | Biggest page (2.2k lines). Scout: my teams. Manager: TBA fetch, publish, passphrase, auto-assign, per-match overrides, coverage board, reminders |
| `/manager` | Aggregated per-team view — stats, search, sort, filters, discrepancy flags, CSV export |
| `/manager/team/[n]` | Per-team match log |
| `/manager/compare` | Multi-team side-by-side |
| `/manager/picklist` | Drag-ordered picklist builder (local only) |
| `/settings` | Identity, role, theme, data management |

## Key library modules

- **`db.js`** — Dexie wrapper. `entries` + `settings` tables, schema v2. Dedupe
  via a compound index on `[eventCode+matchNumber+teamNumber+scoutName+createdAt]`.
- **`form-config.js`** — single source of truth for form fields. Editing this
  file updates the form, the CSV export, and every manager view together.
  `METRIC_FIELDS` holds the numeric counters (retuned each January);
  `NOTE_FIELDS` holds the qualitative ones.
- **`metrics.js`** — the numeric engine. Per-metric n, mean, median, max, min,
  standard deviation, trend, small-sample guard, and the weighted `scoreTeams()`
  used by the picklist. Enforces the rule that blank ≠ 0.
- **`aggregate.js`** — `summarize()` builds per-team rollups: metric stats,
  counts, unique strengths, auto-path frequency, cross-scout discrepancies.
- **`tba.js`** — The Blue Alliance v3 integration. Manager fetches and
  publishes; scouts pull from Supabase and never need a key. TBA event key is
  decoupled from the team's sync code.
- **`assignments.js`** — scout↔team mapping plus `autoAssignTeams()`, a greedy
  most-constrained-first allocator that avoids giving one scout two teams that
  play each other.
- **`coverage.js`** — pure "which (match, team) cells are scouted?" logic,
  shared by home, schedule, and manager so all three agree.
- **`reminders.js` / `reminders.svelte.js`** — manager-authored (Supabase) and
  auto-generated (client-side, from match predicted times) reminders in one
  banner slot. Dismissal is local.
- **`csv.js`** — CSV export for spreadsheet work. Columns derive from
  `form-config.js`, so a new field appears automatically.

## Database

Five tables via 5 migrations: `event_meta` (passphrase hash), `schedules`
(cached TBA match list + `tba_event_key`), `assignments`, `assignment_overrides`,
`reminders`. Plus `reset_event_data()`, which clears scheduling state while
deliberately preserving scout entries. Every table is RLS-gated by
`x-session-id` for reads and `has_manager_token()` for writes.

## State of the code

Well-commented throughout — most modules open with a paragraph explaining the
design decision, not just the mechanics. Consistent patterns. The main soft
spots:

1. **`/schedule` is ~2,200 lines** in one component and does roughly eight
   distinct jobs. Splitting it is step one of the hallmark redesign.
2. **Every page carries its own `<style>` block.** Design tokens exist but no
   shared components.
3. **`/edit` changes never reach the cloud.** The sync layer is INSERT-only, so
   an edited entry keeps its stale remote row.
4. Build artifacts (`build/`, `.svelte-kit/`) are committed to the repo.

`ROADMAP.md` is the single plan — it also records what was deliberately *not*
built (photos, push notifications, voice-to-text, a fully online rewrite) so
those don't get re-proposed.
