# FRC Scout — consolidated roadmap

One source of truth. Everything from the old planning docs (`IMPROVEMENT_DRAFT.md`,
`FRC_Scout_Improvements_v3.docx`, `MANAGER_REDESIGN_HANDOFF.md`, `IMPROVEMENTS.md`,
`PLAN.md`, `UPGRADE_PLAN.md`) was folded in here and those files deleted. Do not
start a second plan document — add to this one.

Last updated: 2026-07-26.

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

## Next: the hallmark redesign

Using [hallmark](https://github.com/Nutlope/hallmark) — an anti-AI-slop design
skill, installed with `npx skills add nutlope/hallmark`. Scope agreed: **every
page**.

### Step 1 — split `/schedule` first (prerequisite)

At 2,242 lines doing eight jobs, `/schedule` can't be redesigned safely in
place. Break it into components under `src/lib/components/schedule/` before any
visual work:

| Component | Contains |
|---|---|
| `PublishSchedule.svelte` | TBA event key, API key, fetch, publish, clear cache |
| `ManagerPassphrase.svelte` | set, verify, rotate, forget, reset event |
| `AssignScouts.svelte` | assignment rows, auto-assign, save |
| `ScoutRoster.svelte` | who's in the event |
| `CoverageCheck.svelte` | conflict list |
| `ReminderPanel.svelte` | compose, active list, delete |
| `SchedulePreview.svelte` | manager's full match table |
| `MyTeams.svelte` | scout's team chips, local extras |
| `UpcomingMatches.svelte` | shared upcoming list |
| `MatchDetailModal.svelte` | coverage + override editor |

State stays in the route; components take props and emit callbacks. No
behaviour changes in this step — it should be a pure move, verifiable by
diffing rendered output.

### Step 2 — run hallmark

Order matters: hallmark writes a `.hallmark/log.json` and won't repeat a
macrostructure or theme across runs in the same project, so run the shell first
and let the rest inherit.

1. `+layout.svelte` — nav, app bar, sync dot. Sets the fingerprint.
2. `/new` and `/edit` — the form scouts use a hundred times a weekend. Thumb
   reach and one-handed use beat visual interest here.
3. `/manager`, team page, `/compare`, `/picklist` — dense data. This is where
   hallmark's typography and table discipline pay off.
4. `/schedule` (post-split) and `/settings`.
5. Lock the system: say *"lock the system"* to emit a portable `design.md`, then
   every later run defers to it instead of diversifying.

### Constraints to hand hallmark

- Phone-first. Most use is a scout standing in a gym holding a phone one-handed.
- Touch targets ≥ 44px. The counter buttons are already 3rem.
- Both themes must pass WCAG AA. `data-theme` on `<html>` drives dark mode.
- Alliance red and blue are semantic, not decorative — they must survive
  retheming and must not be the only signal.
- No new runtime dependencies. Static build, no bundler additions.

---

## After the redesign

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
- **Sync UPDATE path.** `/edit` changes stay local — the sync layer is
  INSERT-only, so an edited entry never updates its cloud row. Needs a real
  UPDATE path keyed on `remoteId`. Worth doing before edits get used in anger at
  an event.
- **Sync the `build/` directory or drop it.** `build/` and `.svelte-kit/` are
  correctly gitignored and untracked, but a stale `build/` from a June run still
  sits on disk. GitHub Actions rebuilds from source on every push, so the local
  copy is only ever a confusing duplicate — safe to delete.

---

## Conditional — only when the need is real

- **Server-side cleanup cron.** A scheduled Supabase job to prune expired
  reminders and dormant-event metadata. Build once cruft is actually visible.
- **Picklist cloud sync.** A `picklists` table gated by `has_manager_token()`.
  Build only if more than one person needs to edit the same picklist at once.
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
