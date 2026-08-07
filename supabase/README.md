# Database

The migrations in `migrations/` are the source of truth for this database.
Applied in filename order, they rebuild it from nothing.

## Audited live state

Read-only probes on 2026-08-03 found this deployment state:

| Migration | Live state |
|---|---|
| `0001`–`0006` | Existing baseline; not individually re-verified in this audit |
| `0007_entry_updated_at.sql` | Applied (`entries.updated_at` exists) |
| `0008_auth.sql` | Applied (profiles/invites/RPCs and `submitted_by` exist) |
| `0009_picklist.sql` | Applied (picklist and alliance schedule fields exist) |
| `0010_identity.sql` | Not applied (`profile_id` fields are absent) |
| `0011_policies.sql` | Not applied (legacy anonymous/session policies still answer) |
| `0012_passphrase_cleanup.sql` | Not applied (removes the inert passphrase objects after 0011 soaks) |

The client also has `AUTH_ENFORCED = false`. Accounts are therefore additive,
not the production authorization boundary. The local migration edits described
below have **not** been run against Supabase.

## Project settings the migrations cannot set

Two dashboard toggles are load-bearing, and no SQL file can set or enforce
them. Both are one-time.

**Authentication → Email → Confirm email: OFF.** Not optional. **With this on,
registration is impossible** — not slow, not manual. Impossible.

Every address here is `<username>@scout.invalid`. `.invalid` is reserved by
RFC 2606 as permanently unroutable, deliberately: the address is an identifier
and not a mailbox. With Confirm email on, GoTrue tries to send a confirmation
message, and its mailer validates the RECIPIENT before sending. `.invalid` fails
that check, so signup returns

    Email address "someone@scout.invalid" is invalid

and no account is created. The message points at the address, so you go and look
at the address — which is the wrong place. The address is fine. Nothing is
sending mail once this is off, so nothing validates the recipient.

Two other symptoms of the same cause, both misleading:

  · `over_email_send_rate_limit` (HTTP 429) on repeated signups. The built-in
    SMTP allows only a handful of sends per hour, and every signup was
    attempting one. With Confirm email off, no mail is sent, so registration
    stops consuming that budget at all.
  · Accounts created through the dashboard's **Add user** work fine, because the
    admin API skips both the mailer and its recipient validation. That
    asymmetry makes the scheme look verified when it is not — it is how this was
    missed in the first place.

Turning it off does not retroactively confirm accounts created through
"Add user" while it was on
([supabase#29632](https://github.com/supabase/supabase/issues/29632)). Tick
"Auto Confirm User" when creating one by hand.

The toggle is not always in the Email provider card — the dashboard has moved it
between **Sign In / Providers → Email** and a separate **Authentication →
Emails** section. Rather than hunt for it, read the setting:

```js
await (await fetch('https://<project>.supabase.co/auth/v1/settings',
  { headers: { apikey: '<anon key>' } })).json()
```

`mailer_autoconfirm: true` means Confirm email is off, which is what you want.

**Secure email change: OFF** for the same reason — it confirms to both the old
and the new address, neither of which exists.

`verify_migrations.sql` reports any account with a null `email_confirmed_at`,
which is the symptom this produces.

## The one rule

**Do not change the schema through the Supabase dashboard.**

Write a migration, run it, commit it. Not because dashboard edits are wrong in
themselves, but because they leave no trace — and this project already learned
what that costs.

The `entries` table, which holds every scouting entry the app has ever
recorded, was created by clicking through the dashboard. Migrations started at
`0002`. For months the repo could not rebuild the database, nobody could review
those RLS policies in a pull request, and when the time came to change them
there was no known starting state to change *from*. Recovering it meant
querying the live database to find out what we had actually built.

Three specific things had drifted, and none of them announced itself:

| | Live | Should have been |
|---|---|---|
| `created_at` | `default now()` | no default |
| `schema_version` | `default 2` | no default |
| policies | included a `DELETE` grant | no delete |

The `schema_version` default is the one that had already caused a real bug: the
client hardcoded `2` while `form-config.js` moved to `3`, so entries containing
counter metrics claimed to predate them — and that column exists precisely to
tell "never collected" apart from "recorded zero", an invariant enforced by
`lib/metrics.js` and its tests.

## Applying migrations

Paste each file into the Supabase SQL editor in order, or use the CLI. The
migrations are written to be corrective and re-runnable where practical, but
that does not make the auth cutover routine: read the preconditions for `0010`
and `0011`, test them in a disposable project, and prepare rollback steps before
touching production.

**The SQL editor shows only the last statement's result set.** A script of six
`SELECT`s displays the sixth and discards the rest, which is an easy way to
conclude a table has no policies when you simply never saw them.

## Checking for drift

```sql
-- paste supabase/verify_migrations.sql into the SQL editor
```

Asserts that 0007, 0008 and 0009 landed: every table, column,
function, trigger and index they create, RLS switched on, at least one policy
per table, `search_path` pinned on every SECURITY DEFINER function, and that the
username index is genuinely UNIQUE and on `lower()`. **Run this after applying
them** — the editor shows only the last statement's result, so an early failure
can look exactly like a script that succeeded.

The audit's read-only probes confirmed the key live markers for those three
migrations. The verification script checks existence, not behavior. A policy
can be present and permit the wrong thing; finding that out requires JWT-backed
behavioral tests against Postgres.

```sql
-- paste supabase/verify_entries.sql into the SQL editor
```

It asserts rather than describes: every row is `PASS` or `FAIL`, failures sort
to the top. A check that requires someone to compare two things by eye is a
check nobody runs — this one answers yes or no.

Run it after applying a migration, after anyone touches the dashboard, and
before each season.

## What the automated checks do and do not prove

`npm test` covers IndexedDB upgrades, metrics, assignment logic, dialog and sync
rules, auth helpers, picklist/alliance behavior, design-system constraints and
static auth-policy invariants. In particular, `auth-policies.test.mjs` now pins
profile role/identity guards, membership plus event scoping, attribution
triggers, grants and the role-based reset RPC.

Those checks do not connect to Postgres. `npm run check:sql` proves grammar, and
the verification scripts prove selected live objects exist, but neither proves
RLS behavior.

```bash
supabase start && npm run test:rls
```

`scripts/check_rls.mjs` does prove it. It applies every migration to a real
local Postgres, then signs in as anon, an authenticated user with no profile,
a scout, a second scout, a manager and a super across two event IDs, and makes
the requests the app makes — through PostgREST, because `current_session_header()`
reads `request.headers` and only an HTTP request has any. 59 assertions covering
event scoping in both directions, attribution forging and clearing, role
transitions, invite visibility and `reset_event_data()`.

It is kept out of `npm test` on purpose: a missing local stack means Docker is
not running, which is not a failing test, so it skips and exits 0.

Every assertion has been mutation-tested — the policies were deliberately broken
and the suite confirmed red — because a security test that cannot fail is worse
than none. One assertion did not survive that: `a scout cannot write schedules`
inserted into a table keyed on `session_id` alone, collided with the row the
event already had, and stayed green while `is_manager()` was stubbed to return
`true`. It now updates instead, and `denied()` distinguishes a policy refusal
from a unique violation.

## Checking syntax

```
npm run check:sql
```

Parses every `.sql` file against the real PostgreSQL grammar (libpg_query, via
`pglast`). CI runs this on every push, so a stray quote is caught in a pull
request rather than halfway through a migration with the database left in a
partly-applied state.

It validates syntax, not semantics — a reference to a table that doesn't exist
still parses fine.

## Files

| File | |
|---|---|
| `migrations/0001_entries.sql` | scouting entries + the session-scope helper |
| `migrations/0002_schedule_and_assignments.sql` | event meta, schedules, assignments, `has_manager_token()` |
| `migrations/0003_reset_event_data.sql` | clears scheduling state, preserves entries |
| `migrations/0004_reminders.sql` | manager-authored reminders |
| `migrations/0005_assignment_overrides.sql` | per-match scout overrides |
| `migrations/0006_tba_event_key.sql` | TBA key decoupled from the sync code |
| `migrations/0007_entry_updated_at.sql` | edit watermark, so corrections reach teammates |
| `migrations/0008_auth.sql` | accounts, roles, invites and profile update guards — **live but additive** |
| `migrations/0009_picklist.sql` | the picklist, one row per team; alliances on `schedules` |
| `migrations/0010_identity.sql` | `profile_id` beside `scout_name` — **not applied; expand/backfill stage** |
| `migrations/0011_policies.sql` | hardened membership + event RLS and role cutover — **not applied; one-way door** |
| `migrations/0012_passphrase_cleanup.sql` | drops the inert `has_manager_token()` and `manager_token` — **not applied; after 0011 has soaked** |
| `verify_entries.sql` | drift assertions for `entries`, read-only |
| `verify_migrations.sql` | did 0007/0008/0009 land? read-only |

`0010` and `0011` split what could have been one migration on purpose.

Swapping the identity key and swapping the policies are independent changes
with different risk. Together they make one irreversible step where a failure is
ambiguous — did the policy break, or did the join? Apart, they are
expand/migrate/contract: `0010` adds `profile_id` and backfills while changing
no policy. The client then has to dual-write and read UUID identity before
`0011` changes the security boundary. Neither stage has been deployed.

The local versions additionally revoke the one-time `profile_for_name()` helper
from API roles. It is for migration-owner backfill only, not a roster lookup RPC.

See [`../docs/adr-001-auth.md`](../docs/adr-001-auth.md).

## The auth cutover, when you get to it

The passphrase is being **replaced**, not supplemented. `0011` drops
`has_manager_token()`, drops `event_meta.manager_token`, and rewrites the
policies that currently call it. It also rebuilds every policy on the event-data
tables, explicitly enables RLS, requires both a real profile and the matching
`x-session-id`, stamps/preserves `entries.submitted_by`, and replaces the
passphrase-dependent `reset_event_data()` with a manager-role check. Two
parallel authorization systems is how you get a hole in one.

`0008` is already live and is additive on purpose: accounts can exist while
nothing requires one. Two things eventually flip together, and neither alone
is safe:

1. `AUTH_ENFORCED = true` in `src/lib/auth.svelte.js`
2. Migration `0011`

Flipping the flag without 0011 locks the UI while leaving the data open.
Applying 0011 without the flag locks the data while the UI still offers the
old path. `src/lib/auth.test.mjs` asserts the flag is still false, so the
tripwire fires when someone changes it.

Before either switch:

1. Test invite/registration behavior in a disposable database.
2. Apply and inspect `0010`; resolve, rather than guess, unmatched identities.
3. Convert every client read/write from passphrases and free-text identity to
   authenticated requests and profile UUIDs.
4. Run live RLS tests for anon, orphaned, scout, manager and super identities,
   including attempts to cross event scopes.
5. Bootstrap a super user, create the real accounts and sign every device in.
6. Apply `0011` and deploy the converted client with `AUTH_ENFORCED = true` as
   one coordinated release.

### Re-running 0008 is safe — rehearsed, not assumed

```bash
scripts/apply_0008.sh
```

Five stages, run from the repo root. It reads the project ref out of
`src/lib/supabase.js` rather than asking, so it cannot be pointed at the wrong
database by a typo; refuses to start unless a preflight query confirms the
original `0008` is live and `0010` is not; opens the SQL editor at each step;
and finishes by checking `mailer_autoconfirm` over HTTP. Every expected result
it quotes was measured against a local database rebuilt to the live shape, not
predicted.

It applies `0008` and nothing else. `0011` is the one-way door and the client
is not converted.

`0008` is live in its **pre-hardening** form. The corrected version can simply be
re-run; it does not need a forward corrective migration.

Rehearsed 2026-08-06 on a disposable local database built to the live shape —
`0001`–`0007`, the 335-line `0008` from `d5cb14e`, then `0009` — seeded with a
profile, an invite and an entry. The current `0008` applied on top cleanly, kept
all three rows, and installed `guard_profile_update` and its two triggers. It
works because `0008` drops every policy on `profiles` and `invites` before
recreating them, so the original's broad UPDATE policy is *replaced*. Left
beside the new ones it would still grant, because permissive policies OR
together.

Continuing that same database through `0010`–`0012` passed all 59 RLS
assertions and both verifiers, so the upgrade path and a from-scratch build
end in the same state.

### Still unverified

Registration to a `.invalid` address was confirmed working locally, and
`GET /auth/v1/settings` returns `mailer_autoconfirm: true` as documented above.
The *negative* half — that turning Confirm email on makes registration
impossible — has not been executed here; it remains reasoning plus the
production incident that produced it.

The current client conversion is incomplete, so the cutover is **not ready**.
See [`../ROADMAP.md`](../ROADMAP.md) for the dependency-ordered checklist. Once
policies require a member profile, an unsigned device stops syncing; schedule
the release between events and leave time for ordinary-device soak testing.

## Password recovery is not wired

`profiles.recovery_email` is metadata only. Supabase Auth recovery sends to
`auth.users.email`, which in this design is the derived and unroutable
`<username>@scout.invalid` address. GoTrue does not consult the profile column.

A functional self-service reset therefore needs trusted server-side code, such
as an Edge Function using the Auth admin API after verifying the recovery
contact. Until that is implemented, recovery is a manual admin process; do not
present the profile field as a working reset channel.
