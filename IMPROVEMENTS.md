# v4 — improvements

Status of the two v4-draft improvements, plus the implementation-ready design
for the next milestone.

Last updated: 2026-06-01

| Item | Status |
|------|--------|
| 2. Decouple event code from TBA event key | **Shipped** (migration 0006) |
| 1A. Unify schedule + scouting — deeplinks everywhere | **Shipped** |
| 1B. Unify schedule + scouting — entries as schedule citizens | **Designed, not built** (this doc) |
| 1C. Unify — single assignment-instances table | **Parked for v5** |

---

## 2. Decouple event code from TBA event key — SHIPPED

The team now picks any memorable event code (e.g. `2027nyc`) for sync, while
the manager stores TBA's canonical key (e.g. `2027nyny`) separately for
fetching. Scouts never see or type the TBA key.

What shipped:

- **Migration `0006_tba_event_key.sql`** — adds a nullable `tba_event_key`
  column to `public.schedules`. Additive and idempotent (`ADD COLUMN IF NOT
  EXISTS`).
- **`tba.js`** — `fetchAndCacheSchedule(eventCode, apiKey, tbaEventKey)` now
  hits TBA with `tbaEventKey` while keeping the local cache keyed by
  `eventCode`. `publishSchedule` writes the key onto the schedules row;
  `pullSchedule` returns it; `getPublishedTbaEventKey()` lets a second manager
  device discover it. All three degrade gracefully on a not-yet-migrated DB
  (catch "column does not exist", retry without the field).
- **`session.svelte.js`** — new persisted `tbaEventKey` setting.
- **Schedule tab (manager)** — a "TBA event key" field above the API-key
  field, a `your code · TBA key` summary line, and auto-adoption of a
  teammate's published key on load.
- **Settings tab** — event-code help text now says "anything your team agrees
  on," not "TBA-compatible code."

### Deviation from the original draft

The draft proposed storing `tba_event_key` on `event_meta`. We store it on
`schedules` instead, because:

- The `event_meta` row only exists once a manager sets a passphrase, and its
  INSERT policy is **bootstrap-only** (`NOT EXISTS`). Writing the TBA key there
  early would create the row and then make the later passphrase-setting INSERT
  fail with a unique violation.
- The `schedules` row is created on the very first publish regardless of
  passphrase, gated by the same `has_manager_token()` bootstrap rule. The key
  and the schedule it produced naturally belong together.

Backward-compatible: events published before 0006 have `tba_event_key = NULL`
and fall back to using the event code as the TBA key — today's behavior.

---

## 1. Unify the schedule + scouting systems

> Source note: "It would be incredibly efficient if we could union the two
> systems for scheduling and scouting … you are to design the process here."

### 1A. Deeplinks everywhere — SHIPPED

Every place that names a `(match, team)` now links into a pre-filled `/new`
entry form, so the hop from "I'm assigned this" to "I'm recording this" is one
tap with match, team, and alliance color already set.

What shipped:

- **Match-detail modal coverage list** (manager) — each of the six team rows
  gets a `Scout →` link to `/new/?match=&team=&color=`.
- **Reminder banner** (scout) — any reminder tied to a match shows a `Scout →`
  link. Auto-reminders carry the exact team; manager reminders carry only the
  match.
- **`/new` match-only deeplinks** — `/new/?match=12` (no team) now resolves the
  scout's team for that match (override wins, else effective team list).
  One match team → auto-filled; several → the existing multi-team picker.
- Already present before this milestone: the home next-match banner, the
  Upcoming-matches list, and the `/new` next-match suggestion.

No schema change — this was pure wiring on top of the data already synced.

### 1B. Entries as first-class schedule citizens — DESIGNED (next milestone)

The visible-quality jump: the schedule stops being a publish-and-forget list
and becomes a live coverage board. The manager sees, per match, which teams
are covered; the scout sees their assignments check off as entries land.

#### What "submitted" means

A `(team_number)` cell in match `M` for event `E` is **submitted** iff at least
one row exists in `entries` with `eventCode = E`, `matchNumber = M`,
`teamNumber = team`. Deliberately:

- **No author gate.** Two scouts covering the same team (e.g. after an override
  swap) both count — status is "submitted ≥ 1", not "submitted by the assigned
  scout." This avoids the "scout typed their name differently on this device"
  failure mode.
- **No quality gate** in v1. A blank-but-saved entry counts as submitted.
  ("needs re-scout" flag is an open question below.)

Three states per team-in-match:

| State | Condition |
|-------|-----------|
| `submitted` | ≥ 1 entry exists for (E, M, team) |
| `assigned` | a scout is assigned/overridden to this team for this match, no entry yet |
| `uncovered` | no entry and no scout assigned |

#### Data model — no migration needed

All inputs already exist locally and are already synced:

- `entries` (Dexie + Supabase mirror) — already pulled on each sync tick.
- the cached schedule (`qmList`) — already in IndexedDB.
- `assignments` + `assignment_overrides` — already pulled into
  `session.overrides` and listed on the schedule page.

So 1B is a **derived-state + UI** change, not a DB change. Build one memoized
index and read it from both surfaces.

#### Core derived index

```js
// entryIndex: Map<`${matchNumber}:${teamNumber}`, { count, lastAt, scouts:Set }>
const entryIndex = $derived.by(() => {
  const idx = new Map();
  for (const e of entries) {
    if (e.eventCode !== session.eventCode) continue;
    const k = `${e.matchNumber}:${e.teamNumber}`;
    const cur = idx.get(k) ?? { count: 0, lastAt: null, scouts: new Set() };
    cur.count += 1;
    if (!cur.lastAt || e.createdAt > cur.lastAt) cur.lastAt = e.createdAt;
    if (e.scoutName) cur.scouts.add(String(e.scoutName).trim());
    idx.set(k, cur);
  }
  return idx;
});
```

`statusFor(matchNumber, teamNumber)` then returns `submitted` if the key is in
`entryIndex`, else `assigned` if a (resolved) scout watches it, else
`uncovered`.

#### Manager surface — `/schedule`

- **Schedule preview rows**: append a coverage chip per row, e.g.
  `4/6 scouted`, colored by completeness (green = all six, amber = partial,
  neutral grey = none). Tinting reuses the theme tokens (`--success`,
  `--warning`, `--text-faint`).
- **Match-detail modal coverage list**: each team row already lists watchers
  and a `Scout →` link (1A). Add a status dot/word: `✓ submitted` (with count
  if > 1), `assigned`, or `uncovered`. When submitted, the `Scout →` link
  becomes a secondary `Re-scout` link.
- **A roll-up** at the top of the preview: "Q12–Q40 · 142/246 team-matches
  scouted."

#### Scout surface — `/schedule` "Your teams" + Upcoming

- "Your teams" stays, but Upcoming-matches rows gain the same `✓ scouted`
  treatment they already have for `done`, now driven by `entryIndex` rather
  than the local-only `doneKey` (so a teammate's entry also greys it out).
- Optional (see open question): a per-scout progress line, "you've logged 11
  of your 14 assigned team-matches."

#### Files touched (estimate)

- `src/routes/schedule/+page.svelte` — `entryIndex`, `statusFor`, preview-row
  chips, modal status, roll-up, styles. (Bulk of the work.)
- `src/lib/aggregate.js` *(or a new `src/lib/coverage.js`)* — factor
  `entryIndex` / `statusFor` out so both `/schedule` and `/` can import it
  without duplicating the reducer.
- `src/routes/+page.svelte` — optional: a "coverage" mini-stat on home.
- No `tba.js`, no `assignments.js`, no SQL.

#### Acceptance

- Manager publishes Q12; no entries yet → row shows `0/6`, all teams
  `uncovered`/`assigned`.
- A scout records team 1678 in Q12 → within one sync tick the manager's Q12 row
  reads `1/6` and team 1678 shows `✓ submitted`. The scout's own Upcoming row
  for 1678/Q12 greys to `✓ scouted`.
- A second scout also records 1678/Q12 → still `submitted`, count shows `2`.
  No double-count in the `n/6` (it's distinct teams covered, not entries).

#### Open questions before building 1B

1. **Visibility to scouts.** Show the full per-team submitted board to scouts,
   or only the manager? Showing it helps a scout notice a missed match; hiding
   it avoids peer pressure. Recommendation: show the scout *their own*
   assignments' status, not the whole board.
2. **"needs re-scout" flag.** Should the manager be able to mark an entry as
   needing redo (e.g. fields left blank), or is delete-and-redo enough? Adds an
   `entries` column + a control if yes. Recommendation: defer; delete-and-redo
   covers v1.
3. **Counting unit for the roll-up.** "team-matches scouted" (6 per qual match)
   vs "matches fully scouted" (all 6). The former is more motivating mid-event;
   the latter is the real goal. Recommendation: show both — "X/Y team-matches ·
   Z matches complete."

### 1C. Single assignment-instances table — PARKED for v5

Collapse `assignments` (always) + `assignment_overrides` (this match) into one
`assignment_instance(event, match_number, scout, team)` row, materialized at
publish time. Makes "what should each scout do right now" a single table read,
lets `entries` FK to an instance for a free scout name, and turns coverage
conflicts into a SQL `GROUP BY`.

It's the right long-term shape but it's a real migration (expand existing base
rows into N instances, handle pre-publish intent, re-materialize on schedule
re-fetch). Not worth doing mid-season. Revisit as v5 after 1B has a real event
of usage data behind it.

---

## Recommended sequencing from here

1. **1B** is the next build. It's derived-state + UI, no schema, and it's the
   visible payoff of the union idea. Half a day to a day.
2. Resolve the three 1B open questions above first (they change the UI surface
   area, not the data plumbing).
3. **1C** stays parked until after a season on 1B.
