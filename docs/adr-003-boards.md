# ADR 003 — Boards: the interactive graph builder

Status: **REJECTED** — not built, and not scheduled
Date: 2026-08-18
Rejected: 2026-08-18, the same day, by the person who asked for it
Superseded by: v0.80 — team-to-team comparison (see `ROADMAP.md`)

> "I think that the board is unnecessary. Instead, better UI for team to team
> comparisons are needed."

Kept rather than deleted, because the decisions in it are the ones any future
charting work would have to make again — no charting library, a chart as a
persisted spec, a field picker generated from `OBSERVATION_FIELDS`, types offered
only where they mean something, blank-is-not-zero at the series level, viewBox
autosizing, FLIP with a keyboard path. If boards ever come back, start here.

**Why the rejection is right.** A board is a tool for building the view you did
not know you needed. Studio's fixed views already answer the questions this team
actually asks — coverage, insights, the picklist — and the one question they
answer badly is the one a board would have been used for ninety percent of the
time: *how do these four teams compare*. Building a general builder to reach a
specific answer is the expensive route to it, and it would have shipped a chart
editor to a team that needed a better table.

Design record for the interactive interface that was Studio's original purpose.
A decision record, not a second plan document — `ROADMAP.md` stays the single
plan and points here.

---

## Context

The original brief, verbatim:

> Managers should be able to click **+ graph** to choose the type of graph they
> want. Pie charts, bar graphs, etc. Can also choose data points to compare,
> from all the data that the scouts submit. Will require being able to drag and
> drop different graphs of data — potential worries are autosizing and smooth
> reorganization.

It was marked "to be developed later due to difficulty" and that assessment was
correct. This is not "add a chart to Insights". It is a **user-configurable
dashboard**: a persisted set of chart specifications, each one a small query over
the entry set, laid out in a grid the manager rearranges.

Four things have to exist that do not exist today: a chart renderer, a language
for saying what to chart, a builder UI that speaks it, and a layout that survives
being dragged. Each is a release's worth of work. Bundling them as one bullet is
what made it look small twice.

### What makes it worth the difficulty

Studio's fixed views — Coverage, Insights, the picklist — answer the questions
that were known in advance. A board answers the one nobody predicted, at 9am on
the Saturday, when a manager wants cycles-per-match for four specific teams and
no page shows it. That is the difference between a tool that reports and a tool
that is used to think.

### The constraints that decide the design

> **There is no server, and the venue has no network.** The bundle is static and
> must work offline.

> **Blank is not zero.** A chart is the highest-leverage place to get this wrong,
> because a bar of height 0 is indistinguishable from a bar that should not be
> there.

---

## Decision 1 — No charting library

Hand-rolled SVG, in the same style as `Sparkline.svelte`, which already draws a
trend line in about forty lines with no dependency.

The app has exactly two runtime dependencies today: `@supabase/supabase-js` and
`dexie`. Chart.js is ~200KB and D3 more, downloaded once and then carried inside
a service-worker cache that a scout may be re-fetching on venue wifi. A fixed set
of five chart types is a few hundred lines of `<path>` and `<rect>`, and it wins
three things a library would fight:

- it consumes design tokens directly, so a board matches Studio in both themes
  and passes the same contrast checks;
- `--studio-series-1..4` already exist, are ordered for maximum adjacent
  separation, and are contrast-verified against both panel grounds;
- no library's default palette, tooltip or font to override back.

The exception worth naming: if boards ever need zoom, pan and brush over
thousands of points, that is a library's job and this decision should be
revisited rather than reimplemented.

## Decision 2 — A chart is a spec, and the spec is data

    { id, title, type, dimension, measure, aggregate, filter, span }

That object is the whole feature. It is what gets persisted, what the builder
edits, what the renderer reads, and what a future export or share would carry.
A page of hard-coded charts has no such object, which is exactly why it is not a
builder.

- **dimension** — what to group by: team, match, scout, alliance, event.
- **measure** — what to aggregate: any `METRIC_FIELDS` key, or entry count, or
  the rate of a boolean like `brokeDown`.
- **aggregate** — mean, median, sum, count, max, or standard deviation.
  `metrics.js` already computes mean, median and stdDev and must be reused, not
  re-derived.

## Decision 3 — The field picker is generated from `form-config.js`

"All the data that the scouts submit" sounds unbounded and is not: it is
`OBSERVATION_FIELDS`, which already enumerates every key, its label and its type.

So the builder's menus are **derived** from that array rather than written
alongside it. A counter added at kickoff appears in the picker with no further
edit, and — the part that matters — a field REMOVED at kickoff cannot leave a
board silently charting a key nothing writes any more.

This is the same instinct as the nav-label check: relate the two things in code
so they cannot drift, rather than remembering to update both.

## Decision 4 — Chart types are offered only where they mean something

A pie chart of a continuous measure is not a chart, and a pie of forty teams is
not readable. The builder offers the types that fit the fields already chosen:

| type | needs |
|---|---|
| bar | a categorical dimension, one measure |
| grouped bar | a categorical dimension, two or more measures |
| line | an *ordered* dimension — match number, time |
| scatter | two measures, one point per team |
| pie | a categorical dimension with few values, one summable measure |

Offering everything always is how a manager builds a meaningless chart, screens
it in a picklist meeting, and stops trusting the tool. The constraint is the
feature.

## Decision 5 — Blank is not zero, and the chart says its sample size

The invariant, at its most dangerous. A bar rendered at height 0 for a team that
was never measured is a visible, confident claim that they scored nothing.

- Null measures are **excluded from the series**, never coerced.
- Every chart shows `n` — per bar where there is room, in the caption otherwise.
- A series with fewer than `MIN_CONFIDENT_SAMPLE` readings is drawn but visibly
  held at arm's length, the way the insights table already dims a provisional
  mean.
- A chart with nothing to draw says which filter emptied it, rather than
  rendering empty axes.

## Decision 6 — Autosizing is a viewBox problem, not a resize problem

The first of the two named worries.

Charts render into a fixed `viewBox` and scale with CSS. The chart does not know
its pixel size, does not measure the DOM, and does not need a `ResizeObserver` —
the same approach `Sparkline` already uses at 90×24.

What a card *does* declare is a **span**: one or two columns. The grid is
`repeat(auto-fill, minmax(…, 1fr))`, so column count follows the viewport and a
two-column card degrades to one on a phone. Text inside a chart is the one thing
that must not scale with the viewBox — labels get rendered as HTML around the
SVG rather than as `<text>` inside it, or they become unreadable at small spans
and comic at large ones.

## Decision 7 — Reorganisation animates with FLIP, and has a keyboard path

The second named worry.

Reordering animates by measuring first and last positions and playing the
difference as a transform — no layout thrash, and it works with CSS Grid, which
`transition` alone does not.

**`prefers-reduced-motion` collapses it to an instant swap.** The app already
holds this line for the reminder fly-by and the same rule applies.

And the rule this codebase already learned on `/studio/event`, whose own header
says drag-and-drop is unreachable by keyboard and awkward on a phone, so *the
buttons are the real control and dragging is the fast path*: **every card carries
move-up / move-down controls**, sized to `--tap-min`. A board that can only be
arranged by dragging is a board a keyboard user cannot arrange.

## Decision 8 — Boards are local first, and sync is a later, separate step

A board is stored in IndexedDB, per event, like every other write in this app.

Syncing them needs a table, RLS policies, a migration, and an answer to "two
managers edited the same board" — which is a last-write-wins problem this app has
deliberately avoided before, and is why the picklist became one row per team
rather than one blob. That is a release of its own and must not be smuggled in
underneath the drawing.

Until then a board belongs to the device that built it, which is honest, and the
existing bundle export is the way to move one.

---

## What this is not

- **Not a report generator.** No PDF, no print layout, no scheduled email.
- **Not a query language.** The dimension/measure/aggregate vocabulary is closed
  and small. The moment it grows a free-text expression field it becomes a
  product nobody on the team can debug at an event.
- **Not for scouts.** Desktop-gated on **viewport and pointer**, never on
  operating system — a browser cannot reliably report an OS and should not be
  asked. On a phone the boards page says so and links to the fixed views.

## Sequencing, and why this comes before ADR-002

Both this and `adr-002-spatial-observations.md` are `x0`-scale. This one goes
first, and the reason is a hard dependency rather than a preference:

**Interactive auto scouting needs a real field image, which needs a real game.**
It cannot be finished, or honestly tested, before kickoff. Boards work on data
the team already has, today, out of season.

So: **v0.80 is boards, v0.90 is spatial observations**, timed to arrive with the
field it needs.

## Open questions

- Whether a board is per-manager or per-event. Per-event is simpler and shares
  work; per-manager avoids two people fighting over one layout. Probably
  per-event with the author recorded, but this is untested against how the team
  actually works.
- Whether the picklist should become a board, or stay a purpose-built page. It is
  the one fixed view whose job a board could plausibly do.
