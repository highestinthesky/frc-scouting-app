# Followups plan

Open items not yet shipped, in rough priority order. Each section has enough
context that a fresh agent can pick it up cold — design, files touched,
acceptance criteria, open questions.

> Companion docs: `CREDENTIALS.md` (Supabase access, gitignored),
> `IMPROVEMENT_DRAFT.md` and `MANAGER_REDESIGN_HANDOFF.md` (older context),
> `supabase/migrations/` (applied SQL history).

Last updated: 2026-05-15

---

## 1. Build-time TBA key (Option B)

**Status:** Approved, not yet implemented.

**Why:** Each manager device today has to paste a TBA read API key into
`/schedule` before fetching. With a build-time env var, the key lives in the
GitHub Actions secret store and ships embedded in the deployed bundle —
manager experience drops to "tap Fetch from TBA, tap Publish". TBA's ToS
technically discourages key sharing, but practical risk for a small team is
minimal: leaked → revoke and regenerate.

**Design**

- Add `VITE_TBA_API_KEY` as a repository secret in GitHub Settings → Secrets
  and variables → Actions.
- Wire it into the deploy workflow at `.github/workflows/deploy.yml`:
  ```yaml
  - name: Build
    env:
      BASE_PATH: "/frc-scouting-app"
      VITE_TBA_API_KEY: ${{ secrets.VITE_TBA_API_KEY }}
    run: npm run build
  ```
- In `src/lib/tba.js`, prefer the env-var key, fall back to user-pasted:
  ```js
  const envKey = import.meta.env.VITE_TBA_API_KEY ?? '';
  const effectiveKey = (apiKey || envKey).trim();
  ```
- On `/schedule`, hide the TBA API key field when the env var is set
  (`import.meta.env.VITE_TBA_API_KEY` is non-empty). The Fetch button works
  with no input.
- Drop `tbaApiKey` from `session.svelte.js` if the env var path is the only
  one used. Or keep it as a fallback for self-hosted forks.

**Files to touch**
- `.github/workflows/deploy.yml` — add env var to Build step
- `src/lib/tba.js` — read `import.meta.env.VITE_TBA_API_KEY`
- `src/routes/schedule/+page.svelte` — conditionally hide the API-key field
- `src/lib/session.svelte.js` — optional: remove the `tbaApiKey` setting

**Acceptance**
- Manager device opens `/schedule` for the first time and sees no API key
  field. Tapping Fetch works on first try.
- Dev build (`npm run dev` locally with no env var) still falls back to the
  pasted-key path so contributors without the key can develop.
- Deployed site bundle contains the key as a plain string (verifiable in
  devtools). That's a known trade-off vs. Option C (server-side proxy).

**Open questions**
- Should we entirely remove the pasted-key UI, or keep it as an "override"
  for forks? Keeping it adds ~20 lines and zero user friction. Removing it
  simplifies the UI further.

---

## 2. "Archive event" UI button

**Status:** Underlying RPC `reset_event_data` is already in place
(migration 0003 + extension in 0004). UI button not yet built.

**Why:** When an event ends, the manager can tap a button to wipe
`event_meta`, `schedules`, `assignments`, and `reminders` for that event,
keeping `entries` (historical scouting data) intact. Prevents Supabase cruft
from accumulating across seasons.

**Design**

- Already shipped on `/schedule`: the "Reset scheduling for this event"
  button — same call. Effectively this item is "rename for clarity + give
  it a better post-action message".
- Rename the button to "Archive event" and the heading to clarify when
  to use it: after the event is over, before starting the next one.
- After successful call, show: "Event archived. Schedule, assignments, and
  reminders for *{eventCode}* are cleared. Scout entries are kept."

**Files to touch**
- `src/routes/schedule/+page.svelte` — relabel button, polish messaging.

**Acceptance**
- Button visible only when manager token is locally known.
- Confirmation dialog mentions exactly what's wiped vs. kept.
- After tap, the `/schedule` page reloads to bootstrap mode (no passphrase
  set, no schedule, no assignments).

**Open questions**
- Should this be the same button as "Reset scheduling" or two separate
  controls? Reset feels like a fix-when-broken action; Archive feels like
  end-of-event hygiene. Two visually distinct buttons might be clearer,
  even if they call the same underlying RPC.

---

## 3. Auto-cleanup of expired reminders + dormant events

**Status:** Client-side filter on `expires_at > now` is in place.
Server-side cleanup not yet built.

**Why:** Without periodic deletion, expired reminder rows sit on Supabase
indefinitely. Same for events that nobody archives — passphrase + schedule
+ assignments rows leak across seasons.

**Design**

- Supabase Scheduled Function (via `pg_cron` extension or an Edge Function
  on a cron schedule).
- Hourly: `DELETE FROM reminders WHERE expires_at < now() - INTERVAL '24 hours';`
  (24-hour grace so a phone offline for a day still sees what it should).
- Daily: prune `event_meta`, `schedules`, `assignments` for events whose
  newest `entries.created_at` is older than 90 days AND has no rows in
  the last 7 days (avoids deleting an event in progress).
- Migration: `0005_cleanup_jobs.sql`.

**Files to touch**
- `supabase/migrations/0005_cleanup_jobs.sql` — new
- No app code changes needed; this is purely server-side.

**Acceptance**
- After running locally, expired reminders disappear from `public.reminders`
  within an hour.
- A test event with all entries dated 100+ days ago has its `event_meta` /
  `schedules` / `assignments` rows removed on next daily run; its `entries`
  rows are kept.

**Open questions**
- Should the 90-day cutoff for event metadata also delete `entries`? No
  default — historical scouting data is valuable. Make it an explicit
  follow-up only if storage actually becomes a concern.
- `pg_cron` is available on Supabase free tier with caveats (jobs only run
  while the project is awake). Edge Function on a separate scheduler may
  be more reliable. Either works.

---

## 4. Per-match assignment overrides

**Status:** Not started. Base assignments model assumes a scout watches
the same teams across every match.

**Why:** Real-world schedules have last-minute swaps. The manager needs to
say "in Q12 specifically, Ning watches team A instead of team B" without
rebuilding their whole assignment table.

**Design**

- New table `assignment_overrides`:
  ```sql
  CREATE TABLE assignment_overrides (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      event_code text NOT NULL,
      match_number integer NOT NULL,
      scout_name text NOT NULL,
      team_number integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX assignment_overrides_uq
      ON assignment_overrides (session_id, match_number, scout_name);
  ```
  RLS pattern matches `assignments` — open select per session, manager-only
  writes via `has_manager_token()`.
- Resolution rule (client-side): for a (match, scout) pair, override wins
  over the base assignment. If no override, scout's team in that match is
  whichever assigned team happens to be playing.
- `src/lib/assignments.js` gains `listOverrides`, `setOverride`,
  `clearOverride`; `pullAndApplyForScout` joins both lists into a single
  `assignmentsByMatch` view stored locally.
- `src/lib/tba.js` `nextUnscoutedMatch` consumes the joined view rather
  than a flat team list.
- UI on `/schedule` manager view: each row in the Schedule preview gets an
  "✎" affordance that opens a per-match override editor (pick a scout, pick
  one of the match's 6 teams). Surface "✎" only on rows where overrides
  could matter (overlapping coverage).

**Files to touch**
- `supabase/migrations/0006_assignment_overrides.sql` — new
- `src/lib/assignments.js` — extend
- `src/lib/tba.js` — `nextUnscoutedMatch` signature changes
- `src/routes/schedule/+page.svelte` — override editor UI
- `src/routes/new/+page.svelte` — banner respects overrides
- `src/routes/+page.svelte` (home banner) — same
- `src/lib/session.svelte.js` — possibly cache overrides

**Acceptance**
- Manager taps "✎" on Q12, changes Ning's team from 1234 to 5678, saves.
- Ning's `/new` next-match banner for Q12 shows team 5678 with the matching
  alliance color, not 1234. Other matches are unaffected.
- Sync round-trip: a different scout device pulls and sees the override
  applied within 30s.

**Open questions**
- Should an override able to *remove* a scout from a match entirely (set
  team to null)? Common case: "Ning is on break for Q15." Easy to support;
  worth deciding.
- Override editor UX: inline on the preview row, or modal? Modal is more
  flexible for the multi-control editor.

---

## 5. Coverage conflict detection (silent display)

**Status:** Not started. User picked "silent display only" — show
conflicts in a panel, don't block saves.

**Why:** Today the assignments model lets a manager give a single scout
multiple teams that play each other (e.g., assign Ning to 1234 AND 5678
when those teams meet in Q12). The scout would need to scout both teams
in one match, which isn't physically possible. Surfacing these conflicts
lets the manager fix them via per-match overrides (item 4).

**Design**

- Derived state on `/schedule` manager view, runs over `qmList` ×
  `assignRows` after each render.
- For each qual match, build `{scoutName → [teams in this match]}`.
  Flag any scout with `≥ 2` teams in the same match.
- Output goes into a new "Coverage check" section on `/schedule` between
  Assign scouts and Schedule preview. Empty state: "✓ No conflicts."
- Each conflict row links to the relevant Schedule preview row (anchor
  scroll) and — once item 4 ships — opens the per-match override editor.

**Files to touch**
- `src/routes/schedule/+page.svelte` — new derived `coverageConflicts`,
  new template section, styles.

**Acceptance**
- After assigning Ning to teams 1234 and 5678 (which play each other in
  Q12), the Coverage check section shows:
  > Q12 — Ning is assigned to 1234 and 5678 (they're in the same match).
- Saving assignments is not blocked by this; the warning is informational.
- Clicking the warning scrolls to the Q12 row in Schedule preview (and,
  later, opens an override editor).

**Open questions**
- Should conflicts also be surfaced on the scout's own `/schedule` view as
  a "heads up, you've got a conflict" note? Probably no — the scout can't
  fix it, only the manager can.

---

## 6. Optional / future

These came up in discussion but weren't formally picked. Recorded so they
aren't lost.

- **Real OS push notifications via Web Push API.** Service worker push
  handler + VAPID keys + Supabase Edge Function to send. Bigger lift than
  the in-app banner we shipped. Worth doing if reminders prove valuable
  enough that scouts want them when the app is closed.
- **Picklist cloud sync.** Today `/manager/picklist` is local-only per
  device. If multiple strategists need to collaborate on the same picklist
  in real time, build a `picklists` table gated by `has_manager_token()`
  (read AND write both gated — picklists are competitive intelligence).
- **Edge Function TBA proxy (Option C from earlier discussion).** Replaces
  Option B if/when the app goes public. Keeps the TBA key entirely on the
  server.

---

## Implementation order I'd recommend

1. Item 1 (env-var TBA key) first — small, removes friction, unblocks the
   "manager opens app, taps Fetch" flow.
2. Item 5 (conflict detection) — pure derived state, no schema, surfaces
   real problems with the existing model. Cheap insurance.
3. Item 4 (per-match overrides) — bigger, but it's the natural next step
   after #5 because conflicts need a way to be resolved.
4. Item 2 (Archive event UI polish) — quick relabel.
5. Item 3 (cron cleanup) — defer until cruft is actually visible.

Items 1, 2, 5 are each ~30–60 min of work. Item 4 is the biggest, probably
half a day including migration + UI.
