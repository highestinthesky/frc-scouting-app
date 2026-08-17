# FRC Scout

Offline-first scouting PWA for FRC team 3419. SvelteKit 2 + Svelte 5 runes,
`adapter-static`, deployed to GitHub Pages. IndexedDB is the write target;
Supabase is the shared mirror. JavaScript with JSDoc, not TypeScript.

## Working agreements

- **Commit freely; leave `git push` to the user.** A push deploys.
- **`ROADMAP.md` is the only plan document.** Update it rather than starting a
  second one — two earlier plans and a handoff were folded into it.
- **Plan a version series before shipping into it.** Every `v0.7x` release is
  enumerated in `ROADMAP.md` before any of them ships, and v0.8 does not begin
  until the 7 series closes. This rule exists because v0.6 finished and the work
  simply kept going into v0.67–v0.71 with no plan behind the numbers — which is
  how a version number stops meaning anything.

  A release may span several commits, and **an overhaul is allowed to stay on
  `v0.x`** rather than forcing a major bump; the series is the unit of planning,
  not the commit.
- Existing structure is a **baseplate**. Reorganising it aggressively is fine.
  The invariants below are what isn't negotiable.

## Invariants

**Blank is not zero.** Blank means *not recorded*; `0` means *recorded and it
was zero*. `readMetric()` in `src/lib/metrics.js` enforces it and eight tests
defend it, so an entry predating a metric contributes nothing to that metric's
sample instead of dragging its mean toward zero. `schema_version` on each row is
what tells the two apart.

**Recording never depends on auth.** `src/lib/db.js` keeps its write path free
of `auth.svelte.js`; keep that import absent. A scout with an expired token, a
revoked account or no signal still writes to IndexedDB. Only sync waits.

**A failed token refresh keeps the session.** It marks sync stale and retries.
A scout in a dead corner of the gym when a refresh fires is holding unsaved work,
and signing them out is how it gets lost. Route guards ask "has this device ever
signed in", not "is this token valid now".

Access tokens last **four days**, not the Supabase default hour — see the session
settings below. That makes a refresh during an event unlikely rather than
hourly, which is belt to this braces, not a replacement for it.

**`0011`, `0012` and `0013` live in `supabase/superseded/`, not `migrations/`.**
None was ever applied to production. `0019` and `0020` replaced them and
borrowed what was right: membership gating, role gating, the attribution trigger
and passphrase removal. `0020` still drops `0011`'s policy names so a database
that did receive them converges.

Filename order is why they had to leave rather than sit unapplied: a local
`db reset` applies everything in `migrations/`, so leaving them there builds a
shape production will never have — which is the rehearsal-fidelity problem this
file keeps returning to.

**The cutover happened.** `AUTH_ENFORCED` is `true` and `0020` is written; the
two flip together and neither is safe alone. The flag alone locks the UI while
the data stays open to anyone holding the event code, which is published on The
Blue Alliance; the migration alone locks the data while the UI still offers a
passphrase and every write silently fails.

`src/lib/auth.test.mjs` still asserts the flag, now pointing the other way —
turning it back off would be the dangerous move, because the database no longer
has an anonymous path and the UI would offer writes that all fail.

**`0020`–`0022` are applied to production** (2026-08-17), and how `0020`
got there is the lesson. It had to land *after* a push, so the client shipped
first — and then the migration was forgotten. For three days production had a
client that no longer sent `session_id` and eight tables where the column was
still `NOT NULL`, so every write failed a not-null constraint.

It surfaced as "syncing is broken" with one telling detail: dragging a scout
onto an event still worked. `event_scouts` is a `0019` table with no
`session_id` — the one write path that did not touch the broken column, and the
control case that located the cause.

**A client change that depends on a migration must not be pushed before the
migration is on production.** That ordering was already written down here. It
failed anyway, because nothing enforced it and the two halves were days apart.

**A grant is not what a comment says it is.** `0021` granted
`UPDATE (deleted_at)` to `authenticated` under a comment asserting "a scout is
deliberately NOT given this". `entries_evt_update` already permits a row where
`submitted_by = auth.uid()`, so a scout editing their own entry was inside the
policy and the grant handed them the tombstone. `0022` replaced it with
`withdraw_entry()`.

Two assertions cover it, not one, and that split is the point: the RPC's
authority check and the column grant are separate holes, and the RPC being right
is exactly what made the grant look fine. Mutating either turns its own
assertion red and leaves the other green.

**The `entries` dedupe index is a content fingerprint** —
`[eventCode+matchNumber+teamNumber+scoutName+createdAt]`. Sync relies on it
raising `23505` so it can adopt the existing row's id. Identity stays out of it:
adding `submitted_by` or `profile_id` would turn two devices' record of one
observation into two rows.

**`scout_name` is a join key, not a label, and `scout-identity.js` owns it.**
Never compare the string in a new place. `sameScout()` decides whether two rows
describe one person — two accounts compare accounts, anything else compares
normalised names — and `rowScout()` absorbs the three column names the same
concept travels under (`profile_id`, `entries.submitted_by`, and camelCase in
IndexedDB). Writes go through `identityFields()` so both columns are filled.

The rule has to live in one place because the codebase used to disagree with
itself: the assignment join, override filter and reminder targeting compared
`trim().toLowerCase()` while the insights filter, duplicate-entry warning and
distinct-scout count compared raw strings, so "Ning" and "ning" were one scout
to three call sites and two to the other three.

**There is no local role toggle.** `role.svelte.js` was a self-asserted setting
in IndexedDB that revealed the manager surfaces to anyone who ticked it, and its
own header still described the file-import workflow that had been removed. Two
questions replaced it, both owned by `auth.svelte.js`: `canManage` is *may this
write succeed* and `showsManagerTools` is *should the surface render at all*.
Both are now the account's role and nothing else.

They used to differ, and the reason is worth keeping: the passphrase entry form
lived inside the surface it unlocked, so gating the surface on already holding
the passphrase sealed the only door to it. There is no door now — the role
arrives with the session — but the pair stays split because they are still two
questions, and `check_components.mjs` fails the build if a caller re-derives
either.

**Signing in fills `session.scoutName`, but only when it is blank.** That
restriction is load-bearing: the name is still the join key, so overwriting one
a device already had would silently detach it from every assignment, override
and reminder addressed to the old spelling.

**The event code is a label. `session_id` is gone.** `0019` made events real
rows with membership deciding access; `0020` dropped `session_id` from all eight
tables along with 29 policies, `has_manager_token()` and the passphrase.
`events.code` survives because The Blue Alliance's API is keyed on it and the
schedule import needs it — but knowing it grants nothing.

`eventIdForCode()` is the only resolver, and it needs a session. That is what
makes "record but do not sync" fall out of the schema rather than being a second
check that could disagree with it. `scopeIdForCode()` existed for one release as
a fallback for the passphrase-era manager surfaces and died with them.

Two superseded notes, for anyone reading old commits: *the event code is going
away in Phase 4, not before — it is still the `session_id` partition on every
shared table*, and later, *every write sets both columns until Phase 4c drops
one.* `docs/adr-001-auth.md` says accounts replace the passphrase and not the
event code; the v0.6 draft supersedes that, replacing it with an `events` table
and an `event_scouts` membership join.

That is a change of architecture, not a tidy-up. It dissolves two problems
rather than working around them: the code is published on The Blue Alliance so
it was never a secret, and "which events may I see" was circular, because you
needed the code to read `event_meta` at all.

`auth.me` is who this device is. Its **label stays `session.scoutName`**, not
`displayName` — the typed name is still what most rows join on, and a device
announcing itself as "Haolun Ning" would stop matching everything addressed to
"Ning". Display is a separate question: use `auth.displayName` for that.

## Svelte traps that already shipped

**Scoped CSS changes specificity.** Svelte scopes by injecting a hash class onto
the selector, so `.dlg { display: flex }` compiles to `(0,2,0)` and beats the
browser's own `dialog:not([open]) { display: none }` at `(0,1,1)`. This shipped
once and every page rendered a stray Confirm/Cancel pair.
`scripts/check_components.mjs` reads *emitted* CSS rather than source for
exactly this reason.

**A parent cannot style a child through a `class` prop.** The scoping hash
belongs to the parent and the child's styles never see it. The compiler stays
quiet, because it can see the class sitting right there in the markup. Two
layouts broke silently this way. Give the child a variant prop and let it own
its styles.

**`var(--ok, var(--accent))` is the pattern to watch.** A fallback renders a
missing token as a plausible-looking colour instead of an obvious break. Two
were live, drawing "improving" trends in brand purple.

`check_components.mjs` and `check_contrast.mjs` run inside `npm test`, and both
exist because the bug they catch already shipped. When one fails, the emitted
CSS or the token is what changes — not the check.

## Database

**Schema changes go through a migration file, never the dashboard.** `entries` —
the table holding every observation the app has ever recorded — was created by
clicking, which is why migrations start at `0002` and why three of its columns
had drifted before anyone noticed. One of those, a `schema_version` default,
had already corrupted the blank-vs-zero distinction above.

**Four dashboard settings are load-bearing and no SQL can set them.** Two are
correctness, two are the difference between a scout recording all weekend and a
scout locked out mid-match. `supabase/config.toml` carries all four so the local
stack matches, but the live project only changes in the dashboard.

*Sessions* (Authentication → Sessions): **JWT expiry 345600** — four days, so a
device that signs in the night before holds a valid access token through the
whole event without ever refreshing. A competition gym has no usable wifi, and
the default hour means discovering that mid-match. **Refresh token rotation
stays on**, with the reuse window widened to 60s: with a four-day token a device
refreshes roughly never, so the usual case for disabling rotation has nothing
left to bite on, while the wider window still covers a refresh whose *response*
was lost. **`[auth.sessions]` stays unset** — a timebox or inactivity timeout
would force-log-out devices between events.

*Email* (Authentication → Email): **Confirm email OFF**, **Secure email change
OFF**. With
Confirm email on, registration is not tedious — it is impossible. Every address
is `<username>@scout.invalid`, RFC 2606 reserves `.invalid` as permanently
unroutable, and GoTrue validates the recipient before sending. The error names
the address, and the address is fine. Read the real setting with
`GET /auth/v1/settings` → `mailer_autoconfirm: true` means Confirm email is off.

**`0001` is corrective and re-runnable.** It is not a create-from-empty
migration: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR
REPLACE FUNCTION`, and a `DO` block that drops every policy by name first. It was
written to repair the dashboard-built `entries` table and went years without ever
being run against it — which is why production had no UPDATE policy on `entries`
(silently discarding every scout correction) and no `current_session_header()`
(which `0011` calls 38 times). Applied 2026-08-07.

**Rehearse against `scripts/rebuild_prod_replica.sh`, never `supabase db reset`.**
`db reset` applies `0001`, so it builds the repo's idea of production rather than
production, and it will pass migrations that fail on the real thing. Three
rehearsals were worthless for exactly this reason.

**Production grants `anon` everything by default; the local stack grants it
nothing.** The live project was created 2026-05-04, before Supabase changed the
default, so `pg_default_acl` in `public` read `tables anon=arwdDxtm` — ALL
privileges, DELETE included — plus `functions anon=X`. `supabase start` uses the
current always-revoked default. Same schema, opposite environment.

This is why `0009_picklist.sql` contains no `GRANT` statements and `picklist`
was still reachable by anon, and why `0008`'s `REVOKE ALL ... FROM PUBLIC` read
as a lockdown and was not one — closing a function takes **both** halves, since
Postgres grants `EXECUTE TO PUBLIC` on every new function *and* the default ACL
added an explicit `anon=X`. Revoking either alone leaves it open. `0010` is the
only pre-`0018` migration that names the role, which is why `profile_for_name`
was the only function actually closed.

`0018` narrows the defaults so new tables arrive with no anon grant, which
matters most for **Phase 4** — `events` and `event_scouts` would otherwise be
anon-writable with only a policy in the way. It also flips the failure
direction: a migration that forgets its grants now fails loudly instead of
over-granting silently. A `supabase_admin`-owned default ACL still grants anon
everything, but migrations run as `postgres`, so it is latent — verified by
creating a table and reading its ACL.

The rehearsal lesson generalises past `0001`: **the replica has to reproduce the
environment, not just the schema.** It now sets these defaults, so a grant bug
is visible locally. Before that change it showed all five functions closed when
production had them open — it could not have caught this.

**`CREATE OR REPLACE FUNCTION` preserves the ACL.** Measured, because assuming
otherwise sent me down a wrong explanation once. Replacing a body never reopens
a function, so migration order is free where only bodies change.

**Filename order is semantic.** A corrective migration numbered after `0011`
runs after the cutover and undoes it — `0013` re-granted `anon` access, restored
write access to `submitted_by`, and added an unscoped 30th policy beside 29
scoped ones. It now lives outside `migrations/`. Check both orderings: a full
`supabase db reset` and the production replica.

Migrations `0010`–`0012` are written and unapplied **on the live project**.
`0011` is a one-way door; read its header before touching it.

Locally they all apply cleanly and are covered by behavioural tests:

```bash
supabase start && npm run test:rls
```

That suite signs in as anon, an orphaned account, a scout, a manager and a super
across two events and makes real HTTP requests, because `current_session_header()`
reads `request.headers` and psql has none. It skips and exits 0 with no stack
running, so `npm test` stays green offline. Every assertion has been
mutation-tested; if you add one, break the policy it covers and watch it go red
before trusting it.

**The failure mode is an assertion that passes for the wrong reason** — it hit
three separate new assertions in one sitting, so assume it rather than hope:

- `a manager cannot call create_managed_profile` passed with EXECUTE granted to
  `authenticated`, because `guard_profile_update` raises first.
- `a scout cannot add someone to an event` passed with the role check deleted
  from `manages_event`, because the scout was not a member yet, so membership
  denied it before role was consulted.
- Every membership assertion would have passed without membership working at
  all, because `0019` is an expand migration and the `x-session-id` header alone
  satisfies the older policy. The membership block sends **no** header for
  exactly this reason.

The shape is always the same: a second mechanism denies the thing, so the
assertion never exercises the one it is named after. Mutation testing is what
finds it — a mutation that leaves the suite green is a finding, not a relief.
When two mechanisms genuinely both apply, assert the invariant rather than the
mechanism; `a forged attribution never lands` accepts denial or correction,
because `0011`'s trigger corrects and `0019`'s policy rejects, and production
has only one of them.

## Agent skills

### Issue tracker

GitHub Issues on `highestinthesky/frc-scouting-app`, via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unrenamed — `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context. No `CONTEXT.md`, deliberately — this file already carries the
vocabulary one would hold. ADRs are `docs/adr-NNN-*.md`, flat, not `docs/adr/`.
See `docs/agents/domain.md`.

## Where the reasoning lives

| | |
|---|---|
| `ROADMAP.md` | the single dependency-ordered plan |
| `docs/adr-001-auth.md` | why each auth decision went the way it did |
| `supabase/README.md` | migration runbook, and repo state vs live state |
| `design.md` | the locked design system |
| `APP_OVERVIEW.md` | routes and modules |

Migration and test files carry their reasoning in comments; when something looks
odd, the explanation is usually two lines above it. Commit messages do the same,
so `git log` is a usable source.
