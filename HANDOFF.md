# Handoff

Written 2026-08-21 after v0.76 shipped. Revised 2026-08-29, after v0.80
and v0.81 shipped and deployed.

**This is not a plan.** `ROADMAP.md` is the only plan document, and the working
agreement says to update it rather than start a second one. This file holds the
things that are true but written down nowhere: how the person running this
project likes to work, environment behaviour that has cost real time, and the
decisions that are open and are theirs to make.

Everything about the *code* lives elsewhere and is current as of this date —
`CLAUDE.md` for invariants and reasoning, `APP_OVERVIEW.md` for the map,
`design.md` for the locked design system, `supabase/README.md` for migrations.
Do not duplicate them here.

---

## How the person running this works

### Codex writes the bulk; you design and review

The explicit instruction:

> "A lot of the brute general structural coding can be done by codex after you
> design it, while you can simply review and edit it once it is outputted."

So for a large, well-specified piece of work: produce the design first — the
decisions, the module shapes, the invariants it must not break — rather than
starting to type the implementation. Expect a full working draft back, and treat
**reviewing that draft as the real task**.

Codex reports back as a summary the user pastes into chat. Do not take it at
face value. The v0.76 username-privacy rollout summary turned out accurate, but
only because every claim in it was checked against the live project first. That
same review found one assertion in Codex's test file that could not fail.

### Do not push unless told to, in this turn

`CLAUDE.md` says it and the nuance matters: **a push deploys to GitHub Pages.**

What changed on 2026-08-29 is the frequency, not the rule. The user now says
"push" fairly often, once the work is verified — but always as an instruction
about the work in front of them, never as standing permission. Commit freely,
then stop and say what is unpushed.

**When you are told to push, run the CI sequence locally first.** `npm ci`,
`npm test`, `npm run check:sql`, and `BASE_PATH="/frc-scouting-app" npm run
build`. `npm ci` is the step that has actually gone red, and it goes red in
fifteen seconds for reasons that have nothing to do with the code. Then watch
the run to completion with `gh run watch` rather than assuming — a green push is
not a green deploy.

### Bug reports arrive terse, batched and numbered

A typical message is seven numbered items with no elaboration. They expect all
of them done, and they notice when one is quietly dropped. If an item turns out
to be a bad idea, say so in a sentence and do the rest — do not silently narrow
the scope.

They also send corrections **mid-turn**, while you are working. Read them and
adjust in the same turn.

### They correct you, and they are usually right

Real examples from the v0.75–v0.76 stretch:

- Under-scoped the graph builder twice; corrected both times with the original
  brief pasted back.
- Claimed `MyTeams` was unreferenced. It is live — `MyAssignments` imports and
  renders it.
- "Fixed the wrong thing" on the Settings page: the complaint was that the
  column was not **centred**, not that it was the wrong width.

Take the correction, verify it, move on. No extended apology, no re-litigating.

### Copy: assume the reader builds robots

A standing instruction, and it is **not** in `design.md`:

> "Remove all of the small descriptions in the website — robotics people are
> tech savvy, and you should assume they know all of this. Remove basically all
> of it."

Applies to any new UI text. Explanatory helper copy under a field, a paragraph
describing what a page is for, a tooltip restating a label — none of it. Labels
and real state only.

### When asked "what is the next step", give a recommendation

Not a survey of options. Pick one, say why, and note what you are not doing.

---

### They report from use, and the reports are precise

The v0.81 feedback was six numbered items, and five of them were things no test
could have found: a toggle that turned the wrong axis, a field too small to aim
at, buttons that clipped, a missing keybind, and a robot that snapped back at the
end of a recording. Each one was correct and each one was specific.

The next round was four, and it held to the pattern. "The coverage page simply
says loading" was one hung network request holding an entirely local page
hostage. "Enter is extremely awkward on desktop" was a key across the keyboard
from the one hand that is free. "Mobile has not been tested" produced a
32px button and a label truncated to "Off pa…" inside ten minutes at 375px.

Two habits follow from that:

- **Take a reported symptom literally and go find its mechanism.** "The flip is
  wrong" turned out to be the wrong AXIS — mirrored across the field instead of
  turned end for end — which every layer agreed on, so nothing looked broken.
  "It snaps back at the end" was the scrub head landing at zero, which also made
  the first correction edit sample zero and drag a line across the field.
- **Check the claim against the source, not against the plan.** Asked to
  research the field, the manual contradicted `docs/auto-scouting-plan.md` on
  whether a robot may cross in auto. The plan is the team's document and it wins
  on what they want; the manual wins on what the rules are. Say which is which.

### Research when the answer is a fact, not a preference

Field dimensions, robot size limits and starting rules are all published. Two of
the three answers changed the design once looked up — the field should never
have been cut, and the start is constrained far more tightly than either party
assumed. Guessing at them produced geometry that was wrong in three particulars
and would have taught scouts a field that does not exist.

## Environment behaviour that has cost time

### There is a second `package.json` somewhere

The `4ec49b0` incident: a lockfile-only commit landed that had been generated
against a **different** `package.json` — one with `pako` added and
`fake-indexeddb` and `pg` removed. The manifest itself was never changed, so
only the lock carried the edit, and `npm ci` refused it.

`npm ci` is the **first** step in `deploy.yml`. If a deploy goes red in about
15 seconds at "Install dependencies", this is why, and it has nothing to do with
tests or the build. The repair:

```
npm install --package-lock-only
```

**That environment presumably still exists.** Its next `npm install` re-breaks
the lock the same way. `pako` is imported nowhere in `src/` or `scripts/`.

### Local toolchain

Node v24.14.1, npm 11.11.0. The CI actions were bumped on 2026-08-29 and the
deprecation annotation is gone: `checkout@v5`, `setup-node@v5`,
`setup-python@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`, with the build
itself on Node 22.

**Two things to know before touching that file again.** `node-version` is the
Node the BUILD runs on and has nothing to do with the deprecation annotation —
that is the runtime each action declares in its own `action.yml`, and only a
`uses:` bump moves it. Bumping `node-version` alone was tried and changed
nothing. And `upload-pages-artifact` v4 stopped including dotfiles, so v5 needs
`include-hidden-files: true` or `build/.nojekyll` silently disappears — which
surfaces as `_app/` 404ing on the live site, not as a red run.

### Driving the app in the browser tool

Each of these produced a confident wrong answer or a stall:

- **The pane goes stale and reports `Viewport: 0x0`.** `read_page` returns
  "(empty page)". Call `resize_window` first and confirm the viewport before
  trusting anything you read.
- **Synthetic pointer clicks time out when the pane is hidden.** A scripted
  `document.querySelector('a').click()` still goes through SvelteKit's client
  router — and still fires `afterNavigate` — so it is the reliable way to test
  navigation.
- **`location.href = …` kills the JS context.** The tool errors with "Inspected
  target navigated or closed". Navigate in one call, measure in the next.
- **Svelte 5 binds through delegated listeners.** Setting `.value` on an input
  does *not* update component state. Use the native property setter, then
  `dispatchEvent(new Event('input', { bubbles: true }))`.
- **A hidden pane stops time.** `document.hidden` is usually true, and then
  `setInterval` is throttled hard, `requestAnimationFrame` fires **zero** times
  in 500 ms, and `resize` and `ResizeObserver` do not fire at all. Three separate
  "bugs" this session were this: a recording that ran 52 seconds, a replay that
  would not play, and a field that would not re-orient. Before concluding the app
  is wrong, dispatch the event by hand — if the handler works, the app is fine
  and the pane is asleep.
- **HMR leaves component state behind.** Editing a component mid-session leaves
  the old instance's state in place, so a `$state` that should have re-derived
  has not. `location.reload()` before measuring anything that depends on mount.
- **Toggling `data-theme` by hand does not re-resolve a transitioned property.**
  Set the theme through `theme.set()` and reload. This produced a convincing
  2.08 contrast failure that did not exist.

### The sync tick overwrites what you set

`session.update({ overrides: [...] })` is silently reverted within about three
seconds: the sync layer pulls the (empty) override set from the local database
and writes it back. To exercise override behaviour, assign `session.overrides`
directly on the reactive object and read the DOM immediately.

### Local stack, in practice

`supabase start`, then `node scripts/seed_demo.mjs`, then write `.env.local`
(the recipe is in `CLAUDE.md`), then `npm run dev`. **Delete `.env.local` when
finished** — the build silently produces a bundle pointed at a laptop otherwise.

Seed accounts, all password `demo-password`:

    boss@demo.invalid    manager
    ada@demo.invalid     scout
    rey@demo.invalid     scout
    event 2026onsum      all three are members

Signing in through the UI needs a real password field, so from a browser tool it
is easier to call `getAuthClient().auth.signInWithPassword(...)` in the console.
The seed publishes no TBA schedule — write one into
`settings['tba-schedule:<event>']` if you need to exercise anything match-based.

**Docker stops on its own, mid-session.** It went down between two browser
checks on 2026-08-29 and the only symptom was `Failed to fetch` on sign-in. Worse,
the `.env.local` recipe reads the anon key from `supabase status`, so writing it
while the daemon is down produces a file with an **empty key** and the app fails
the same way for a second reason. Check the key is ~150 characters, not zero.

The user has granted permission to start Docker more than once, but ask rather
than assume it carries forward.

### Production data moves while you query it

An assignments audit returned "17 of 51 have no account, 3 distinct names", and
the identical query moments later returned "0 of 51, 6 distinct names". Someone
was running auto-assign at the time. The first read was a real snapshot of an
in-flight state, not a bug.

**Re-run before reporting a finding about live data**, and prefer one statement
over several — a `count(*) FILTER` across a single query cannot disagree with
itself the way two sequential queries can.

---

## Open decisions — the user's to make

None of these are bugs to go and fix unasked. Each has more than one defensible
answer.

1. **A scout on two events is stranded.** `currentEvent()` returns `null` for
   two or more undated events, and nothing in the app ever sets `starts_on` —
   `createEvent({code, name})` never passes dates. Scouts have no picker since
   v0.75, so they see "A manager puts you on an event" when a manager already
   has. Two fixes: collect dates at creation (TBA knows them), or give the scout
   a picker when auto-selection cannot decide. The picker is worth having either
   way — returning `null` is only safe when the caller can recover. Currently
   nobody is affected; it is one drag-and-drop in Studio away.

2. **`supabase/rollout/revoke_email_for_username.sql` is deliberately unapplied.**
   It closes the anon email lookup. Run it only after the deployed PWA has
   soaked, because a service worker can serve a pre-v0.76 bundle for a long time
   and those clients still use the old path. It stays out of `migrations/` so
   `db push` cannot fire it early.

3. **The `/accounts` and `/insights/*` redirect stubs.** Kept so an installed
   PWA holding a pre-v0.73 bundle does not 404 mid-event. Retiring them is a
   judgment about whether that window has closed — not tidiness.

4. **Leaked-password protection is OFF** in the Supabase dashboard. Only the
   user can change it, and it is worth doing before more accounts are handed out.

5. **Studio is per-event and they dislike it.** "I dislike how inconvenient it
   is for users to have to choose an event, and then there is a custom studio for
   each of them." No decision was reached. A Studio-level event switcher was the
   suggestion.

6. **Four accounts still hold `@scout.invalid` addresses** from before `0016`.
   They sign in normally and can never receive recovery mail; resetting one is a
   manual admin job. This is also a second, still-live reason Confirm email must
   stay OFF.

7. **The field is drawn whole, and that costs screen.** The manual has no rule
   confining a robot to its own half in auto, so drawing it cut would have had
   nowhere to put a robot that crossed. The price is a 2.05 aspect instead of
   1.55 — on a portrait phone the rotated field is 327×669 rather than 366×566,
   about a quarter less area for the same fifteen seconds. If their scouts never
   see a robot cross, cutting it back is one line in `DRAWN`. It is a trade
   between correctness and precision and it is theirs.

8. **G303-E is deliberately not enforced.** A robot may not start touching a
   BUMP, and the lateral BUMP extents in `field.js` are *derived* from a width
   that sums rather than measured off a drawing. Hard-blocking a placement on an
   inferred number would fight a scout who watched a robot start somewhere the
   file is wrong about. If someone measures the real extents off the field
   drawings, enforcing it becomes reasonable.

9. **The scoring heat map is designed and not built** (ADR-002 Decision 9). It
   was deferred first because the geometry was a guess; the geometry is real now,
   so the remaining reason is that a heat map wants more than a handful of
   recordings before it says anything. The honest time to build it is after the
   offseason has produced some.

10. **The recorder has never been used by a scout.** Every verification of it is
    synthetic pointer events driven from a console. It has not been held in one
    hand, in a gym, for fifteen real seconds, and that is the only test that
    matters for an input method. This is the reason v0.81 was scheduled early.

    It has now been driven end to end on the **built** bundle at 375x812 —
    signed in, placed, started with space, recorded, saved, and confirmed in
    Postgres with a 400-character track. That is the deployed artifact rather
    than the dev server, which is a different claim from before. It is still not
    a thumb.

11. **The alliance bands are nearly invisible on both themes, deliberately.**
    Measured: 1.26 against the carpet on light, 1.28/1.33 on dark, and own
    against opponent is 1.00 on light and 1.04 on dark — the two ends differ in
    hue and not at all in luminance. The comment says tint-not-fill so the BUMPs
    read through, and the two themes agree, so this is a design choice and not a
    light-theme regression. Worth knowing before someone "fixes" one theme and
    breaks the pair. If it turns out a scout cannot find their end at a glance,
    the answer is a stroke or a label, not more opacity.

### The v0.81.2 pass

- **The alliance bands were inverted for every blue scout.** The tint was keyed
  on the end's relationship to the SCOUT (`own` / `opp`) while the stylesheet
  painted `own` red and `opp` blue. Those agree only for a red scout; a blue one
  got their own end red and the opponent's blue — both wrong, on the one graphic
  whose entire job is saying which end is which, and it looked deliberate.
  An end's colour is a fact about the field, so it is now `near → red, far →
  blue` from `field.js`'s own convention, unconditionally. `AutoField` no longer
  takes an `allianceColor`: where a robot may START is alliance-dependent and
  belongs to `clampToStart()`, and leaving the prop in place would invite the
  same mistake back.

- **The match page was linked from nowhere.** `/studio/[eventCode]/q[n]` shipped
  with the replay in it and the only inbound links were its own prev/next pager
  — which needs you to already be there. It was reachable by typing the URL and
  no other way, so nobody had it. Now linked from Schedule (the complete index)
  and from Coverage's Gaps rows. Coverage alone is not enough: that list holds
  only matches with gaps, so a fully-covered match never appears there.

  Worth a habit: when a route is added, add the link in the same commit. Grep
  `href=.*<route>` before calling a page done.

- **The replay needs one track, not six.** `{#if withTracks.length}` — the panel
  renders whatever exists and says "N of 6 robots were tracked". Verified with 2
  of 6.

### The v0.81.3 pass — the field says what, not just whether

Asked for: *"whenever a robot is performing an action, they should have an icon
on them displaying collecting, shooting, or anything else."*

The action state was already plumbed to the renderer and simply not drawn.
Replay put a stroke round the rect, the recorder put a pulse behind it, and both
said only THAT something was happening. `badges()` in `AutoField` now lays a row
of chips above the robot, driven by `active` in record mode and `actionsAt()` in
replay — the same data, one renderer, both surfaces.

Four things worth keeping:

- **Above the robot, never on it.** The rect's colour carries the alliance, its
  middle carries the team number, and its POSITION is the recorded data. Nothing
  may sit on the position.
- **Sized for the phone, which is the tightest case.** Full screen and turned a
  quarter, the field draws at ~0.62 screen px per viewBox unit; a radius of 15
  was a 19px disc holding a 9px glyph — present and unreadable. 20 measures 25px
  on a 375px phone, confirmed in the running app.
- **Clamped back on-canvas.** A robot against the top wall — which is most of a
  start position on a rotated phone — would have put the row at cy = -24 and
  simply lost it, and a chip that vanishes reads as an action that stopped. It
  flips below, and the row is kept inside the sides too because two chips are
  wider than the robot.
- **Colour is the second signal.** Collect and score are a mirrored pair of
  arrows; at fifteen pixels a reversal reads and a hue does not.

The contrast work found one real thing. The chip's disc is `--bg-card` on a
`--bg-subtle` carpet — 1.08 apart in dark — so its EDGE is the entire boundary,
and that ground had never been measured. Pinning `--border-strong` against it
failed at **2.97 in the light scout palette**, under the 3.0 floor. The edge
moved to `--text-faint`, which the field's other outlines already use and which
is pinned at 4.5 against exactly that ground; the speculative pair came back out
of the table, because nothing renders it any more and an assertion no surface
backs would demand a palette change for a pairing that does not exist. The
2.97 is still true and still latent — if anything ever draws a strong border on
a subtle fill, measure it first.

### The v0.81.4/.5 pass — seven reports from use

Five about the recorder's layout, two about the field itself. The layout five
are in the v0.81.4 commit message; the two worth carrying forward:

- **A start could land in the neutral zone, in front of the hub.**
  `clampToStart()` clamped x into the legal band and then handed the result to
  `clampToField()`, whose obstacle escape is free in EITHER axis. The HUB is a
  47in square centred on the starting line, so the middle of the field is inside
  it — and the cheapest way out was often along x, straight off the line. 391 of
  3721 placements, up to 23.5in.

  It resolves along the line now. The general lesson is the one already in
  `clampToField`'s own comment, in a second costume: **a resolution that is free
  to move on an axis another rule has already fixed will use it.**

  The existing test `a start cannot be inside the HUB` was green throughout,
  because it passes if EITHER axis clears the hub — which escaping along x does.
  It is the right assertion for its own question and the wrong one for the rule,
  so the rule is now swept separately over a 61x61 grid per alliance.

- **The grey line down the blue end was the cut edge.** `DRAWN` has been the
  whole field since v0.81; the `.cut` line at `u=1` was left behind and drew
  `--text-faint` down the far wall. Removed, along with two comments that still
  described the far HUB as "a half square" straddling a cut that no longer
  exists.

### The v0.81.6 pass

- **The start zone is the ALLIANCE ZONE, not the starting line.** The line was my
  reading of G303-D and it made a placement the team actually sees — behind the
  hub — impossible to record. The principle that settles it was already written
  in `field.js` about rule point E and just needed generalising: **a recording
  aid is not a referee.** Rule out what could not have happened; do not enforce a
  rule the app has only inferred.

- **A climb ends the auto run.** `press('climb')` opens a mark that `release`
  does not close — it runs to the whistle. Two reasons, and the second is the
  one that would have bitten: it frees the scout's hands for the questions, and
  `encodeTrack` drops any interval with `t1 <= t0`, so a climb that ended the
  recording the instant it began would have been silently thrown away. The one
  action the scout most wants recorded, discarded for being instantaneous.

  The sheet takes the screen because there is nothing left on the field to
  watch. Both answers are three-state: `ok` is `true`/`false`/ABSENT, and
  `cycleStats.climbOk` returns null rather than false for an unjudged climb —
  the same blank-is-not-zero line the rest of the app holds.

- **The 7% mobile reflow was one wrapped button.** At 375px the place row
  measured 149 + 106 + 145 against 351, so "Exit full screen" wrapped and the
  controls block was a row taller before the whistle than during it. The visible
  label is "Exit" now (the full phrase is the accessible name) and `.say`
  reserves its own tallest state. Both phases are 82px, and the field is 623 in
  both — bigger than the 581 it used to be while placing, so nothing was traded
  for it.

- **Robots stopped fading a fraction of a second early.** Alignment is on first
  movement, so tracks end up to a second apart for scout-timing reasons.
  `DONE_GRACE_MS` is 1s. Verified both ways: three tracks ending 0.3s and 0.6s
  apart never fade, and an 8s track among 14.5s ones still fades — at 9.6s, not
  8.0s.

**The action glyphs are about to be replaced.** They are a single `GLYPH` map of
SVG path strings in `AutoField`, drawn in a local box of roughly +/-8 around the
chip's centre, stroked not filled. Swapping them is a one-place change; keep the
stroke widths, since they are what makes the glyph legible at 25px on a phone.

---

## Where things stood

**Production is at migration `0025`** (applied 2026-09-01), which is
`correct_entry_track()` — a manager correcting a scout's recording. It grants
nothing: `entries_evt_update` already permitted `manages_event()`. It NARROWS,
by merging one key server-side instead of writing the whole observations blob
from a possibly-stale copy.

**v0.80 and v0.81 shipped and deployed, 2026-08-29.** `AUTH_ENFORCED` is true,
and **no migration was needed for the recording itself** — the auto track rides
`entries.observations`, which is already a JSON blob that syncs. `0025` came
later and is about who may correct one, not about storing it.

### The v0.81.1 pass — four reports, and what each turned out to be

- **The scout can no longer drag after the whistle.** ADR-002 Decision 6 had the
  correction pass letting them scrub back and move the robot, described as
  "where accuracy is bought". It is not: a position dragged in from memory is,
  once stored, byte-for-byte a position observed at 10 Hz, and nothing
  downstream can tell them apart. `AutoField` takes a drag in `record` mode
  only; the third mode is `review` now, not `correct`, because it corrects
  nothing. Scrub, trim, set a rung, flip end for end and record again all
  survive — none of them invents a point. The ADR carries the reversal.
- **Coverage was frozen on "Loading…" by a duplicate key, not by the network.**
  Worth reading in full, because the first diagnosis was confidently wrong.

  The reported symptom was "simply says loading and never shows statistics". The
  first pass found that entries and the cached schedule are IndexedDB while only
  the roster needs Supabase, and that all three shared one `loading` flag — so a
  hung request held the whole page. That is real, it was fixed, and **it was not
  what the user was seeing.**

  The actual cause only appeared against production's own data. A published
  schedule is the RAW TBA payload, playoffs included: 68 quals, 13 semifinals,
  2 finals. Every other consumer of the cache calls `qualMatches()`; coverage
  read `cached.matches` straight, in a variable named `qmList`. Playoff
  numbering restarts, so thirteen semifinals all carry `match_number` 1 — and
  the Gaps table is a KEYED `{#each}` on that number. Svelte throws
  `each_key_duplicate`, which **aborts the render**, and an aborted render
  leaves the DOM showing whatever it painted last. On this page that is the
  "Loading…" paragraph. A spinner that is not a spinner: the page had already
  finished loading and simply could not paint.

  Two fixes, and both belong: `qualMatches()` makes the numbers right, and the
  `{#each}` is keyed on TBA's own `match.key` (`2026nyny_sf10m1` — the SET
  number is what makes it unique) so a stray non-qual is never again fatal.

  Measured on production's data before the fix: **three entries reported as five
  robot-matches recorded**, 83 matches counted as the event, and the Gaps list
  showing "Q1" three times, twice for semifinals.

  The lesson is the one already in this file, and it still cost a wrong answer:
  **a symptom reproduced is not a symptom explained.** The stubbed-fetch
  repro produced the right words on screen from the wrong mechanism, and it was
  only running the real functions over the real payload that found the truth.
  Reach for production's actual data early — `schedules` is one row and it is
  the whole story.

  Two smaller things fell out of the same pass: supabase-js **retries** a
  rejected fetch rather than surfacing it (three attempts and still going at
  4.8s), so the roster panel has a patience timer; and `session.eventCode` was
  read after the first `await`, which made the effect dependency-free —
  switching events never reloaded the page.
- **Space starts the recording, not Enter.** Enter is under the hand that is
  about to be on the mouse. It still works natively when the button itself has
  focus, which is the platform's job. `begin()` now clears any live timer, since
  two callers can reach it in one gesture and a leaked interval would fill
  samples at twice the rate with nothing looking wrong.
- **Mobile.** Tested on the built bundle at 375x812, not the dev server. Two
  real defects: `.sp-edit` on the schedule page at `min-height: 1.85rem` (32px,
  12 under the floor design.md calls non-negotiable) and the "Off path" label
  truncating to "Off pa…" — the same bug the label was already shortened once to
  avoid. The label wraps now rather than shrinking, because a control read under
  a fifteen-second clock should not get smaller. `check_components.mjs` gained a
  sweep for the first one: it collects the classes that sit on an interactive tag
  in each file and flags a literal height under 44px. Across all of `src/` it
  finds exactly one thing, which is the one it was written for.

`SCHEMA_VERSION` is **4**. An entry on 3 has no `autoTrack`, and that is not "the
robot did not move": `readTrack()` returns null and every spatial aggregate counts
its own sample size.

### What v0.81 actually is, in one pass

Five modules, in dependency order. The first two are pure and carry the rules:

| | |
|---|---|
| `src/lib/auto-track.js` | the encoding, cycle stats, route signatures. 67 tests |
| `src/lib/field.js` | 2026 REBUILT geometry, alliance-relative zones, collision, the view transforms. 113 tests |
| `components/AutoField.svelte` | one renderer, three modes: record / correct / replay |
| `components/AutoRecorder.svelte` | place → arm → live → correct |
| `components/studio/AutoReplay.svelte` | every recording of a match at once |

And two routes, both event-scoped, both added in step 1 so the recorder had
somewhere to be played back:

    /studio/<eventCode>/q<n>            one match, and the replay
    /studio/<eventCode>/team/<n>        one team, at this event and this season

### Two lessons from adding 0025, both about tests that lie

Mutation testing found both, and neither was visible any other way.

- **`stamp_submitted_by` overwrites `submitted_by` on every INSERT** with
  `auth.uid()`. A raw-SQL fixture carries no JWT, so the column lands **null**
  however explicitly it is passed, and the row belongs to nobody. Two assertions
  were built on such a fixture and neither tested what it was named after.
  Insert fixtures **as the user**, through PostgREST.
- **A PostgREST UPDATE that matches no rows reports SUCCESS.** So `!error` is
  true for a caller who was refused as well as one who was allowed. Assert the
  row **changed**, never the absence of an error.

Both bugs were also present in the pre-existing withdraw block — "a scout can
still correct their own entry" stayed green with every scout UPDATE denied — and
are now repaired there too.

The other half of the discipline: **assert the GRANT separately from the
behaviour.** Granting EXECUTE on the new RPC to `anon` left the behavioural
assertion completely green, because `manages_event()` refuses anon anyway. That
is `0021` exactly — the body being right is what makes the grant look fine.

### The five things most likely to be broken by an innocent change

1. **`t` is derived from a sample's INDEX.** Evenly-spaced samples are the one
   thing the encoding rests on, so the recorder fills forward to
   `performance.now()` rather than counting `setInterval` ticks. Counting ticks
   recorded 52 seconds that would have decoded as 15 seconds of motion at three
   times the true speed, and nothing about the result looks wrong.
2. **Every view transform is a rotation, never a mirror.** `toScreen` /
   `fromScreen` own them. A mirror moves the alliance wall *and* reverses the
   scout's left and right while the labels still look deliberate. `fromScreen` is
   written out rather than reusing `toScreen` because a quarter turn is not
   self-inverse.
3. **Coordinates are fractions of the FULL field**, never the drawn region and
   never alliance-relative. The drawn region has already changed twice; not one
   stored path had to move, and that is Decision 1 paying for itself.
4. **`decodeTrack` refuses a version it does not know.** A future layout decoded
   as this one draws a plausible path in the wrong places, which is worse than a
   gap because a gap is visible.
5. **Blank stays blank, per piece.** Start-only is a real record. `climbLevel` is
   `null` and never `0` — "climbed, rung unknown" and "did not climb" are
   different facts.

### Where v0.8 stands

`ROADMAP.md` enumerates six releases. **v0.80 and v0.81 are done.** Remaining:

- **v0.82 — the comparison pair.** Transpose `compare` so metrics are rows and
  teams are columns. Its old item 6, the pre-match view, moved into v0.81's match
  page; what is left here is that the match page swaps in the transposed table
  once it exists.
- **v0.83 — pit scouting**, as a second section on the team page.
- **v0.84 — the scout's schedule**, the smallest item and the only one that can
  slip without costing anything on the day.
- **v0.85 — the move to `rohawks.org/app`.**

The series targets the offseason on **10–11 October 2026**, and everything in it
is used at an event by someone standing in a gym.

### Two things only the user can do

- **Leaked-password protection is still OFF** in the Supabase dashboard. Worth
  doing before more accounts are handed out.
- **The field geometry should be checked against the real drawings** before
  scouts practise on it. Two numbers in `field.js` are DERIVED rather than
  quoted, and both are flagged in place:

  - **The alliance zone depth is 184in, not the 158.6in the manual states.** The
    manual gives 158.6 twice — as the zone depth and as the wall-to-HUB-centre
    distance — and its own figures then sum to `158.6 + 283 + 158.6 = 600.2`
    against a 651in field, leaving 51 inches nowhere. `(651 - 283) / 2 = 184`
    tiles the field exactly and matches where the HUB bands sit on the team's own
    field image, about 0.282 of the length. If someone works out what the 158.6
    actually measures, `ALLIANCE_ZONE_IN` is the single line to change.
  - **The lateral TRENCH width is 61in derived against 65.65in stated**, which is
    a which-face-is-measured difference. The derived value is used because the
    lateral elements then sum to the field width exactly, and that sum is the
    check that the layout was read correctly.

  Everything in `field.js` is in inches for this reason: `184` can be checked
  against a drawing and `0.2826` cannot.

`docs/adr-003-boards.md` is REJECTED and kept for its decisions.
`docs/auto-scouting-plan.md` is the team's own source document for auto scouting
and is reference, not a draft — where it and `docs/adr-002-spatial-observations.md`
disagree, the plan won, twice.

**Native apps are paused, not cancelled.** Android, iOS, macOS and Windows were
green-lit and then put behind features, deliberately — a rehearsal event wants a
deployment that can be fixed on the Saturday morning, and a native build cannot
be. The plan is recorded under *Deliberately not in v0.8*.
