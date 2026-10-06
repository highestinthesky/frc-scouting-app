<!-- Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 -->
# Hallmark UI review

Reviewed 2026-10-05 against `design.md`, Hallmark's audit and redesign guidance,
modern-minimal anti-patterns, and the applicable slop-test gates.

The main app and Studio use neutral surfaces, system type and a restrained purple
accent. Visible logos and wordmarks are removed. Page titles, control labels,
status, data qualifications and consequential-action confirmations remain.

## Coverage

All 24 route templates, both layouts and all 27 shared component templates were
reviewed in source. All 16 active pages were rendered with synthetic manager,
event, schedule and entry data at 320, 375, 414 and 768px: 64 page/width checks.
No page-level horizontal overflow or out-of-bounds controls were found in those
checks; wide data tables scroll within their own wrappers.

| Area | Active pages reviewed |
| --- | --- |
| Access | Sign in, account setup |
| Main app | Home, Settings, Practice, New entry, Edit entry |
| Studio | Event, Schedule, Coverage, Insights, Compare, Picklist, Accounts |
| Detail views | Match detail, team detail |

The eight legacy redirect routes retain their destinations and use a brief
“Opening…” state. They were reviewed in source.

| Shared UI | Parts reviewed |
| --- | --- |
| Controls and layout | Button, Field, Select, PageHead, Panel, Toolbar, Table, Stat, Stats |
| Session and status | SessionSetup, EventPicker, SyncPanel, Dialog, ReminderFlyby |
| Recording and analysis | AutoField, AutoRecorder, AutoReplay, Sparkline, PublicRating |
| Event management | AssignScouts, CoverageCheck, ImportEntries, MatchDetailModal, PublishSchedule, ReminderPanel, SchedulePreview, ScoutRoster |

Rendered state checks included the recorder's placement/live/completed views,
replay controls, expanded team entries, the sync popover and the match editor.
Recording actions, match rows and the sync popover were checked at all four
required widths. Light and dark page samples were inspected visually, including
Home and Studio at desktop size.

## Findings resolved

- Removed logos, wordmarks, greeting, decorative role/section labels, repeated
  event context, duplicated counts and paragraphs that restated nearby controls.
- Kept useful error messages, credential recovery instructions, destructive
  warnings, partial/synced-data qualifications and relative-rating caveats.
- Corrected the coverage empty state to describe partially recorded matches;
  removed an incorrect team-count interpretation of unreadable rating keys.
- Removed the repeated thin-coverage count from the Scouts statistic. The
  coverage notice continues to identify the affected teams.
- Removed sparkle decoration and thick colored stripes from cards and entry rows.
- Kept live recording labels on one line on phones and preserved 55px targets.
- Reflowed scout names and actions in narrow match-editor rows.
- Used a native modal dialog for the match editor. Initial focus enters the
  dialog, background controls become inert, Escape closes it, and focus returns
  to the triggering edit button. Tab navigation was checked through a full cycle.
- Applied the primary-button ink token to session setup in both themes and used
  the shared scrim token for both dialog types.

## Verification

`npm test` passes, including 51 shared-component assertions and 190 token contrast
assertions. `npm run build` passes with the static site and PWA output.
`git diff --check` passes. The build retains existing warnings for the field
SVG tabindex, Select's initial id capture and the Browserslist database.

An independent Hallmark source reviewer examined every route/shared template,
then reviewed the final recorder, modal and sync-copy changes. No actionable
findings remained in that focused review. No open findings remain from the
source review and sampled rendered checks.

This review does not exercise live account, permission, reminder, schedule
publishing or cloud-sync writes. Runtime QA used an isolated preview with
synthetic local data. System fonts and the existing Workbench structure are
intentional app-specific choices: venue reliability and established task flows
take precedence over marketing-page diversification rules.

## Layout follow-up — 2026-10-06

The app menu now spans the viewport. Manager and super Home shows one coverage
surface, missing-entry rows linked to match detail, and scout activity with
assignment counts. Settings starts at the left page gutter. Scouts with no
selected or accessible event receive a native event dialog and explicitly choose
from the events their account may access; Escape dismisses it and a visible
button reopens it. An empty list explains how to obtain event access.

Fresh Chromium checks covered Home and Settings for scout, manager and super at
320, 375, 414, 768, 1280 and 1920px: 36 page/role/width combinations. The event
prompt was exercised at 320, 375, 414, 768 and 1280px. Selection writes to
IndexedDB, dismissal/reopening works, and keyboard navigation does not reach
background controls. Event-list errors and retry, the no-events state, long
event codes, connected sync status, and dark mode were also checked. Screenshots
of desktop/mobile Home, Settings, the dialog and dark Home were inspected.
These checks used synthetic data in an isolated preview with external requests
blocked; physical phones and live server writes were not exercised.

Seven new overview tests cover missing submissions on played matches, future
matches and playoffs, duplicates and unrelated entries, delayed results, unknown
coverage, zero scores and scout account identity. The full test suite, component
checks and 190 contrast assertions pass. The production build and diff whitespace
check pass. The independent follow-up review has no remaining actionable
findings. All applicable Hallmark visual and mobile gates pass against the
existing app system; system fonts and the shared Workbench remain intentional.
