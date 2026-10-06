# FRC Scout — application overview

Audited 2026-08-20 against the source tree and the live project. A migration
being present in Git does not mean it is deployed, so the database section below
records what is actually applied.

This is the map. `CLAUDE.md` is the reasoning — every invariant, every trap and
why each decision went the way it did. When the two disagree, `CLAUDE.md` is the
one kept current.

## What it is

An offline-first PWA for FRC team 3419. Scouts record match observations on
phones; managers publish the schedule, staff the event and use the combined data
for alliance selection. Static SvelteKit on GitHub Pages, IndexedDB as the write
target, Supabase as the shared mirror.

**Stack:** Svelte 5 (runes), SvelteKit 2 with `adapter-static`, Vite 5,
`vite-plugin-pwa`, Dexie, `@supabase/supabase-js`. JavaScript with JSDoc, not
TypeScript.

## One shell, navigation by role

    a scout      Home · Settings
    a manager    Home · Plan · Run · Pick · Accounts · Settings

Studio was a separate application from v0.73 and folded back in on
`ui-optimization`: scouts never saw it, and the split cost managers an event
picker outside their tools. `nav-items.js` is the list and `AppNav.svelte`
renders it; a manager's modes have sub-pages in a segmented control, and the
event is chosen in the app bar. See CLAUDE.md for the detail.

## The core model

**An event is a row.** `events.id` scopes every shared table via `event_id`, and
`event_scouts` decides who may see it. `events.code` is a TBA label, not a
credential — knowing it grants nothing.

Recording writes to **IndexedDB first, always**. The sync layer pushes to
Supabase on a 3-second tick and pulls peers' rows back. Pull is a watermark on
`updated_at`, not a full fetch, which is why deletion is a tombstone
(`deleted_at`) and why `updated_at` is set by a trigger rather than the client.

Three roles on `profiles.role` — `scout`, `manager`, `super` — enforced in
Postgres RLS. `manages_event(event_id)` is the one predicate; `auth.canManage`
and `auth.showsManagerTools` are its client twins, and `check_components.mjs`
fails the build if anything re-derives them.

Sign-in sends username and password to the `username-sign-in` Edge Function,
which resolves the address privately and returns only a token pair. The browser
never receives an email merely for knowing a username.

## Current routes

| Route | Purpose |
|---|---|
| `/` | Sign in. Every other route redirects here when signed out |
| `/register` | Redeem an invite code; shows whose invite it is |
| `/home` | Where a scout lands: up next, manager notes, upcoming, the whole schedule behind a disclosure. Managers see coverage, missing entries and scout activity, with personal scouting tools in a disclosure |
| `/scouting` | A redirect to `/home`; folded into Home at v0.82 |
| `/scouting/new` | Record a match observation |
| `/scouting/edit` | Correct a saved observation |
| `/settings` | Device settings, event, theme, sign out |
| `/practice` | The auto recorder on the current season, nothing kept. In `NEEDS_NO_EVENT`, so a signed-in device reaches it with no event or scout name |
| `/studio/plan/people` | Who is on this event, and who is assigned and recording |
| `/studio/plan/schedule` | Fetch and publish the TBA schedule |
| `/studio/plan/assignments` | Assign scouts, auto-assign, conflicts in the draft |
| `/studio/plan/event` | Name, dates, archive, reset planning data |
| `/studio/run/matches` | Coverage numbers, quals with coverage and conflicts on their rows, a Gaps/Conflicts filter, per-match overrides |
| `/studio/run/scouts` | Entries by scout; reminders; collect a file from a phone that cannot sync |
| `/studio/review` | Next match and its six teams, matches played, find a team |
| `/studio/[code]/q[n]`, `/studio/[code]/team/[n]` | One match with its replay; one team. Under Review |
| `/studio/pick` | Team metrics and CSV, with `/compare` and `/picklist` |
| `/studio/accounts` | Create accounts, mint invites, paste a roster, set roles |

`/accounts`, `/insights/*`, `/studio`, `/studio/event`, `/studio/schedule`,
`/studio/coverage`, `/studio/run/coverage` and `/studio/insights/*` exist as **redirect stubs**, not
duplicates. Those surfaces moved (into Studio at v0.73, then into Plan, Run and
Pick; Coverage then into Run › Matches), and deleting the old paths would 404 an
installed PWA that still holds a bundle whose links point at them. Same reasoning
as the username-lookup rollout gate: a service worker can serve an old bundle
long after a deploy. Retire them when that window is judged closed, not for
tidiness.

## Key modules

- **`db.js`** — Dexie and the offline-first write path. Deliberately free of
  `auth.svelte.js`: recording never depends on auth.
- **`sync.svelte.js` / `sync-rules.js`** — push/pull, conflict rules, throttled
  schedule and assignment refreshes.
- **`session.svelte.js`** — this device's event, name and per-event settings.
- **`auth.svelte.js` / `username-auth.js`** — account state, invite
  registration, and the private username/password exchange.
- **`scout-identity.js`** — `scout_name` is a join key, not a label. `sameScout()`
  and `rowScout()` are the only things that may compare one.
- **`form-config.js`** — the field definitions shared by the form, export and
  insights.
- **`seasons/`** — the game as data. `2026.js` is REBUILT: the field, auto's
  length, the actions with their keys, icons and follow-up questions, the cycle
  and the endgame. `fixture.js` is a throwaway 1999 season that proves the swap.
  `index.js` validates and builds a season and holds `CURRENT_SEASON`, the one
  line that changes which season new recordings are made on.
- **`field.js`** — the geometry engine (`makeField`): collision, start zones and
  the view transforms, for any season. It names no game.
- **`auto-track.js`** — the auto track's encoding. Stamped with its season and
  read back on it; `cycleStats()` reports `byAction`, `cycles`, `faults` and
  `endgame.{done, startedAt, answers}` from the track's own season.
- **`metrics.js` / `aggregate.js`** — numeric summaries. Blank means *not
  recorded*; `0` means a recorded zero.
- **`auto-assign.js` / `assignments.js` / `coverage.js`** — DSATUR assignment,
  per-match overrides, coverage maths (`gapMatches()` is Run's Gaps filter).
- **`event-data.svelte.js` / `plan-state.js` / `review.js`** — the manager
  pages' one copy of the current event, the derivations Plan and Run share
  (conflicts, watchers, `scoutCounts()`), and Review's split of the quals into
  next and played.
- **`tba.js` / `alliances.js`** — schedule and alliance data. `myMatches()` is
  the single resolver for which robot a scout watches in a match; `auto-assign`
  depends on its answer.
- **`picklist.js` / `picklist-store.js`** — per-team ranked list and merge.
- **`draft.js`** — a half-filled entry form survives leaving the page.
- **`greeting.js`** — Legacy greeting helper, retained for compatibility.
- **`transfer.js`** — offline handoff as a file, for gyms with no usable wifi.
- **`event-rules.js` / `events.js`** — event codes, per-event settings, and which
  event a device is on.

## Database state

Live project `hhvpkgwgkuiemxyarsuk`, verified 2026-08-20.

| Migration | Live state |
|---|---|
| `0001`–`0010` | Applied. `0001` is corrective and re-runnable |
| `0011`–`0013` | **Never applied**; superseded, and they live in `supabase/superseded/` |
| `0016`–`0018` | Applied 2026-08-14 |
| `0019`–`0023` | Applied. Events, membership, and the auth cutover |
| `0024` | Applied 2026-08-20. Private username sign-in and its rate limit |

**The cutover is complete.** `AUTH_ENFORCED` is `true`, `session_id` and the
manager passphrase are gone, and membership is the only thing granting access.

The username email lookup is closed to browsers (`0028`, 2026-10-04).
Leaked-password protection is still off in the dashboard.

Four accounts still hold `<username>@scout.invalid` addresses from before `0016`.
They sign in normally but can never receive recovery mail.

## Known gaps

- **No self-service password recovery UI.** Addresses are real now, so Supabase
  can send it, but there is no request screen or callback route.
- **No whole-event schedule view for scouts.** Home lists only matches one of
  their own teams is in.
- **`currentEvent()` cannot choose between undated events**, and nothing in the
  app ever sets `starts_on`. A scout put on a second event gets no
  auto-selection and has no picker.

`ROADMAP.md` is the single dependency-ordered plan. `docs/adr-001-auth.md`
records the auth decisions, `supabase/README.md` is the migration runbook, and
`design.md` is the locked design system.
