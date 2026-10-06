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

### Integration with the current shared shell

The final changes preserve the current remote navigation: one full-width header,
role-specific AppNav, and Plan, Run, Review and Pick routes. Home reads the shared
event data. The manager's existing next-match, assignment and entry tools remain
in a collapsed Your scouting section, with a single main landmark. Returning
from recording and deleting an entry refreshes the same coverage data.

Home, Run's Gaps filter and Review share the last-played cutoff. Earlier quals
with no submissions remain missing when a later qual has been recorded, and
zero scores establish a played match. Two additional regression tests cover
these cases, bringing the overview suite to nine tests.

The final Chromium pass repeated the 36 Home/Settings role/viewport checks and
scout event states. A second pass exercised management routes and personal
scouting at all six widths, the phone More menu, the coverage link to a match
with zero entries, and a local save returning to Home without an inbound sync
change. All passed. The independent integration review's findings were fixed
and rechecked; no actionable findings remain. The full suite passes, including
83 component and 190 contrast checks, and the production build succeeds with
only the existing Select, SVG tabindex and Browserslist notices.

## Home priorities and team-purple follow-up — 2026-10-06

Home restores the existing per-person greeting for scouts, managers and supers.
The greeting remains stable as the minute updates. Manager Home leads with the
next qualification match, its teams and a review action; once quals finish it
shows the latest match. Missing entries and scout activity follow, while
coverage and fully recorded counts occupy a compact lower summary. Personal
scouting remains available through its disclosure.

The header returns to team purple in both themes. Light page and navigation
surfaces are lavender, dark surfaces are deep purple, and selected navigation
links have a purple fill. Alliance and status colors retain their meanings.
Active navigation hover and keyboard focus retain readable contrast; token
checks now include navigation surfaces and pass 218 assertions.

Fresh Chromium checks covered Home and Settings for every role at 320, 375,
414, 768, 1280 and 1920px, plus finished quals, no schedule, long names, dark
mode and scout event selection. Match review links, six team links, personal
scouting and the smaller coverage summary were checked. Light, dark and mobile
screenshots were inspected. All checks used the isolated synthetic preview,
with external requests blocked. The full test suite and production build pass;
the existing Select, SVG tabindex and Browserslist notices remain.

The final review caught the sync chip's offline/error dots losing contrast on
hover. The hover fill was darkened, and assertions now cover every dot against
both resting and hovered header surfaces. The regression first failed for those
colors in all four palettes; the corrected palette passes all 218 assertions.

The targeted browser verification also passed 24 selected-navigation keyboard
focus/hover states and 12 hovered offline sync indicators, covering scout and
manager navigation at 375, 768 and 1280px in both themes. The final independent
review has no remaining actionable findings.
