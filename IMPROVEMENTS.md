# v4 draft — improvements

Two things to design before we commit to building. Both came from
scouting-app-v4-draft notes; both deliberately *not* implemented yet.

---

## 1. Unify the schedule + scouting systems

### What the user said

> It would be incredibly efficient if we could union the two systems for
> scheduling and scouting. Integrating those two systems would be incredibly
> efficient — you are to design the process here.

### What "scheduling" and "scouting" currently are

Today the app already shares an event scope (the event code → Supabase
session id), but the two flows touch totally separate tables and UIs:

| | Where it lives now | Who writes | Who reads |
|---|---|---|---|
| **Schedule** | `schedules` row keyed on session_id | manager publishes from TBA | every device pulls into IndexedDB |
| **Assignments** | `assignments` rows (scout → team) | manager edits in Schedule tab | scouts pull, see "Your teams" |
| **Overrides** | `assignment_overrides` rows per (match, scout, team) | manager edits in match-detail modal | scouts pull, override-aware nextUnscoutedMatch |
| **Reminders** | `reminders` rows (optional scout, optional match) | manager sends; system auto-generates | scouts see banner |
| **Entries (scouting data)** | `entries` (Dexie locally, mirrored to `entries` table) | scouts record after each match | manager aggregates in Manager tab |

The hand-off today is: manager publishes a schedule + assignments →
scout walks into the form blind, fills it in, exports → manager imports.
There's no live tie between "match N, team T, scout S" on the schedule
side and the entry that scout actually records.

### What "union" could mean — three flavors

**A. Light: pre-fill links across every entry point.**
We already do this in `Upcoming matches` and the home next-match banner.
Extend it so any place that mentions a `(match, team)` deeplinks to a
pre-filled `/new` URL — coverage-conflict rows, match-detail modal
coverage list, reminders ("Q12 starting"). No data-model change; just
better wiring. Cheapest, least risky.

**B. Medium: make entries first-class members of the schedule.**
On the schedule preview row and inside the match-detail modal, show
*per-team* status: empty / scout-on-it / submitted. Manager can see a
match at-a-glance: "Q15 — 4/6 teams scouted, 2 missing." Scout-side, the
"Your teams" view becomes a checklist that grays out as entries land.
This needs the manager view to live-merge schedule + assignments +
entries; it's a UI refactor more than a DB one. The data is already there.

  *Detail to nail down:* "submitted" should mean: at least one entry
  exists with `(event_code, match_number, team_number)`. Multiple entries
  for the same cell are valid (e.g., two scouts both covered team 1234
  in Q15 because of an override change). The status should still be
  "submitted ≥ 1" — don't gate on author identity.

**C. Heavy: collapse the model to one "assignment-instances" table.**
Today `assignments` is "always" and `assignment_overrides` is "this
match only." A unified `assignment_instance(event, match_number, scout,
team)` row would replace both. Base assignments would be materialized
into N rows (one per qual match the team plays) the moment a manager
publishes the schedule, and overrides would just be edits to a
specific row.

Pros:
- The "what should each scout be doing right now" query becomes one
  table read, no resolution layer.
- Entries can FK into assignment-instances and get the scout name "for
  free" — no more "scout typed their name wrong on this device."
- Coverage conflicts become a SQL group-by, not a JS reducer.

Cons:
- It's a real migration. `assignments` is currently the source of truth;
  pre-existing rows have to be expanded.
- Adding a team to a scout's base list now means inserting N rows
  instead of 1. Editing the base list becomes: diff old vs new, then
  insert/delete instance rows.
- A team that didn't exist in the schedule yet (manager assigned a
  scout to team 4321 before publishing) needs a sentinel until publish
  time. Easiest: keep base `assignments` as the *intent*, and have a
  trigger or RPC that materializes instances at publish time.

### Recommendation

Land **A** immediately (it's a free win, mostly wiring), then ship **B**
as the next milestone. **C** is the right long-term shape but the
migration is a meaningful piece of work and we shouldn't rush it during
a competition season. Revisit **C** as v5.

### Open questions before implementation

- Should the "submitted" indicator be visible to scouts, or just
  managers? (Showing it to scouts can help them realize they missed a
  match. Hiding it avoids social pressure from peers.)
- For B, do we want a "needs re-scout" flag on entries that the manager
  can set (e.g., scout left fields blank)? Or is delete-and-redo fine?
- For C, what happens to historical entries from older events when
  we migrate? Probably untouched — they FK to nothing — but worth a row
  in the migration doc.

---

## 2. Decouple event code from TBA event key

### What the user said

> I think that the event code and the id to fetch from tba could be
> separate — the manager could tell everyone we're scouting with code
> 2027nyc, and then pull data from 2027nyny, which would be the same
> event, but easier to memorize for the team.

### Why this matters

Today there's one string, `eventCode`, used for two things:

1. **Sync namespace.** The Supabase session id is derived from
   `sha256(eventCode)`. Every scout on the same code shares data.
2. **TBA lookup key.** The schedule-fetch endpoint hits TBA's
   `/event/{eventCode}/matches`, so the code has to match TBA's
   canonical key (e.g., `2027nyny`, `2027hop`, `2027new` — short, dense,
   and not always intuitive).

The conflation is a UX papercut: the team has to memorize and type the
TBA key, even though only the manager actually needs it for fetching.

### Proposed model

Two distinct fields per event:

- **Team event code** (free-form, human-readable, case-insensitive,
  what gets typed into Settings): `2027nyc`. Drives sync only.
- **TBA event key** (canonical, set by the manager when they publish):
  `2027nyny`. Drives fetching only.

The TBA key lives on the manager device + on the published `schedules`
or `event_meta` row so that any future re-pull uses the right key.

### UI changes

**Settings tab (scouts and managers):**
- "Event code" field stays. Help text changes from "TBA-compatible code"
  to "Anything your team agrees on — `2027nyc`, `team1234`, anything."

**Schedule tab (manager only):**
- New "TBA event key" field next to the "Fetch from TBA" button. Stored
  per-device as `session.tbaEventKey` and uploaded as part of
  `event_meta` on publish (so a second manager device can re-fetch
  without re-typing).
- Show both keys at the top: `your code: 2027nyc  ·  TBA key: 2027nyny`
  so the manager can confirm the link before fetching.

**Schedule tab (scout view):**
- Unchanged. Scouts never see or care about the TBA key.

### Data model changes

- Add `tba_event_key text` column to `event_meta`. Nullable; only set
  once a manager has fetched.
- `fetchAndCacheSchedule(eventCode, apiKey)` becomes
  `fetchAndCacheSchedule(tbaEventKey, apiKey)`. Caller resolves the key
  from `event_meta` first, falls back to the eventCode itself for
  backward compatibility.
- `publishSchedule(eventCode, matches, opts)` also writes
  `event_meta.tba_event_key = opts.tbaEventKey` so it's discoverable.

### Migration

A new SQL migration that adds the column:

```sql
alter table public.event_meta
    add column tba_event_key text;
```

No data migration needed. Existing events were created with the
eventCode == TBA key implicitly; the new column being NULL is fine
because we'll fall back to the eventCode for the TBA fetch when it's
unset. Once the manager fetches once with the new UI, the column gets
populated, and from then on the codes are decoupled.

### Backward-compatibility

Devices on the old build still write/read `eventCode` only. As long as
the TBA key column defaults to NULL and the new client falls back to
`eventCode` when it's missing, mixed-version use is safe. The first
fetch from a new-build manager populates the column; old-build managers
that try to fetch will simply hit TBA with the user-typed code (same as
today).

### Open questions before implementation

- Should the TBA key be visible to scouts in any view (read-only)?
  Argument for: lets them double-check they're on the right event.
  Argument against: adds noise to a screen scouts barely use.
- Do we want a "preset" picker that fetches `/events/{year}/keys` from
  TBA and lets the manager pick from a list? Nice-to-have; not required
  for v1.
- What happens if a manager changes the TBA key mid-event? Probably:
  re-fetch + re-publish, same as a fresh event. Worth adding a confirm
  dialog ("This will replace the current schedule for {eventCode}.").

---

## Combined milestone proposal

If we're sequencing these two together:

1. **Ship #2 first.** It's contained, has a clean migration, and unlocks
   nicer event names for the team. Maybe a half-day of work.
2. **Then ship #1 flavor A** (deeplinks everywhere). Half-day of UI work,
   no DB changes.
3. **Then ship #1 flavor B** (entries as schedule citizens). A few
   days. This is the visible-quality jump.
4. **Park #1 flavor C** for v5 after a real season of usage data.
