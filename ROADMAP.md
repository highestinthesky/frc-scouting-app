# FRC Scout — consolidated roadmap

This is the single planning document. Older improvement drafts and handoff
documents were folded into it; update this file instead of starting another
plan.

Last audited: 2026-08-08. Planning v0.6 — see below.

> **Live state, verified 2026-08-07.** `0001`, `0002`–`0010` and the corrected
> `0008` are applied; `verify_migrations.sql` and `verify_entries.sql` both
> return zero FAILs against the live project. `0011` and `0012` remain unapplied
> and `AUTH_ENFORCED` is still `false`, so the manager passphrase is still the
> production authorization path. The committed client is safe to deploy.
>
> Three things were found and fixed that day, none of which the previous audit
> knew about, and all of which trace to `entries` having been built by clicking:
>
> - **`entries` had no UPDATE policy.** Scout corrections had never reached the
>   cloud — observation edits were silently discarded, match/team edits
>   duplicated the row. `0001` contained the fix the whole time.
> - **`current_session_header()` did not exist.** `0011` calls it 38 times, so
>   the cutover would have aborted on its first policy.
> - **`0001` was believed unrunnable** and is not: `IF NOT EXISTS` throughout.
>   It was always the repair for that table and had simply never been run.
>
> Rehearse future migrations with `scripts/rebuild_prod_replica.sh`, not
> `supabase db reset` — the latter applies `0001`, which production had not, and
> that gap is what made three earlier rehearsals worthless.

## Where the app is now

| Area | Current state |
|---|---|
| Offline scouting and sync | Shipped; IndexedDB remains the write target and edits sync via `updated_at` |
| Schedule, assignments and coverage | Shipped; schedule UI is split into scouting components and auto-assign uses DSATUR |
| Metrics and manager analysis | Shipped across Insights, team detail, compare, CSV and picklist scoring |
| Picklist and alliance selection | Cloud-synced picklist and live taken-team state shipped; real-event refinements remain |
| Information architecture and design system | Route move and token/contrast enforcement shipped |
| Accounts and roles | Account UI and database objects exist; v0.6 replaces the invite flow with manager-created accounts |
| Studio and expanded Insights | Not started — v0.6 Phase 5 |

The current production model is still hybrid:

- The event code hashes to `session_id` and partitions all shared data.
- IndexedDB accepts scouting entries offline and sync retries later.
- Live privileged writes still use `x-manager-token` and
  `has_manager_token()`.
- Supabase Auth profiles and invites exist, but login is optional because
  `AUTH_ENFORCED` is off.

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
thousand requests to harvest a named scout's email; six is a million.

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

**4b — the client. Not started.** This is the remaining work:

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

**4c — contract.** Once 4b ships and has soaked: drop `session_id`, the old
policies, and the passphrase objects. This is what supersedes `0011`/`0012`.

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

### Phase 5 — Manager Studio

New surface, built on everything above. A route group with a left sidebar and
tabs — Schedule, Graphs, more later — that the draft wants to feel like a
separate, more futuristic application, opened in a new tab from Insights.

The draft marks the drag-and-drop graph builder *"to be developed later due to
difficulty"*, which is the right call: start with a small fixed set of
decision-oriented charts and see what actually gets used at the offseason event.

---

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
