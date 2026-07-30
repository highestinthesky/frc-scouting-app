# Database

The migrations in `migrations/` are the source of truth for this database.
Applied in filename order, they rebuild it from nothing.

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
-- paste supabase/verify_entries.sql into the SQL editor
```

It asserts rather than describes: every row is `PASS` or `FAIL`, failures sort
to the top. A check that requires someone to compare two things by eye is a
check nobody runs — this one answers yes or no.

Run it after applying a migration, after anyone touches the dashboard, and
before each season.

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
| `verify_entries.sql` | drift assertions, read-only |

Planned next: `0007_auth.sql` and `0008_policies.sql` — see
[`../docs/adr-001-auth.md`](../docs/adr-001-auth.md).
