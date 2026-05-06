# Manager page redesign — implementation spec

Self-contained brief for an agent picking this up cold. Read top to bottom; don't ask the user clarifying questions about anything answered here.

## Project context

This is `frc-scout`, an offline-first FRC scouting PWA built with SvelteKit (Svelte 5 runes mode) + adapter-static. Data lives in IndexedDB via Dexie. Sync is file-based: scouts export a gzipped-JSON `.scout` file (gzip via pako) and a manager imports those files on a separate device. There is no backend.

Repo: `/Users/groceries11/FRC Scouting Application`
Live URL: `https://highestinthesky.github.io/frc-scouting-app/`
Hosted at the `/frc-scouting-app` subpath on GitHub Pages — `paths.base` is read from the `BASE_PATH` env var in `svelte.config.js` and `vite.config.js`. All internal nav must use `base` from `$app/paths`. Deploy is automated via `.github/workflows/deploy.yml` on push to main.

Two roles, toggled in Settings: **scout** (collects entries, exports one file) and **manager** (imports many files, aggregates, re-exports). The work in this spec is entirely on the manager view.

## Current data model

Entry rows in Dexie:

```js
{
  id,                    // local auto-increment, stripped on export
  eventCode,             // e.g. "2026cala"
  matchNumber,           // integer
  teamNumber,            // integer
  allianceColor,         // "red" | "blue"
  scoutName,
  createdAt,             // ISO string
  observations: {
    strengths,           // free text, optional
    weaknesses,          // free text, optional
    defense,             // free text, optional
    failures             // free text, optional
  }
}
```

`src/lib/aggregate.js` exports `summarize()` which returns:

```js
{
  totalEntries, teamCount, eventCount, scoutCount, matchCount,
  events: string[],   // sorted
  scouts: string[],   // sorted
  teams: [{
    teamNumber,
    entryCount,
    matchesCovered,    // count of distinct matchNumbers
    scoutsCovered,     // count of distinct scoutNames
    entries            // sorted by matchNumber asc
  }]
}
```

`src/lib/export.js` exports `exportToFile({ kind, exportedBy, eventCode })` which builds a gzipped-JSON payload and triggers a browser download. Filename pattern: `{eventCode}-{tag}-{date}.scout` where tag is `aggregated` for manager exports or the scout's name for scout exports.

## Why this redesign

The current manager page lists teams with entry/match/scout counts and a click-to-expand showing observations. To find which teams had failures noted, the manager has to expand every row. To rank teams, no sorting exists. There's no search and no CSV export. At competition, alliance selection happens in minutes — the page has to surface the answers immediately.

Observations are still all free-text, so the redesign cannot introduce quantitative scoring. What it CAN do is count signals already present in the data: how many entries had non-empty `observations.failures`, etc.

## Work breakdown

Three files change. No new dependencies, no DB migration, no changes to the scout flow, no changes to `form-config.js`.

### 1. `src/lib/aggregate.js` — extend `summarize()`

Add to the top-level return:

- `lastEntryAt` — most recent `createdAt` across all entries, or `null` if empty.

Add to each team object:

- `failureCount` — number of entries where `observations?.failures` is a non-empty trimmed string.
- `defenseCount` — same for `observations?.defense`.
- `strengthCount` — same for `observations?.strengths`.
- `firstStrengthSnippet` — `observations.strengths` of the first entry that has one, trimmed and truncated to 80 chars (with an ellipsis appended if truncated). `null` if no strengths anywhere.
- `redCount`, `blueCount` — counts by `allianceColor`.
- `lastSeen` — most recent `createdAt` across this team's entries.

Keep the existing fields. Don't change the sort order coming out of summarize — the page does its own sorting.

### 2. `src/lib/export.js` — add `exportToCsv()`

New export alongside `exportToFile`:

```js
export async function exportToCsv({ exportedBy, eventCode })
```

Behavior:

- Calls `listEntries()`.
- Builds CSV with header row: `eventCode,matchNumber,teamNumber,allianceColor,scoutName,createdAt,strengths,weaknesses,defense,failures`.
- One row per entry. Observation fields come from `entry.observations?.[key] ?? ''`.
- Properly RFC 4180 escapes: any value containing `,`, `"`, `\r`, or `\n` is wrapped in double quotes, with internal `"` doubled to `""`.
- Triggers a browser download (use the same blob/`URL.createObjectURL` pattern already in `download()`, but with `text/csv;charset=utf-8` and a `.csv` filename).
- Filename: `{eventCode-or-"event"}-aggregated-{YYYY-MM-DD}.csv` using the same slugging as `defaultFilename`.
- Returns `{ filename, count }` matching `exportToFile`.

### 3. `src/routes/manager/+page.svelte` — full rewrite

Mostly new markup and styles. Keep these existing imports and behaviors:

- `summarize` (now returning the extended shape).
- `importFile` from `$lib/import.js` — file picker behavior is unchanged.
- `exportToFile` for `.scout` export.
- `session` and `role` stores.
- `base` from `$app/paths` for any new links.

Add `exportToCsv` import.

#### State (Svelte 5 runes)

```js
let summary = $state(null);
let loading = $state(true);
let importing = $state(false);
let importMessage = $state('');
let importError = $state('');
let exportMessage = $state('');
let fileInput;
let expanded = $state(new Set());

// Toolbar state
let searchTerm = $state('');
let sortKey = $state('entries'); // 'entries' | 'team' | 'failures' | 'matches' | 'recent'
let eventFilter = $state(null);   // null = all
let scoutFilter = $state(null);
let allianceFilter = $state('all'); // 'all' | 'red' | 'blue'
```

#### Derived team list

A `$derived` (or `$derived.by(() => …)`) named `visibleTeams` that:

1. Starts from `summary?.teams ?? []`.
2. If `eventFilter` is set, filters each team's `entries` by event, recomputes `entryCount`, `failureCount`, etc. on the filtered subset, and drops teams whose filtered entry count is 0. Same for `scoutFilter`. Same for `allianceFilter`.
3. If `searchTerm` non-empty, filters teams whose `teamNumber.toString()` includes the trimmed term.
4. Sorts by `sortKey`:
   - `'entries'`: `entryCount` desc
   - `'team'`: `teamNumber` asc
   - `'failures'`: `failureCount` desc, tiebreak `entryCount` desc
   - `'matches'`: `matchesCovered` desc
   - `'recent'`: `lastSeen` desc

Keep the recomputation cheap — just iterate filtered entries once per team. This is a phone running on at most a few hundred entries.

#### Layout (top to bottom)

**Header row.** Title "Manager" (h1, 22px / 500). Subtitle on the right or below: `"{totalEntries} entries · last {relativeTime} ago"`. Use a small relative-time helper (no library) — under 60s "now", under 60m "{m}m", under 24h "{h}h", under 7d "{d}d", else date.

**Stats grid.** Four metric cards, equal width on desktop, 2×2 on mobile. Background `#f3f4f6`-ish (or just keep current style). Label on top (13px secondary), big number (24px / 500) below. Stats: Entries, Teams, Matches, Scouts. The values come from summary directly (not from filtered list — they describe the whole imported set).

**Toolbar row.** Single row that wraps on narrow viewports. Contains:

- Search input, `placeholder="Find team #"`, bound to `searchTerm`. Type=text, inputmode=numeric. Width: flex-grow with max ~220px.
- Sort `<select>` bound to `sortKey` with options "Most entries", "Team number", "Most failures", "Most matches", "Recent activity".
- Three buttons: Import (existing label-wraps-input pattern), Export .scout (calls existing handler), Export CSV (calls new handler).

**Filter chip row.** Three chips that cycle on click:

- Event chip: text "Event: all" or "Event: {eventCode}". Click cycles through `[null, ...summary.events]`. Render in info color when a specific event is selected, neutral otherwise.
- Scout chip: same pattern with `summary.scouts`. Label "All scouts" / "Scout: {name}".
- Alliance chip: cycles `'all' → 'red' → 'blue' → 'all'`. Label "Both alliances" / "Red only" / "Blue only".

**Team list.** Stacked cards, gap 8px. Each team card has a header row (always visible, click toggles expand) and an optional expanded body.

Header row, left to right:

- Team number, 16px / 500, min-width 64px. `Team {teamNumber}` or just `{teamNumber}` — pick one and be consistent (recommend `Team {teamNumber}` to match existing style).
- Alliance bar, 14px tall, ~56px wide, border-radius 3px. Two flex children with `flex: redCount` and `flex: blueCount`, colored `#E24B4A` (red) and `#378ADD` (blue). If `entryCount < 3`, render a muted gray placeholder bar of the same dimensions instead, and append italic muted text "thin coverage" in the coverage slot.
- Coverage line, secondary text 13px, `flex: 1`: `"{entryCount} entries · {matchesCovered} matches · {scoutsCovered} scouts"`. Pluralize "entry/entries" and "scout/scouts" properly. The "thin coverage" replacement above takes priority when count < 3.
- Failure badge (conditional, only if `failureCount > 0`): pill, 12px text, padding 3px 9px, danger background + danger text. Label: `"{n} failure"` or `"{n} failures"`.
- Defense badge (conditional, only if `defenseCount > 0`): pill, secondary bg + secondary text. Label: `"{n} defense"`.
- Last seen relative time: 12px tertiary text. Same helper as the header subtitle.
- Chevron: `▾` if expanded, `▸` if not. Tertiary color.

Below the header row but still in the always-visible area: if `firstStrengthSnippet` is set AND the row is collapsed, show one line: `"Strengths preview: {snippet}"`. 13px, primary color for the label, secondary for the snippet text. Hide entirely when expanded.

Expanded body: render team's entries (the unfiltered ones from `summary.teams[i].entries`, OR the filtered ones if you went the route of recomputing — pick the filtered ones for consistency). Each entry: card with `border-left: 3px solid` red or blue. Header line: `Q{matchNumber}`, alliance text, `by {scoutName}` right-aligned. Then observation lines if non-empty: `+` strengths, `−` weaknesses, `D` defense, `!` failures. Match the current visual style — those are already in the existing manager page CSS.

If a team has more than ~6 entries, show first 6 + a small footer `"+ {N} more entries"` that, on click, expands fully. Optional polish — fine to render all if simpler.

#### Empty states

- No entries imported at all: same as today — "No entries yet. Tap **Import scout files** to load .scout files your scouts shared with you."
- Filter/search returns zero teams but `totalEntries > 0`: "No teams match these filters." Below it, a "Clear filters" button that resets `searchTerm`, `eventFilter`, `scoutFilter`, `allianceFilter`.

#### Responsive

The existing `max-width: 42rem` (~672px) wrapper is fine. Inside that:

- ≥640px: stats grid is 4 columns. Toolbar fits on one line. Team header row fits on one line.
- <640px: stats grid is 2×2. Toolbar wraps; search input goes full width on its own row, sort+buttons on the next. Team header row may wrap — alliance bar onto its own line is acceptable.

Use plain CSS media queries inside the component `<style>`. Don't introduce a CSS framework.

## Conventions

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`). The codebase is fully runes-mode (forced in `svelte.config.js`).
- **Internal links** use `${base}/...` from `$app/paths`. Do not write absolute paths starting with `/`.
- **Sentence case** in all UI text. No Title Case, no ALL CAPS.
- **No emoji** anywhere in UI.
- **Existing color tokens**: `#0b3d91` (navy primary), `#c0392b` (red alliance accent), `#2c5cb0` (blue alliance accent — note the alliance bar uses brighter `#E24B4A` / `#378ADD` for visibility), `#ffb000` (manager role badge). Stay within these unless the design explicitly calls for new ones.
- **Component-scoped styles**: existing pages use `<style>` blocks at the bottom. Match that.
- **Comments**: existing files have explanatory comments on non-obvious logic. Add the same. No header banners.
- **No new dependencies**.

## Out of scope

Don't touch any of these — they're separate work or already shipped:

- Database schema / Dexie migration
- Scout-side pages (`+page.svelte`, `new/+page.svelte`, `settings/+page.svelte`)
- `form-config.js` (and don't add quantitative fields — that's a future, larger change)
- `import.js` and the `.scout` file format
- The PWA manifest, icons, service worker, or deploy workflow
- Any CHANGELOG, README, or top-level docs

## Verification before shipping

Run from the project root:

```sh
BASE_PATH=/frc-scouting-app npm run build
```

Build must succeed clean. Then in dev (`npm run dev`):

1. With no entries: empty state shows "Import scout files" prompt.
2. Import a `.scout` file with a few entries spanning 3+ teams.
3. Stats cards show correct counts.
4. Sort dropdown reorders the team list correctly for each option.
5. Search by partial team number filters the list.
6. Each filter chip cycles through values correctly and combines with the others.
7. Failure badge appears only on teams with at least one non-empty `observations.failures`.
8. Defense badge same logic.
9. Strengths preview appears under collapsed rows that have any strengths text, hides when expanded.
10. Click a team row → expands to show entries with red/blue left borders and observation prefixes.
11. Export .scout still works as before.
12. Export CSV downloads a `.csv` that opens in Excel/Numbers/Sheets with no quote-escaping artifacts. Verify a row whose strengths field contains a comma round-trips correctly.
13. Re-importing a previously exported .scout still dedupes (no regression on existing dedupe path).
14. Resize to ~380px wide: layout doesn't break, badges wrap rather than overflow.

## File summary

| File | Change |
|---|---|
| `src/lib/aggregate.js` | Extend `summarize()` with new per-team fields and top-level `lastEntryAt`. ~30 net lines added. |
| `src/lib/export.js` | Add `exportToCsv()` alongside existing functions. ~40 lines. |
| `src/routes/manager/+page.svelte` | Rewrite markup, styles, and add toolbar/filter state. ~250 lines net. |

No other files should change.
