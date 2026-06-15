# v5 — Upgrade Plan: consistency, analytics, numeric scouting

Goal (from the manager): make the app **more consistent, more detailed, and
smarter to use** — with the manager-facing surfaces as the priority.

Three chosen focus areas:

1. **UI/UX consistency** — one design system, applied everywhere.
2. **Manager analytics & intelligence** — turn entries into rankings, trends,
   and a scored picklist.
3. **Game-agnostic numeric counters** — capture numbers, not just prose, so
   teams can be ranked on what they actually did.

Approach: **plan-first** (this doc), then build in the phase order below.

Last updated: 2026-06-15 · Companion docs: `IMPROVEMENTS.md` (v4 status,
coverage-board design), `PLAN.md` (parked roadmap items), `CREDENTIALS.md`.

---

## Shipped so far (v5.0 — scheduling overhaul)

The scheduling system was upgraded first, since that's where managers spend the
most time. All additive, no Supabase migration, build verified green.

- **Live coverage board** — `src/lib/coverage.js` (new, pure) derives which
  `(match, team)` cells have been scouted from the synced entries. The manager
  Schedule preview now shows a colour-coded `n/6` chip per match plus a
  progress-bar roll-up ("X/Y team-matches scouted · Z matches fully covered").
  The match-detail modal tags each team `✓ scouted` / `assigned` / `uncovered`
  and flips its link to "Re-scout →" once an entry exists. Scouts get a
  "you've logged X of Y" progress bar driven by the same shared index, so a
  teammate's entry counts too.
- **Smart auto-assign** — `autoAssignTeams()` in `src/lib/assignments.js`: a
  manager enters scout names and taps ✨ Auto-assign; it spreads every team at
  the event across them, balancing load to within one team each and avoiding
  same-match double-assignments (most-constrained-first greedy). Result fills
  the editor for review before saving; unavoidable overlaps surface in the
  existing Coverage check. Verified: covers all teams once, balanced, finds a
  conflict-free solution when one exists, degrades gracefully otherwise.
- **Design-system tokens** — spacing / radius / type / elevation scales added
  to the global stylesheet (`+layout.svelte`) and consumed by the new
  scheduling UI. Groundwork for the broader component migration (Phase 0/5).

Still to build from the phases below: numeric counters (Phase 1), the
aggregation engine + smarter manager analytics (Phases 2–3), the scored
picklist (Phase 4), and rolling the component library across all pages.

---

## Where the app is today (baseline)

- **Stack:** SvelteKit (Svelte 5 runes) → `adapter-static` → GitHub Pages.
  Offline-first PWA. Local store = Dexie/IndexedDB; cloud sync = Supabase
  (3 s polling); match schedule = The Blue Alliance.
- **Roles:** scout vs. manager (`role.svelte.js`).
- **Data model:** an entry is `{ eventCode, matchNumber, teamNumber,
  allianceColor, scoutName, observations{…}, createdAt, clientId, remoteId }`.
  `observations` today is **entirely qualitative**: `autoPathing`, `strengths`,
  `weaknesses`, `defense`, `brokeDown`, `comments`. No numbers, so nothing can
  be averaged or ranked numerically.
- **Manager surfaces:** `/manager` (sortable team list + badges),
  `/manager/compare`, `/manager/picklist` (manual, local-only),
  `/manager/team/[teamNumber]`.

### Two facts that shape this plan

1. **`observations` syncs as a single JSON blob** (`sync.svelte.js` pushes
   `observations: local.observations ?? {}`; Supabase stores it whole). So new
   numeric keys flow to the cloud **with no Supabase migration** — only a local
   Dexie `SCHEMA_VERSION` bump and a few read shims. This makes the metrics
   work far cheaper than it looks.
2. **Styling is duplicated, not shared.** Every page carries its own large
   `<style>` block re-defining `.btn`, `.badge`, `.card`, `.stat`, `.chip`,
   `.page-head`, etc. The CSS *tokens* (`--accent`, `--success`, spacing-ish
   values) live in `+layout.svelte` and are good — but the *components* built
   from them are copy-pasted and drift. That drift is the "inconsistency" the
   manager feels. The only shared low-level primitive is `Field.svelte`
  (`ReminderBanner` and `SessionSetup` exist, but they're feature blocks, not
  reusable button/card/badge primitives).

---

## Phase 0 — Design-system foundation (consistency groundwork)

**Why first:** every later phase adds UI. If we standardize the building
blocks now, new screens inherit consistency for free instead of adding more
drift. Low risk, no data changes.

**Do:**

- Add a **token layer** to the global stylesheet (extend `+layout.svelte` or a
  new imported `app.css`): a spacing scale (`--space-1…6`), radius
  (`--radius-sm/md/lg`), font sizes (`--fs-xs…xl`), and elevation/shadow tokens.
  Keep the existing color tokens; they're already solid for light/dark.
- Extract the repeated patterns into **shared Svelte components** under
  `src/lib/components/`: `Button.svelte`, `Card.svelte`, `Badge.svelte`,
  `Stat.svelte`, `Chip.svelte`, `PageHeader.svelte`, `EmptyState.svelte`,
  `Toolbar.svelte`. Each reads only tokens.
- **Migrate one page first** (`/manager`) to the new components as the
  reference implementation, then roll through the others.

**Files:** `src/routes/+layout.svelte` (tokens), new `src/lib/components/*`,
then each route's `<style>` shrinks as markup adopts the components.

**Acceptance:** `/manager` renders identically (or better) in light + dark using
zero page-local button/badge/card CSS. A second page (e.g. `/manager/compare`)
adopts the same components with no visual surprises.

> Optional accelerator: the installed **design** plugin's `design-system` and
> `design-critique` skills can audit current inconsistencies and pressure-test
> the component API before we lock it in.

---

## Phase 1 — Game-agnostic numeric counters (data model + form)

**Why:** numbers are the prerequisite for every "smart" feature. Without them
ranking is impossible; with them, Phases 2–4 light up.

**Design — keep it configurable, not hard-coded to one game:**

- Add a new field group `METRIC_FIELDS` in `src/lib/form-config.js` alongside
  the existing identity/observation groups, so the single-source-of-truth
  promise in that file's header finally holds for metrics too.
- Add a **`counter`** field type (a big `–`/`+` stepper) to `Field.svelte` —
  tap-to-count is far better than typing on a phone mid-match. `number` already
  exists for things like a final score.
- Ship a **sensible default, game-neutral set** the team can rename/trim:
  e.g. `autoScored`, `teleopScored`, `cyclesCompleted`, `missed`,
  `penaltiesDrawn`, plus a `defenseRating` (1–5 pills) and an `endgame`
  (select). All optional. None assume a specific season's game pieces.
- **Stretch (decide before building):** let the *manager* define metrics in
  Settings (stored in `settings`/Supabase `event_meta`) so a new season needs
  zero code deploy. Bigger lift — recommend shipping the code-defined default
  set first, manager-editable metrics as a fast follow.
- **Schema & compatibility:** bump Dexie `SCHEMA_VERSION` 2 → 3. Old entries
  simply lack the metric keys. Treat **absent as "not recorded," never as 0**,
  so missing data never drags an average down. Add read shims where
  `observations` is consumed: `aggregate.js`, `export.js` (its CSV header is
  currently **hard-coded** — switch it to derive columns from `form-config` so
  it can't fall out of sync again), and the entry render paths.

**Files:** `src/lib/form-config.js`, `src/lib/components/Field.svelte`,
`src/lib/db.js` (version bump), `src/lib/export.js`, `src/lib/import.js`,
`src/lib/aggregate.js`. **No Supabase migration.**

**Acceptance:** a scout records auto/teleop/cycle counts via steppers; the entry
round-trips to Supabase and back intact; a pre-upgrade entry still displays and
is excluded from numeric averages rather than counted as zero; CSV export
includes the new columns automatically.

---

## Phase 2 — Numeric aggregation engine

**Why:** one place computes per-team stats so every manager surface stays
consistent (no metric recomputed three different ways).

**Do:** extend `summarize()` in `src/lib/aggregate.js` so each team gains, **per
metric**: sample size `n`, mean, median, max, a last-N **trend** (improving /
flat / declining), and a **consistency** measure (std-dev or
coefficient-of-variation). Keep existing qualitative rollups. Add a
small-sample guard (reuse the existing "thin coverage" idea) so a 1-match team
isn't ranked #1 on noise.

**Files:** `src/lib/aggregate.js` (or factor a `src/lib/metrics.js` it imports).

**Acceptance:** for a team with 5 entries, `summary.teams[i].metrics.teleopScored`
exposes `{ n:5, mean, median, max, trend, cv }`; a 1-entry team is flagged
low-confidence.

---

## Phase 3 — Smarter manager surfaces

Built on Phase 2's engine; this is the visible "more detailed" payoff.

- **`/manager` team list:** add metric columns and let **Sort by** target any
  metric mean (extends the existing `sortBy`). Show a tiny per-metric value with
  a confidence dot for sample size.
- **`/manager/team/[teamNumber]`:** add a **per-metric trend sparkline** across
  that team's matches, plus the mean/median/max/consistency block.
- **`/manager/compare`:** add numeric metric rows with simple inline bars so two
  to three teams compare at a glance; highlight the leader per row.
- **Live coverage board (1B from `IMPROVEMENTS.md`):** fold in the already-
  designed `entryIndex`/`statusFor` coverage chips while we're in these files —
  it's derived-state only, no schema, and it's the other half of "smart."

**Files:** `src/routes/manager/+page.svelte`,
`src/routes/manager/team/[teamNumber]/+page.svelte`,
`src/routes/manager/compare/+page.svelte`, shared `aggregate`/`coverage` helper.

**Acceptance:** manager sorts the roster by mean teleop score; opening a team
shows its trend; compare shows leader-highlighted numeric rows; schedule/manager
shows `n/6 scouted` coverage.

---

## Phase 4 — Scored (smart) picklist

**Why:** the picklist is where decisions happen. Today it's manual drag and
local-only. Make it rank teams automatically from the data — the headline
"smart for managers" feature.

**Do:**

- Add a **weighted composite score**: manager sets weights per metric (sliders);
  each team's score = Σ(weight × normalized metric mean). Auto-rank the
  available list by it, while keeping manual drag override on top.
- Surface confidence (sample size) and the existing "do not pick" list.
- **Optional cloud sync** for collaborative picking (`picklists` table gated by
  `has_manager_token()`) — noted in `PLAN.md §6`; keep local-only for v1 unless
  multiple strategists need it.

**Files:** `src/routes/manager/picklist/+page.svelte`, reuse the Phase 2 engine.

**Acceptance:** manager raises the "auto scoring" weight and the available list
reorders live; a thin-coverage team is visibly flagged; manual reordering still
wins.

---

## Phase 5 — Consistency & accessibility polish

Final pass once features exist: migrate any remaining pages
(`/`, `/new`, `/edit`, `/schedule`, `/settings`) to the Phase 0 components,
remove dead page-local CSS, and run a WCAG AA check (contrast in both themes,
touch-target sizes, focus states) — the **design** plugin's
`accessibility-review` skill covers this.

**Acceptance:** no page defines its own button/badge/card styles; light + dark
both pass an AA contrast check; keyboard focus is visible everywhere.

---

## Recommended sequence & effort

| # | Phase | Risk | Rough effort |
|---|-------|------|--------------|
| 0 | Design-system foundation | Low | 0.5–1 day |
| 1 | Numeric counters (data + form) | Med (schema) | 1 day |
| 2 | Aggregation engine | Low | 0.5 day |
| 3 | Smarter manager surfaces | Med | 1–1.5 days |
| 4 | Scored picklist | Med | 1 day |
| 5 | Consistency + a11y polish | Low | 0.5 day |

Phases 0→2 are the backbone; 3 and 4 are the visible wins. Each phase is
independently shippable and deployable to GitHub Pages.

## Risks & decisions to confirm before building

- **Metric set:** ship a fixed game-neutral default now, or invest in
  manager-editable metrics immediately? (Recommend: default first.)
- **Counting unit semantics:** confirm which counters matter for your game so
  the defaults are useful out of the box.
- **Backward compatibility:** confirmed cheap — JSON `observations` means no
  Supabase migration; only a Dexie version bump + read shims. Pre-upgrade
  entries stay valid and are excluded from numeric stats.
- **Picklist sync:** local-only (simple) vs. cloud-shared (collaborative)?
