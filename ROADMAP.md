# FRC Scout — consolidated roadmap

One source of truth. Everything from the old planning docs (`IMPROVEMENT_DRAFT.md`,
`FRC_Scout_Improvements_v3.docx`, `MANAGER_REDESIGN_HANDOFF.md`, `IMPROVEMENTS.md`,
`PLAN.md`, `UPGRADE_PLAN.md`, `FRC Scouting App v6.pdf`) was folded in here and
those files deleted. Do not start a second plan document — add to this one.

Last updated: 2026-07-29.

---

## Already shipped — stop re-planning these

**Through v0.5 (June 2026)**

- Manager view rebuilt: stats grid, search, sort, filter chips, badges, CSV
  export, strengths preview.
- Edit-after-save (`/edit`), TBA schedule integration, deeplinked pre-fill,
  per-team match log, multi-team compare, picklist builder, discrepancy
  flagging, dark mode, home pace counter.
- TBA event key decoupled from the sync event code.
- Live coverage board, smart auto-assign, per-match assignment overrides,
  coverage-conflict detection, design-system tokens.
- Structured defense entry, team-scoped tag pills, deduplicated strengths.

**This round (July 2026)**

- **File transport layer removed.** `export.js`, `import.js`, the `.scout`
  format and the `pako` dependency are gone, along with the Import/Export UI on
  `/` and `/manager`. Cloud sync fully replaced the hand-carried-file workflow.
  CSV export survives as `lib/csv.js` — it's a deliverable for spreadsheet work,
  not a transport, and its columns now derive from `form-config.js`.
- **Numeric metrics.** A `counter` field type plus a `METRIC_FIELDS` group in
  `form-config.js`. See "Retuning metrics each season" below.
- **Aggregation engine** (`lib/metrics.js`): per-metric n, mean, median, max,
  min, standard deviation, trend and a small-sample guard. Every manager surface
  reads from this one module so they can't disagree.
- **Metrics surfaced**: metric strip and sort-by-metric on `/manager`; metric
  cards with sparklines on the team page; numeric rows with leader highlighting
  on `/manager/compare`; weighted composite scoring on `/manager/picklist`.
- **UI copy trimmed** across every route.
- **`/schedule` split into ten components** under `src/lib/components/schedule/`.
  State stays in the route; CSS co-located verbatim per component.
- **Auto-assign rewritten as graph colouring.** Every match is a 6-team clique,
  so assigning teams to scouts is exactly graph colouring. DSATUR plus a
  per-match override repair pass. Real coverage went from ~79% to 100% at 6+
  scouts, and reports coverage instead of a clash count. `lib/auto-assign.js`,
  79 tests.
- **Unsaved assignment drafts survive a refresh** — mirrored to IndexedDB,
  restored with a dismissible note, cleared on save.
- **Scouts see the whole schedule**, with a My teams / All matches toggle and
  rows that expand to all six robots.
- **Scout-added teams removed.** They lived only on one phone, so the manager's
  coverage board never saw them and auto-assign planned around a roster that
  didn't match reality.
- **Design system locked** in `design.md` — genre modern-minimal, Workbench
  family, brand purple, system fonts, nav docked to the bottom on phones.
  Contrast audited: `--text-faint` was failing AA at 3.5 and is now 4.54.

### What stayed local-first, deliberately

The file layer went; the local-first write path did **not**. Entries still land
in IndexedDB first and sync up afterwards, and the PWA still installs. An FRC
venue is a few hundred phones fighting over one access point — a scout who
can't save during a wifi drop loses the match entirely, and there's no way to
reconstruct it. Revisit only if a real event proves the connection reliable.

---

## Retuning metrics each season

`METRIC_FIELDS` in `src/lib/form-config.js` is deliberately game-agnostic —
fields are named for what a scout physically counts, not for this year's game
pieces. Each January:

1. Edit the labels, `max` values and `higherIsBetter` flags in `METRIC_FIELDS`.
2. Bump `SCHEMA_VERSION`.
3. Push. The form, CSV export, aggregation engine, manager table, team page,
   compare view and picklist all read from that array — no other file changes.

Keep the list to four or five counters. A scout has ~2m30s and one pair of eyes;
a metric nobody reliably records is worse than no metric.

**The one invariant to preserve:** blank means *not recorded*, `0` means
*recorded and it was zero*. `readMetric()` in `lib/metrics.js` enforces the
distinction and every consumer depends on it. Entries from before a metric
existed contribute nothing to its sample rather than dragging the mean to zero.

---

## The v6 plan — sequenced

From the v6 upgrade doc plus the follow-up decisions, reordered by dependency
and cost. Next competition is months away, so this is built properly.

### Four decisions that shaped it

1. **Real accounts, with server-side role enforcement.** That is the only one of
   the stated reasons for login that a shared password can't deliver — hiding UI
   is not enforcement.
2. **Offline-first relaxes for login, not for recording.** See below.
3. **Manager Studio is a desktop surface.** Managers bring laptops. It gets a
   sidebar, denser layout, and a higher breakpoint floor. Schedule stays in the
   main app, because publishing and assigning happen at the venue, possibly on a
   phone.
4. **Playoff match scouting is out; alliance selection is in.** This is the
   biggest cost saving in the plan — see § Alliance selection, not playoffs.

### Auth layers on top of event codes; it does not replace them

The v6 doc treats login as a replacement for the event-code model. It shouldn't
be. The two answer different questions:

- **Event code** — *which event is this data for.* Hashing it into a
  `session_id` partitions data cleanly and is good design. It stays.
- **Auth** — *who are you, and what may you do.* Adds `submitted_by uuid` for
  accountability and a role check for writes.

Keeping both preserves the sharing model that works and keeps the migration
small, instead of rewriting every RLS policy from scratch.

### The offline rule, stated precisely

Logging in may require network. **Recording may not.**

"If they can log in, they have wifi" holds at the moment of login. The failure
it misses is forty minutes later: access tokens expire in about an hour and
refresh in the background. A scout in a dead corner when the refresh fires must
not be bounced to a login screen holding unsaved work — that is a worse failure
than the one this app has today.

Three rules, all client-side:

- The IndexedDB write path never checks auth. A scout records regardless of
  token state.
- A failed token refresh **never** logs the user out. Keep the local session,
  surface sync as stale, retry on reconnect.
- Long refresh-token lifetime, so a weekend event is covered by one login.

Operationally: log in before leaving the school. Worth putting in the app's
own empty state, not just in this file.

### Phase 0 — cheap, independent, unblocks the rest

None of these depend on auth, so they can land immediately.

1. **Native dialogs.** Replace the 7 `confirm()`/`alert()` sites across 5 files
   with one in-app dialog component. Blocking browser dialogs look alien in an
   iOS PWA, and Accounts needs this component anyway for delete confirmations.
2. **Minimal-delta auto-assign.** Today, re-running after a scout drops out
   redistributes all ~40 teams and hands everyone a new list mid-event. Pin
   existing assignments and rebalance only what's necessary — a constraint on
   the DSATUR pass in `lib/auto-assign.js`, not a rewrite.
3. **Sync UPDATE path.** Known data-loss bug: the sync layer is INSERT-only, so
   an `/edit` change never reaches its cloud row. Needs an UPDATE keyed on
   `remoteId`.

### Phase 1 — auth, roles, accounts

**Full spec: [`docs/adr-001-auth.md`](docs/adr-001-auth.md).** Summary here; the
ADR carries the schema, policies, RPC and migration order.

First, because everything downstream should be gated by roles rather than
retrofitted. Anything built before auth gets its RLS written twice.

One Supabase project. Supabase already separates `auth.users` from the public
schema — that *is* the separation the v6 doc asks for.

Two findings from reading the code that changed the design:

1. **`entries` is not in migrations.** Files start at `0002`; the table holding
   every scouting entry, and its RLS policies, exist only in the Supabase
   dashboard. The repo could not rebuild the database. Now captured as `0001`,
   idempotent, and safe to run against the live database — it clears every
   existing policy on the table first, because permissive policies combine with
   OR and one forgotten dashboard policy would silently defeat a restrictive
   one. `supabase/verify_entries.sql` reports the live shape beforehand.
2. **Static hosting rules out the v6 account flow.** Manager-creates-account
   needs `auth.admin.createUser()`, which needs the `service_role` key, which
   can never ship in a client bundle. So: **invite codes, and scouts
   self-register.** That removes temp-password generation, delivery, the
   activation flag and the forced first-login change — the "has this person
   signed up" signal becomes `invites.redeemed_at`.

The rest:

- Username uniqueness is a unique index on `lower(username)` plus a shape
  CHECK. The form's availability check is a courtesy with a read-to-insert race;
  the index is the guarantee.
- Login derives the auth email from the username (`user@scout.invalid`), so
  there's no lookup table and no roster leak. Usernames become immutable.
- Roles via a `SECURITY DEFINER` function with `search_path = ''`.
- `session_id` stays as the event partition but stops being the security
  boundary; `to authenticated` becomes it, which closes the public-event-code
  hole.
- `has_manager_token()` and the passphrase flow get deleted. Two parallel
  authorisation systems is how you get a hole in one.
- Password recovery is the weak point: optional `recovery_email`, else the
  manager revokes and re-invites. First piece of server-side code in the project
  would be an Edge Function for proper resets — worth resisting until it
  actually bites twice.

### Phase 2 — alliance selection, not playoffs

Dropping playoff match scouting removes the most expensive item in the earlier
plan. Playoff matches are identified by `(comp_level, set_number, match_number)`
rather than a bare number, and this app keys on the bare number everywhere —
`entryIndex`, overrides, coverage. Supporting them was a match-identity
refactor touching every data path. Not doing it is worth several days.

**The deliberate boundary:** the app helps you *pick* an alliance and then goes
quiet once elims start. That is the right trade — selection is where scouting
data has leverage; by the time elims begin the picking is done. Recorded here so
it isn't re-litigated as an oversight.

1. **Picklist cloud sync.** A `picklists` table gated by role. Promoted from
   "conditional": selection is the moment the app exists for, and a local-only
   picklist dies with the phone holding it.
2. **Mark teams already picked.** TBA publishes alliances as selection proceeds
   (`/event/{key}/alliances`). Grey out taken teams in the picklist so nobody
   burns a pick on an unavailable robot. TBA's latency during selection is
   unreliable, so a manual strike-through is the fallback, not the polish.
3. Whatever `/compare` needs to answer "these two are left, which do we want".

### Phase 3 — information architecture, then redesign

The v6 reorganisation is a real improvement, and it invalidates redesigning the
current routes first. Move, then run hallmark once per page at its new address.

| New | From |
|---|---|
| `/login`, `/register` | new |
| `/home` | `/` — greeting, next match, reminders, directory |
| `/scouting` | `/schedule` + `/new` + `/edit` |
| `/insights` | `/manager`, `/team/[n]`, `/compare`, `/picklist` |
| `/accounts` | new |
| `/studio/*` | new — desktop surface, own layout (Phase 4) |
| `/settings` | unchanged |

### Phase 4 — Studio and Insights

Studio is **desktop-first** and gets a documented variant in `design.md` — not a
free-for-all second design system. It shares the tokens, type scale and accent;
it differs on nav (left sidebar, not the tab bar), density, and breakpoint
floor. Boundaries stated in the file so the two surfaces stay recognisably one
product.

It is a route group (`/studio/*` with its own `+layout.svelte`), **not a
separate app in a new tab.** A new tab buys nothing and costs session and state
coherence; a route group gives it its own chrome for free.

Insights ships as four to six fixed charts chosen for alliance selection,
hand-rolled like `Sparkline.svelte`. No charting library, no DnD library.
Revisit a drag-and-drop builder only if the fixed set demonstrably fails a real
selection — during selection a manager has about five minutes and reaches for a
ranked list, not a canvas.

## Smaller items, still open

Moved out of "after the redesign" — the sync UPDATE path and picklist sync were
promoted into Phase 0 above.

- **Design-system cleanup.** Once hallmark emits `design.md` and `tokens.css`,
  migrate every page off its duplicated `<style>` block onto shared components
  (Button, Card, Badge, Stat, Chip, PageHeader, EmptyState). Finish with a
  WCAG-AA pass: contrast in both themes, focus states, touch targets.
- **Build-time TBA API key.** Put the read key in a GitHub Actions secret
  (`VITE_TBA_API_KEY`), read it in `tba.js`, hide the paste field when set. Keep
  the paste field as a fallback for forks.
- **Relabel "Reset scheduling" → "Archive event."** Same RPC, clearer wording,
  and a post-action message spelling out that schedule/assignments/reminders are
  cleared while scout entries are kept.
- **Sync the `build/` directory or drop it.** `build/` and `.svelte-kit/` are
  correctly gitignored and untracked, but a stale `build/` from a June run still
  sits on disk. GitHub Actions rebuilds from source on every push, so the local
  copy is only ever a confusing duplicate — safe to delete.

---

## Conditional — only when the need is real

- **Server-side cleanup cron.** A scheduled Supabase job to prune expired
  reminders and dormant-event metadata. Build once cruft is actually visible.
- **Manager-editable metrics.** Defining counters in the UI instead of in
  `form-config.js` — needs a `metric_defs` table, a definitions UI, and a
  version stamp on every entry so a mid-event change doesn't corrupt
  aggregation. Considered and deferred: editing one file each January is cheaper
  than the machinery, and mid-event schema changes are a footgun.

---

## Deliberately not doing

Recorded so these don't get re-proposed.

- **Voice-to-text dictation.** Removed once already — uneven browser support,
  fiddly UI, little payback in a loud gym.
- **Photo attachment for robots.** Touches the data model, sync layer, export
  format, and adds Supabase Storage, for uncertain payoff. Revisit only if a
  concrete "we really wish we had photos" pain shows up at a real event.
- **Real OS push notifications (Web Push / VAPID).** Big lift to replace
  something the in-app reminder banner already does well enough.
- **Edge Function TBA proxy.** Only justified if the app goes public to hide the
  key server-side; the build-time env-var key is simpler for a private team tool.
- **Single `assignment_instances` table.** Collapsing `assignments` +
  `assignment_overrides` into one materialized table is a real migration with
  re-materialize-on-refetch complexity, for no user-visible benefit.
- **Fully online-only rewrite.** See "What stayed local-first" above.

### Rejected from the v6 plan, with reasons

- **A second Supabase project for users.** You lose the ability to join a user
  to their data — every "who submitted this" becomes a cross-project lookup in
  application code — and RLS stops being the enforcement layer, which is the
  whole current security model. Supabase already separates `auth.users` from the
  public schema in one project.
- **Drag-and-drop graph builder.** Needs a DnD library and a charting library,
  both against the no-new-dependencies rule, and it's a second design system to
  maintain. But the real objection is product: during alliance selection you
  have about five minutes and you reach for a ranked list, not a canvas. Fixed
  charts first; revisit only on evidence.
- **Auto-generated `hz123` usernames.** Superseded: scouts pick their own.
  Random digits are unmemorable and unpredictable by the person who has to type
  them. Uniqueness comes from a unique index on `lower(username)`, not from
  entropy — see Phase 1.
- **Google Sheets API.** CSV export exists and Sheets imports CSV. The API wants
  OAuth, a Cloud project and token refresh, and breaks the static-no-server
  model. A ten-second manual upload wins until it demonstrably doesn't.
- **A free-for-all second design system for Studio.** Studio does get its own
  register — desktop-first, sidebar, denser — but as a documented variant in
  `design.md`, sharing tokens, type scale and accent. Two unrelated systems in
  one product means two to maintain and an app that feels like two apps.
- **Opening Studio in a new tab.** A route group (`/studio/*` with its own
  layout) gives it separate chrome without costing session and state coherence.
  A new tab buys nothing here.
- **Playoff match scouting.** Deferred deliberately, not forgotten — see
  Phase 2 for the boundary and the reasoning.

### Answered: Studio is a desktop surface

Managers bring laptops, so Studio drops phone-first and gets a sidebar, denser
layout and a higher breakpoint floor. Schedule stays in the main app — a manager
may need to publish or reassign from a phone on the floor.

This is the only surface allowed to escape phone-first, and the permission is
specific to it. `design.md` records it as a variant with stated boundaries.
