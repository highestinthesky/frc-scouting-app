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

---

## Where things stood

**v0.80 and v0.81 shipped and deployed, 2026-08-29.** Working tree clean, CI
green, nothing unpushed. Production is at migration `0024`, `AUTH_ENFORCED` is
true, and **no migration was needed for any of v0.81** — the auto recording rides
`entries.observations`, which is already a JSON blob that syncs.

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
  scouts practise on it. It is built from published dimensions rather than
  traced, and the one number that is inferred rather than quoted is the lateral
  TRENCH width — 62.35in derived against 65.65in stated, which is a
  which-face-is-measured difference. Everything in `field.js` is in inches for
  exactly this reason: `158.6` can be checked against a manual and `0.2435`
  cannot.

`docs/adr-003-boards.md` is REJECTED and kept for its decisions.
`docs/auto-scouting-plan.md` is the team's own source document for auto scouting
and is reference, not a draft — where it and `docs/adr-002-spatial-observations.md`
disagree, the plan won, twice.

**Native apps are paused, not cancelled.** Android, iOS, macOS and Windows were
green-lit and then put behind features, deliberately — a rehearsal event wants a
deployment that can be fixed on the Saturday morning, and a native build cannot
be. The plan is recorded under *Deliberately not in v0.8*.
