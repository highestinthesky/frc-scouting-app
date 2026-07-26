# Handoff — hallmark redesign

Short-lived doc. The durable plan is `ROADMAP.md`; this is just session state.
**Delete this file once the redesign has landed.**

Written 2026-07-26.

---

## Read first

1. `ROADMAP.md` — the plan. The "Next: the hallmark redesign" section has the
   full component breakdown and page ordering.
2. `APP_OVERVIEW.md` — architecture map, if you haven't seen this codebase.

Hallmark v1.1.0 is already installed at `.claude/skills/hallmark/`
(project-scoped, gitignored). It should load as an invokable skill.

---

## Two blockers to clear before touching code

**1. The user's `node_modules` is broken on their Mac.**

A previous sandbox session ran `npm install` from Linux, so only `linux-arm64`
binaries got installed. `npm run dev` fails on macOS with:

```
Cannot find module @rollup/rollup-darwin-arm64
```

Fix, run **by the user, in their own terminal** — not from the agent sandbox:

```
cd "/Users/groceries11/Personal Projects/FRC Scouting Application"
rm -rf node_modules
npm install
```

`package-lock.json` is healthy (all 25 rollup platform entries intact, correct
`os`/`cpu` tags) — keep it. As of this writing the user had not confirmed the
fix worked. **Ask before assuming dev server works.**

> **Never run `npm install` from the agent sandbox against this folder.** It
> overwrites their macOS binaries with Linux ones every time. Building
> (`npm run build`) is safe. If a dependency genuinely needs installing, hand
> the user the command.

**2. Everything from the last session is uncommitted.**

24 files changed, on `main`, last commit `e9708ea`. Offer to commit before
starting the redesign so there's a clean rollback point — a hallmark run touches
a lot of CSS and you do not want it tangled with the metrics work in one diff.

---

## What just shipped (don't redo it)

- **File transport layer removed** — `export.js`, `import.js`, `.scout` format,
  `pako`. CSV export survives as `lib/csv.js`, columns derived from
  `form-config.js`.
- **Numeric metrics** — `counter` field type + `METRIC_FIELDS` in
  `form-config.js`; engine in `lib/metrics.js`; surfaced on `/manager`, the team
  page, `/compare` and `/picklist`.
- **UI copy trimmed** across every route.
- **Roadmap consolidated** into `ROADMAP.md`.

New files: `src/lib/metrics.js`, `src/lib/csv.js`,
`src/lib/components/Sparkline.svelte`, `src/lib/metrics.test.mjs`.

---

## Settled decisions — do not re-litigate

The user already answered these. Re-asking wastes their time.

| Question | Answer |
|---|---|
| Drop offline-first? | **Only the file layer.** IndexedDB-first saving and the PWA stay. Gym wifi is unreliable; a scout who can't save loses the match. |
| Where do metrics get defined? | **In code**, `METRIC_FIELDS` in `form-config.js`, retuned each January. A manager-editable UI was considered and deferred. |
| Redesign scope? | **Every page** — all nine routes. |
| Split `/schedule` first? | **Yes**, it's step one. 2,211 lines doing eight jobs; can't be redesigned in place. |

---

## The job

### Step 1 — split `/schedule` (prerequisite, no visual changes)

Pure move into `src/lib/components/schedule/`. State stays in the route;
components take props and emit callbacks. Ten components — the table in
`ROADMAP.md` lists them with contents.

Verify by diffing rendered output before/after. Behaviour must be identical.

### Step 2 — run hallmark, in this order

`+layout.svelte` → `/new` + `/edit` → `/manager` + team + `/compare` +
`/picklist` → `/schedule` + `/settings` → lock the system (`design.md`).

Hallmark writes `.hallmark/log.json` and won't repeat a macrostructure or theme
within a project, so run the shell first and let the rest inherit.

### Constraints to feed hallmark

- **Phone-first.** A scout standing in a loud gym, one hand, watching a match.
  Thumb reach beats visual interest on `/new`.
- **Touch targets ≥ 44px.** Counter buttons are already 3rem.
- **Both themes WCAG AA.** `data-theme` on `<html>` drives dark mode.
- **Alliance red/blue are semantic, not decorative.** Must survive retheming and
  must never be the only signal.
- **No new runtime dependencies.** Static build, no bundler additions.

---

## Invariant you can silently break

In `lib/metrics.js`: **blank means "not recorded", `0` means "recorded and it
was zero".**

Every entry recorded before this session has no counter keys at all. If those
collapse into zeros, every team average craters and every ranking downstream is
wrong — and nothing in the UI looks broken. `readMetric()` enforces the
distinction; eight of the 21 tests exist only to hold that line.

If you touch `metrics.js`, `form-config.js`, or any aggregation path, run the
tests.

---

## Verify

```
npm run build              # must compile with zero warnings
node src/lib/metrics.test.mjs   # must print "21 passed"
```

The build currently emits **no** unused-CSS warnings. If your changes introduce
some, they're real dead selectors — clean them up rather than leaving noise.

There is no test coverage outside `metrics.js`. Visual changes need the user to
look at them; ask them to run the dev server rather than claiming a redesign
works.

---

## Suggested opening message

> Read HANDOFF.md, then ROADMAP.md. We're doing the hallmark redesign. Start
> with the `/schedule` split — pure refactor, no visual changes — and show me
> the component breakdown before you write anything.
