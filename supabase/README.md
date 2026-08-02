# Database

The migrations in `migrations/` are the source of truth for this database.
Applied in filename order, they rebuild it from nothing.

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
tell "never collected" apart from "recorded zero", the invariant
`lib/metrics.js` and eight of its tests defend.

## Applying migrations

Paste each file into the Supabase SQL editor in order, or use the CLI. They are
written to be idempotent and corrective — safe to re-run, and they `ALTER` an
existing table rather than silently skipping it.

**The SQL editor shows only the last statement's result set.** A script of six
`SELECT`s displays the sixth and discards the rest, which is an easy way to
conclude a table has no policies when you simply never saw them.

## Checking for drift

```sql
-- paste supabase/verify_migrations.sql into the SQL editor
```

Asserts that 0007, 0008 and 0009 actually landed: every table, column,
function, trigger and index they create, RLS switched on, at least one policy
per table, `search_path` pinned on every SECURITY DEFINER function, and that the
username index is genuinely UNIQUE and on `lower()`. **Run this after applying
them** — the editor shows only the last statement's result, so a 173-statement
script that fails at statement 40 looks exactly like one that succeeded.

It checks existence, not behaviour. A policy can be present and permit the wrong
thing; finding that out means signing in as two different people and trying.

```sql
-- paste supabase/verify_entries.sql into the SQL editor
```

It asserts rather than describes: every row is `PASS` or `FAIL`, failures sort
to the top. A check that requires someone to compare two things by eye is a
check nobody runs — this one answers yes or no.

Run it after applying a migration, after anyone touches the dashboard, and
before each season.

## What the client assumes about this schema

`npm test` covers the client side of these tables:

| | |
|---|---|
| `src/lib/db.test.mjs` | the IndexedDB version bumps, against a real (faked) IndexedDB — including the v2 → v3 upgrade with existing data, and the legacy picklist migration |
| `src/lib/picklist.test.mjs` | rank arithmetic and per-team merge |
| `src/lib/alliances.test.mjs` | TBA's alliance payload |

None of them talk to Postgres. A migration that parses and a client that passes
its tests can still disagree — `verify_entries.sql` is what checks the live
database, and it only covers `entries`.

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
| `migrations/0008_auth.sql` | accounts, roles, invites — **additive**, nothing enforced yet |
| `migrations/0009_picklist.sql` | the picklist, one row per team; alliances on `schedules` |
| `verify_entries.sql` | drift assertions for `entries`, read-only |
| `verify_migrations.sql` | did 0007/0008/0009 land? read-only |

Planned next: `0010_policies.sql`, the cutover — swaps every policy to
`to authenticated`, replaces `has_manager_token()` with `is_manager()`, and
deletes the passphrase machinery. See
[`../docs/adr-001-auth.md`](../docs/adr-001-auth.md).

## The auth cutover, when you get to it

The passphrase is being **replaced**, not supplemented. `0010` drops
`has_manager_token()`, drops `event_meta.manager_token`, and rewrites all 18
policies that currently call it. Two parallel authorisation systems is how you
get a hole in one.

0008 is additive on purpose: accounts exist and work, and nothing requires
one. Two things flip together, and neither alone is safe:

1. `AUTH_ENFORCED = true` in `src/lib/auth.svelte.js`
2. Migration `0010`

Flipping the flag without 0010 locks the UI while leaving the data open.
Applying 0010 without the flag locks the data while the UI still offers the
old path. `src/lib/auth.test.mjs` asserts the flag is still false, so the
tripwire fires when someone changes it.

Before either: every person needs an account, and one super user has to exist.
The bootstrap steps are at the bottom of `0008_auth.sql`.

Full sequence in [`../ROADMAP.md`](../ROADMAP.md) § Phase 1. It is a one-way
door — once policies require an authenticated user, a device that has not signed
in stops working. Do it between seasons.
