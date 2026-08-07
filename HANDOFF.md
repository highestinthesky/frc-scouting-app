# Handoff — FRC Scout, v6 auth cutover

Paste this into a fresh Claude Code session in this repo.

---

## Read these first, in this order

1. `ROADMAP.md` — the only plan document. Don't start a second one.
2. `docs/adr-001-auth.md` — the auth design and why each decision went the way it did.
3. `supabase/README.md` — the database rules, and two dashboard settings no migration can set.
4. `design.md` — the locked design system.
5. `APP_OVERVIEW.md` — what the app does.

The migration files are heavily commented and the comments carry the reasoning, not just the what. Same for the test files. If something looks odd, the explanation is usually two lines above it.

## What this is

An FRC scouting PWA for team 3419. SvelteKit 2 + Svelte 5 runes, `adapter-static`, deployed to GitHub Pages. Data is local-first in IndexedDB (Dexie) and syncs to Supabase. Mid-way through a "v6" overhaul.

## Standing instructions from the user

- **Commit, never push.** He runs `git push` himself.
- **Finish everything before reporting.** One brief report at the end, not a running commentary.
- Treat existing structure as a baseplate — reorganising aggressively is fine. The things that are *not* negotiable are listed under "Invariants" below.

## Current state

- Branch `main`, clean, **everything is pushed** — `origin/main` is at `b997f26`.
- `npm test` → **461 assertions across 11 suites**, all green.
- `npm run check:sql` → 14 files, all valid.
- `.claude/` is untracked and contains a local `hallmark` skill. Leave or gitignore, your call.

```bash
npm test          # 11 suites
npm run check:sql # PostgreSQL grammar + one semantic lint
npm run build     # NEVER succeeded in the previous environment — see below
```

## The single most important thing to know

**Migrations 0008 through 0012 have never been executed.** Roughly 800 lines of SQL — policies, `SECURITY DEFINER` functions, triggers, RPCs — that have been syntax-checked and reviewed and have never touched a running Postgres.

The previous work happened in a sandbox with no root, so Postgres could not be installed. `check_sql.py` proves the SQL *parses*; nothing proves a policy permits what its name claims. This is the largest unquantified risk in the project and it is the first thing you should fix.

**You can fix it.** You are on the user's machine. `supabase start` gives a local Postgres in Docker. Apply 0001→0012 against it, then test the policies by actually signing in as three different users — anon, a scout, a manager — and trying reads and writes that should and shouldn't work. `supabase/verify_migrations.sql` says in its own header that it cannot do this.

Doing that turns 0011 from a one-way door the team has to trust into one that's already been walked through twice.

### Migration status

| | |
|---|---|
| 0001–0006 | applied to the live project, predate this work |
| 0007 | applied — `entries.updated_at`, the sync watermark |
| 0008 | applied — accounts, roles, invites. **Later hardened; the corrected version has NOT been re-run** |
| 0009 | applied — picklist rows, alliances on `schedules` |
| 0010 | **written, not applied** — `profile_id` beside `scout_name`. Additive, safe to apply mid-season |
| 0011 | **written, not applied** — the cutover. One-way door, off-season only |
| 0012 | **written, not applied** — removes the inert passphrase objects after 0011 soaks |

## Invariants — do not break these

1. **Blank ≠ zero in metrics.** Blank means *not recorded*; `0` means *recorded and it was zero*. `readMetric()` in `lib/metrics.js` enforces it and eight tests defend it. Entries predating a metric contribute nothing to its sample rather than dragging the mean down.
2. **Recording never depends on auth.** `db.js` does not import `auth.svelte.js`. A scout with an expired token, a revoked account or no signal still writes to IndexedDB. Only sync waits.
3. **A failed token refresh never signs anyone out.** A scout in a dead corner when the hourly refresh fires must not be bounced to a login screen holding unsaved work.
4. **`AUTH_ENFORCED` and migration 0011 move in the same deploy.** Either alone is worse than doing nothing. `src/lib/auth.test.mjs` fails when the flag changes — that's the tripwire, not a bug.
5. **The `entries` dedupe index is a content fingerprint.** Sync relies on it raising `23505` and adopting the existing row's id. Identity is not part of it. Don't add `submitted_by`.
6. **Svelte scopes CSS by injecting a hash class, which silently changes specificity.** `.dlg { display: flex }` becomes `(0,2,0)` and beats the browser's `dialog:not([open]) { display: none }` at `(0,1,1)`. This shipped once — every page rendered a stray Confirm/Cancel pair. `scripts/check_components.mjs` reads *emitted* CSS for this reason.
7. **A parent cannot style a child component through a `class` prop.** The compiler doesn't warn, because it can see the class in the markup. Already broke two layouts silently.

## What the checks enforce

Both run in `npm test`, and both exist because the bug they catch already shipped once.

- `scripts/check_components.mjs` — sweeps all 29 components for raw `rem` in spacing or type, hex literals outside `+layout.svelte`, undefined `var(--token)` references, the class-prop trap, 44px tap targets on back links, and that nothing outside `auth.svelte.js` re-derives "am I a manager".
- `scripts/check_contrast.mjs` — parses the real token values and measures 33 rendered colour pairs in both themes against WCAG AA. Caught three live failures, including every primary button in dark mode at 2.71:1.
- `scripts/check_sql.py` — libpg_query grammar, plus one semantic lint for an aggregate beside a bare column with no `GROUP BY`. That exact statement was written and shipped into a migration; it parses and can never run.

`var(--ok, var(--accent))` is the pattern to watch for generally — a fallback that turns a missing token into a plausible-looking colour. Two of those were live, rendering "improving" trends in brand purple.

## Next task, in order

### 1. Verify the migrations against a real Postgres

Described above. Highest value by a distance.

### 2. Dual-write `profile_id` from the client

0010 gives the schema somewhere to put real identity. **Nothing fills it going forward** — the client still writes only `scout_name`, so the whole burden sits on 0010's backfill.

The change: when signed in, write both `scout_name` and `profile_id`; on read, prefer `profile_id` and fall back to the name. Once that's shipping, 0011's preconditions become achievable.

Scope: `scout_name` is a **join key**, not a label — **141 references across 27 files**, including `assignments.js` (28 uses), `auto-assign`, `coverage`, `reminders`, `sync`, `csv`. `assignments.js` already normalises with `trim().toLowerCase()` in nine places, which tells you the code has known the key was unreliable for a while and papered over it rather than fixing it.

"Ning", "ning" and "Haolun" are three different scouts to every one of those call sites. It is the same failure that killed scout-added teams: someone typed something on one phone and no other device agreed.

### 3. Signing in still has no visible effect

The app bar renders `session.scoutName` — the name typed into Settings on that device — so it shows the wrong person after login. `auth.displayName` exists and is used in exactly one place.

Do **not** fix this on its own. Pointing the app bar at the account while the app still *joins* on a typed string is worse than today, because it would look correct. It belongs with task 2.

### 4. Re-run the corrected 0008

It was hardened after being applied (self-role-change blocked, super accounts and invites protected, usernames bound to the authenticated account, `recovery_email` hidden). The live project still has the original. 0011 repeats the guard so the cutover is self-contained, but until then the original broad UPDATE policy is live.

### Then, in rough order

Alliance-selection polish that needs a real event to design against; per-page composition work (the token migration is done, what each page *leads with* is not); Studio + Insights (Phase 4, desktop route group, fixed charts).

## Things the previous environment could not do

Worth knowing, because they're all things you *can*, and the gaps shaped the work.

- **`npm run build` has never succeeded.** Rollup ships platform-native binaries; the sandbox was Linux, this machine is macOS. CI catches breakage, but only after a push. Run it.
- **No Postgres.** See above.
- **No browser.** The Dialog specificity bug was inferred from emitted CSS *after* the user reported it as "an extra button below each page". With Playwright that's a screenshot.

## Two dashboard settings no migration can touch

Both in Supabase → Authentication → Email. Documented in `supabase/README.md`.

- **Confirm email: OFF.** Not optional. With it on, **registration is impossible** — every address is `<username>@scout.invalid`, `.invalid` is permanently unroutable by RFC 2606, and GoTrue's mailer validates the recipient before sending. Signup returns `Email address "..." is invalid`, which points at the address, and the address is fine. Currently off; confirm with `GET /auth/v1/settings` → `mailer_autoconfirm: true`.
- **Secure email change: OFF**, same reason.

Accounts created through the dashboard's "Add user" bypass the mailer entirely, which is what made the scheme look verified when the registration path had never run.

## Recent history worth having

Last ~10 commits, newest first:

```
b997f26 feat(auth): finish the cutover migration, and centralise "am I a manager"
278325e test(sql): catch the semantic error I made writing 0010
d5cb14e feat(db): split the cutover in two — identity now, policies later
379a5ef docs: scout_name is a join key, and accounts are meant to retire it
c20ee0b docs(db): Confirm email doesn't make registration tedious — it makes it impossible
3ba3274 docs(db): the email-confirmation toggle, written down and asserted
```

Commit messages in this repo carry the reasoning. `git log` is a usable source when something looks strange.
