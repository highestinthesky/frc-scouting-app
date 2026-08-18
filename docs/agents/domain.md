# Domain Docs

How the engineering skills should consume this repo's documentation when
exploring the codebase.

Single-context repo. No `CONTEXT-MAP.md`, no `packages/`, one `src/`.

## Before exploring, read these

This project documents itself unusually heavily, and the reasoning is spread
across several files rather than gathered into one. Read what the topic touches:

| | |
|---|---|
| `CLAUDE.md` | the invariants. Start here — it is what must not break |
| `ROADMAP.md` | the single dependency-ordered plan, and the live database state |
| `docs/adr-001-auth.md` | why each auth decision went the way it did |
| `docs/adr-002-spatial-observations.md` | the design for interactive auto scouting (v0.80, not built) |
| `supabase/README.md` | migration runbook, and repo state vs live state |
| `design.md` | the locked design system |
| `APP_OVERVIEW.md` | routes and modules |

There is **no `CONTEXT.md`**, and its absence is not a gap to fill on sight.
`CLAUDE.md` already carries the vocabulary a glossary would — blank vs zero,
join key vs label, the cutover, the tripwire — and a second file restating it
would be one more place to go stale. `/domain-modeling` creates one lazily if a
term actually needs resolving; until then, proceed silently.

## ADRs live in `docs/`, not `docs/adr/`

Named `adr-NNN-<topic>.md`. There are two, and `docs/` holds nothing else
besides `agents/`, so the directory already is the ADR directory. Number the next
one `adr-003-`.

The skills' default layout is `docs/adr/`. This repo keeps the flatter form
deliberately: moving the existing file would mean updating eight references,
including comments inside `0008_auth.sql` and `auth.svelte.js` — exactly the
kind that go stale silently and are never noticed.

## Use the vocabulary the codebase already has

When output names a domain concept — an issue title, a refactor proposal, a
hypothesis, a test name — use the term this codebase uses. Several are load-bearing
and mean something narrower than they sound:

- **join key** vs **label** — `scout_name` is the first; `displayName` is the second.
  `scout-identity.js` owns the distinction and nothing else may re-derive it.
- **blank** vs **zero** — not recorded, versus recorded and it was zero.
- **the cutover** — `0011` and `AUTH_ENFORCED = true` shipping together. Not "the
  auth work" generally.
- **tripwire** — a test that fails on purpose to stop a change proceeding
  unnoticed. Failing one means finishing the work, not editing the assertion.
- **event code** vs **account** — the event code partitions data; the account
  says who you are. Accounts replace the passphrase, never the event code.

If a concept you need isn't in that list or in `CLAUDE.md`, that is a signal:
either the language is being invented (reconsider) or there is a real gap worth
noting for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts `docs/adr-001-auth.md`, surface it rather than silently
overriding:

> _Contradicts ADR-001 (accounts replace the passphrase, not the event code) —
> but worth reopening because…_

## What this repo has learned about verifying claims

Worth reading before any skill asserts that something works, because each of
these cost real time:

- **Rehearse against `scripts/rebuild_prod_replica.sh`, never `supabase db reset`.**
  `db reset` applies `0001`, which production had not, so it tests the repo's
  idea of production rather than production. Three rehearsals passed that way
  and the migration still failed on the live project.
- **A check that cannot fail is worse than no check.** Every RLS assertion in
  `scripts/check_rls.mjs` was mutation-tested — the policy broken deliberately,
  the suite watched going red. One assertion did not survive that and was
  passing for the wrong reason.
- **Read the whole file before concluding what it does.** `0001` was called
  unrunnable for a day and a half because its first statement is `CREATE TABLE`;
  the `IF NOT EXISTS` was on the same line.
