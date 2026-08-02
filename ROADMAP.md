# FRC Scout — consolidated roadmap

One source of truth. Everything from the old planning docs (`IMPROVEMENT_DRAFT.md`,
`FRC_Scout_Improvements_v3.docx`, `MANAGER_REDESIGN_HANDOFF.md`, `IMPROVEMENTS.md`,
`PLAN.md`, `UPGRADE_PLAN.md`, `FRC Scouting App v6.pdf`) was folded in here and
those files deleted. Do not start a second plan document — add to this one.

Last updated: 2026-08-01.

> **Three migrations are written and have never been run.** `0007`, `0008` and
> `0009`. Until they are applied the app is worse than it was: sync errors on
> every tick looking for `entries.updated_at`. Paste them into the Supabase SQL
> editor in order. See [`supabase/README.md`](supabase/README.md).

---

## Already shipped — stop re-planning these

**Through v0.5 (June 2026)**

- Manager view rebuilt: stats grid, search, sort, filter chips, badges, CSV
  export, strengths preview.
- Edit-after-save (`/edit`), TBA schedule integration, deeplinked pre-fill,
  per-team match log, multi-team compare, picklist builder, discrepancy
  flagging, dark mode, home pace counter.
- TBA event key decoupled from the sync event code.
- Live coverage board, smart auto-assign, per-match assignment overrides,
  coverage-conflict detection, design-system tokens.
- Structured defense entry, team-scoped tag pills, deduplicated strengths.

**This round (July 2026)**

- **File transport layer removed.** `export.js`, `import.js`, the `.scout`
  format and the `pako` dependency are gone, along with the Import/Export UI on
  `/` and `/manager`. Cloud sync fully replaced the hand-carried-file workflow.
  CSV export survives as `lib/csv.js` — it's a deliverable for spreadsheet work,
  not a transport, and its columns now derive from `form-config.js`.
- **Numeric metrics.** A `counter` field type plus a `METRIC_FIELDS` group in
  `form-config.js`. See "Retuning metrics each season" below.
- **Aggregation engine** (`lib/metrics.js`): per-metric n, mean, median, max,
  min, standard deviation, trend and a small-sample guard. Every manager surface
  reads from this one module so they can't disagree.
- **Metrics surfaced**: metric strip and sort-by-metric on `/manager`; metric
  cards with sparklines on the team page; numeric rows with leader highlighting
  on `/manager/compare`; weighted composite scoring on `/manager/picklist`.
- **UI copy trimmed** across every route.
- **In-app confirm dialog** replacing `window.confirm()` at all seven sites.
- **Sync UPDATE path** — edits now reach the cloud and propagate to teammates.
- **Minimal-delta auto-assign** — re-running mid-event moves only what must move.
- **`Button.svelte`** — one CTA voice, replacing 194 lines of duplicated CSS.
- **`/settings` migrated** onto the design system: tokens, 44px targets, and
  both option pickers given proper radiogroup semantics.
- **`/schedule` split into ten components** under `src/lib/components/scouting/` (was `schedule/`).
  State stays in the route; CSS co-located verbatim per component.
- **Auto-assign rewritten as graph colouring.** Every match is a 6-team clique,
  so assigning teams to scouts is exactly graph colouring. DSATUR plus a
  per-match override repair pass. Real coverage went from ~79% to 100% at 6+
  scouts, and reports coverage instead of a clash count. `lib/auto-assign.js`,
  79 tests.
- **Unsaved assignment drafts survive a refresh** — mirrored to IndexedDB,
  restored with a dismissible note, cleared on save.
- **Scouts see the whole schedule**, with a My teams / All matches toggle and
  rows that expand to all six robots.
- **Scout-added teams removed.** They lived only on one phone, so the manager's
  coverage board never saw them and auto-assign planned around a roster that
  didn't match reality.
- **Design system locked** in `design.md` — genre modern-minimal, Workbench
  family, brand purple, system fonts, nav docked to the bottom on phones.
  Contrast audited: `--text-faint` was failing AA at 3.5 and is now 4.54.

### What stayed local-first, deliberately

The file layer went; the local-first write path did **not**. Entries still land
in IndexedDB first and sync up afterwards, and the PWA still installs. An FRC
venue is a few hundred phones fighting over one access point — a scout who
can't save during a wifi drop loses the match entirely, and there's no way to
reconstruct it. Revisit only if a real event proves the connection reliable.

---

## Retuning metrics each season

`METRIC_FIELDS` in `src/lib/form-config.js` is deliberately game-agnostic —
fields are named for what a scout physically counts, not for this year's game
pieces. Each January:

1. Edit the labels, `max` values and `higherIsBetter` flags in `METRIC_FIELDS`.
2. Bump `SCHEMA_VERSION`.
3. Push. The form, CSV export, aggregation engine, manager table, team page,
   compare view and picklist all read from that array — no other file changes.

Keep the list to four or five counters. A scout has ~2m30s and one pair of eyes;
a metric nobody reliably records is worse than no metric.

**The one invariant to preserve:** blank means *not recorded*, `0` means
*recorded and it was zero*. `readMetric()` in `lib/metrics.js` enforces the
distinction and every consumer depends on it. Entries from before a metric
existed contribute nothing to its sample rather than dragging the mean to zero.

---

## Where we are on v6

Measured 2026-08-01. Percentages are of *scope*, not effort.

**Written is not running.** Phase 1 was previously logged at 70% on the basis of
lines committed. Every line of its schema is unapplied, so the correct number is
lower and the honest unit is "verified against a real database", not "typed".

| Phase | | Status |
|---|---|---|
| **0** Cheap wins | dialogs · minimal-delta auto-assign · sync UPDATE · picklist sync | **100%** |
| **1** Auth, roles, accounts | client done; schema written but never executed; cutover not started | **45%** |
| **2** Alliance selection | picklist syncs; taken teams marked live from TBA | **90%** |
| **3** IA + redesign | routes moved; every page and component on the token scale | **85%** |
| **4** Studio + Insights | not started | **0%** |

### Done

- **Native dialogs.** Zero `confirm()` calls remain. `Dialog.svelte` +
  `dialog.svelte.js`.
- **Minimal-delta auto-assign.** A departing scout moves 5 teams instead of 33.
- **Sync UPDATE.** Edits reach the cloud and propagate. *Blocked on migration
  0007 — the client queries `updated_at` and errors until then.*
- **Database under version control.** `entries` captured as 0001, drift
  assertions, CI gates on tests + SQL parsing.

**Route tree on the v6 IA.** `/schedule` → `/scouting` with `/new` and `/edit`
as children; `/manager` → `/insights` with its four sub-pages;
`components/schedule/` → `components/scouting/`. Every internal link rewritten
and checked against the real route tree. Structure only — which is the point:
each page is now at its final address, so the redesign happens once per page
instead of twice.

**The design system is enforced, not reviewed.** Every page and all sixteen
components are on the token scale. Two checks run on `npm test`:
`check_components.mjs` sweeps all 29 components for raw `rem`, hex literals
outside `+layout.svelte`, and undefined `var(--token)` references;
`check_contrast.mjs` measures 33 rendered colour pairs in both themes. Both were
verified by breaking the code on purpose.

They found four real bugs that review had not:

| | |
|---|---|
| `--on-accent` in dark mode | white on light lavender, **2.71:1** — every primary button in the app, in the theme people use in a dark gym |
| `--border-strong` | 1.61 / 1.49 — an input's border is the only thing that says "input" (WCAG 1.4.11 → 3:1) |
| four hardcoded alliance hexes in six places | light-mode values, so they stayed dark against a dark card once dark mode existed |
| `var(--ok)` and `var(--warn)` | never-defined tokens with fallbacks, so "improving" rendered in brand purple and "provisional" as plain grey — a quiet lie about the data |

**One dark palette.** It existed twice — `[data-theme='dark']` and
`@media (prefers-color-scheme: dark)` — and the copies had already drifted.
"system" now resolves to an explicit attribute in JS (pre-paint in `app.html`),
so the palette is written down once and `check_contrast.mjs` fails if a second
block reappears.

**Picklist cloud sync.** One row per team rather than one blob per event: a
stale phone can no longer erase an afternoon of ranking, because it pushes only
the row it touched. `rank` is a float, so a reorder writes one row instead of
the whole list and two managers dragging different teams both succeed.
Migration 0009, `lib/picklist.js` + `lib/picklist-store.js`, 53 tests.
*Needs migration 0009 applied.*

**Alliance selection board.** During selection the picklist marks teams already
taken, straight from TBA, and names the best team still on your list. Declined
teams count as gone — under FRC rules they are out of selection entirely, and
"declined" reads like "available". The alliance array rides the existing
`schedules` row, so the one person with a TBA key publishes for everyone else's
phone. `lib/alliances.js`, 53 tests.

**The IndexedDB upgrade has a test.** A Dexie version bump runs once per device,
in the field, against the user's only copy of their data, and cannot be re-run.
`db.test.mjs` replays the real `.version()` blocks parsed out of `db.js`, seeds
a returning user's database, and opens it at the new version. It found a real
bug immediately: `rebalanceIfNeeded` judged the pick and do-not-pick lists
together, so two rows legitimately sharing rank 1024 read as exhausted
precision — every page load would have rewritten and re-pushed every row in the
event, and it would have looked like the sync working hard.

406 assertions across nine suites.

### Not done, in dependency order

1. **Auth cutover — replace the passphrase.** The single largest remaining item,
   detailed below. Not "add accounts alongside": the passphrase is deleted.
2. **Alliance selection** — the board works. What is left needs a real event to
   design against: whether managers want taken teams auto-collapsed, and whether
   the second pick wants its own ranking. Both are guesses until someone runs a
   selection with this.
3. **Redesign** — done as far as the system goes. What is left is composition:
   what each page leads with, and how dense it is. Per-page judgement, not a
   migration.
4. **Studio + Insights** — desktop route group, fixed charts.

### Nothing is precious except three things

The route tree, the component layout and the storage shapes are all v0.5
artefacts and have been rearranged freely — `/schedule` became `/scouting`, the
picklist stopped being a blob. Keep doing that where it helps.

The constraints that actually bind:

- **`design.md`** — the token scale and the AA floor, both now enforced by
  `npm test` rather than by review.
- **The sync invariants** — a local row with unpushed edits is never
  overwritten by a peer; the watermark is `updated_at`, not `created_at`.
- **The metrics blank-vs-zero rule** — blank means *not recorded*, `0` means
  *recorded and it was zero*.

## The v6 plan — sequenced

From the v6 upgrade doc plus the follow-up decisions, reordered by dependency
and cost. Next competition is months away, so this is built properly.

### Four decisions that shaped it

1. **Real accounts, with server-side role enforcement.** That is the only one of
   the stated reasons for login that a shared password can't deliver — hiding UI
   is not enforcement.
2. **Offline-first relaxes for login, not for recording.** See below.
3. **Manager Studio is a desktop surface.** Managers bring laptops. It gets a
   sidebar, denser layout, and a higher breakpoint floor. Schedule stays in the
   main app, because publishing and assigning happen at the venue, possibly on a
   phone.
4. **Playoff match scouting is out; alliance selection is in.** This is the
   biggest cost saving in the plan — see § Alliance selection, not playoffs.

### Auth layers on top of event codes; it does not replace them

The v6 doc treats login as a replacement for the event-code model. It shouldn't
be. The two answer different questions:

- **Event code** — *which event is this data for.* Hashing it into a
  `session_id` partitions data cleanly and is good design. It stays.
- **Auth** — *who are you, and what may you do.* Adds `submitted_by uuid` for
  accountability and a role check for writes.

Keeping both preserves the sharing model that works and keeps the migration
small, instead of rewriting every RLS policy from scratch.

To be unambiguous about what *does* go: the **event code stays**, the **manager
passphrase does not**. The event code is a partition key and is fine as public
knowledge. The passphrase is an authorisation mechanism, and it is the one being
replaced.

### The offline rule, stated precisely

Logging in may require network. **Recording may not.**

"If they can log in, they have wifi" holds at the moment of login. The failure
it misses is forty minutes later: access tokens expire in about an hour and
refresh in the background. A scout in a dead corner when the refresh fires must
not be bounced to a login screen holding unsaved work — that is a worse failure
than the one this app has today.

Three rules, all client-side:

- The IndexedDB write path never checks auth. A scout records regardless of
  token state.
- A failed token refresh **never** logs the user out. Keep the local session,
  surface sync as stale, retry on reconnect.
- Long refresh-token lifetime, so a weekend event is covered by one login.

Operationally: log in before leaving the school. Worth putting in the app's
own empty state, not just in this file.

### Phase 0 — cheap, independent, unblocks the rest

None of these depend on auth, so they can land immediately.

1. **Native dialogs.** Replace the 7 `confirm()`/`alert()` sites across 5 files
   with one in-app dialog component. Blocking browser dialogs look alien in an
   iOS PWA, and Accounts needs this component anyway for delete confirmations.
2. ~~**Minimal-delta auto-assign.**~~ Done. Re-running after a scout dropped
   out redistributed all ~40 teams and handed everyone a new list mid-event.
   Passing the current assignments keeps them: on a 48-team event a departing
   scout now moves 5 teams instead of 33, an arriving scout 4 instead of 36,
   and re-running with no roster change moves nothing at all. Coverage stays at
   100% and nobody is double-booked.
3. ~~**Sync UPDATE path.**~~ Done. The layer was INSERT-only, so an `/edit`
   change never reached its cloud row. Fixing the push half alone would have
   been worse than leaving it: the pull watermarked on `created_at`, which does
   not move on edit, so a teammate could never receive the correction while the
   editing device showed it saved and synced. Both halves now work —
   `updated_at` (migration 0007, set by trigger) is the watermark, and a local
   row with unpushed edits is never overwritten by a peer.

### Phase 1 — auth, roles, accounts

**Full spec: [`docs/adr-001-auth.md`](docs/adr-001-auth.md).** Summary here; the
ADR carries the schema, policies, RPC and migration order.

The end state has **one** authorisation system. Accounts replace the manager
passphrase completely — `has_manager_token()` is dropped, the `manager_token`
column goes, and `managerToken` comes out of the client. Two parallel
authorisation systems is how you get a hole in one, and a shared secret cannot
answer "who recorded this", which was the first reason for wanting login at all.

Two findings from reading the code that changed the design:

1. **`entries` was not in migrations.** Files started at `0002`; the table
   holding every scouting entry, and its RLS policies, existed only in the
   Supabase dashboard. Now captured as `0001`, idempotent, and corrective — it
   clears every existing policy on the table first, because permissive policies
   combine with OR and one forgotten dashboard policy silently defeats a
   stricter one.
2. **Static hosting rules out the v6 account flow.** Manager-creates-account
   needs `auth.admin.createUser()`, which needs the `service_role` key, which
   can never ship in a client bundle. So: **invite codes, and scouts
   self-register.** That removes temp-password generation, delivery, the
   activation flag and the forced first-login change — "has this person signed
   up" becomes `invites.redeemed_at`.

Design points, settled:

- Username uniqueness is a unique index on `lower(username)` plus a shape CHECK.
  The form's availability check is a courtesy with a read-to-insert race; the
  index is the guarantee.
- Login derives the auth email from the username (`user@scout.invalid`, an
  RFC 2606 reserved domain), so there is no lookup table and no roster leak.
  Usernames become immutable.
- Roles via a `SECURITY DEFINER` function with `search_path = ''`.
- `session_id` stays as the event partition but stops being the security
  boundary; `to authenticated` becomes it, which closes the public-event-code
  hole — event codes are published on TBA.
- Password recovery is the weak point: optional `recovery_email`, else the
  manager revokes and re-invites. A proper reset needs an Edge Function, which
  would be the first server-side code in this project. Worth resisting until it
  bites twice.

#### What is actually built

| | |
|---|---|
| `src/lib/auth.svelte.js` | sign in, register-with-invite, sign out, invite and profile management |
| `/login`, `/register`, `/accounts` | complete, on the design system |
| `+layout.svelte` | route gate, orphaned-account state, role badge |
| `0008_auth.sql` | profiles, invites, `app_role()` / `is_manager()` / `is_super()`, `redeem_invite()`, `create_invite()`, `peek_invite()`, `entries.submitted_by` |
| `auth.test.mjs` | 28 assertions on the pure parts, plus a tripwire on the flag |

All of it is **deliberately inert**: `AUTH_ENFORCED` is `false` and no live
policy consults any of it.

#### What is not built, and what that costs

1. **`0008` has never been executed.** 173 statements. `check_sql.py` proves it
   parses against the real PostgreSQL grammar; nothing proves the policies do
   what their comments claim, that `redeem_invite()` handles a concurrent
   redemption, or that the `lower(username)` index behaves. Those are semantic
   questions and no test in this repo can answer them. **This is the largest
   unquantified risk in the project.**
2. **`0010_policies.sql` does not exist.** The cutover migration is described in
   the ADR and unwritten. It has to: swap `has_manager_token()` for
   `is_manager()` across all **18** policies on `entries`, `schedules`,
   `assignments`, `reminders`, `assignment_overrides`, `picklist`,
   `picklist_prefs` and `event_meta`; change `to anon` → `to authenticated`;
   drop `has_manager_token()` and the `manager_token` column; and drop
   `event_meta`'s passphrase machinery.
3. **`entries.submitted_by` is added by `0008` and written by nobody.**
   Accountability was reason one for having accounts, and the write path in
   `sync.svelte.js` does not set it.
4. **Nine client files still gate on `managerToken`**: `sync.svelte.js`,
   `assignments.js`, `tba.js`, `event-meta.js`, `reminders.js`,
   `picklist-store.js`, `session.svelte.js`, `supabase.js`, plus
   `/scouting` and `/insights/picklist`. Every one of them changes.
5. **Bootstrap is a manual SQL step.** The first super user is created by hand
   in the dashboard. Acceptable — it happens once — but it must be written down
   where someone will find it, not only in a migration comment.

#### The cutover, and why it is one event

Two things flip **together**, and every other combination is worse than doing
nothing:

| | `AUTH_ENFORCED = false` | `AUTH_ENFORCED = true` |
|---|---|---|
| **`0010` not applied** | today — passphrase works, accounts inert | UI demands login; the database still accepts anyone's passphrase. Locked-out users *and* unprotected data |
| **`0010` applied** | UI still offers passphrase entry, people type it, every write is silently rejected. App looks broken | working |

`auth.test.mjs` asserts the flag is still `false`, so changing it trips a test
rather than shipping quietly.

Order of operations, once written:

1. Apply `0007`, `0008`, `0009`. Verify against the live database, not by
   reading the SQL.
2. Create the first super user by hand.
3. Everyone registers. Every device signs in at least once.
4. Backfill `entries.submitted_by` where `scout_name` matches a username.
5. Apply `0010` and flip `AUTH_ENFORCED` in the same deploy.
6. Delete the passphrase UI and the nine files' `managerToken` plumbing.

It is a **one-way door**. Once policies require an authenticated user, a device
that has not signed in stops working — survivable in the off-season, and
catastrophic at 9am on a Saturday. Do it between seasons, with a week of normal
use afterwards before anything matters.

### Phase 2 — alliance selection, not playoffs

Dropping playoff match scouting removes the most expensive item in the earlier
plan. Playoff matches are identified by `(comp_level, set_number, match_number)`
rather than a bare number, and this app keys on the bare number everywhere —
`entryIndex`, overrides, coverage. Supporting them was a match-identity
refactor touching every data path. Not doing it is worth several days.

**The deliberate boundary:** the app helps you *pick* an alliance and then goes
quiet once elims start. That is the right trade — selection is where scouting
data has leverage; by the time elims begin the picking is done. Recorded here so
it isn't re-litigated as an oversight.

1. ~~**Picklist cloud sync.**~~ Done, as rows rather than a document — see
   migration 0009. Selection is the moment the app exists for, and a local-only
   picklist dies with the phone holding it.
2. ~~**Mark teams already picked.**~~ Done. Taken teams are dimmed, struck
   through and labelled with where they went; the board also names the best team
   still on your list. Reads `/event/{key}/alliances`, cached locally and
   republished through the `schedules` row so a device without a TBA key still
   sees it. A stale board with a visible timestamp beats a spinner.
3. Whatever `/compare` needs to answer "these two are left, which do we want".
   Still open — and worth designing after a real selection rather than before.

### Phase 3 — information architecture, then redesign

The v6 reorganisation is a real improvement, and it invalidates redesigning the
current routes first. Move, then run hallmark once per page at its new address.

| New | From |
|---|---|
| `/login`, `/register` | new — **done** |
| `/accounts` | new — **done** |
| `/` | home. Stays at the root: naming it `/home` would need a redirect and buy nothing |
| `/scouting` | was `/schedule` — **done** |
| `/scouting/new`, `/scouting/edit` | were `/new`, `/edit` — **done** |
| `/insights` | was `/manager` — **done** |
| `/insights/team/[n]`, `/insights/compare`, `/insights/picklist` | were under `/manager` — **done** |
| `/settings` | unchanged |
| `/studio/*` | new — desktop surface, own layout (Phase 4) |

Grouped rather than merged: `/new` and `/edit` became children of `/scouting`
instead of collapsing into one page. The v6 doc asks for scouts to see the
schedule and fill forms "here", and a parent route delivers that without a
mega-page that does three jobs — which is the shape `/schedule` was already in
when it had to be split.

### Phase 4 — Studio and Insights

Studio is **desktop-first** and gets a documented variant in `design.md` — not a
free-for-all second design system. It shares the tokens, type scale and accent;
it differs on nav (left sidebar, not the tab bar), density, and breakpoint
floor. Boundaries stated in the file so the two surfaces stay recognisably one
product.

It is a route group (`/studio/*` with its own `+layout.svelte`), **not a
separate app in a new tab.** A new tab buys nothing and costs session and state
coherence; a route group gives it its own chrome for free.

Insights ships as four to six fixed charts chosen for alliance selection,
hand-rolled like `Sparkline.svelte`. No charting library, no DnD library.
Revisit a drag-and-drop builder only if the fixed set demonstrably fails a real
selection — during selection a manager has about five minutes and reaches for a
ranked list, not a canvas.

## Smaller items, still open

Moved out of "after the redesign" — the sync UPDATE path and picklist sync were
promoted into Phase 0 above.

- **Design-system cleanup.** Once hallmark emits `design.md` and `tokens.css`,
  migrate every page off its duplicated `<style>` block onto shared components
  (Button, Card, Badge, Stat, Chip, PageHeader, EmptyState). Finish with a
  WCAG-AA pass: contrast in both themes, focus states, touch targets.
- **Build-time TBA API key.** Put the read key in a GitHub Actions secret
  (`VITE_TBA_API_KEY`), read it in `tba.js`, hide the paste field when set. Keep
  the paste field as a fallback for forks.
- **Relabel "Reset scheduling" → "Archive event."** Same RPC, clearer wording,
  and a post-action message spelling out that schedule/assignments/reminders are
  cleared while scout entries are kept.
- **Sync the `build/` directory or drop it.** `build/` and `.svelte-kit/` are
  correctly gitignored and untracked, but a stale `build/` from a June run still
  sits on disk. GitHub Actions rebuilds from source on every push, so the local
  copy is only ever a confusing duplicate — safe to delete.

---

## Conditional — only when the need is real

- **Server-side cleanup cron.** A scheduled Supabase job to prune expired
  reminders and dormant-event metadata. Build once cruft is actually visible.
- **Manager-editable metrics.** Defining counters in the UI instead of in
  `form-config.js` — needs a `metric_defs` table, a definitions UI, and a
  version stamp on every entry so a mid-event change doesn't corrupt
  aggregation. Considered and deferred: editing one file each January is cheaper
  than the machinery, and mid-event schema changes are a footgun.

---

## Deliberately not doing

Recorded so these don't get re-proposed.

- **Voice-to-text dictation.** Removed once already — uneven browser support,
  fiddly UI, little payback in a loud gym.
- **Photo attachment for robots.** Touches the data model, sync layer, export
  format, and adds Supabase Storage, for uncertain payoff. Revisit only if a
  concrete "we really wish we had photos" pain shows up at a real event.
- **Real OS push notifications (Web Push / VAPID).** Big lift to replace
  something the in-app reminder banner already does well enough.
- **Edge Function TBA proxy.** Only justified if the app goes public to hide the
  key server-side; the build-time env-var key is simpler for a private team tool.
- **Single `assignment_instances` table.** Collapsing `assignments` +
  `assignment_overrides` into one materialized table is a real migration with
  re-materialize-on-refetch complexity, for no user-visible benefit.
- **Fully online-only rewrite.** See "What stayed local-first" above.

### Rejected from the v6 plan, with reasons

- **A second Supabase project for users.** You lose the ability to join a user
  to their data — every "who submitted this" becomes a cross-project lookup in
  application code — and RLS stops being the enforcement layer, which is the
  whole current security model. Supabase already separates `auth.users` from the
  public schema in one project.
- **Drag-and-drop graph builder.** Needs a DnD library and a charting library,
  both against the no-new-dependencies rule, and it's a second design system to
  maintain. But the real objection is product: during alliance selection you
  have about five minutes and you reach for a ranked list, not a canvas. Fixed
  charts first; revisit only on evidence.
- **Auto-generated `hz123` usernames.** Superseded: scouts pick their own.
  Random digits are unmemorable and unpredictable by the person who has to type
  them. Uniqueness comes from a unique index on `lower(username)`, not from
  entropy — see Phase 1.
- **Google Sheets API.** CSV export exists and Sheets imports CSV. The API wants
  OAuth, a Cloud project and token refresh, and breaks the static-no-server
  model. A ten-second manual upload wins until it demonstrably doesn't.
- **A free-for-all second design system for Studio.** Studio does get its own
  register — desktop-first, sidebar, denser — but as a documented variant in
  `design.md`, sharing tokens, type scale and accent. Two unrelated systems in
  one product means two to maintain and an app that feels like two apps.
- **Opening Studio in a new tab.** A route group (`/studio/*` with its own
  layout) gives it separate chrome without costing session and state coherence.
  A new tab buys nothing here.
- **Playoff match scouting.** Deferred deliberately, not forgotten — see
  Phase 2 for the boundary and the reasoning.

### Answered: Studio is a desktop surface

Managers bring laptops, so Studio drops phone-first and gets a sidebar, denser
layout and a higher breakpoint floor. Schedule stays in the main app — a manager
may need to publish or reassign from a phone on the floor.

This is the only surface allowed to escape phone-first, and the permission is
specific to it. `design.md` records it as a variant with stated boundaries.
