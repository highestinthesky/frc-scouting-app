# ADR 002 — Spatial observations

Status: **accepted, not implemented** — scheduled for v0.81
Date: 2026-08-18
Rescheduled: 2026-08-26, from v0.90 — see *Why this is v0.81* below.
Depends on: nothing. Deliberately buildable without a native app.

Design record for interactive auto scouting and everything that follows from it.
This is a decision record, not a second plan document — `ROADMAP.md` stays the
single plan and points here.

---

## Context

Every number this app records is a scalar: four counted, three cycles, broke
down. That is what almost every scouting system collects, and it is also what
The Blue Alliance and Statbotics can already derive from match results for free.
A team that records only scalars is doing unpaid work to reproduce a public
dataset slightly worse.

**Where a robot went is not in any public dataset.** Which side of the field it
starts on, which route it takes in auto, where on the field it scores from,
where it gets stuck, which corner it plays defense in — none of that is
recoverable from a score breakdown, and all of it decides alliance selection.
That is the leverage a team's own scouts have, and this app currently throws it
away.

Lovat popularised the interaction: the scout taps a field diagram instead of
filling in a number. The interaction is the easy part. The decisions below are
the parts that are hard to change later.

### The constraint that shapes it

> **A scout is watching the field, not the phone.** Auto is fifteen seconds.

Everything else follows. An input that requires looking at the screen during
auto does not get used, it gets guessed at afterwards — and a guessed path is
worse than no path, because it looks like data.

And the standing one, unchanged:

> **There is no server.** Recording writes to IndexedDB first, always, and this
> must work with no signal.

---

## Decision 1 — Coordinates are normalised and field-absolute

Store `x` and `y` as floats in `0..1`, relative to the **field**, with a fixed
origin: `(0,0)` is the red alliance wall's left corner as drawn on the reference
image, `(1,1)` the far corner.

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

## Decision 2 — A sequence of events, not a path

    observations.autoMap = [
      { t: 0,    x: 0.12, y: 0.44, a: 'start'  },
      { t: 3200, x: 0.31, y: 0.40, a: 'score'  },
      { t: 7800, x: 0.55, y: 0.62, a: 'miss'   },
      { t: 11400, x: 0.48, y: 0.71, a: 'stuck' }
    ]

`t` is milliseconds from the start of the recording, not wall-clock: it survives
a device with a wrong clock, which is the same reason `updated_at` is set by a
trigger rather than by the client.

Actions are a closed set — `start`, `score`, `miss`, `pickup`, `stuck`,
`defense` — versioned with the season alongside `METRIC_FIELDS`, because what a
robot can *do* changes every January and a free-text action would be
unaggregatable within one event.

A polyline of positions was the alternative and is rejected: it captures where
the robot was, which nobody asks, and not what it did there, which is the whole
question. It is also far more data for a worse answer.

## Decision 3 — It rides `observations`, so there is no migration

`entries.observations` is already a JSON blob that syncs. A new key inside it
needs **no schema change, no migration, and no new RLS policy**, and it inherits
the existing dedupe fingerprint and watermark sync unchanged.

The key is `autoMap`. Deliberately not `autoPathing` — that key already exists
as a free-text autocomplete field and is displayed on the team page. Two
concepts must not share a name; that is the mistake `scout-identity.js` exists
to have already fixed once.

`SCHEMA_VERSION` goes 3 → 4 when this ships.

## Decision 4 — Blank stays blank

**No map recorded is not "the robot did not move."**

This is the app's oldest invariant and it extends here without amendment: an
entry from before v0.80, or from a scout who did not have time, must contribute
*nothing* to a heat map rather than contributing an empty field. `readMetric()`
returns `null` for absent scalars; the spatial reader must return `null` for an
absent map, and every aggregate must count its own sample size.

The failure this prevents is specific and would be invisible: a heat map that
silently averages in fifty empty auto routines looks like a team that does
nothing in auto, and it looks exactly like real data.

## Decision 5 — The field image is season data, not an asset

One SVG per season, checked in beside `METRIC_FIELDS`, with its own version. The
January retune ritual gains a step: update the image, update the action set, bump
`SCHEMA_VERSION`.

SVG rather than a bitmap: it scales to any phone without a second file, it is a
few KB in a bundle that has to work offline, and the tap regions can be derived
from it rather than maintained as a parallel list of rectangles that drifts.

Because coordinates are normalised, **a new image does not invalidate old data**
— last season's paths still plot, on last season's image, at the same relative
positions.

## Decision 6 — The input has to work without looking

Three rules, in priority order:

1. **Marking happens after auto ends, not during.** The realistic flow is: watch
   the fifteen seconds, then tap what happened while it is fresh. Anything that
   demands attention during auto competes with the job.
2. **Targets are thumb-sized**, `--tap-min` at minimum, on a field that is at
   most a few tap regions wide. A pixel-accurate tap is not achievable one-handed
   in a gym and should not be asked for.
3. **Every mark is undoable and the whole thing is skippable.** A scout who
   cannot remember must be able to record nothing — see Decision 4. A required
   field here would manufacture false data at exactly the moment the real data
   was unavailable.

## Decision 7 — Aggregation is the feature, not the drawing

Recording paths is worthless until they answer a question a manager asks. Three,
in order of how often they get asked:

- **Start position frequency.** "Where does 254 line up?" — a histogram over
  `start` marks. Cheap, and immediately useful for predicting field conflicts
  with your own robot.
- **Scoring location heat map**, per team, over `score` marks.
- **Route consistency.** A team whose auto varies every match is a different
  alliance risk from one that does the same thing eleven times, and that is the
  same argument the existing standard-deviation consistency signal already makes
  for scalars.

None of these needs the graph builder. They are three fixed views, which is the
same call the coverage page already made and for the same reason.

---

## What this deliberately is not

- **Not teleop tracking.** A full teleop heat map means marking for two minutes
  fifteen, which no scout sustains across eleven matches. Auto is bounded,
  scripted, and the part teams actually rehearse — the highest-value fifteen
  seconds on the field. Teleop can reuse every decision here if it is ever
  wanted.
- **Not a replay.** Storing enough to animate the robot is a different data
  volume and answers a question nobody asks twice.
- **Not native-dependent.** Pointer events on an SVG are well supported on
  mobile Safari; this needs no app shell, no plugin, and no store review. It was
  checked before scheduling, because "we need the native app first" would have
  parked the most differentiating feature behind an Apple developer waiver.

## Why this is v0.81

**The original reasoning, for the record.** Not a ranking of ambition: Decision 5
needs a real field image, and a real field image needs a real game — so this
could not be finished, or honestly tested, before kickoff. `docs/adr-003-boards.md`
worked on data the team already had, out of season, so it went first and this was
held for v0.90, to arrive with the field it needed.

**Both halves of that changed on 2026-08-26.** Boards were rejected outright, so
there is nothing for this to queue behind. And the field-image argument was right
about the **2027 season** and wrong about an **offseason event**, which plays the
**2026** game — that field image already exists. The target is now the offseason
on 10–11 October 2026, which is the last chance to find out what is wrong with a
new input method somewhere it does not cost a real match.

The field image itself becomes season data, retuned every January alongside
`METRIC_FIELDS`, rather than a reason to delay the feature.

## Open questions

- Whether `defense` marks belong here or stay on the existing defense field.
  They are spatial, but they are a teleop concept, and Decision "not teleop"
  cuts against it.
- Whether a scout should be able to mark a path for a robot they were not
  assigned. Coverage says no; a scout with spare attention says yes.
