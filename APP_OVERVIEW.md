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

## Two applications, one deployment

    the scout app     Home · Scouting · Settings      + a Studio button for managers
    Studio            Event · Schedule · Coverage · Insights · Accounts

Different jobs, different devices, different rooms. v0.73 split them, and Studio
renders with **no app shell at all** — the root layout returns early on
`/studio` — because the global tab bar was a trapdoor out of it.

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
| `/home` | Where a scout lands: greeting, up next, manager notes, upcoming |
| `/scouting` | The scout's own entries, and what they have recorded |
| `/scouting/new` | Record a match observation |
| `/scouting/edit` | Correct a saved observation |
| `/settings` | Device settings, event, theme, sign out |
| `/studio/event` | Who is on this event — drag scouts on and off |
| `/studio/schedule` | Publish a TBA schedule, auto-assign, overrides, reminders |
| `/studio/coverage` | What is being watched and what is not |
| `/studio/insights` | Team metrics, with `/team/[teamNumber]`, `/compare`, `/picklist` |
| `/studio/accounts` | Create accounts, mint invites, paste a roster, set roles |

`/accounts` and `/insights/*` still exist as **redirect stubs**, not duplicates.
v0.73 moved those surfaces into Studio, and deleting the old paths would 404 an
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
- **`metrics.js` / `aggregate.js`** — numeric summaries. Blank means *not
  recorded*; `0` means a recorded zero.
- **`auto-assign.js` / `assignments.js` / `coverage.js`** — DSATUR assignment,
  per-match overrides, coverage maths.
- **`tba.js` / `alliances.js`** — schedule and alliance data. `myMatches()` is
  the single resolver for which robot a scout watches in a match; `auto-assign`
  depends on its answer.
- **`picklist.js` / `picklist-store.js`** — per-team ranked list and merge.
- **`draft.js`** — a half-filled entry form survives leaving the page.
- **`greeting.js`** — Home's greeting, seeded on the day so it does not reshuffle
  while being read.
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

Two things are deliberately still open: `anon` retains EXECUTE on
`email_for_username` for cached clients — `supabase/rollout/revoke_email_for_username.sql`
is the final gate and stays out of `migrations/` — and leaked-password protection
is off in the dashboard.

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
