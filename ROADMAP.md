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
| Interactive auto scouting | Designed in ADR-002, not built (v0.81) |
| Pre-match view | Not built (v0.82) |
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

## Already shipped — do not re-plan

### Scouting and event operations

- Offline-first entry capture with peer sync and an UPDATE path for corrections.
- TBA schedule publishing, event-key decoupling, reminders and live coverage.
- DSATUR auto-assignment, minimal-delta reruns and per-match overrides.
- Whole-schedule scout view with My teams / All matches filtering.
- Refresh-safe assignment drafts.
- Structured defense, tag pills and deduplicated strengths.
- Edit-after-save and mismatch warnings.

### Analysis and alliance selection

- Shared numeric metric definitions in `form-config.js`.
- One aggregation engine for mean, median, range, standard deviation, trend and
  small-sample handling.
- Metric summaries, sorting, sparklines, compare rows and weighted picklist
  scoring.
- Row-based picklist sync, so one stale device cannot overwrite the whole list.
- TBA alliance state on the picklist, including picked and declined teams.
- CSV export derived from the same form configuration.

### Structure and interface

- Routes moved to `/scouting/*` and `/insights/*`; account routes are present.
- The former schedule mega-page split into focused scouting components.
- Shared buttons and in-app confirmation dialogs.
- Design tokens, explicit light/dark palettes and automated component/contrast
  checks.
- File import/export transport and the `.scout` format removed; CSV remains a
  reporting deliverable rather than a sync mechanism.

## Auth upgrade: where it got to before v0.6

Kept as the record of what is live and why, not as a plan. The forward plan is
the v0.6 section below, which supersedes it.

### Original state

Full rationale: [`docs/adr-001-auth.md`](docs/adr-001-auth.md). Database
operations: [`supabase/README.md`](supabase/README.md).

#### Live today

- `0008_auth.sql` objects are present: `profiles`, `invites`, role helpers,
  invite RPCs and `entries.submitted_by`.
- Public signup is enabled and email auto-confirm is on.
- `0009_picklist.sql` is present.
- `0010_identity.sql` columns are absent.
- `0011_policies.sql` has not replaced the legacy policies; anonymous
  event-scoped access still works.
- The client keeps `AUTH_ENFORCED = false` and still sends manager passphrases.

#### Hardened locally, not deployed

The current working tree addresses the most serious audit findings:

- A profile update trigger makes user IDs and usernames immutable, blocks every
  self-role change, and limits transitions to or from `super` to super users.
- Roster reads require an actual profile; an `auth.users` row alone is not team
  membership.
- Every `0011` event-data policy requires both membership and matching
  `session_id`, and the migration rebuilds all relevant policies and explicitly
  enables RLS.
- Entry insert attribution is stamped from `auth.uid()` and updates preserve the
  original `submitted_by` value.
- The archive/reset RPC is rewritten to use `is_manager()`, is event-scoped and
  no longer depends on the function `0011` drops.
- The one-time `profile_for_name()` backfill helper is not executable by API
  roles.
- `loadProfile()` now queries only the signed-in user's UUID instead of trying
  to collapse the whole roster to one row.
- Static regression checks pin these SQL invariants alongside the client auth
  helper checks.

This improves the migration source, not the live database. Because `0008` is
already applied, its new hardening must be carried forward deliberately — by a
new corrective migration or a rehearsed, verified rerun — rather than assumed
to exist in production.

## v0.6 — the offseason build

Source: the v0.6 draft (2026-08-08). **This supersedes the auth-cutover plan
that stood here.** The cutover was sequenced to harden the event-code model;
v0.6 replaces that model, so hardening it first would be a one-way door onto an
architecture with a known expiry date.

Target: the app is as good as it can be before the offseason event, which is a
deliberate stress test with 20+ scouts, and in full use for the real season
after.

### Already shipped — the draft asks for these and they exist

Do not re-plan them: minimal-delta auto-assign on edit, native in-app confirm
dialogs, upcoming matches with break gaps, the whole-schedule view with a
scout's own matches highlighted, and basic Insights.

### The one hard constraint

The draft has the super create every account directly — proper name, temporary
password, hand it over. **That needs the Auth admin API and `service_role`, and
a static GitHub Pages bundle cannot hold that key.** It is why the built version
uses invite codes and self-registration instead: the idea was not dropped for
taste, it does not fit static hosting.

The draft feels this — *"I am considering making the user database a separate
supabase"*, *"multiple databases might be needed"* — but a second project does
not help. The problem is where the key lives, not which project it opens.

**Resolution: one Edge Function.** Trusted server-side code that creates
accounts on a manager's behalf. It keeps static hosting, makes the draft's flow
work exactly as written including generated `hz123` usernames, and is the same
trusted context any later admin operation needs.

### Migrations 0011, 0012 and 0015 are on hold

`0011` hardens policies keyed on `session_id` — the hashed event code. Phase 4
replaces that key with a real `event_id`, so roughly a third of `0011` is about
to be wrong and the rest gets rewritten around membership. **Do not apply it.**

`0019` has now written most of that replacement, borrowing from `0011` exactly
as predicted: membership gating, manager-role gating and attribution are all
carried over. `0011` and `0012` are still on hold — Phase 4c retires them, and
until then they stay in `migrations/` so a local `db reset` keeps exercising the
post-cutover ordering, which is how `0019`'s policy-name collision was caught.

`0012` drops the passphrase objects and follows the same fate. `0015` extends
invite expiry, and invites may not survive Phase 3 — **do not apply it either.**

None is deleted. All three stay in `migrations/` until Phase 4 decides what
replaces them, at which point whatever is obsolete leaves the sequence the way
`0013` did.

---

## v0.6 phases, in dependency order

### Phase 1 — routes and Home

Independent of everything else, visible immediately, and it is the shell the
rest lands in.

- `/` becomes **Login**. `/register` stays its subpage.
- `/home` becomes **Home**: greeting, and a directory to everywhere else — next
  match, standing, reminders. Role-aware, so managers also see Accounts and
  Insights entries.
- `/scouting`, `/insights`, `/accounts` keep their paths.

The current `/` (entry history, sync status, next match) is most of Home
already; it moves and grows a directory.

### Phase 2 — real email addresses

Small, and it is the stated pre-offseason requirement.

`<username>@scout.invalid` is replaced by a real address collected at
registration. Supabase's built-in recovery then works with no Edge Function and
no admin flow.

**Verification stays off.** `mailer_autoconfirm: true` stamps `email_confirmed_at`
at signup without sending anything, so the account is confirmed from GoTrue's
point of view and `/auth/v1/recover` will still send to it. Registration keeps
its no-round-trip flow *and* recovery works.

The cost is a typo'd address that fails silently until someone needs it. Show
each scout's address on the Accounts page so a manager can spot `gmial.com`.

Must land before Phase 3: accounts created by a manager have their address set
at creation, and doing it after means rewriting every account twice.

### Phase 3 — the account model from the draft ✅ built, not deployed

The Edge Function, and the flow it unlocks:

- A manager enters a first and last name; the function creates the account with
  a temporary password and returns it to hand over.
- Usernames are **generated**, not chosen: first initial, last initial, three
  digits — `hz123`. This also retires "pick your username carefully, it is
  immutable", and removes the duplicate-name collision that becomes near-certain
  at 20 scouts.
- On first sign-in the scout is prompted to set a real password.
- Accounts lists who has activated and who has not — the onboarding progress
  question, answered properly rather than inferred from assignment rows.
- Supers create managers and promote scouts; managers create scouts. Deletion
  keeps its confirm dialog.

Invite codes retire here if this fully replaces them. Both flows are live side
by side for now — the Accounts page offers "Add someone" and "Invite someone
instead" — because the invite path is what already works in production and the
Edge Function is not deployed yet.

**Deploying it:** `supabase link --project-ref hhvpkgwgkuiemxyarsuk`, then
`supabase functions deploy create-account`. It needs no secrets set by hand —
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. `0017` has to be applied first, or the function's two RPCs do
not exist.

Usernames carry six digits, not the draft's three. `email_for_username()` turns
a username into a real address for anonymous callers, so three digits is a
thousand requests to harvest a named scout's email; six is a million. **That was
a temporary mitigation, not the fix.** The 2026-08-19 privacy rollout moves the
lookup and password exchange into the public-but-rate-limited `username-sign-in`
Edge Function. Migration `0024` grants the lookup to `service_role`; the final
rollout script revokes it from browser roles only after the new PWA has soaked.

### Phase 4 — events and identity

**4a — the database. ✅ `0019_events.sql`, applied to production 2026-08-14.**

Done as an **expand** migration rather than a cutover. `session_id` still works
and `event_id` sits beside it, so the client migrates on its own schedule
instead of in the same instant as the database. The "one migration" reasoning in
this document was about doing events and identity together rather than migrating
`entries` twice — both are in `0019` — not about a flag day. `0010` used the same
shape for `profile_id`.

What is live: `events` and `event_scouts`; `event_id` on all eight shared
tables, backfilled and FK'd; `is_event_member()`, `manages_event()` and
`create_event()`; and a full `<table>_evt_*` policy set keyed on membership,
sitting alongside the `session_id` policies rather than replacing them.

108 RLS assertions cover it, all mutation-tested. Two bugs were found by that
suite and are written up in `0019`'s header and in `CLAUDE.md`.

**4b — the client. Mostly done (v0.67–v0.69).**

Shipped: `event-rules.js` (pure) and `events.js` (I/O); claim-on-sign-in wired
into `loadProfile()` so it runs on session restore too; every shared write
carries `event_id` beside `session_id`; entry sync resolves a real event id and
pauses with a named reason when it cannot; `EventPicker` replaced the free-text
code field in **both** places it appeared — Settings and the first-run
`SessionSetup` gate.

Still open:

- `managerToken` removal — 62 references across 9 files. Now unblocked in
  principle: `0019`'s `manages_event()` policies are live on production, so a
  signed-in manager who is a member can already write without the passphrase.
  Removing it collapses `canManage`/`showsManagerTools` to the role, which is
  effectively flipping `AUTH_ENFORCED` for the manager surfaces — so it wants
  to land near 4c rather than alone.
- `scout_name` stops being a join key. It stays as a display label and as part
  of the dedupe fingerprint, which is content and must not gain identity.
- The signed-in picker has not been looked at by a human. Its logic is tested;
  its appearance is not.

The original 4b list, for reference:

- Replace `deriveSessionId(eventCode)` with a real event id from `events`. The
  event picker becomes a list of events the device is a member of — a question
  the database can finally answer — instead of a text field.
- Send `event_id` on every write; stop sending `x-session-id`.
- **Claim on sign-in.** Rows recorded signed-out carry `client_id` and a null
  `submitted_by`. On sign-in the client claims its own: `client_id` matches this
  device and `submitted_by` is null. Only unclaimed rows, only this device, so it
  cannot take a teammate's work, and it is idempotent. Unsynced rows never left
  the phone, so this happens locally before the first push — no claim RPC.
- **Signed out, you record but do not sync.** The IndexedDB write path stays free
  of `auth.svelte.js`; the push path requires a session.
- `managerToken` removal — 62 references across 9 files.
- `scout_name` stops being a join key. It stays as a display label and as part of
  the dedupe fingerprint, which is content and must not gain identity.

**4c — contract. ✅ `0020_contract.sql`, written and applied LOCALLY only.**

`session_id` dropped from all eight tables; 29 legacy policies, the passphrase
and `has_manager_token()` gone; attribution stamped by a BEFORE INSERT trigger;
`AUTH_ENFORCED` flipped to `true` in the same commit. 194 client references to
the passphrase removed across 12 files.

**Not on production, deliberately.** Every earlier migration was compatible with
the deployed bundle. This one is not: applying it while the live site runs the
old client breaks that site. Push first, then apply.

### Phase 5 — Manager Studio ✅

`/studio` with a sidebar: **Event** (staff an event by dragging, with a button
beside every drag) and **Coverage** (three numbers and the gaps under them).
The draft's drag-and-drop graph builder stays deferred, which the draft itself
marked as the right call.

**Events become real rows.** An `events` table with a uuid primary key, and an
`event_scouts` join table so a manager assigns people to an event by dragging
them. `session_id` becomes `event_id` on every shared table, and the event code
retires with it.

This dissolves two problems rather than working around them: the event code is
published on The Blue Alliance so it was never a secret, and "which events can I
see" was circular — you needed the code to read `event_meta` at all. Membership
answers both.

**Identity binds to the account.** `submitted_by` becomes the identity on
`entries`; `scout_name` retires as a join key. `scout-identity.js` shrinks to
the display question it should always have been.

**Signed out, you record but do not sync.** The IndexedDB write path stays free
of auth — that invariant does not move — but the push path requires a session.

**Claim on sign-in.** Rows recorded signed-out carry `client_id` and a null
`submitted_by`. On sign-in, the client claims its own: `client_id` matches this
device and `submitted_by` is null. Only unclaimed rows, only this device, so it
cannot take a teammate's work, and it is idempotent. Because unsynced rows never
left the phone, claiming happens locally before the first push — no server-side
claim RPC needed.

`managerToken` removal (62 references across 9 files) happens here, as part of
the new policy set rather than as a prerequisite for the old one.

---

## v0.7 — the interface series

**Planned in full before any of it ships**, per the working agreement: every
`v0.7x` release is enumerated here and no v0.8 work begins until the series
closes. A release may span several commits; an overhaul is allowed to stay on
`v0.x` rather than forcing a major bump.

v0.67–v0.71 spilled into this series unplanned. They are the account/event
cutover finishing, not part of the plan below, and the overflow is the reason
this section exists.

### The diagnosis

Three of four navigation labels do not match the page they open:

| Nav says | Route | Page is titled |
|---|---|---|
| Home | `/home` | **Your entries** |
| Scouting | `/scouting` | **Schedule** |
| Insights | `/insights` | **Manager** |
| Settings | `/settings` | Settings |

Recording — the app's entire purpose — lives at `/scouting/new` and is reached
from Home. So "scouting" is the one thing the Scouting tab does not do, and
"Insights" is literally titled Manager, which is also what Studio is. That one
table is the root of four separate complaints, and everything in v0.72 follows
from it.

Two structural facts sit underneath the rest. Content is capped at `max-width:
42rem` on every route, so a 1280px screen shows a 672px column with a third of
the window empty. And the breakpoints in use are `28rem`, `40rem`,
`47.9375rem` and `600px` — four scales, no system, which is why the layout does
not meaningfully differ between a phone and a laptop.

### v0.72 — the self-contained fixes ✅

*Taken first because they depend on nothing else in the series — notes 6 and 2,
plus the mobile overflow that turned up while verifying them. Doing these ahead
of the IA work costs nothing: none of it gets redone when routes move.*

- **Studio drops the app shell.** No global bar, no tab strip. The tab bar was a
  trapdoor: one tap left Studio with nothing offering a way back. Studio now
  carries its own chrome — the event it is operating on, and one exit that is a
  real control and is never hidden on a phone.
- **Every native `<select>` is gone** — nine of them across seven files, not the
  one that was noticed. `Select.svelte` styles the real element rather than
  rebuilding a listbox out of divs: the closed state is ours, the open list stays
  the platform's, so keyboard navigation, type-ahead and the phone wheel picker
  keep working.
- **The app no longer scrolls sideways on a phone.** Eleven grid tracks used a
  bare `1fr`, which refuses to shrink below its content's min-content width — two
  text inputs held the Accounts form wider than a 375px viewport. Now
  `minmax(0, 1fr)`, and that form collapses to one column.

### v0.73 — one reorganisation, done in steps

Everything still outstanding, combined into one release because the pieces are
the same cut: **the app splits into recording and running an event.** Doing them
separately would mean moving the same routes twice.

**The split.** A scout opens this app to record a match. A manager opens it to
run an event. Those are different jobs, different devices and different rooms,
and today they are interleaved: `/scouting` holds nine components, five of them
manager-only, while the actual recording lives on Home.

    the scout app        Scout · Schedule · Settings
    Studio               Event · Schedule · Insights · Accounts

Studio is reached by a button at the top of the screen carrying a pop-out
indicator, because it opens in its own tab. It stops being a nav tab: it is not
a peer of Scout and Schedule, it is a different application.

**The steps**, in order, each shippable on its own:

1. **Recording moves to `/scouting`.** It is what the word means and what the
   tab has always claimed. Home's entry list and record button go there, with
   the scout's own next match and assigned teams.

2. **Event planning moves to Studio.** `PublishSchedule`, `AssignScouts`,
   `ScoutRoster`, `CoverageCheck` and `ReminderPanel` are manager surfaces that
   have been sitting behind a tab labelled Scouting. `SchedulePreview`,
   `MyTeams` and `UpcomingMatches` stay scout-side as a read-only `/schedule`.

3. **Insights folds into Studio.** It gives no advantage as a separate surface —
   teams, compare and picklist are all "running the event", and keeping them
   apart is what made Insights and Studio clash. `/insights/*` becomes
   `/studio/insights/*`.

4. **Accounts folds into Studio** and leaves Settings. It is a manager job, and
   moving it dissolves the sizing complaint rather than restyling it: Settings
   is left with sign-out as its only account control, so there is no mismatched
   pair.

5. **Every old path redirects.** A cached PWA or a bookmark must not 404 on the
   morning of an event.

6. **Nav labels equal the `<h1>` they open**, enforced by a check, because this
   drifted once and will drift again.

7. **Reminders stop being a shelf. ✅** Today they are a static stack under the nav
   — up to three at once, pushing every page down, persisting until dismissed.
   That is not a notification, it is furniture. They become:
   - a **fly-by** that slides in, reads, and leaves on its own, for anything
     informational;
   - a **popup** that interrupts, for the ones that need an action now — you are
     up in two matches, you have an unrecorded team.

   Reduced-motion collapses the fly-by to a fade, and neither may steal focus
   from a form a scout is mid-way through filling in.

7b. **Syncing, fixed at the root.** Reported as three symptoms — assignments not
   reaching scouts, entries not deletable, dragging a scout onto an event working
   fine. The last one was the control case that found the cause: `event_scouts`
   is a table `0019` created, with no `session_id`; every OTHER table still had
   `session_id NOT NULL` while the deployed client had stopped sending it. Every
   write to the other eight was failing a not-null constraint.

   `0020` was written to drop that column and was never applied, because it had
   to land *after* a push and the push happened without it. Applied 2026-08-17;
   every row preserved. **Do not push a client change that depends on a migration
   before the migration is on production** — the ordering rule already in
   `CLAUDE.md` failed here because nothing enforced it.

   `0021` adds entry deletion as a tombstone rather than a DELETE, because the
   pull is a watermark on `updated_at` and a vanished row is indistinguishable
   from an unchanged one. Managers withdraw; the stamp propagates; the row is
   kept so it can be undone and so the fingerprint stays honest.

   Scouts can see their assignments again: `MyTeams` moved to Studio with the
   rest of the manager page in v0.73 and Studio is manager-gated, so there was
   nowhere for a scout to look. `MyAssignments` puts it back on `/scouting`.

7c. **Sync is legible from anywhere. ✅** The app bar had a four-state coloured
   dot with a `title` — and a title needs a mouse to hover, so on the device this
   app is actually used it said nothing. Everything readable lived on Settings,
   two taps from every screen. `SyncPanel` replaces it: a tappable chip carrying
   the queue depth, opening a sheet that names the state in words, says how many
   entries are waiting and when it last synced, and offers a retry.

   Four states, four different answers, because they need different responses —
   offline (keep scouting), signed out (keep scouting, but sign in before you
   leave), not on this event (ask a manager, you cannot fix this), error (a
   manager should know). A dot could only be a colour someone learns to ignore.

   Two bugs came out of building it. The old dot's derivation never read
   `syncState.reason`, so a signed-out scout was told to set an event code they
   already had. And `pendingCount` was only written inside `pushOutbox()`, which
   does not run when offline — so a scout recording six matches in a dead corner
   saw "Waiting to upload: Nothing" while holding six unsent entries, which is
   the exact moment that number exists to reassure them. The tick now recounts
   before it checks connectivity. Verified: offline shows 2 waiting with 2
   actually queued, and the queue drains to 0 on reconnect.

8. **The shell earns its space. ✅** Width is a decision about the content, not
   the device, and it is expressed once: `--w-form` 34rem (a column of fields),
   `--w-read` 42rem (prose), `--w-list` 60rem (cards and entry lists),
   `--w-board` 78rem (tables and coverage grids). Every page used to pick its own
   number — 38rem here, 32rem there, 42rem in the bar — so a 1440px screen showed
   a 672px column and no two surfaces agreed why. The entry list now runs to
   960px there; a form stays narrow, because a 900px text input is harder to use,
   not easier.

   The app bar aligns to `--w-list`, the busiest surface under it. Aligning it to
   the widest instead left its text starting well left of the content it sits
   above, which reads as two pages stacked.

   The overflowing bar is fixed too — see the v0.72 note. And 22 grid tracks that
   could not shrink are now `minmax(0, 1fr)`, with a check that fails the build
   on a bare `fr`: it shipped three times, it is invisible in review because
   `1fr` looks like exactly what you meant, and it only appears on a narrow
   screen, which is the screen this app is for.

9. **Identity without typing. ✅ partly — `0023`.** The invite now carries the
   name the manager typed, and `redeem_invite` uses it rather than whatever the
   redeemer sends. `/register` shows "Joining as Haolun Ning" instead of asking a
   question whose answer is already decided; the fields only appear for codes
   minted before the migration.

   The mismatch this closes: a manager assigns "Haolun Ning" a team, the scout
   registers as "haolun", nothing compares the two, and the assignment addresses
   a person who does not exist — with an empty Your Teams and no way to tell why.
   `scout-identity.js` exists because that was already happening between call
   sites; this is the same failure one level earlier, between two humans.

   The Settings field is done (see the identity commit). On the join itself:
   `sameScout()` already prefers `profile_id` and falls back to the name only
   when one side lacks an account, and `auth.me` carries the account id — so the
   assignment join is account-first today. Removing the name fallback outright
   waits until every assignment row on production carries `profile_id`; until
   then it is the thing that keeps a pre-0010 row reaching its scout.

   What was missing was not the join but the *diagnosis*. "Nothing assigned" had
   two causes needing opposite responses — wait, or go ask someone — and the copy
   guessed at a third that is no longer actionable: "check your name matches".
   Since `0023` the account owns the name and the field is read-only, so that
   sent a scout to a dead end. It now distinguishes "none published yet" from
   "published, none yours", both verified against seeded data.

10. **The visual pass. ✅** Run against `design.md` as the locked system, so
    tokens, contrast and component checks stayed authoritative — a redesign
    inside the system, not a reskin.

    The audit's two loudest findings were false positives, and saying so is part
    of the result: the hex literals flagged as "bypassing tokens" ARE the `:root`
    token block, which is exactly where literals belong; and every italic in the
    codebase is a body-copy label, not a heading.

    The real one: **eight components had interactive elements and no
    `:focus-visible` at all.** A keyboard user tabbed through them with nothing
    to see, and the failure is invisible to a mouse, so it had survived every
    review. One zero-specificity `:where(...)` baseline in the layout covers all
    of them and loses to any component that defines its own — verified with a
    real Tab press, and by seeing a component's own 1px offset win over the
    baseline's 2px.

### v0.74 — Studio becomes its own application, visually ✅

Two halves, both shipped. The roster paste landed first; the rest was Studio's
appearance and layout, and it was the larger half.

**The problem.** Studio's five pages were moved wholesale out of the scout app
in v0.73 and never redressed. `schedule` is 1087 lines with 8 local style rules
— it inherits a scout page's styling that no longer applies around it.
`insights` is 1010 lines with 92 rules written for a phone-width column, now
sitting inside a sidebar layout. They read as the main site with a sidebar
bolted on, because that is exactly what they are.

#### The palette, and the constraint that shapes everything

    #662DB4  purple   8.08x on white   ← the ONLY one that can carry white text
    #0087F8  blue     3.61x on white   dark text only (fails AA for body copy)
    #00C7FA  cyan     1.99x on white   dark text only
    #49FCE2  aqua     1.29x on white   dark text only

**Three of the four cannot have white text on them.** That is not a detail to
discover during implementation, it decides the whole scheme: they are surfaces,
fills, borders, chart series and state accents — never a button background with
white text, never body copy on a light ground. `check_contrast.mjs` fails the
build on it, so this is enforced rather than remembered.

`#662DB4` is within a hair of the app's existing accent (`#5F24A2`, 9.29x). The
palette is an *extension* of the brand, not a break from it: Studio reads as the
same product, cooler and deeper, which is the right relationship for a surface
the same people open on a laptop ten minutes later.

#### Steps

1. **Studio gets its own token block** — a `[data-studio]` scope defining
   `--studio-*` over the existing scale, so the scout app is untouched and
   `design.md` still governs spacing, type and radii. A second palette on one
   system, not a second design system.
2. **A dark surface.** Studio is a laptop-at-a-table application used under
   competition lighting, the four colours sing on a dark ground and wash out on
   white, and dark is what makes the three light ones usable at all — as accents
   on dark rather than fills beneath white text.
3. **Each page redressed for the layout it now lives in.** Wide tables instead
   of phone-width cards, real density on `insights`, and `schedule` losing the
   styling it inherited from a page it no longer shares.
4. **A Studio component set** — table, panel, stat, toolbar — so five pages stop
   each inventing their own. `insights`'s 92 local rules are mostly four things
   repeated.
5. **Contrast verified per surface, not per token.** Every pairing that ships
   gets checked, because a palette that passes in isolation still fails in the
   combination someone actually writes.

#### How it went

All five steps shipped. Two things about the plan turned out differently and
both are worth keeping.

**The token block remaps the base names, it does not only add `--studio-*`.**
Step 1 as written would have dressed the pages and left every shared component
behind: `Button`, `Select`, `Dialog` and `Field` all read `--bg-card`,
`--accent` and `--text-primary`, so a white button would have sat on a dark
panel until each grew a Studio variant. Remapping inside the scope dresses all
of them at once, and it is why the contrast suite could run the *same* pairs
table over a third palette rather than needing a second one. `--studio-*` keeps
the names with no scout-app equivalent: the raw four, the white-text fill, the
series.

**Cyan is the accent, not the purple.** `--accent` has to be both ink and fill —
`Button` paints it as a background, every page paints it as text. Purple can
carry the fill but is 2.29 as ink on a Studio card, so it would have made every
link unreadable. Cyan is 9.29 as ink and 9.95 as a fill under `--on-accent`.
Purple keeps the one job only it can do: `--studio-fill`, the surface that takes
white text, spent on the brand mark and the event code.

The measuring found two colours that would have shipped wrong, and both failed
only on `--bg-elev` — the raised panel, the one surface nobody checks by eye.
`--border-strong` at the obvious value was 2.27 against WCAG 1.4.11's 3:1, and
the raw blue was 4.36 as series text. Contrast assertions went 67 → 116.

#### What the redress found that was already broken

Each of these was live, and none is a styling bug — they are the kind of thing a
redress surfaces because it makes you look at every page at a real size.

- **Three Studio pages rendered in Times.** The font stack was declared eighteen
  times, always on a page's own `main`, and `event`, `coverage` and `insights`
  never grew a `main` rule. Declared once on `body` now.
- **Coverage credited every scout with every entry.** `sameScout()` was passed a
  raw entry and a raw roster row instead of two `ScoutRef`s, so it compared
  `undefined` to `undefined` and returned true for every pair. The one number
  the panel exists to surface — the scout at zero — could never appear.
- **Two grids were invalid CSS.** `minmax(8.5rem, minmax(0, 1fr))` is not legal,
  so the browser dropped the declaration and the grid collapsed to one column.
- **`variant="ghost"` never existed**, at four call sites, rendering unstyled.
- **Event's `+`/`−` buttons were 32px**, on the page whose own header argues
  those buttons are the control that must always work.
- **Studio's sidebar was not actually sticky**, twice over: `align-self: start`
  shrank its containing block, and with no `box-sizing` reset in the app the
  rail measured 32px taller than the viewport.
- **Every phone override in Studio's layout silently lost**, because the media
  block sat above the rules it overrode and a media query adds no specificity.

Six new checks came out of it, each mutation-tested: the Studio palette's
ordering, per-surface Studio contrast, the single font declaration, Button
variants that exist, nested `minmax()`, and PageHead owning the `<h1>` and the
back control. Two existing checks were fixed for false positives — `\b` is the
wrong boundary for a CSS class name, and the bare-`fr` stripper could not handle
a nested `min()`.

#### Left open, deliberately

**The scout-side `/schedule` route from v0.73 step 2 was never built.**
`MyTeams` and `UpcomingMatches` were left inside Studio behind `{#if
!isManager}` — a condition that can never be true, because Studio's layout gates
every child on `auth.isManager`. The unreachable branches are gone; the two
components stay on disk, unreferenced, under `components/scouting/`.

So a scout currently has no schedule view: `/scouting` shows `MyAssignments` and
nothing else. Either build `/schedule` or delete the two components — it is a
planning decision, not a visual one, and it belongs to whoever plans v0.75.

**The app has no `box-sizing: border-box` reset.** Everything is `content-box`.
Studio's rail sets it locally; flipping the box model under every page in the
app is a change with its own blast radius and wants its own release.

#### Deliberately not in v0.74

The visualization builder. Studio needs to *look* like one application before it
grows a new feature; a chart builder built on five inconsistent pages inherits
all five inconsistencies. The series tokens (`--studio-series-1..4`) are defined
and contrast-checked, so the palette half of that work is already done.

### v0.75 — the season-usable series

Enumerated before it ships, per the working agreement. It spans several commits;
the series is the unit of planning, not the commit.

**The constraint that sets the shape: there is no native app coming soon.** An
Apple developer account needs a waiver first, so everything in this series has to
work on the web, this season, on the phones the team already owns. Nothing here
may be parked behind a store review.

**The goal.** This should eventually be worth turning into a Mac/iOS app, which
means beating what is already free — Scoutradioz, Scouting PASS / QRScout, 1678's
open system, and the Google Sheets homebrew most teams actually run. Those do not
lose on features. They lose on whether the data arrives: gym wifi is unusable,
which is the entire reason QR transfer exists as a category. And Statbotics gives
every team decent predictive analytics for nothing, so raw analytics stopped
being a differentiator some time ago.

What is left is the charter for this series:

1. the data arrives, with no infrastructure;
2. the data says something public sources structurally cannot see.

Point 2 is **v0.81's** job — see `docs/adr-002-spatial-observations.md`, written
and deliberately unscheduled here. Point 1 is this series.

#### 1. One box model ✅

`<a class="btn">` measured 62px and `<button class="btn">` measured 44px, in one
toolbar, from the same rule: the UA stylesheet gives form controls border-box and
everything else content-box. It shipped in v0.74, because that is the release
that gave `Button` an `href` and first put the two elements side by side. Fixed
with a zero-specificity global reset. The sweep also found `.toggle` at 35px on
`/scouting/new` — the smallest target on the most-used screen in the app, and
predating the change.

#### 2. Offline handoff — a file, not a QR code

**The problem.** Sync needs the internet. A competition gym does not have it.
Everything else this app does well is undone by six phones holding data nobody
can collect.

**The decision: export and import a JSON bundle, transferred by any means the
devices already have** — AirDrop, Nearby Share, a cable, a memory stick, an email
when there is signal. Not QR codes, and the reasoning is worth keeping:

| | QR | file |
|---|---|---|
| capacity | ~2–3 KB per code, so ~5–10 entries; needs chunking | whole event in one file |
| scanner | camera + a decoding library in an offline bundle | none |
| failure mode | a mis-scanned chunk in a set of forty | the file arrived or it did not |

QR is what Scouting PASS and QRScout do, and it is the right answer *when you
have no file system*. Two phones and a laptop have file systems and already have
AirDrop, so QR would be solving a problem this situation does not have. It can
layer on later — it feeds the same import path.

**Most of this already exists**, which is why it is second and not last:
`insertRemoteEntry()` in `db.js` takes a row, matches it against the dedupe
fingerprint `[eventCode+matchNumber+teamNumber+scoutName+createdAt]`, and returns
`{inserted: false}` if it is already here. Its own comment anticipates this —
"via realtime echo, **or two import paths**". So import is idempotent by
construction: the same bundle imported twice cannot duplicate a row, and a bundle
that overlaps another is merged rather than doubled.

What is actually to build: a serializer, a file picker, a summary of what an
import would do before it does it, and the manager-side screen to run it. Plus
the honest edge: a bundle carries `schemaVersion` per row and an import from a
future version must refuse rather than guess.

#### 3. Statbotics as a prior, never a dependency

**Statbotics needs no API key** — its own OpenAPI spec declares
`securitySchemes: NONE`. So half the key problem does not exist; only TBA needs
one.

**A shared TBA key must not go in the bundle.** This is a static site in a public
repo: anything in it is public permanently, including in git history, on an
account with a rate limit anyone could then exhaust. The key is per-manager in
`session.tbaApiKey` today and that works. If one shared key is genuinely wanted,
it belongs in a row readable only by managers under RLS — the same shape as every
other manager-only fact in this database. The Edge Function proxy already named
under Conditional work is the answer only if this app ever goes public.

**Treat the data as enrichment that can be absent.** While planning this, every
Statbotics `/v3/` data endpoint returned 500 while its root returned 200. An
analytics source that can be down must never be something the picklist depends
on: fetch, cache, degrade to your own numbers, and say which you are showing.

The feature is not rebuilding EPA. It is showing **where EPA and your scouts
disagree**, because agreement tells a manager nothing they did not already have
for free, and disagreement is where a pick is won or lost.

#### 4. The graph builder — moved out, and correctly sized

**Cut from v0.75.** It was listed here as one bullet about a media query, and
that was a misreading of what it is. The original brief:

> Managers should be able to click **+ graph** to choose the type of graph they
> want. Pie charts, bar graphs, etc. Can also choose data points to compare, from
> all the data that the scouts submit. Will require being able to drag and drop
> different graphs of data — potential worries are autosizing and smooth
> reorganization.

That is a user-configurable dashboard: a persisted set of chart specifications,
each a small query over the entry set, in a grid that is rearranged by hand. Four
things must exist that do not — a chart renderer, a language for saying what to
chart, a builder that speaks it, and a layout that survives being dragged.

It briefly held the v0.80 slot and was then **cut entirely** — see below. That
number now belongs to the v0.8 series; the graph builder has no successor.

#### Deliberately not in v0.75

- **The graph builder** — cut, not deferred. `docs/adr-003-boards.md` is marked
  REJECTED and kept for its decisions.
- **Interactive auto scouting.** Designed in full in
  `docs/adr-002-spatial-observations.md` and held for **v0.90**: it needs a real
  field image, which needs a real game, so it cannot be finished or honestly
  tested before kickoff. It needs no native work — that was checked before
  deferring it, so it is not waiting on the Apple waiver.

  **Superseded — it is v0.81.** The reasoning was right about the 2027 season and
  wrong about an offseason event, which plays the **2026** game: that field image
  already exists. The "needs no native work" half is what made the move possible.

### v0.76 — the scout's side ✅ shipped 2026-08-20

v0.75 rebuilt what a manager sees. This is the other half: the surfaces a scout
actually touches at an event, reported by the person running the team after
using them. Seven items, all from that list.

**The through-line.** Every one of these is the app failing a scout who is
holding a phone between matches — losing their typing, telling them to watch two
robots at once, or sending them somewhere they did not come from. None is a
missing feature; each is the app being slightly wrong in a way that costs
attention at the exact moment there is none to spare.

#### 1. Back returns to where you came from

The form's back link, Cancel, and post-save redirect were all hardcoded to
`/scouting/`. Reaching the form from Home and pressing back therefore landed on
a page the scout had not been on. Uses SvelteKit's `afterNavigate` to capture
the real origin, falling back to `/scouting/` on a cold load or deep link — a
hardcoded `history.back()` would walk off the app entirely when the form was
opened from a notification or a pasted URL.

#### 2. A started form survives leaving it

Half-filled forms were lost on navigation, reload, or the phone locking. The
draft persists to the `settings` store in IndexedDB — no schema bump, and it
keeps `db.js` free of `auth.svelte.js`, which the recording invariant requires.

Restored only when it belongs to the form being opened: a draft carries its
match and team, and a deep link naming a different pair discards it rather than
pouring Q3's observations into Q7. Cleared on successful submit, kept on
cancel — an accidental back press is the case this exists for.

#### 3. No greeting on `/scouting`

It greeted you a second time, one tap after Home already had. Home is the front
door; `/scouting` is the record of what you have done.

#### 4. The full upcoming list, not the first four

Five ahead by default, then an expandable list of the rest. A scout planning a
bathroom break needs to know whether they are up in three matches or eleven.

#### 5. One robot per match

**The real bug of the seven.** `nextUnscoutedMatch()` resolves a scout's teams
for a match through `resolveMyTeams()` — overrides replace the base list for the
match they name. Home's "After that" list did not: it intersected the base
assignment with the match roster directly, so a scout whose clash had already
been resolved by an override still saw both robots, and the override that fixed
it was invisible.

`auto-assign.js` already states the consequence — *"a scout with two teams in one
match covers one of them; the other is lost"* — and generates overrides to
prevent exactly that. Home was showing the unresolved state.

The resolver moves out of `tba.js`'s module scope and gains one exported caller
so both surfaces resolve identically. It must stay one function: `auto-assign.js`
carries a comment requiring its coverage maths to mirror it, and three call sites
disagreeing about who watches what is the same class of bug as the `scout_name`
comparisons that `scout-identity.js` exists to prevent.

#### 6. One page rhythm

Home, Scouting and Settings share `main` rules but not their first child's
spacing, so two of the three began under the header. A shared page-head rhythm,
not three hand-tuned paddings.

#### 7. A larger, varied greeting

Three fixed time bands read as a machine by the second morning of a two-day
event. The pool varies, but **the choice is stable within the day**: the page
re-derives `now` every 60 seconds, so anything seeded on the clock would reshuffle
the greeting while the scout was reading it. Seeded on the date and the person.

Larger needs a token — the scale stops at `--fs-xl`, and `check_components.mjs`
fails a raw `rem` in a component's `font-size`. `--fs-display` is added to
`:root` and to `design.md`, which is the only place a literal belongs.

#### Deliberately not in v0.76

- **Event dates.** `currentEvent()` returns null for 2+ undated events and
  nothing in the app ever sets `starts_on`, so a scout put on a second event has
  no auto-selection and no picker. Real, and its own decision — collecting dates
  versus giving the scout a picker are different answers. Not folded in here.

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

### v0.80 — what is actually on the screen

Reported by the person running the team: black text on a black ground in
places, and buttons clipping into each other. That is on a codebase with 170
contrast assertions and a component checker, which makes the gap between them
the real finding.

**Why the checks did not catch it.** `check_contrast.mjs` measures token
*pairings* from a fixed table across four palettes. It never looks at a rendered
page. So a component that sets a background and inherits its text colour from an
ancestor is invisible to it — and that is exactly the hole v0.74 and v0.75
opened when the Studio block began remapping the base tokens underneath
components written for the scout app. Black on black is that shape. The check is
not wrong; it is answering a different question than the one being asked.

**The clipping already has a name in `CLAUDE.md`:** the app has no `box-sizing`
reset, so everything is `content-box` and padding adds to a declared width.
Studio's rail sets `border-box` locally and the note says changing it globally is
its own release. This is that release.

1. **Audit first, fix second.** Drive the real app in a browser across all four
   palettes — scout light, scout dark, Studio light, Studio dark — at phone and
   desktop widths, and write down what is actually broken before changing
   anything. A green test suite has shipped real bugs in this repo before; the
   audit is not a test run.
2. **The global box model**, if the audit confirms it. One change closing a
   category, rather than a dozen spot repairs that each look local.
3. **The remaining fixes**, from the audit's list.
4. **Whatever the audit finds that the checks should have caught** goes back into
   the checks — but only where a check can be made to answer the real question.
   A false failure is worse than a missing one, and this file already carries two
   examples of a checker that cost more than it caught.

**This release goes first, and not only because it is discovery.** If the box
model is global, it has to land before any new surface is built — otherwise
every page in v0.81 through v0.84 is built against a wrong box and has to be
re-checked afterwards.

### v0.81 — interactive auto scouting

`docs/adr-002-spatial-observations.md` as written; its seven decisions do not
move. A scout marks where things happened on a picture of the field instead of
typing counts, and the aggregation across many scouts is the feature.

**Why this is no longer held for v0.90.** The deferral reasoning was that it
needs a real field image, which needs a real game, so it could not be honestly
tested before kickoff. That is true of the 2027 season and false of an offseason
event, which plays the **2026** game — the field image it needs already exists.
Building it now and testing it on 10 October is the sequence that does not
involve debugging a new input method live at a real regional in March.

**The field image joins the January ritual.** It is season data in exactly the
way `METRIC_FIELDS` is, so it belongs in *Retuning metrics each season* below
rather than in a release of its own.

**It needs no native work.** That was checked before scheduling and is the
reason this could move at all — pointer events on an SVG work on mobile Safari,
so nothing here waits on a store.

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
6. **The pre-match view.** Pick a match, get the same table pointed at six teams
   grouped red against blue, with each team's notes underneath. Nothing in the
   app answers "who are we about to play" today: the schedule import already
   knows who is in every match, and `alliances.js` only covers selection day.
   This is the one item in the series used before *every* match rather than once
   a weekend, and once the transpose exists it is close to free.

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

### Out of scope for the interface series (v0.72–v0.74)

Named so that series could actually close: no new analysis features, no graph
builder, no season retune.

It closed with v0.74. v0.75 opens a new charter — getting the data off the phones
and making it say something public data cannot — so the graph builder is in scope
again there, and the season retune moves to the January ritual it belongs to.

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

`METRIC_FIELDS` in `src/lib/form-config.js` is deliberately game-agnostic. Each
January:

1. Update labels, maximums and `higherIsBetter` flags.
2. Bump `SCHEMA_VERSION`.
3. Run the full test and build checks before deploying.

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
