# FRC Scout — consolidated roadmap

One source of truth, merged from every prior planning doc:
`IMPROVEMENT_DRAFT.md`, `FRC_Scout_Improvements_v3.docx`,
`MANAGER_REDESIGN_HANDOFF.md`, `IMPROVEMENTS.md`, `PLAN.md`, and
`UPGRADE_PLAN.md`. Duplicates collapsed, shipped work marked, and ideas that
aren't worth building cut (with reasons) so they don't keep resurfacing.

Last updated: 2026-06-15.

> The older docs above are now **superseded by this file** — they're either
> fully shipped or folded in below. Safe to archive/delete once you've read
> this.

---

## Already shipped — stop re-planning these

Everything in the two oldest specs is done, plus most of the early draft:

- **Whole `FRC_Scout_Improvements_v3.docx`** — voice-to-text removed;
  tag pills and auto-path autocomplete scoped to the entered team; structured
  defense entry; deduped strengths in the team view.
- **Whole `MANAGER_REDESIGN_HANDOFF.md`** — manager page rebuilt with stats
  grid, search, sort, working filter chips, badges, CSV export, strengths
  preview.
- **From `IMPROVEMENT_DRAFT.md`** — edit-after-save (`/edit`), TBA schedule
  integration, deeplinked pre-fill, per-team match log (`/manager/team/[n]`),
  multi-team compare, picklist builder, discrepancy flagging, dark mode,
  coverage view, home pace counter ("N today").
- **From `IMPROVEMENTS.md` (v4)** — TBA event key decoupled from sync code;
  deeplinks everywhere; **live coverage board (1B)**.
- **From `PLAN.md`** — per-match assignment overrides (#4); coverage-conflict
  detection (#5).
- **From `UPGRADE_PLAN.md` (v5.0)** — live coverage board, smart auto-assign,
  design-system tokens.

---

## The plan from here

Four tiers, in build order. Each item is independently shippable and needs no
Supabase migration unless noted.

### Tier 1 — Quick friction-removers (each ~30–60 min)

- **Build-time TBA API key.** Put the read key in a GitHub Actions secret
  (`VITE_TBA_API_KEY`), read it in `tba.js`, and hide the paste-key field when
  it's set. Manager flow drops to "tap Fetch → tap Publish." Keep the paste
  field as a fallback for forks. *(was PLAN #1)*
- **Relabel "Reset scheduling" → "Archive event."** Same RPC; clearer wording
  and a post-action message that spells out schedule/assignments/reminders are
  cleared while scout entries are kept. *(was PLAN #2)*

### Tier 2 — Data + intelligence backbone (the main thrust)

This is the "more detailed and smarter for managers" work. Numbers unlock
everything downstream.

1. **Game-agnostic numeric counters.** Add a tap-friendly `counter` field type
   and a configurable `METRIC_FIELDS` group in `form-config.js` (auto/teleop
   scored, cycles, missed, etc.). Bump the Dexie schema; treat missing values
   as "not recorded," never 0. No Supabase migration — `observations` syncs as
   one JSON blob. Switch the CSV export to derive columns from `form-config`.
2. **Aggregation engine.** Extend `aggregate.js` to compute per-metric `n`,
   mean, median, max, trend, and consistency per team, with a small-sample
   guard. One engine so every surface reports the same numbers.
3. **Smarter manager surfaces.** Metric columns + sort-by-metric on `/manager`;
   per-metric trend sparkline on the team page; numeric comparison rows with
   leader highlighting on `/manager/compare`.
4. **Scored picklist.** Manager-weighted composite score auto-ranks the
   available pool (manual drag still wins); surface sample-size confidence.

### Tier 3 — Consistency

- **Roll out the design system.** Extract shared components (Button, Card,
  Badge, Stat, Chip, PageHeader, EmptyState) onto the tokens already added, and
  migrate every page off its duplicated `<style>` blocks. Finish with a
  WCAG-AA pass (contrast in both themes, focus states, touch targets).

### Tier 4 — Optional / conditional (only when the need is real)

- **Server-side cleanup cron.** A scheduled Supabase job to prune expired
  reminders and dormant-event metadata. Build it only once cruft is actually
  visible in the dashboard. *(was PLAN #3)*
- **Picklist cloud sync.** A `picklists` table gated by `has_manager_token()`,
  for multiple strategists collaborating live. Build only if more than one
  person needs to edit the same picklist at once; local-only is fine otherwise.
  *(was PLAN #6)*

---

## Deliberately not doing (filtered out)

Recorded so these don't get re-proposed. Each was considered and cut.

- **Voice-to-text dictation.** Already removed once (v3) — uneven browser
  support, fiddly UI, little payback in a loud gym.
- **Photo attachment for robots.** The single heaviest item: touches the data
  model, sync layer, export format, and adds Supabase Storage — for uncertain
  payoff on a deliberately qualitative, small-team app. Revisit only if a
  concrete "we really wish we had photos" pain shows up at a real event.
- **Real OS push notifications (Web Push / VAPID).** Big lift (service-worker
  push handler + VAPID keys + an Edge Function to send) to replace something
  the in-app reminder banner already does well enough.
- **Edge Function TBA proxy.** Only justified if the app goes public to hide
  the key server-side; the Tier-1 build-time env-var key is the simpler choice
  for a private team tool.
- **Single `assignment_instances` table (v4 item 1C).** Collapsing
  `assignments` + `assignment_overrides` into one materialized table is a real
  migration with re-materialize-on-refetch complexity, for no user-visible
  benefit. The current two-table model works; don't churn it mid-life.
