# FRC Scout — improvement draft

A proposal, in prose, for what I'd build next on top of the current shipped version. The shipped version handles the basics — a working PWA that records qualitative observations, syncs wirelessly through Supabase keyed by event code, and aggregates per team for a manager. Everything below assumes that as the starting point and lays out where the obvious gaps are.

The proposals are split into two halves: **recording** (the scout-side experience of capturing data during matches) and **manager** (the analysis-side experience of using that data to make decisions). Within each, items are roughly ordered from highest to lowest leverage. At the end there's a suggested implementation order across both halves.

---

## Recording

### The honest read on what's there

The form captures one match per submission, with three identity fields (match number, team number, alliance color) and six observation fields (auto pathing, strengths, weaknesses, defense, broke down, comments). The autocomplete on auto pathing is the one place the app does something Google Forms can't easily do; everything else is generic textarea-style capture. Saving is one tap, but every match requires the scout to fully type three identity fields plus their observations, even though most of the identity is predictable from where they're sitting in the stands.

### Edit after save

Currently entries are read-only once submitted. A scout who notices they typed the wrong team number sees the entry on the home list and has only two options: delete it and re-enter, or live with it. Both are bad. The fix is to make the entry rows on the home list tappable — opening a pre-filled entry form that updates the existing row in place when saved. This requires giving entries a stable identifier the form can target (we already have one — the local Dexie `id`) and adding an `updateEntry` helper alongside `addEntry`. The sync layer needs to learn to push updates as well as inserts, which means an UPDATE path on the cloud-side row keyed by `remoteId`. Modest amount of new code; substantial UX win.

### Repeat-entry / pre-fill from previous

The single biggest cause of typing fatigue is re-entering the same identity fields match after match. A scout assigned to "blue 2" for the day will type that alliance and slot through every match. The "+ New entry" button could carry forward `allianceColor` from the previous entry by default — and if scouts had a way to declare their assignment up front (e.g., "I'm blue 2 today" in Settings), even more of the form could be pre-filled, including the team number once a schedule is loaded.

The minimum-effort version of this is just remembering `allianceColor` and `scoutName` between submissions. A more ambitious version is a "scout assignment" field in Settings — `Assignment: blue 2` — that, combined with the next item below, pre-fills team and match too.

### Schedule integration with The Blue Alliance

This is the biggest single feature missing from the recording side. The Blue Alliance has a free public API that exposes match schedules per event. With an event code (which the scout already enters in Identity) the app can fetch the schedule once and cache it. Then the entry form can:

- Auto-suggest the next unscouted match by number based on the schedule and current entries.
- Pre-fill `teamNumber` and `allianceColor` based on the scout's declared assignment ("I'm blue 2") plus the upcoming match's roster.
- Warn if the entered match number doesn't exist for this event, or if the team number doesn't match the alliance the schedule says they're on.

This collapses a three-field manual entry into a one-tap "next match" button. Forms physically cannot do this; it's the kind of thing a custom tool justifies its existence with. Cost: a few hundred lines of TBA fetching and caching, plus a new Settings field. TBA's API is anonymous-readable for most calls so no key management.

### Tag presets

A handful of observations come up across most matches: "fast cycles," "consistent auto," "weak intake," "broken bumper at match end," "played strong defense." Right now scouts type these phrases freshly into textareas every time, with subtle variations that defeat the manager's ability to spot patterns. A row of tag pills above each textarea — populated from the team's most-used phrases plus a few hand-curated defaults — would let a scout one-tap to compose an observation. The textarea remains for free-form additions. Implementation reuses the autocomplete suggestions logic already shipped for auto pathing, just rendered as buttons instead of a datalist.

### Live entry counter on home

Right now the home list just shows entries. A small badge near the top — "12 entries this event, 4 today" — gives scouts visible feedback on their pace, which matters at venues where a manager wants to nudge slow scouts. This is purely a render change; no schema impact.

### Voice dictation

Phones are bad typing surfaces, especially in a noisy gym with cold fingers. Modern Web Speech API handles dictation in-browser, no server, no library, no cost. Add a small mic button next to each textarea that toggles dictation into that field. Implementation is shockingly small (~30 lines) but support is uneven across browsers — works great on Chrome/Edge, weaker on Safari, can fall back gracefully when unavailable.

### Photo attachment for robots

Sometimes the easiest way for a strategy lead to recall a robot is "the orange one with the elevator." A camera input that takes a still photo, compresses it client-side to a few hundred KB, stores it in IndexedDB, and round-trips through Supabase Storage (separate from the Postgres rows) gives that capability. This is the largest individual change in this section because it touches the data model, the sync layer, the export format, and adds a new UI affordance. I'd defer it until the qualitative-only model has been used at a real event and a clear "we wish we had photos" pain point shows up.

---

## Manager

### The honest read

The manager page does the basics — counts, search by team number, sort buttons, expandable team rows showing strengths preview and a few entries. But three things are visibly broken or stubbed in the current build: the filter chips ("Event," "All scouts," "Both alliances") are decorative-only and don't actually filter; the "+ N more entries" footer when expanding a team is a label rather than a clickable expand control; and there's no way to export to anything other than the binary `.scout` format, which strategy folks can't open in Sheets. All three of these are quick wins.

### Wire up the dead filter chips

The chips render but tapping them does nothing. The aggregation already produces the data needed (`summary.events`, `summary.scouts`, plus per-team `redCount`/`blueCount`); the filtering needs to recompute the per-team rollup on the filtered subset of entries. Behaviour I'd ship: each chip cycles through values on tap. "Event: all" → `Event: 2027hvr` → `Event: 2026cala` → "Event: all". Same pattern for scouts and alliance. Filters combine — selecting an event AND an alliance shows only those matching both. Empty filter result shows a "no teams match these filters" empty state with a "Clear filters" button.

### Show every entry when expanding a team

Currently expanding a team shows the most recent three entries plus "+ N more entries" as static text. The fix is to make that text a button that, when tapped, expands to show all of them. Or to drop the limit entirely and let the expanded section be as long as it needs. Three is a footgun — at a competition with eight matches per team, you're hiding more data than you're showing.

### CSV export

The single most-requested integration for any data-collection tool is "give me a spreadsheet." Add a "Export CSV" button alongside the existing "Export .scout" in the manager toolbar. The CSV flattens each entry into a row with one column per observation key plus the identity fields. RFC-4180 escaping for any text field that contains commas, quotes, or newlines. Filename matches the `.scout` pattern: `<eventcode>-aggregated-<date>.csv`. ~40 lines of new code in `export.js`; one new button.

This is also the move that lets us stop trying to compete with Sheets on analysis. The pitch becomes "capture in our app, analyze in your sheet." Strategy teams that already have a Sheets template just paste in.

### Per-team match log view

The most common manager workflow during competition is "we're playing team 254 next, what do we have on them?" Right now that requires scrolling the team list to find 254, expanding the row, reading the entries inline. A dedicated per-team page (`/manager/team/254`) with a clean chronological match log, all observations in full (no preview truncation), and a header summarizing counts, would be much better than scrolling-and-expanding. Click a team row to navigate; back button returns to the manager list.

### Multi-team comparison

For pre-match strategy briefings, a strategy lead wants to see all six teams in an upcoming match — three blue, three red — laid out together. A new comparison route (`/manager/compare?teams=254,1234,2056`) renders columns of teams side by side, with strengths/weaknesses/breakdown counts/auto pathing aligned across rows. The TBA schedule integration above could feed this directly: "compare teams in match 14" auto-populates the URL.

Without quantitative data this is a side-by-side qualitative read rather than a numeric ranking, but it's still vastly better than tab-switching between team detail pages.

### Picklist builder

At alliance selection, the strategy lead has minutes to pick partners from the available pool. A picklist tool — a screen showing all teams in their seeded order, drag-rankable into a single column representing first-pick choices, plus a separate "backup" column — is the actual deliverable strategy work has been building toward all weekend. Save the picklist as a row in IndexedDB. Share it as a `.scout` file or QR code so the drive coach has a copy on their own phone before the team is called up.

This is a meaningfully large feature — new route, drag-and-drop interaction, persistence, share-out. But it's the one thing that makes the difference between "we have data" and "we made the right pick."

### Discrepancy flagging

If two scouts in the same alliance color report contradictory observations on the same team in the same match (one says "broke down," the other doesn't), that's worth knowing before you trust the data. A small inline flag — "⚠ disagreement" next to a team — that shows on hover or expand, and links to the conflicting entries, helps the manager spot scouting noise. Pure aggregate logic, no schema change. Defer until the basic flow is otherwise polished.

### Coverage view

A small section near the top of the manager page that shows "we've scouted 28 of 36 teams at this event; 8 not yet covered: 1234, 5678, …" With one click it could open a "to do" list a manager can hand to a free scout. Encourages full coverage during qualifications. Tiny addition; pulls its weight.

### Dark mode

Phones in the stands often run on low brightness to save battery. A dark theme toggle in Settings — with system-default detection — makes the app friendlier in those conditions. Pure CSS work, no logic change. Worth doing once the rest of the manager view is settled.

---

## Suggested implementation order

The first three items pay for themselves the moment you ship them and don't depend on anything else: **wire up the filter chips**, **fix the "+ N more entries" expansion**, and **add CSV export**. They're each a few hours of work and they unlock the manager page from being demo-grade to being usable.

After that, **edit-after-save** for the recording side and the **per-team match log view** for the manager side. Both are straightforward extensions of what's already there, and both are visible quality-of-life wins.

Then the bigger pieces in this order: **schedule integration with TBA** (highest single-feature ROI, but more work), **multi-team comparison** (cheap once schedule integration exists), and **picklist builder** (real new route but the alliance-selection workflow needs it).

Lower priority: **tag presets**, **discrepancy flagging**, **coverage view**, **dark mode**, **photo attachment**, **voice dictation**. Each is independently nice but none of them is the difference between "useful" and "not useful."

The quantitative-scoring direction we explicitly passed on stays passed-on. If a future season pushes you to add per-game-element counters, the form framework already supports introducing new field types — `number-counter`, `enum`, `1-5-rating` — without rewriting the rest of the app.
