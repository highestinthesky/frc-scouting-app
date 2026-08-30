# FRC Scout — consolidated roadmap

This is the single planning document. Older improvement drafts and handoff
documents were folded into it; update this file instead of starting another
plan.

Last audited: 2026-08-26. Planning **v0.8 — the event series**; see below.

> **Live state is maintained in `CLAUDE.md`, not here.** A plan document and a
> state document drift apart, and this file has already carried a "live state"
> block that stayed frozen at 2026-08-07 through nine migrations and two whole
> releases, asserting a passphrase that no longer exists.
>
> In short, as of 2026-08-26: production is at migration `0024`, `AUTH_ENFORCED`
> is `true`, events are real rows with membership deciding access, and v0.76 is
> shipped. One commit is unpushed.

## Where the app is now

| Area | Current state |
|---|---|
| Offline scouting and sync | Shipped; IndexedDB remains the write target and edits sync via `updated_at` |
| Schedule, assignments and coverage | Shipped; auto-assign uses DSATUR, with overrides and reminders in Studio |
| Metrics and manager analysis | Shipped across Insights, team detail, compare, CSV and picklist scoring |
| Picklist and alliance selection | Shipped; cloud-synced picklist and live taken-team state |
| Accounts and roles | Shipped; manager-created accounts and invite codes, three roles enforced in RLS |
| Studio | Shipped in v0.73–v0.74 — Event, Schedule, Coverage, Insights, Accounts, with its own two palettes |
| What a scout sees at an event | Shipped in v0.76 — but the event's full schedule is still missing (v0.84) |
| What is on the screen | Reported broken in places: black on black, clipping buttons (v0.80) |
| Interactive auto scouting | Shipped in v0.81 — record, correct, replay, and route clustering. Field geometry is a placeholder |
| What happened in one match | No route for it at all; the replay needs one (v0.81 step 1) |
| Pre-match view | Not built — moved into v0.81's match page |
| Pit scouting and the team profile | Not built (v0.83) |
| Native apps | Paused — see *Deliberately not in v0.8* |

**The production model is no longer hybrid.** `0020` dropped `session_id` from
all eight tables along with 29 policies, `has_manager_token()` and the
passphrase:

- **An event is a row.** `events.id` scopes every shared table via `event_id`,
  and `event_scouts` decides who may see it.
- **The event code is a label, not a credential** — it is published on The Blue
  Alliance. `eventIdForCode()` is the only resolver, and it needs a session,
  which is what makes "record but do not sync" fall out of the schema.
- **Recording never depends on auth.** IndexedDB accepts entries offline and
  sync waits for a session.
- **Roles live on `profiles.role`**, enforced in Postgres RLS, with
  `manages_event()` as the one predicate.

## v0.8 — the event series

Enumerated in full before any of it ships, per the working agreement. The 7
series closed with v0.76, so this is where the numbers resume.

**The charter: everything here is used *at* an event, by someone standing in a
gym.** That is what decides both what is in the series and the order it lands
in. A feature that is only interesting on a laptop at home is not in v0.8.

**The target is the offseason event on 10–11 October 2026.** It is a rehearsal,
and the point of a rehearsal is to find out what is broken — which is also the
reason this series stays on the web. When a scout finds a bug on the Saturday
morning, a push fixes it and they reload. Inside a native build the same fix
waits on App Review. The web is not the fallback for a shakedown event; it is
the correct answer.

**Native is paused, not cancelled** — see *Deliberately not in v0.8* below.

### v0.80 — what is actually on the screen ✅ audited and fixed 2026-08-27

Reported by the person running the team: black text on a black ground in places,
and buttons clipping into each other. That is on a codebase with 170 contrast
assertions and a component checker, which makes the gap between them the real
finding.

**The audit.** 48 route-renders — 12 routes × scout/Studio light and dark × 375px
and 1280px — driven in the running app against a seeded local stack with 36
entries, 8 teams and a 24-match schedule. Contrast and geometry measured
computationally rather than by eye, because `#0a0a0a` on `#000` is not something a
screenshot settles.

Two traps caught it on the way, both already written down in `CLAUDE.md` and both
worth the warning: the first sweep ran at a **zero-width viewport**, where every
element overflows its parent and every number is an artifact; and a later reading
of `data-studio` leaking onto scout routes turned out to be a stale async loop in
the harness, not the app.

#### What was actually wrong

1. **Every unselected pill was black on near-black in dark mode** —
   `Field.svelte`. Contrast **1.21** against a 4.5 floor, on `/scouting/new/`,
   which is the most-used screen in the app.

   `.pill` sets `font: inherit` and never sets `color` — and `font` does not carry
   colour, so a `<button>` keeps the user agent's `color: buttontext`, which is
   black in every theme. Measured rather than inferred: the pill's parent computed
   to `rgb(232,232,232)` while the pill computed to `rgb(0,0,0)`, so it was not
   inheriting at all. The `.selected` rules below it set colours carefully — the
   comment there is about getting dark mode right — and the default state was
   simply never given one. In light mode black on a light card looks deliberate,
   which is why it survived. Now `--text-primary`, which is a pair the contrast
   check already measures in all four palettes.

2. **`/studio/schedule/` put content off the right edge, unreachably.**
   `repeat(auto-fit, minmax(24rem, 1fr))` is a 384px floor inside a 343px
   container. Measured: 41px lost, and the document does not scroll sideways, so
   the TBA event key field, the code/key row and the API key field were cut off
   rather than reachable. `/studio/coverage/` had the same bug at 22rem, 9px.

   Fixed with `minmax(min(24rem, 100%), 1fr)`, which is the shape
   `check_components.mjs` already names in its own comment as the valid CSS its
   stripper must not false-flag. Applied to **all seven** `auto-fit` tracks, not
   the two that overflowed — the other five are safe only because 16rem happens to
   fit today, and v0.72 set the precedent by fixing eleven bare `1fr` tracks
   rather than the one that was noticed.

3. **Six tap targets under 44px on `/studio/schedule/`**, in both themes. Worst
   was a borderless `✕` at **18×20**. Two `✕` buttons had horizontal padding and
   nothing else; four inputs sat at 37px because padding set their height and
   nothing held the floor.

#### Why the checks did not catch any of it

- **`check_contrast.mjs` structurally cannot see the pill.** It compares token
  *pairings*. The pill's foreground was not a token — it was a UA keyword. There
  was no pair to look up. The check is not wrong; it was answering a different
  question than the one being asked.
- **`check_components.mjs` pins `min-height: var(--tap-min)` on `Dialog` and
  `Button` only.** The `✕` buttons live in schedule components, entirely outside
  its coverage.
- Neither reads a rendered page, so a grid floor wider than the viewport is
  invisible to both.

**Nine control rules set padding with no height floor.** Eight of them measure
at or above 44px today and were left alone; only `PublishSchedule` actually fell
short. That is a latent class rather than a bug list, and it is the argument for
a check — but a check that cannot compute rendered height would have to guess,
and a false failure on correct CSS is worse than a missing one. Left as a
recorded risk.

#### Two corrections to what this section originally said

- **The box-sizing hypothesis was wrong.** The clipping was predicted to be the
  missing `box-sizing` reset. It is not — every clipping element computes
  `border-box`. The cause was grid track floors in `rem` exceeding a phone's
  content width. The global box-sizing change fixes nothing that was reported and
  is **not** part of this release; it stays the separate release `CLAUDE.md`
  already calls it.
- **Two measured overflows are deliberate and were left.** `.start` in
  `EventPicker` and `.entry-link` on `/scouting/` each carry a negative margin
  that exactly cancels their own padding, so a borderless control's label lines
  up with the text above it. Both are optical alignment, documented in place.

#### After

48 route-renders re-audited at both widths: **0 contrast failures, 0 tap targets
under 44px, 0 horizontal document scroll**, and the only geometry findings left
are the two deliberate negative margins above. `npm test` green, 170 contrast
assertions included.

**This release still goes first**, though not for the reason originally given.
Not the box model — it is that the audit is what tells the next four releases
what "correct" looks like on a phone, and building four new surfaces on top of
unmeasured ground is how the same class comes back.

### v0.81 — interactive auto scouting

`docs/auto-scouting-plan.md` is the source document; `docs/adr-002-spatial-observations.md`
is how it resolves into a data format and a screen. A scout drags the robot they
are watching around a picture of the field while holding action buttons, and the
aggregation across many scouts is the feature.

**The ADR was rewritten on 2026-08-29 to match the plan.** Its first draft was
written without the plan document and contradicted it on three load-bearing
points — a dragged path, recording during auto, and the replay. Two of the three
were wrong on the facts rather than merely outvoted, so the ADR changed. It is
worth reading its *What changed in the revision* section before building any of
this, because the superseded design is the one that sounds more cautious.

**This release lands in two steps, and step 1 ships and gets used first.**

#### Step 1 — the match page ✅ shipped 2026-08-29

`/studio/[eventCode]/q[matchNumber]`, e.g. `/studio/2026onsum/q12`. Nothing in the app answers *"what happened in
match 12?"* today. Insights aggregates a team across matches, coverage says
whether a match was watched, and neither shows the match itself.

This is a prerequisite, but **not a speculative one** — it is a hole in the app
independent of auto scouting, which is what makes building it first safe rather
than a guess at what the replay will need:

1. **The entries recorded for one match**, grouped red against blue, with each
   scout's notes. The data is already there and unrendered.
2. **Two tenses, one route.** Before the match it is the pre-match view — who are
   we about to play, and what does history say. After it, it is the review. Same
   six teams, same table; only the tense of the content changes. This absorbs
   item 6 of v0.82 rather than building the same shape twice, which is the
   argument that release already makes about itself.
3. **Reachable from the schedule and from coverage**, which are the two places
   the question gets asked.
4. **It is where the replay lands in step 2.** Sized for that, built without it.

**The event went into the URL, and the team page moved with it.** A match number
means nothing without an event, and `/studio/insights/team/<n>` had the same
problem one level down: it answered with every entry the device held, from every
event, pooled into one mean. Both now live under `/studio/<eventCode>/`, and the
team page answers *at this event* and *this season* as separate columns. The old
route redirects, because an installed PWA still holds bundles that link there.

**What the build found that the suite did not**, all three by opening the page:

- The coverage fraction counted a stray team in the numerator, so a match with
  two of six scheduled teams watched read **3/6**. A coverage number that
  overstates coverage is worse than none.
- A link inside a table cell had no colour rule anywhere and kept the user
  agent's `#0000EE`, which is **1.97** on a Studio dark card. That is the v0.80
  pill bug exactly: the foreground was not a token, so `check_contrast.mjs` had
  no pair to look up. Fixed in `Table` rather than per page.
- `Panel` rendered `children` unconditionally, so a title-and-hint empty state
  threw `invalid_snippet` and left the page on "Loading…" — a blank screen for
  what is only an absence of data.

The zero-width-viewport trap fired once here too, reporting horizontal scroll on
a page that has none. `docW === 0` is now asserted before any geometry is read.

**Why this ordering is not optional.** A recorder whose output cannot be played
back cannot be verified — the only feedback is a base64 blob, and "the track
looks right" is not a judgement anyone can make about that. Step 1 ships,
gets pushed, and gets used before the recorder is written.

#### Step 2 — the recorder and the replay ✅ shipped 2026-08-29

5. **Record live, correct after** (ADR Decision 6). The drag runs during the
   fifteen seconds; the scrub-and-fix pass runs after, with no clock on it. The
   correction pass and the manager's replay are **the same renderer**, which is
   why they are one step and not two.
6. **The encoding is pinned in the ADR** — 10 Hz, 8 bits per axis, ~500 bytes per
   robot per match, ~70 KB for a fully covered event. The plan's database-size
   worry was checked arithmetically and does not survive it.
7. **Partial records count.** Start-only is a legitimate outcome and feeds the
   most-asked question. Blank stays blank, per piece.
8. **The replay says it is a reconstruction** (ADR Decision 8). Six scouts start
   recording at six different moments and there is no shared clock, so tracks are
   aligned on first movement with a manual nudge — and labelled, because a replay
   is the one surface here that will be trusted more than it deserves.
9. **`SCHEMA_VERSION` 3 → 4**, and the field geometry plus its legal-region mask
   join the January ritual in *Retuning metrics each season* below.

**The field is the real 2026 REBUILT field**, built in `field.js` from FIRST's
published dimensions — 651.2in × 317.7in, two 47in HUBs each 158.6in from their
own alliance wall, the BUMPs and TRENCHes as landmarks, and the cut at the
opponent's ALLIANCE ZONE. It replaced a placeholder schematic that had one
circular obstacle at field centre, which is wrong in every particular.

The heat map (ADR Decision 9) is still **not** built. It was deferred because
the geometry was a guess; now that it is not, the reason has changed rather than
gone: a heat map wants more than a handful of recordings before it says
anything, and the honest time to build it is after the offseason has produced
some. Start-zone frequency, cycle statistics and route clustering are enough to
tell whether the input method works, which is what October is for.

**What the build found that the suite did not**, again all by driving the app:

- **A 15-second recording came out as 52.2 seconds.** The sampler counted
  `setInterval` ticks, and a backgrounded tab throttles them. Worse than a wrong
  duration: `t` is derived from the sample index, so 150 samples over 52 real
  seconds decode as 15 seconds of motion at three times the speed, and nothing
  about the result looks wrong. The sampler now fills forward to
  `performance.now()`.
- **`requestAnimationFrame` stops entirely while a tab is hidden** — zero ticks in
  500 ms — so the first frame after a manager switches back carried the whole gap
  and the replay jumped to the end. The frame delta is clamped.
- **A `.ghost` class collided with `Button`'s `ghost` variant.** Svelte's scoping
  keeps them apart, so this was a trap rather than a bug; the SVG robots are `.bot`
  now.
- **`Panel` and `Table` both needed the fixes v0.81 step 1 made**, which is what
  made this release's UI cheap.

And one finding that was **not** a bug: a 2.08 contrast failure on two ghost
buttons in dark mode turned out to be the measurement. See the new trap in
`CLAUDE.md` — toggling `data-theme` from the console does not re-resolve a
transitioned property.

**A per-scout page is not a prerequisite** and is not in this release. The plan
lists it beside the match page, but coverage already carries the by-scout counts,
and nothing in the recorder or the replay is blocked by it.

**It must be practised before the event.** A scout meeting a new input method
during a real match is how a match's data is lost, which is why this sits at
v0.81 rather than at the end. Early also means there is time to revise it once
someone has actually used it, which is the more likely outcome than getting it
right first.

### v0.82 — the comparison pair

Two questions, one table, **one release** — because they are the same rendering
and building them apart is how `insights` ended up with the same shape under
four names.

**The problem, on `/studio/insights/compare` today.** It renders each team as a
CARD, side by side, with the metrics stacked inside. Comparing "auto scored"
across four teams means reading three separate card bodies at three different
vertical positions and holding the numbers in your head. The one job the page
has is the thing its layout makes hardest. It is the v0.74 diagnosis about
Insights, in the one place it was not fixed: cards are what you build when the
data is one subject, and a comparison is never one subject.

**The fix is a transpose.** Metrics become ROWS and teams become COLUMNS, so a
row reads as one measure across every team, aligned, in tabular-nums. `Table`
already exists and already scrolls in its own wrapper.

1. **Transpose the grid.** Metrics down, teams across. Best-in-row keeps the
   existing leader mark; the mark moves from decorating a card to meaning "this
   is the largest number in this row", which is a fact rather than a highlight.
2. **A delta, not just a value.** The question is rarely "what is 254's cycle
   count" — it is "how much better is 254 than 1114". Show the gap against the
   row leader, or against a chosen baseline team.
3. **Sample size stays visible per cell.** The existing page already shows
   `avg of 4 · max 15 · ±1.1` and must keep doing it. A comparison that hides n
   invites comparing a four-match mean with a one-match one.
4. **Blank stays blank, per row.** A team with no reading for a metric leaves the
   cell empty and is excluded from that row's leader calculation — not ranked
   last. The `disagreements()` helper added in v0.75 already establishes this
   shape at the ranking layer.
5. **Reachable from where the question is asked.** Selecting rows in the Insights
   table and pressing Compare, rather than typing team numbers into a box.
6. **The match page inherits the transpose.** The pre-match view was item 6 here
   and **moved to v0.81**, because the replay needed a match route to live on and
   building the same six-teams-red-against-blue shape twice is the exact mistake
   this release exists to correct. What stays here is the second half of that
   bargain: once the transpose exists, `/studio/match/[matchNumber]` swaps its
   own table for it rather than keeping a simpler one. v0.81 builds the route and
   the grouping; v0.82 makes the numbers in it read across teams.

**Deliberately not in v0.82:** charts of any kind. If the transposed table is
still not enough, that is the evidence a chart is needed — and `docs/adr-003-boards.md`
is where the thinking already is.

### v0.83 — pit scouting and the team profile

**Pit scouting is not a new surface.** `/studio/insights/team/[teamNumber]`
already renders what the matches say about a team; pit answers are what the team
says about itself. Same route, second section. "Profile" is the right word for
the union, and it is much cheaper than a page of its own.

1. **The questions live in a config file**, in the same shape and next to
   `form-config.js`, so a field added to the definition appears in the form, in
   the profile and in the CSV export without being wired three times. Ship with
   placeholders; the team supplies the real questions.
2. **No camera, deliberately.** Wanting one is what deferred pit scouting in the
   first place, and dropping it is what makes this cheap — it also keeps
   Supabase Storage out of scope, which is where a photo feature would otherwise
   have to go.
3. **One pit record per team per event**, not per scout. A pit answer is a fact
   about the robot, not an observation of a match, so it does not want the
   `entries` dedupe fingerprint and should not pretend to.
4. **Blank stays blank here too.** A question nobody asked is not a "no".

**The schema is free this time.** The data can be wiped without consequence
until after the first offseason, which removes the migration care that is
normally the expensive half of adding a table here. That licence expires with
the event.

### v0.84 — the scout's schedule

v0.73 step 2 planned a read-only `/schedule` and it was never built — there is
no route for it. A scout sees the matches one of their own teams is in, on Home,
and never the event's. Resolved through `myMatches()` so it agrees with the
coverage maths rather than computing the same thing a second way.

Last because it is the smallest and the only item in the series that can slip
without costing anything on the day.

### v0.85 — the app moves to rohawks.org/app

Off GitHub Pages and onto the team's own hosting, once the features are stable.

1. **A plain folder, not a WordPress page.** The build lands in
   `public_html/app/` and is reached at `rohawks.org/app/`. WordPress's own
   rewrite rule already skips anything that is a real file or directory, so it
   never sees the request and Elementor's header never enters the picture. A
   menu link on the main site is the whole integration.
2. **`.htaccess`, not a source change.** Apache serves the existing `404.html`
   for unknown paths, which keeps the prerendered root page that
   `svelte.config.js` warns about losing. `/studio/insights/team/[teamNumber]`
   sets `prerender = false` and depends entirely on that fallback.
3. **`BASE_PATH` becomes `/app`.** Every call site goes through `$app/paths` —
   24 files — so this is one variable in the workflow. `/app` and not `/scouting`, because the
   app already has a page called `/scouting` and the result would be
   `rohawks.org/scouting/scouting/`.
4. **`deploy.yml` keeps everything above the upload.** `npm ci`, tests, SQL
   validation and build are unchanged; only the two GitHub Pages steps become an
   FTP upload. The credentials are the user's to add to the repository secrets.
5. **Leave the last Pages build up** through the switch so nobody is stranded
   mid-transition.

**Checked, because these are what usually break on a domain move and none of
them do here:** both Edge Functions send `Access-Control-Allow-Origin: *`, so
there is no allowlist to update; the Supabase URL and anon key do not change;
sign-in is a password exchange, so there are no OAuth redirect URLs to
re-register. The one hard requirement is HTTPS — `deriveSessionId()` uses
`crypto.subtle`, which browsers only expose on a secure origin.

### Deliberately not in v0.8

- **Native on four platforms — paused, not cancelled.** Android, iOS, macOS and
  Windows were green-lit and then deprioritised behind features, which is the
  right order: the offseason is a rehearsal and a rehearsal wants a deployment
  you can fix in the middle of. The plan survives intact — Capacitor for mobile,
  Tauri v2 for desktop, one `src/lib/native.js` as the only file that knows a
  plugin exists, so the same bundle keeps running as the web app. Android via
  Play internal testing (100 testers, live in minutes, no review) rather than a
  sideloaded APK, iOS via TestFlight, desktop via GitHub Releases. It targets
  2027, which is also when interactive scouting needs a new field image anyway.
  Enrolling in the Apple Developer Program is worth doing early regardless: it is
  a form and a wait, not work, and an organisation enrolment can take three
  weeks against an individual's two days.

  **One thing already known to break, found on 2026-08-26.** The Studio button in
  `+layout.svelte` uses `target="_blank"`, and a native app has no tabs. Depending
  on the webview that either does nothing or opens the system browser — which
  drops a manager into Safari *signed out*, because the session lives in the
  app's storage. Removing the attribute is not the fix on its own: the new tab
  was how you got back, which is why Studio has no tab bar of its own. On native,
  Studio needs an explicit exit. That is a design decision, not a one-line change.
- **Password recovery.** Wiping the data takes the four unroutable
  `@scout.invalid` accounts with it, and every account created since `0016` has a
  real address, so the urgent half of this problem disappears on its own. What
  remains is that there is no recovery flow in the UI at all — a fair thing to
  carry into v0.9, and still the most immediate reason a second Edge Function
  gets written.
- **A camera, and therefore Supabase Storage.** See v0.83.
- **True peer-to-peer sync.** Still not possible in a browser: iOS Safari has no
  Web Bluetooth and no local peer discovery, and WebRTC needs a signalling server
  — which needs the internet the feature exists to avoid. It belongs to the
  native release, where MultipeerConnectivity and Nearby Connections make it
  straightforward, and it moves with native rather than ahead of it. The offline
  file handoff shipped in v0.75 is the version that works without waiting.
- **Scout reliability**, considered and rejected as superficial.
- **The season retune.** January's ritual, not this series'.

## Target model

**Account** — who you are. Created by a manager, username generated, real email
for recovery. The only identity; there is no local name to disagree with it.

**Role** — what you may do. Scout records; manager operates event planning and
Studio; super controls manager accounts. Held on the profile, never asserted by
the device.

**Event** — a row a manager creates, with scouts assigned to it. Replaces the
event code as the data partition and as the answer to "what am I allowed to
see".

**Attribution** — an immutable account id on the row, stamped server-side.

### Offline rule

Login may require a network. Recording may not.

- The IndexedDB write path never checks auth.
- Token refresh failure never discards unsaved work or redirects a scout away
  from the form.
- Signed out, entries are recorded and held; sync waits for a session and the
  rows are claimed and pushed when one arrives.
- Access tokens last four days so a device that signs in before leaving holds a
  valid session through the whole event without refreshing.

## Retuning metrics each season

`METRIC_FIELDS` in `src/lib/form-config.js` is deliberately game-agnostic, and
from v0.81 the field image is season data in the same way. Each January:

1. Update labels, maximums and `higherIsBetter` flags.
2. **Replace the field image**, and re-check the coordinate normalisation against
   it. Spatial observations store field-absolute fractions, so a new picture with
   different proportions silently moves every mark recorded against the old one —
   which is why the image is versioned with the schema rather than swapped in
   place.
3. Bump `SCHEMA_VERSION`.
4. Run the full test and build checks before deploying.

Keep the list short enough to record reliably during one match. Preserve the
critical invariant: blank means *not recorded*; `0` means *recorded and zero*.

## Constraints worth preserving

- **Offline-first writes.** A local row with pending edits is never overwritten
  by a peer; `updated_at`, not `created_at`, is the remote watermark.
- **Event partitioning.** Auth membership and matching event scope are separate
  requirements.
- **Real identity.** Authorization and joins use profile UUIDs, never a typed
  display name.
- **Design system and accessibility.** `design.md`, token checks and the AA
  contrast floor remain enforced.
- **Metrics semantics.** Blank and zero remain different.

## Conditional work

- Server-side cleanup for expired reminders or dormant events, only when cruft
  is measurable.
- Manager-editable metric definitions, only if annual source edits become an
  actual burden; this needs versioned definitions to avoid corrupting an event.
- An Edge Function TBA proxy only if the app becomes public and the key must be
  hidden. Password recovery is a separate and more immediate reason an Edge
  Function may become necessary.

## Deliberately out of scope

- Voice-to-text in a loud gym.
- Robot photo storage and Supabase Storage without a demonstrated need.
- Web Push/VAPID while in-app reminders suffice.
- A fully online-only rewrite.
- Playoff match scouting; selection is where this app's data has leverage, and
  playoffs would require a match-identity refactor across the data path.
- A second Supabase project for users, which would break database joins and RLS
  as the authorization layer.
- Google Sheets API integration while CSV import is sufficient.
- A separate Studio app or unrelated second design system.

---

## Archive — shipped work

Everything below has shipped. It is kept for the **decisions**, not the plans:
the step lists executed and now live in git. The full release plans, at their
original length, are at commit `3ce6945` — and the commit messages carry the
same reasoning at the moment it was acted on, which `git log` makes searchable.

Invariants that came out of this work are in `CLAUDE.md`, which is where they
are maintained. This section is history, not a second copy of them.

### Before v0.6 — the passphrase era

The app partitioned data by an event code hashed into a `session_id`, and
privileged writes carried an `x-manager-token` checked by `has_manager_token()`.
Neither was a secret: the event code is published on The Blue Alliance, and the
manager passphrase was a shared string typed into a form. Supabase Auth profiles
and invites existed alongside it, but sign-in was optional because
`AUTH_ENFORCED` was `false`.

Three faults were found on 2026-08-07, all tracing to `entries` having been
built by clicking in the dashboard rather than by a migration:

- **`entries` had no UPDATE policy**, so scout corrections had never reached the
  cloud — observation edits were silently discarded and match/team edits
  duplicated the row. `0001` had contained the fix the whole time.
- **`current_session_header()` did not exist**, and `0011` calls it 38 times, so
  the cutover would have aborted on its first policy.
- **`0001` was believed unrunnable and was not** — `IF NOT EXISTS` throughout.
  It was always the repair for that table and had simply never been run.

The lesson outlived the era: **rehearse migrations with
`scripts/rebuild_prod_replica.sh`, not `supabase db reset`.** The latter applies
`0001`, which production had not, so it builds the repo's idea of production
rather than production. Three rehearsals were worthless for exactly that reason.

### v0.6 — the offseason build ✅

Replaced the passphrase with accounts, and replaced the event code with a row.

- **Phase 1 — routes and Home.** Recording became the thing the app opens to.
- **Phase 2 — real email addresses.** `0016`. Before it, every account was
  `<username>@scout.invalid` — RFC 2606 reserves `.invalid` as permanently
  unroutable, so those accounts can sign in but can never receive recovery mail.
  Four of them are still on production.
- **Phase 3 — the account model.** Manager-created accounts, invite codes
  carrying the name the manager typed, three roles on `profiles.role`.
- **Phase 4 — events and identity.** The decisive one. `0019` made events real
  rows with an `event_scouts` membership join; `0020` dropped `session_id` from
  all eight tables along with 29 policies, `has_manager_token()` and the
  passphrase. `events.code` survived only because TBA's API is keyed on it.

  This dissolved two problems rather than working around them: the code was
  never a secret, and "which events may I see" was circular — you needed the
  code to read `event_meta` at all. Membership answers both, and it is what makes
  *record but do not sync* fall out of the schema instead of being a second check
  that could disagree with it.
- **Phase 5 — Manager Studio.** `/studio` with a rail: Event (staff an event by
  dragging, with a button beside every drag) and Coverage. The drag-and-drop
  graph builder was deferred here and later rejected outright — see
  `docs/adr-003-boards.md`.

**`0011`, `0012` and `0013` never reached production** and live in
`supabase/superseded/`. `0019` and `0020` replaced them, borrowing what was
right. They had to leave the directory rather than sit unapplied, because a local
`db reset` applies everything in `migrations/` and would build a shape production
will never have.

### v0.7 — the interface series ✅

**The diagnosis.** Three of four navigation labels did not match the page they
opened:

| Nav said | Route | Page was titled |
|---|---|---|
| Home | `/home` | **Your entries** |
| Scouting | `/scouting` | **Schedule** |
| Insights | `/insights` | **Manager** |
| Settings | `/settings` | Settings |

Recording — the app's entire purpose — lived at `/scouting/new` and was reached
from Home, so "scouting" was the one thing the Scouting tab did not do, and
"Insights" was literally titled Manager, which is also what Studio is. That table
was the root of four separate complaints. `check_components.mjs` now asserts that
a nav label matches its page's `<h1>`, so it cannot drift back.

Two structural facts sat underneath the rest: content was capped at `42rem` on
every route, so a 1280px screen showed a 672px column with a third of the window
empty; and four breakpoints were in use — `28rem`, `40rem`, `47.9375rem`, `600px`
— with no system behind them. The `--w-form / --w-read / --w-list / --w-board`
tokens came out of this: **content width is a decision about the content, not
the device.**

#### v0.72 — the self-contained fixes ✅

Taken first because they depended on nothing else in the series.

- **Studio dropped the app shell.** The global tab bar was a trapdoor: one tap
  left Studio with nothing offering a way back. `+layout.svelte` now returns
  early on `/studio`, and Studio carries its own chrome and one real exit.
- **Every native `<select>` gone** — nine across seven files, not the one that
  was noticed. `Select.svelte` styles the real element rather than rebuilding a
  listbox from divs, so keyboard navigation, type-ahead and the phone wheel
  picker keep working.
- **No more sideways scroll on a phone.** Eleven grid tracks used a bare `1fr`,
  which refuses to shrink below its content's min-content width — two text inputs
  held the Accounts form wider than a 375px viewport. `minmax(0, 1fr)` fixed it,
  and a check now forbids a bare `fr` track.

#### v0.73 — one reorganisation, done in steps ✅

**The app split into recording and running an event**, because those are
different jobs on different devices in different rooms. Recording moved to
`/scouting`; the five manager surfaces that had been sitting behind a tab
labelled Scouting moved to Studio; `/insights/*` became `/studio/insights/*`;
Accounts left Settings. Every old path redirects, because a cached PWA or a
bookmark must not 404 on the morning of an event.

**Step 2's read-only `/schedule` was never built.** It is v0.84.

#### v0.74 — Studio becomes its own application, visually ✅

Studio's pages had been moved wholesale in v0.73 and never redressed — they read
as the main site with a sidebar bolted on, because that is what they were.

**The palette, and the constraint that shapes everything:**

    #662DB4  purple   8.08x on white   ← the ONLY one that can carry white text
    #0087F8  blue     3.61x on white   dark text only
    #00C7FA  cyan     1.99x on white   dark text only
    #49FCE2  aqua     1.29x on white   dark text only

Three of the four cannot have white text on them, which decides the whole
scheme rather than being a detail found during implementation. On a dark ground
every number inverts, and that is the design: the light three become ink and
purple becomes the fill.

The block **remaps the base tokens** rather than only adding `--studio-*` ones,
which is what dresses `Button`, `Select`, `Dialog` and `Field` for free — a
component that consumes tokens correctly is already a Studio component.

Two ordering traps, both enforced by checks because neither is visible: the
Studio block must come *after* the dark block, since both are `(0,2,0)` and
source order is the entire mechanism; and `data-studio` goes on the document
root, or `body`'s background resolves outside it.

#### v0.75 — the season-usable series ✅

**The charter**, and it is still the sharpest statement of what this app is for:
competitors do not lose on features. They lose on whether the data arrives — gym
wifi is unusable, which is the entire reason QR transfer exists as a category —
and Statbotics gives every team decent predictive analytics for free, so raw
analytics stopped being a differentiator. So: *(1) the data arrives, with no
infrastructure; (2) the data says something public sources structurally cannot
see.* Point 1 was this series. Point 2 is v0.81.

Shipped in it: one box model for `<a class="btn">` and `<button class="btn">`
(62px against 44px in the same toolbar, from the UA stylesheet giving form
controls border-box); the offline file handoff; Statbotics ratings; per-event
settings; and `username-sign-in`, after which knowing a username no longer buys
you an email address.

**Studio began following the app theme here.** It had been dark in both, on
reasoning about the palette rather than about the person reading it — who could
not read it. There are now two Studio palettes and `check_contrast.mjs` measures
both, at 170 assertions across four palettes in total.

#### v0.76 — the scout's side ✅ shipped 2026-08-20

v0.75 rebuilt what a manager sees; this was the other half, reported by the
person running the team after using it. Seven items, and **the through-line is
worth keeping**: every one was the app failing a scout holding a phone between
matches — losing their typing, telling them to watch two robots at once, or
sending them somewhere they had not come from. None was a missing feature; each
was the app being slightly wrong at the exact moment there is no attention to
spare.

Back returns where you came from, via `afterNavigate` rather than a hardcoded
`history.back()` that would walk off the app when the form was opened from a
notification. A started form survives leaving it, persisted to the `settings`
store so `db.js` stays free of `auth.svelte.js`, and restored only when the
draft's match and team match the form being opened. And the scout got their
upcoming matches on Home, resolved through `myMatches()` so it agrees with the
coverage maths.

#### Out of scope for the interface series (v0.72–v0.74)

Named so that series could actually close: no new analysis features, no graph
builder, no season retune. It closed with v0.74.
