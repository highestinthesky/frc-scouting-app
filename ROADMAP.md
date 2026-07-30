# FRC Scout — consolidated roadmap

One source of truth. Everything from the old planning docs (`IMPROVEMENT_DRAFT.md`,
`FRC_Scout_Improvements_v3.docx`, `MANAGER_REDESIGN_HANDOFF.md`, `IMPROVEMENTS.md`,
`PLAN.md`, `UPGRADE_PLAN.md`, `FRC Scouting App v6.pdf`) was folded in here and
those files deleted. Do not start a second plan document — add to this one.

Last updated: 2026-07-29.

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
- **`/schedule` split into ten components** under `src/lib/components/schedule/`.
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

## The v6 plan — sequenced

From the v6 upgrade doc, reordered by dependency and cost. Next competition is
months away, so this is built properly rather than rushed.

Three answers shaped it: login must enforce roles **server-side** (which is the
only one of the four stated reasons that genuinely needs real auth), Manager
Studio starts as a fixed Insights page rather than a builder, and there is
runway.

### The load-bearing decision: layer auth on top of event codes, don't replace them

The v6 doc treats login as a replacement for the current event-code model. It
shouldn't be. The two answer different questions and are orthogonal:

- **Event code** answers *which event is this data for*. Deriving `session_id`
  from a hashed code partitions data cleanly and is genuinely good design.
- **Auth** answers *who are you and what may you do*.

So `session_id` stays as the event dimension. Auth adds `submitted_by uuid`
for accountability and a role check for writes. That keeps the sharing model
that already works, keeps the migration small, and avoids rewriting every RLS
policy from scratch.

**Recording must never depend on auth.** The IndexedDB write path stays
auth-free: a scout with an expired token, or no signal at all, still records.
Only *sync* needs a valid token, and it retries. Login happens before leaving
the school; that is an operational rule to document, not a hope.

### Phase 0 — cheap, independent, unblocks the rest

1. **Native dialogs.** Replace the 7 `confirm()`/`alert()` sites across 5
   files with an in-app dialog component. Blocking browser dialogs look alien
   in an iOS PWA. The Accounts page needs this component anyway for delete
   confirmations, so it comes first.
2. **Minimal-delta auto-assign.** Today re-running it after a scout drops out
   redistributes all ~40 teams and hands everyone a new list mid-event. Pin
   existing assignments, rebalance only what's necessary. A constraint on the
   DSATUR pass in `lib/auto-assign.js`.
3. **Sync UPDATE path.** Known data-loss bug: the sync layer is INSERT-only, so
   an `/edit` change never reaches its cloud row. Needs an UPDATE keyed on
   `remoteId`. Fix before edits get used in anger.
4. **Picklist cloud sync.** A `picklists` table gated by `has_manager_token()`.
   Promoted from "conditional" — alliance selection is the moment the app
   exists for, and a local-only picklist dies with the phone holding it.

### Phase 1 — match identity and playoffs (the spine)

The v6 note *"the app is not ready for playoffs"* is the highest-value line in
that document and structurally true. `qualMatches()` filters
`comp_level === 'qm'` at the source, and everything downstream is built on the
result.

The real cost is not a page, it's **match identity**. A playoff match is
identified by `(comp_level, set_number, match_number)`, not a bare number. The
app keys on the bare number everywhere: `entryIndex` uses
`` `${match_number}:${team}` ``, overrides key on `match_number`, coverage keys
on `match_number`.

1. Introduce `matchKey(m)` and migrate every consumer onto it.
2. `allMatches()` / `playoffMatches()` alongside `qualMatches()`.
3. `comp_level` + `set_number` on entries. `SCHEMA_VERSION` bump, migration
   defaulting existing rows to `qm`.
4. Extend the coverage, assignment and auto-assign paths.
5. Tests before UI — this is the change most likely to corrupt data silently.

Do this **before** the remaining redesign work. It touches every data path, and
doing it afterwards means editing every file twice.

### Phase 2 — auth, roles, accounts

One Supabase project, not two. Supabase already separates `auth.users` from the
public schema — that *is* the separation the v6 doc asks for, and splitting into
two projects would make it impossible to join a user to their data and would
remove RLS as the enforcement layer.

1. Supabase Auth. `profiles` table: `id` → `auth.users`, first/last name,
   username, `role` enum (`scout` / `manager` / `super`), `activated_at`.
2. Role checks as a `SECURITY DEFINER` function, so policies read the role from
   Postgres rather than trusting a client header. This is what "enforced
   server-side" actually means: a scout cannot publish a schedule even with a
   hand-crafted request.
3. Session persisted locally, long refresh window. Boot and record with an
   expired access token; sync retries.
4. `/login`, `/register`, `/accounts`. Registration flow per the v6 doc, with
   two changes: **usernames are `first.last`, not `hz123`** — random digits are
   unmemorable, unpredictable, and the doc doesn't handle collisions — and
   temp-password delivery is manual (manager reads it out), because email at a
   venue is the same network problem wearing a different hat.
5. Migration for existing entries: backfill `submitted_by` as null, treat null
   as "pre-auth", don't delete anything.

### Phase 3 — information architecture, then redesign

The v6 doc's page reorganisation is a genuine improvement, and it invalidates
redesigning the current routes first. Do the moves, then run hallmark once per
page at its new address.

| New | From |
|---|---|
| `/login`, `/register` | new |
| `/home` | `/` — greeting, next match, reminders, directory |
| `/scouting` | `/schedule` + `/new` + `/edit` |
| `/insights` | `/manager`, `+ /team/[n]`, `/compare`, `/picklist` |
| `/accounts` | new |
| `/settings` | unchanged |

Each page reads `design.md` and stamps `designed-as-app`. `design.md` gets an
Insights variant if that surface needs a denser register — **amended in the
file, not overridden per page.**

### Phase 4 — Insights

Four to six charts chosen for alliance selection, hand-rolled like
`Sparkline.svelte`. No charting library, no DnD library, no new runtime
dependencies.

Revisit a drag-and-drop builder only if the fixed set demonstrably fails a real
selection. During selection a manager has about five minutes; they need a
ranked list and two or three known comparisons, not a canvas.

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
- **`hz123`-style usernames.** Random digits are unmemorable and unpredictable
  by the person who has to type them, and the v6 doc doesn't handle collisions.
  `first.last` instead.
- **Google Sheets API.** CSV export exists and Sheets imports CSV. The API wants
  OAuth, a Cloud project and token refresh, and breaks the static-no-server
  model. A ten-second manual upload wins until it demonstrably doesn't.
- **"Completely new futuristic vibe" for Manager Studio as a free-for-all.**
  Two design systems in one product means two to maintain and an app that feels
  like two apps. If that surface needs its own register it becomes a documented
  variant in `design.md` with stated boundaries.
- **Opening Manager Studio in a new tab.** A desktop pattern. If it's a
  laptop-in-the-stands tool, say so explicitly and give it desktop constraints;
  don't inherit them by accident.

### Open question carried forward

Is Insights / Manager Studio a **phone** surface or a **laptop-in-the-stands**
surface? The v6 doc implies laptop (left sidebar, new tab) but never says it.
It's the one surface with a legitimate case for escaping phone-first, and the
answer changes its layout constraints completely. Decide before Phase 4.
