# ADR 002 — Spatial observations

Status: **accepted, not implemented** — scheduled for v0.81
Date: 2026-08-18
Rescheduled: 2026-08-26, from v0.90 — see *Why this is v0.81* below.
Revised: 2026-08-29 — **substantially rewritten** against
`docs/auto-scouting-plan.md`. See *What changed in the revision*.
Depends on: nothing. Deliberately buildable without a native app.

Design record for interactive auto scouting and everything that follows from it.
This is a decision record, not a second plan document — `ROADMAP.md` stays the
single plan and points here. The feature's source document is
`docs/auto-scouting-plan.md`, and **where the two disagree, that document wins**;
this one records how its requirements resolve into a data format and a screen.

---

## What changed in the revision

The first draft of this ADR was written on 2026-08-18 **without the plan
document**, and it contradicted it in three places that were each load-bearing:

| The plan asks for | The first draft said |
|---|---|
| Drag the robot; a continuous path | Decision 2 rejected a polyline outright |
| Hold action buttons during the 15 seconds | Decision 6 required marking only *after* auto |
| Replay a match, every path at once | "Not a replay", on data-volume grounds |

All three resolved toward the plan, and two of the three because **the original
reasoning was wrong on the facts**, not merely outvoted:

- *"A polyline captures where the robot was, which nobody asks."* The plan asks.
  Route clustering and "seconds spent scoring" are both unanswerable from four
  tapped points, and those are the two questions the feature exists to answer.
- *"Storing enough to animate the robot is a different data volume."* It is about
  **600 bytes** — see Decision 2. A fully covered 24-match event is roughly 84 KB.
  The volume argument does not survive the arithmetic.

The third — recording during auto — was a real objection and is answered rather
than dismissed, in Decision 6.

What survived unchanged: normalised field-absolute coordinates (Decision 1),
riding `observations` so there is no migration (Decision 3), blank stays blank
(Decision 4), and the field image as season data (Decision 5).

---

## Context

Every number this app records is a scalar: four counted, three cycles, broke
down. That is what almost every scouting system collects, and it is also what
The Blue Alliance and Statbotics can already derive from match results for free.
A team that records only scalars is doing unpaid work to reproduce a public
dataset slightly worse.

**Where a robot went is not in any public dataset.** Which side of the field it
starts on, which route it takes in auto, where on the field it scores from,
where it gets stuck — none of that is recoverable from a score breakdown, and
all of it decides alliance selection. That is the leverage a team's own scouts
have, and this app currently throws it away.

### The constraints that shape it

> **A scout is watching the field, not the phone.** Auto is fifteen seconds.

This is the one the design has to earn its way past rather than ignore — see
Decision 6.

And the standing one, unchanged:

> **There is no server.** Recording writes to IndexedDB first, always, and this
> must work with no signal.

---

## Decision 1 — Coordinates are normalised and field-absolute

Store `x` and `y` as fractions of the **full field**, with a fixed origin:
`(0,0)` is the red alliance wall's left corner as drawn on the reference image,
`(1,1)` the far corner.

Not pixels. A pixel coordinate is meaningless the moment the phone rotates, the
field image is redrawn at a different resolution, or a season changes the image
— and all three of those happen.

Not alliance-relative. It is tempting to store "my alliance's side is always the
left", because it makes a red path and a blue path directly comparable. It is
also lossy in the one case that matters: a team's behaviour is often *specific
to a real corner of a real field*, and folding red onto blue destroys that. Flip
at **display** time instead, where the alliance is known and the transform is
one subtraction.

This is the same reasoning as `scout_name` being a join key rather than a label:
store the thing that is true, derive the thing that is convenient.

**The sharp edge: the drawn field is cut, and the coordinate space is not.** The
plan is right that a robot can only reach the alliance and neutral regions in
auto, so the picture shows that slice and not the whole field. The fractions
must still be **relative to the full field anyway.** Normalising to the cut
region instead would mean a season that cuts differently silently rescales every
stored path, and red and blue would no longer share a coordinate space. The cut
is a property of the picture. It is not a property of the data.

## Decision 2 — A sampled track, plus action intervals

Two separable things, because they have different resolutions and different
value.

    observations.autoTrack = {
      v: 1,                       // format version, independent of SCHEMA_VERSION
      hz: 10,
      start: { x: 0.12, y: 0.44 },
      p: "<base64>",              // 2 bytes per sample: x as uint8, y as uint8
      s: [                        // action intervals, ms from t0
        { a: 'collect', t0: 1200, t1: 2600 },
        { a: 'score',   t0: 4100, t1: 5000 },
        { a: 'fault',   t0: 9300, t1: 9800 }
      ]
    }

**`t` is milliseconds from the start of the recording**, not wall-clock: it
survives a device with a wrong clock, which is the same reason `updated_at` is
set by a trigger rather than by the client. It is also *not* the start of auto —
see Decision 8, which is the problem that creates.

**10 Hz, and not more.** Human pursuit tracking lags by roughly 200–300 ms, so
sampling faster than that records the scout's thumb tremor rather than the
robot. 150 samples over fifteen seconds is already finer than the input is
honest to.

**8 bits per axis.** 256 steps across a 16.5 m field is 6.4 cm — under a tenth of
a robot's width, and well under a thumb's precision on a field drawn 350 px wide,
where one step is 1.4 px. Quantisation is not the limiting error here; the scout
is.

**The actions are intervals, not instants**, because that is what a held button
produces and it is what "seconds spent scoring" needs. Their endpoints are
recorded at full event resolution rather than snapped to the 10 Hz grid — a
button press is an exact moment, and the sample rate is a property of the
position track only.

The action set is closed — `collect`, `score`, `fault` — and versioned with the
season alongside `METRIC_FIELDS`, because what a robot can *do* changes every
January and a free-text action would be unaggregatable within one event.

### The arithmetic, since the plan raises it

> *"I worry about the database size limitations."*

150 samples × 2 bytes = **300 bytes** of position, which base64 carries as 400
characters, plus a start pair and the intervals.

**Measured rather than estimated, because the estimate was 20% light.** A full
15-second track with four action intervals is **598 bytes** of JSON; a real one
recorded through the UI with two intervals came out at **533**. A fully covered
24-match offseason — 144 tracks — is **about 84 KB.** Supabase's free tier is
500 MB. `auto-track.test.mjs` asserts both numbers, because this is the figure the
replay was readmitted to the design on and a claim a release rests on should fail
loudly when it stops being true.

The start pair is stored to four decimals rather than at full float precision:
`0.12156862745098039` is nineteen characters to express one of 256 values, twice
on every record, and one quantisation step is 0.0039.

Even the lazy encoding, 60 Hz of unquantised JSON floats, is 27 KB per track and
3.9 MB per event, which is still not a problem. The concern is reasonable and
the numbers do not support it. What actually grows is the size of a single
`entries` row, roughly doubling it, and that is the honest way to state the cost.

### Partial records are a feature, not a degraded case

`start` is stored separately from `p` rather than being read off the first
sample, and the reason is that the three pieces have to be independently
recordable:

- **Start only** — the scout placed the robot before the match and then watched
  it instead of tracking it. This is a legitimate and common outcome, and it
  still feeds the single most-asked question (Decision 7).
- **Start and track** — no action buttons pressed.
- **All three.**

A histogram of starting positions also should not have to base64-decode 144
tracks to count them.

## Decision 3 — It rides `observations`, so there is no migration

`entries.observations` is already a JSON blob that syncs. A new key inside it
needs **no schema change, no migration, and no new RLS policy**, and it inherits
the existing dedupe fingerprint and watermark sync unchanged. At ~500 bytes this
remains true; it would not survive a 27 KB blob nearly as comfortably, which is
the second reason Decision 2 quantises.

The key is `autoTrack`. Deliberately not `autoPathing` — that key already exists
as a free-text autocomplete field (`form-config.js:111`) and is rendered on the
Insights and team pages. Two concepts must not share a name; that is the mistake
`scout-identity.js` exists to have already fixed once.

`SCHEMA_VERSION` goes 3 → 4 when this ships. `autoTrack.v` is a *separate*
version for the encoding itself, so the sample rate or quantisation can change
without pretending the whole form changed.

## Decision 4 — Blank stays blank

**No track recorded is not "the robot did not move."**

This is the app's oldest invariant and it extends here without amendment: an
entry from before v0.81, or from a scout who did not have time, must contribute
*nothing* to a heat map rather than contributing an empty field. `readMetric()`
returns `null` for absent scalars; the spatial reader must return `null` for an
absent track, and every aggregate must count its own sample size.

Per Decision 2 this applies **per piece**: a record with `start` and no `p`
counts toward start-position frequency and toward nothing else. It is not a
robot that started and then stood still.

The failure this prevents is specific and would be invisible: a heat map that
silently averages in fifty empty auto routines looks like a team that does
nothing in auto, and it looks exactly like real data.

## Decision 5 — The field is season data, not an asset

One field per season in `field.js`, checked in beside `METRIC_FIELDS`, with its
own version. The January retune ritual gains a step: update the geometry, update
the action set, update the legal region, bump `SCHEMA_VERSION`.

**Built from published dimensions, not traced from an image**, and that is the
better outcome rather than a compromise. This decision originally asked for an
SVG so the regions could be "derived from it rather than maintained as a parallel
list of rectangles that drifts" — which is the right instinct pointed one level
down. What must not drift is the geometry, and the way to guarantee that is for
the picture and the collision test to read the *same numbers*. A trace would have
put a bitmap on one side of that line and a hand-kept list on the other.

So `field.js` holds the 2026 REBUILT field in inches, exactly as FIRST publishes
it, and derives every fraction. Inches rather than fractions because `0.2435`
cannot be checked against a game manual and `158.6` can.

Vector rather than a bitmap for the same reasons as before: it scales to any
phone without a second file, and it is bytes rather than kilobytes in a bundle
that has to work offline.

### What a placeholder got wrong

The first implementation was a schematic guess, and it was wrong in three ways
that would each have taught scouts a field that does not exist:

- **It had one obstacle at field centre.** There are **two HUBs**, one per
  alliance, each 158.6in from *its own* alliance wall. Nothing is at the centre
  line.
- **The HUB is a 47in square**, not a circle.
- **BUMPs and TRENCHes are not obstacles.** A robot drives *over* a BUMP and
  *under* a TRENCH. Adding them as walls is the natural next step when putting
  them in the picture, and it would have fought the scout on paths that really
  do cross them. They are landmarks; only the HUBs and the DEPOT stop a robot.

The lateral layout is its own check: `47 (HUB) + 2 × 73 (BUMPs) + 2 × 62.35
(TRENCHes) = 317.7`. That it sums exactly is the evidence the manual was read
correctly, so `field.test.mjs` asserts the sum rather than the individual widths.

**The legal region is part of the geometry.** The plan requires that a robot
cannot be dragged into a wall or through the hub, so the drag clamps to it. This
is a recording aid and not a validation rule — it keeps a thumb from parking the
robot somewhere impossible, which is a different thing from rejecting a scout's
input.

**The whole field is drawn, and the plan was wrong about this.**
`docs/auto-scouting-plan.md` says robots "can only enter neutral and alliance
regions during auto" and this shipped cut on that basis. There is no such rule in
2026: the only thing AUTO restricts about driving is **G403**, and that restricts
*contact* past the CENTER LINE, not territory. A cut field is not a convenience,
it is a hole — a scout watching a robot that crossed would have had nowhere to
put it, and the path would have flattened against the edge as though the robot
had parked there. Recording something false is worse than recording nothing, and
it would have done it silently.

**A start position is constrained, and by the rule rather than by the zone.**
**G303-D**: *"its BUMPERS overlap their ROBOT STARTING LINE."* Not anywhere in
the alliance zone and not anywhere on the field — straddling one line. The start
is the most-asked question of the whole feature, so it is constrained at the
input rather than corrected in the reading. G303-E (*"not contacting the BUMP"*)
is deliberately **not** enforced: the lateral BUMP extents are derived from a
width that sums rather than measured off a drawing, and hard-blocking on an
inferred number would fight a scout who watched a robot start somewhere the file
is wrong about. The BUMPs are drawn; a scout can see them.

**The robot is drawn at its real size.** R104 gives 110in of FRAME PERIMETER, so
a square robot is 27.5in a side and bumpers add about 3.25in per side — 34in of
carpet. BUMPERS are what the rules measure, so they are what this measures. The
icon was a fixed 48 units through two changes of picture width, which made it
about 70% of a robot; a scout judging whether one fits between the HUB and a BUMP
is reading that square.

Because coordinates are normalised to the full field, **a new image does not
invalidate old data** — last season's paths still plot, on last season's image,
at the same relative positions.

## Decision 6 — Record live, correct after

The first draft forbade recording during auto, on the grounds that a scout
looking at a phone is not watching the field. That objection is real. It is not
answered by giving up the track, because a path reconstructed from memory
afterwards is exactly the "guessed path that looks like data" the objection was
protecting against.

**So: the scout drags during the fifteen seconds, and then gets a correction pass
before submitting.**

1. **Live capture gets the shape.** Tracking one robot with a thumb is a pursuit
   task, which people are reasonably good at, and it is a different task from
   filling in a form. It will lag by a couple of hundred milliseconds and it will
   be approximate. Decision 2's sample rate already assumes that.
2. **The correction pass is where accuracy is bought.** Auto ends, the recording
   stops, and the scout can scrub the track, drag a misplaced segment, or trim an
   action interval that started late. This is the part that runs with no clock
   pressure, and it is the part the original objection was actually asking for.
3. **Every mark is undoable and the whole thing is skippable.** A scout who could
   not track must be able to record nothing, or to record the start position
   alone — see Decision 4. A required field here would manufacture false data at
   exactly the moment the real data was unavailable.
4. **Targets are thumb-sized.** The three action buttons are `--tap-min` at
   minimum and sit under the thumb of whichever hand holds the phone, which is
   why the plan makes the rail side-swappable.
5. **Recording takes the whole screen.** The field cannot share a phone with a
   form: fifteen seconds of thumb-tracking is the input everything else rests on,
   and inline it was happening on a 358px picture. Full screen is entered
   automatically when recording starts rather than offered as a setting, because
   a scout about to watch a match will not go looking for one.
6. **And there are keys, for the half of the team on a laptop.** A/S/D under the
   resting left hand while the right drags. `keydown` repeats are guarded — a held
   key fires over and over, and each one would open an interval the single
   `keyup` cannot close — and a window blur closes everything still held, because
   a key held when focus leaves never sends its release.

**The correction pass and the manager's replay are the same renderer.** That is
not a coincidence to exploit later; it is the reason both can be in one release.
A track that can be scrubbed and played by its own scout is already the component
the eagle's-eye view needs.

## Decision 7 — Orientation and handedness are display state

The plan asks for two toggles: alliance side on the left or the right, and the
action rail on the left or the right. Both are **device preferences**, and
neither touches a stored coordinate — that is what Decision 1's field-absolute
storage buys.

**Turning the view around is a ROTATION, not a mirror**, and that distinction is
load-bearing. The first implementation mirrored the across-field axis, which
swapped the Left and Right bands and left the alliance wall exactly where it
was: the wrong axis, applied consistently, so every layer agreed with every
other and none of it was what the scout asked for. Mirroring the long axis
instead would move the wall and *reverse* the scout's left and right, because a
reflection changes handedness — worse, because the labels would still look
deliberate. Turning 180° moves the wall and keeps Left on the left, which is
what physically happens when you walk to the other end of the field.

**A quarter turn is a third view state, and it is about the device rather than
the field.** The field is half again as wide as it is tall, so on a phone held
upright the picture is width-bound and most of the screen is empty. Standing it
on end puts the field's long axis down the phone's long axis. Measured: 2.5× the
area to aim a thumb at.

`toScreen`/`fromScreen` in `field.js` own all three, and `fromScreen` is written
out rather than reusing `toScreen` — a quarter turn is **not** self-inverse, and
assuming it was would land the robot a quarter of the field from the thumb in the
one mode that exists to make the thumb more accurate.

The same applies to **start position classification.** "Behind the hub is Middle"
is stated from the perspective of a member of that team, so the classifier is
alliance-relative and therefore a display-time function over field-absolute
data, versioned with the season like the rest of Decision 5. Storing the label
instead of deriving it would freeze one season's vocabulary into every old row.

## Decision 8 — The replay is a reconstruction, and says so

Six scouts start their recordings at six slightly different moments. `t = 0` is
when *that scout* pressed record, not when auto started, and there is no shared
clock to fix it — a gym has no signal, which is the premise of the whole app.

**So tracks from different scouts are not time-aligned, and playing them together
without saying so would be a lie told in a convincing format.** The plan's
eagle's-eye replay is the one feature where this matters, and it is the thing
most likely to be trusted more than it deserves.

Three parts to the answer:

1. **Align on first movement**, not on `t = 0` — the first sample where position
   changes beyond a threshold. Robots start on a shared cue even when scouts do
   not, so this recovers most of the offset for free.
2. **Let the manager nudge.** A per-track offset in the replay, because the
   heuristic will be wrong sometimes and the person watching can see it.
3. **Say it on the screen.** The replay is labelled as a reconstruction from
   independent recordings. It is not footage, and one sentence prevents it being
   read as though it were.

## Decision 9 — Aggregation is the feature, not the drawing

Recording paths is worthless until they answer a question a manager asks. In
order of how often they get asked:

- **Start position frequency.** "Where does 254 line up?" — a histogram over
  `start`, cheap, immediately useful for predicting field conflicts with your own
  robot, and answerable from a start-only record.
- **Scoring location heat map**, per team, over `score` intervals sampled against
  the position track.
- **Cycle statistics.** Seconds spent scoring, seconds spent collecting, and the
  count of complete collect→score cycles. These come from Decision 2's intervals
  and need no geometry at all.
- **Route clustering.** The plan's "find similar auto paths", and the plan is
  also right that it is the hard one.

### How clustering works, since the plan flags it as hard

> *"Turning auto paths into general words would be very difficult."*

It is, if the words have to come from the geometry. They do not.

**Cluster on the route signature first** — the start zone plus the ordered action
sequence, e.g. `Middle → score → collect → score`. That is discrete, cheap,
robust to a shaky thumb, and it is *already how a manager says it out loud*. The
words come from the action sequence, which was recorded as words, so the hard
problem is sidestepped rather than solved.

**Refine geometrically only within a signature group**, where a distance measure
over resampled tracks is comparing like with like and the result means something.
Two routes with different signatures are different routes no matter how close
their curves are.

None of this needs the graph builder. They are fixed views, which is the same
call the coverage page already made and for the same reason.

---

## What this deliberately is not

- **Not teleop tracking.** A full teleop heat map means tracking for two minutes
  fifteen, which no scout sustains across eleven matches. Auto is bounded,
  scripted, and the part teams actually rehearse — the highest-value fifteen
  seconds on the field. Teleop can reuse every decision here if it is ever
  wanted.
- **Not native-dependent.** Pointer events on an SVG are well supported on
  mobile Safari; this needs no app shell, no plugin, and no store review. It was
  checked before scheduling, because "we need the native app first" would have
  parked the most differentiating feature behind an Apple developer waiver.
- **Not a prediction engine.** The plan's future section — predicting which
  combination of paths a team will run, and folding that into match prediction
  with Statbotics — is downstream of having the data and is not in scope here.

## Why this is v0.81

**The original reasoning, for the record.** Not a ranking of ambition: Decision 5
needs a real field image, and a real field image needs a real game — so this
could not be finished, or honestly tested, before kickoff. `docs/adr-003-boards.md`
worked on data the team already had, out of season, so it went first and this was
held for v0.90, to arrive with the field it needed.

**Both halves of that changed on 2026-08-26.** Boards were rejected outright, so
there is nothing for this to queue behind. And the field-image argument was right
about the **2027 season** and wrong about an **offseason event**, which plays the
**2026** game — that field image already exists. The target is the offseason on
10–11 October 2026, which is the last chance to find out what is wrong with a new
input method somewhere it does not cost a real match.

**The match page comes first inside the release**, and the plan says why: a
recorder whose output cannot be played back cannot be verified. See `ROADMAP.md`.

## Open questions

- Whether a scout should be able to record a track for a robot they were not
  assigned. Coverage says no; a scout with spare attention says yes.
- What the `fault` button does to the rest of the form. The plan says pressing it
  prompts an additional malfunction form, and the form already has a `brokeDown`
  boolean and a comments field — so the likely answer is that it jumps there
  rather than adding a fourth place to record the same fact.
- Whether the correction pass should let a scout redraw a segment freehand or
  only drag existing samples. Freehand is better input and a much larger build.
