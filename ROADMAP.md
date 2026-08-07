# FRC Scout — consolidated roadmap

This is the single planning document. Older improvement drafts and handoff
documents were folded into it; update this file instead of starting another
plan.

Last audited: 2026-08-03.

> **Live state, verified read-only:** migrations `0007`, `0008` and `0009` are
> applied. `0010` and `0011` are not. `AUTH_ENFORCED` is `false`, so the manager
> passphrase remains the production authorization path. The hardening changes in
> the local working tree have not been deployed and no migration was run against
> the live project as part of this work.
>
> **Local, 2026-08-06:** `0001`–`0012` now apply cleanly to a real Postgres and
> pass 59 behavioural RLS assertions (`supabase start && npm run test:rls`). The
> SQL was never the problem; the scripts that verify it were. This says nothing
> about the live project, which still has the original `0008`.

## Where the app is now

| Area | Current state |
|---|---|
| Offline scouting and sync | Shipped; IndexedDB remains the write target and edits sync via `updated_at` |
| Schedule, assignments and coverage | Shipped; schedule UI is split into scouting components and auto-assign uses DSATUR |
| Metrics and manager analysis | Shipped across Insights, team detail, compare, CSV and picklist scoring |
| Picklist and alliance selection | Cloud-synced picklist and live taken-team state shipped; real-event refinements remain |
| Information architecture and design system | Route move and token/contrast enforcement shipped |
| Accounts and roles | Account UI and database objects exist, but enforcement and identity conversion are incomplete |
| Studio and expanded Insights | Not started |

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

## Auth upgrade: current implementation state

Full rationale: [`docs/adr-001-auth.md`](docs/adr-001-auth.md). Database
operations: [`supabase/README.md`](supabase/README.md).

### Live today

- `0008_auth.sql` objects are present: `profiles`, `invites`, role helpers,
  invite RPCs and `entries.submitted_by`.
- Public signup is enabled and email auto-confirm is on.
- `0009_picklist.sql` is present.
- `0010_identity.sql` columns are absent.
- `0011_policies.sql` has not replaced the legacy policies; anonymous
  event-scoped access still works.
- The client keeps `AUTH_ENFORCED = false` and still sends manager passphrases.

### Hardened locally, not deployed

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

## Auth upgrade: remaining work in dependency order

The cutover is **not ready**. Complete these steps in order.

1. **Choose the forward-migration shape.** Preserve a record of the live schema
   and move hardening for already-applied `0008` into a forward migration, or
   prove a rerun is safe in a disposable clone. Do not rely on edited historical
   SQL magically reaching production.

2. **Build a real staging environment and account fixtures.** Create anon,
   orphaned-auth, scout, manager and super identities across at least two event
   IDs. Exercise invite expiry, concurrent redemption, duplicate usernames,
   revocation and role changes.

3. **Apply and inspect the identity expand step.** Run `0010_identity.sql` in
   staging, review every unmatched or ambiguous name, and rerun its conservative
   backfill only after the intended profiles exist. Never guess a UUID for an
   ambiguous person.

4. **Convert client identity to profile UUIDs.** Dual-write
   `submitted_by`/`profile_id` while compatibility names remain. Prefer UUIDs for
   assignment, override and targeted-reminder reads, and display the signed-in
   account identity rather than the locally typed scout name.

5. **Convert every shared-data request to the account authorization path.**
   Remove `managerToken` parameters, `x-manager-token` construction and
   passphrase gating from sync, schedules, assignments, overrides, reminders,
   event metadata, picklist and archive/reset flows. Remove the passphrase UI in
   the same client release that expects role policies.

6. **Implement live Postgres/RLS tests.** ✅ Done — `npm run test:rls`, 59
   assertions against a real local stack, mutation-tested. Static SQL inspection
   is not enough. It proves:

   - anon and orphaned users see and change no event data;
   - members cannot cross event scopes by changing either headers or row data;
   - scouts can record/correct entries but cannot use manager surfaces;
   - no one can forge or clear entry attribution;
   - managers cannot promote themselves or anyone else to super;
   - only super users can promote/demote or delete super users;
   - every manager table and RPC behaves as intended;
   - archive/reset clears only the current event's planning state and preserves
     scouting entries.

7. **Resolve password recovery.** `profiles.recovery_email` is not functional:
   Supabase recovery sends to `auth.users.email`, which is the derived
   `<username>@scout.invalid` address, and never reads the profile column. A
   working self-service reset requires trusted server-side code, most likely an
   Edge Function using the Auth admin API after verifying the recovery contact.
   Until then, document recovery as a manual admin operation.

8. **Rehearse the coordinated release.** Bootstrap a super, create the real
   invites, make each device sign in while online, verify offline entry capture,
   then rehearse `0011` plus the client flag against production-like data. Write
   the rollback and verification queries before starting.

9. **Cut over between events.** Deploy the UUID/passphrase-converted client with
   `AUTH_ENFORCED = true` and apply `0011` as one coordinated release. Applying
   either half alone produces a broken or insecure hybrid.

10. **Verify and soak.** Repeat the role/event matrix against the live project,
    test normal phones offline and online, inspect sync errors, then remove only
    the compatibility code and columns proven obsolete.

## Target auth model

Accounts replace the manager passphrase; they do not replace event codes.

- **Event code:** which event the row belongs to. It remains the `session_id`
  partition and every policy checks it against `x-session-id`.
- **Profile:** whether the authenticated user is a team member.
- **Role:** what that member may do. Scouts record; managers operate event
  planning surfaces; supers control privileged account transitions.
- **Attribution:** immutable UUID on the row, not a free-text name supplied by
  the client.

Invite-based self-registration remains the static-hosting-compatible account
flow. Manager-created Auth users require `service_role`, which cannot ship in a
GitHub Pages bundle.

### Offline rule

Login may require a network. Recording may not.

- The IndexedDB write path never checks auth.
- Token refresh failure never discards unsaved work or redirects a scout away
  from the form.
- Sync waits and retries when a usable session returns.
- Devices should sign in before leaving for the venue and keep a long-lived,
  rotating refresh token through the event weekend.

## Product work after the security cutover

Security and identity come first because later manager surfaces would otherwise
build on the wrong authorization and join keys.

1. **Alliance-selection field test.** Use the current board at a real selection
   before deciding whether picked teams auto-collapse or a second-pick ranking
   needs separate state. Improve Compare around the actual “these two are left”
   decision.
2. **Page composition pass.** The design system and route move are complete;
   refine hierarchy and density page by page based on real use.
3. **Studio and expanded Insights.** Add a desktop-first `/studio/*` route group
   with shared tokens, a sidebar and a small fixed set of decision-oriented
   charts. Do not start with a drag-and-drop chart builder.
4. **Operational polish.** Supply the TBA key through the build environment,
   retain the paste fallback for forks, and relabel reset scheduling as Archive
   event with precise preservation copy.

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
