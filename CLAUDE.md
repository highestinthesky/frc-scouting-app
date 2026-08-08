# FRC Scout

Offline-first scouting PWA for FRC team 3419. SvelteKit 2 + Svelte 5 runes,
`adapter-static`, deployed to GitHub Pages. IndexedDB is the write target;
Supabase is the shared mirror. JavaScript with JSDoc, not TypeScript.

## Working agreements

- **Commit freely; leave `git push` to the user.** A push deploys.
- **`ROADMAP.md` is the only plan document.** Update it rather than starting a
  second one — two earlier plans and a handoff were folded into it.
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
Access tokens last about an hour, and a scout in a dead corner of the gym when
that fires is holding unsaved work — signing them out is how it gets lost. Route
guards ask "has this device ever signed in", not "is this token valid now".

**`AUTH_ENFORCED` and migration `0011` flip in the same deploy.** The flag alone
locks the UI while the data stays open to anyone holding the event code, which
is published on The Blue Alliance. `0011` alone locks the data while the UI
still offers the passphrase and every write silently fails. `src/lib/auth.test.mjs`
asserts the flag is still `false`; that assertion is a **tripwire**, so when it
fires the cutover is what gets finished and the assertion is what changes last.

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
write succeed* (the passphrase now, the role after `0011`), and
`showsManagerTools` is *should the surface render at all*. They differ
pre-cutover because the passphrase form lives inside the surface it unlocks —
gate the surface on holding the passphrase and you seal the only door to it.

**Signing in fills `session.scoutName`, but only when it is blank.** That
restriction is load-bearing: the name is still the join key, so overwriting one
a device already had would silently detach it from every assignment, override
and reminder addressed to the old spelling.

**The event code is not going away.** It is the `session_id` partition on every
shared table and `docs/adr-001-auth.md` is explicit that accounts replace the
passphrase, not the event code. Turning it into a picker instead of a typed
field needs `0011`: before the cutover you need the code to read `event_meta` at
all, so discovering events you have access to is circular.

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

**Two dashboard toggles are load-bearing and no SQL can set them:** Confirm
email **OFF**, Secure email change **OFF** (Authentication → Email). With
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
