# Handoff

Written 2026-08-21, after v0.76 shipped.

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

### Never push

`CLAUDE.md` says it, and the nuance matters: **a push deploys to GitHub Pages.**
The user has overridden this twice for a specific commit, never as a general
permission. Commit freely, then stop and say what is unpushed.

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

Node v24.14.1, npm 11.11.0. The CI actions target Node 20 and GitHub force-runs
them on Node 24 — a warning on every run, not yet a failure. `checkout@v4`,
`setup-node@v4`, `setup-python@v5`, `upload-pages-artifact@v3`,
`deploy-pages@v4` will all need bumping eventually.

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

Docker was not running at the start of this session; the user granted permission
to start it. Ask before assuming that permission carries forward.

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

---

## Where things stood

v0.76 shipped and deployed 2026-08-20. Production is at migration `0024`,
`AUTH_ENFORCED` is true, and the `username-sign-in` Edge Function is live and
smoke-tested. Working tree clean, nothing unpushed, CI green.

Measured on production 2026-08-20, so re-verify rather than trust: 6 auth users,
2 events (both undated), 51 assignments all carrying a `profile_id`, 218
overrides all valid and scoped to members of their event.

The next planned work is **v0.8 — the event series**, enumerated in `ROADMAP.md`
as six releases: the visual audit and box model (v0.80), interactive auto
scouting (v0.81), the comparison pair (v0.82), pit scouting and the team profile
(v0.83), the scout's schedule (v0.84) and the move to `rohawks.org/app` (v0.85).
Everything in it is used at an event, and it targets the offseason on 10–11
October 2026.

`docs/adr-003-boards.md` is marked REJECTED and kept for its decisions.
`docs/adr-002-spatial-observations.md` moved from v0.90 to v0.81 on 2026-08-26:
it needs a real field image, and an offseason event plays the 2026 game, so that
image already exists.

**Native apps are paused, not cancelled.** Android, iOS, macOS and Windows were
green-lit and then put behind features, deliberately — a rehearsal event wants a
deployment that can be fixed on the Saturday morning, and a native build cannot
be. The plan is recorded under *Deliberately not in v0.8*.
