# Database

The migrations in `migrations/` are the source of truth for this database.
Applied in filename order, they rebuild it from nothing.

## Audited live state

Verified against the live project on 2026-08-20: production is at `0024`,
`AUTH_ENFORCED` is true, and the old `0011`–`0013` drafts live under
`superseded/` rather than in the active sequence.
Do not infer production state from the presence of a migration file.

| Migration | Live state |
|---|---|
| `0001_entries.sql` | **Applied 2026-08-07** — the corrective run it had never had |
| `0002`–`0007` | Applied |
| `0008_auth.sql` | **Corrected version applied 2026-08-07** (guards + both triggers) |
| `0009_picklist.sql` | Applied |
| `0010_identity.sql` | Applied 2026-08-07 |
| `0011`–`0013` | Superseded; never applied in this sequence |
| `0016_real_emails.sql` | **Applied 2026-08-14** |
| `0017_managed_accounts.sql` | **Applied 2026-08-14** |
| `0018_revoke_from_anon.sql` | **Applied 2026-08-14** — grants, not behaviour |
| `0019`–`0023` | Applied; account/event cutover complete |
| `0024_username_sign_in_rate_limit.sql` | **Applied 2026-08-20** — before the function, per the ordering rule |

`username-sign-in` is deployed and ACTIVE (v1, `verify_jwt` **off** — it runs
before a session exists and is itself the credential check). Smoke-tested
against production 2026-08-20: a bad credential sent with no `Authorization`
header returns 401, which is the single result proving both that the public
route works and that `consume_username_sign_in_attempt` executed as
`service_role` — a failed rate-limit RPC returns 503 instead. The 11th attempt
returns 429 with `Retry-After`, and a different username from the same IP is
unaffected. `auth_logs` showed each probe reaching GoTrue as
`400 invalid_credentials`, not an API-key rejection; that distinction is the
only evidence separating "wrong password" from "the function's anon key is
broken and every login fails closed".

The `create-account` Edge Function is deployed and ACTIVE (v1, `verify_jwt`
on). Verified against the live endpoint rather than assumed: the CORS preflight
returns 200 without a token, and a POST without an `Authorization` header is
rejected by the platform with `UNAUTHORIZED_NO_AUTH_HEADER` before the handler
runs. `apikey` had to be added to `Access-Control-Allow-Headers` — supabase-js
sends it, and the preflight would have failed in a browser while passing under
curl.

`AUTH_ENFORCED` is true. Membership and account roles are the production
authorization boundary.

`0018` went ahead of `0016`/`0017` because it only narrows privileges and
depends on nothing they add. Order is safe in either direction: `0016` replaces
`redeem_invite`'s body, and `CREATE OR REPLACE` preserves the ACL.

After `0018`, `anon` can still execute exactly four functions —
`current_session_header`, `has_manager_token`, `peek_invite` and
`reset_event_data`. All four are load-bearing pre-cutover, because the manager
surfaces write as anon with a passphrase header; `0011` revokes the last three
and `0012` drops `has_manager_token` outright. The security advisor still warns
about three of them, and that is expected rather than outstanding.

The advisor's remaining *actionable* item is **leaked password protection**,
which is a dashboard setting: Authentication → Providers → Email. Worth turning
on before accounts are handed out.

## Project settings the migrations cannot set

Two dashboard toggles are load-bearing, and no SQL file can set or enforce
them. Both are one-time.

**Authentication → Email → Confirm email: OFF.** Invite registration calls
`signUp()` and immediately redeems the invite with the returned authenticated
session. Turning confirmation on changes that contract: signup may create the
Auth user without a session, so `redeem_invite` cannot run and the account is
left orphaned until email confirmation. Real addresses make confirmation
possible now, but the application intentionally keeps the one-step, venue-safe
flow and uses those addresses for password recovery instead.

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

| | Live | Should have been | Fixed by |
|---|---|---|---|
| `created_at` | `default now()` | no default | `0014` |
| `schema_version` | `default 2` | no default | `0014` |
| policies | included a `DELETE` grant | no delete | `0013` |
| policies | **no UPDATE policy at all** | update allowed | `0013` |
| `current_session_header()` | **absent** | present, `0011` needs it | `0013` |

The last two rows were not in the original audit. Both were found on 2026-08-07
by asking the live database instead of reading `0001`, and the missing UPDATE
policy had been losing scout corrections the whole time.

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
| `migrations/0001_entries.sql` | scouting entries + the session-scope helper — **corrective and re-runnable; run it on production** |
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
| `migrations/0024_username_sign_in_rate_limit.sql` | service-only email bridge and atomic rate buckets for private username authentication |
| `functions/username-sign-in/index.ts` | pre-auth username/password exchange; returns tokens, never the resolved email |
| `rollout/revoke_email_for_username.sql` | final compatibility gate; intentionally outside `migrations/` |
| `0013_applied_superseded.sql` | applied to production 2026-08-07, then removed from the sequence — it ran after `0011` and undid the cutover. Superseded by `0001`. |
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

### Two migrations are pending. `0001` fixes a live data-loss bug.

```bash
scripts/apply_pending_migrations.sh
```

**`0001` is the urgent one.** Verified on the live project 2026-08-07: `entries`
has `entries_session_delete`, `entries_session_insert` and
`entries_session_select`, and **no UPDATE policy**. With RLS on and no
permissive UPDATE policy, every edit matches zero rows — no error, nothing
written.

`pushUpdate()` reads a zero-row update as "the remote row was deleted
server-side" and re-inserts, so:

| A scout corrects… | Fingerprint | What actually happens |
|---|---|---|
| a count, a note (observations) | unchanged → `23505` | the client adopts the existing row; **the correction is discarded** and the UI says it saved |
| a wrong match or team number | changes → insert succeeds | **a duplicate row appears**; the stale original is never fixed |

`0001` already repairs both halves and names the bug in its own comments — but
`0001` CREATEs the table, so it can never be run against the table it describes,
and its repairs never reached production. `0013` carries just those two changes
forward.

`verify_entries.sql` does detect this. It had never been run against the live
project.

**`0013` also creates `current_session_header()`, and that is not incidental.**
The first attempt at `0013` failed on the live project with

    42883: function public.current_session_header() does not exist

`0001` is what creates that function, and `0001` can never run. Every other
pre-cutover migration inlines the expression instead — which is exactly why
`0002`–`0010` applied without anyone noticing it was missing, and why the live
`entries` policies carry the inlined form.

**`0011` calls it 38 times.** Without `0013` first, the cutover aborts on its
first policy, inside its own transaction, in the middle of the release window.
It would roll back cleanly; that is not the moment to find out.

Seven stages, run from the repo root. It reads the project ref out of
`src/lib/supabase.js` rather than asking, so it cannot be pointed at the wrong
database by a typo; probes the live schema over HTTP to decide what still needs
doing; opens the SQL editor at each step; and skips whatever is already applied.

**`0010` must be applied before the next `git push`.** This is not a preference.
The client selects and inserts `profile_id` on `assignments`,
`assignment_overrides` and `reminders`. Production does not have those columns
yet — confirmed 2026-08-07:

    GET /rest/v1/assignments?select=profile_id
    → 400  {"code":"42703","message":"column assignments.profile_id does not exist"}

Deploying the current client against that schema breaks assignment **reads**,
so scouts lose their team lists and every sync tick throws. `0010` is additive,
changes no policy, and is safe mid-season.

`0008` is the other one, and it is not urgent — production simply keeps the
original broad UPDATE policy on `profiles` until it runs.

Neither is the cutover. `0011` is the one-way door and the client still ships
`AUTH_ENFORCED = false`.

`0008` is live in its **pre-hardening** form. The corrected version can simply be
re-run; it does not need a forward corrective migration.

```bash
scripts/rebuild_prod_replica.sh    # needs supabase start
```

**Rehearse against that, not against `supabase db reset`.** `db reset` applies
`0001`, and production never has, so it starts from a database where the repairs
already happened — which is why `0013` rehearsed clean and then failed on the
live project. The replica script builds `supabase/live_baseline.sql` (the
dashboard-built `entries` table, defects included) then `0002`–`0007`, the
pre-hardening `0008`, `0009`, `0010` and `0013`.

Verified 2026-08-07: the replica matched production on every observable — same
policy set, same two column defaults, same two `0008` FAILs, same `0010 complete`.
Then, on it, `0001` and the corrected `0008` both applied clean, kept every
seeded row, and left both verifiers at zero FAILs. The current `0008` applied on top cleanly, kept
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

## Password recovery UI is not wired

Accounts created since `0016` use a real address in `auth.users.email`, so
Supabase Auth can send recovery mail to them. The application still has no
forgot-password request screen or recovery callback route, so self-service
recovery is incomplete at the client. `profiles.recovery_email` is the
manager-visible copy used to spot typos; GoTrue continues to send to
`auth.users.email`.

Four accounts on production predate `0016` and still hold
`<username>@scout.invalid`. They sign in normally — the address is an
identifier, not a mailbox — but no recovery mail can ever reach them, so those
four are a manual admin reset regardless of what the client grows later.
