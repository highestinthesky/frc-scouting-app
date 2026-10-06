# Design — FRC Scout

The shared visual system for the scouting app and Manager Studio. Updated by
the visual layout updates on 2026-10-06. Pages share this system; consistency
across the app takes precedence over catalog diversification.

## Audience and use

Scouts record matches on phones, often one-handed in a noisy gym. Managers use
Studio to staff events, publish schedules, inspect coverage and compare teams.
The design should make the next task easy to find and the data easy to scan.

## Genre and tone

Modern-minimal, quiet and utilitarian. Warm neutral surfaces in light mode,
charcoal in dark mode, restrained team purple for actions and selected states.
No gradients, glow, glass, ornamental art, or marketing sections.

## Macrostructure family

Workbench throughout: functional headings, a clear primary task, and sections
shaped by the actual content. Forms stay narrow; tables get more room. There
are no marketing pages. Auth pages use a functional heading and lead directly into the form.

## Copy

No logos, wordmarks, greeting copy, decorative section labels, or repeated
explanations. Use functional page headings, concise labels and short empty
states. Keep instructions only when they explain an unfamiliar control, prevent
a destructive mistake, or change how a number should be interpreted. Show event
context once in the navigation; detail pages retain their own event when their
route can differ from the selected event.

## Theme

Runtime tokens are defined in `src/routes/+layout.svelte`, the existing single
source of truth. `tokens.css` is a portable snapshot, not a second runtime
stylesheet. Components always use named tokens.

### Light

| Token | Value |
|---|---|
| `--bg-page` | `#f6f5f2` |
| `--bg-card` | `#ffffff` |
| `--bg-subtle` | `#eeede9` |
| `--bg-elev` | `#f0efec` |
| `--text-primary` | `#252525` |
| `--text-muted` | `#595750` |
| `--text-faint` | `#6b6862` |
| `--border` | `#dedcd6` |
| `--border-strong` | `#8a877f` |
| `--accent` | `#5f24a2` |
| `--accent-soft` | `#f1ebf7` |
| `--on-accent` | `#ffffff` |

### Dark

| Token | Value |
|---|---|
| `--bg-page` | `#151517` |
| `--bg-card` | `#1d1d20` |
| `--bg-subtle` | `#27272a` |
| `--bg-elev` | `#29292d` |
| `--text-primary` | `#f0eeea` |
| `--text-muted` | `#bbb8b2` |
| `--text-faint` | `#a09d98` |
| `--border` | `#38383c` |
| `--border-strong` | `#7f7d84` |
| `--accent` | `#bba1e1` |
| `--accent-soft` | `#30283c` |
| `--on-accent` | `#1d1d20` |

### Contrast and semantic color

`npm test` measures 190 color pairings across the main and Studio palettes in
light and dark. Body text needs 4.5:1; focus rings and required input boundaries
need 3:1. Dark primary buttons use dark ink on a light purple fill.

Red and blue identify alliances. They are always accompanied by text or position;
state colors identify success, warning and failure. Chart series use dedicated
Studio tokens. None of these colors are used to decorate the navigation.

The dark palette is defined once under `data-theme='dark'`. `app.html` resolves
the user's preference before paint; the layout follows changes thereafter.
Studio's overrides stay after the dark block and remap existing token names.

## Typography

System fonts load without a network request. `--font-body` and `--font-display`
share the system stack; `--font-mono` is reserved for codes. Body font is declared
once on `body` and inherited. Inputs use `--fs-control` (16px) to avoid iOS zoom.

- Page headings: `--fs-page`, tight tracking, roman, weight 650–700.
- Section headings: sentence case, weight 600, `--fs-md` or `--fs-lg`.
- Small table labels: sentence case, `--fs-xs`, muted.
- Counts, team numbers and table figures: tabular numerals.
- Uppercase is reserved for compact semantic metadata, such as alliance or role.

## Spacing and surfaces

The 4-point scale is `--space-1` through `--space-8`: 4, 8, 12, 16, 24, 32, 48,
and 64px. Controls use `--radius-md` (6px); panels use `--radius-lg` (8px).
Pages consume tokens rather than hardcoded spacing or type sizes.

Content widths: `--w-form` 34rem, `--w-read` 42rem, `--w-list` 60rem,
`--w-board` 78rem. Scout Home uses the reading width; manager Home and Studio
use the board width. Navigation spans the viewport with safe-area gutters.
Settings aligns to the left page gutter, with each control group limited to
form width. Its page heading spans the page rather than a centered form.

Use whitespace and rules before adding a card. Upcoming entries form open rows;
recorded entries share one list surface. Manager Home leads with event coverage and match status in one surface, then
lists missing entries and scout activity as open rows. Coverage percentages use
qualification matches through the last played or recorded qual, excluding
future matches; earlier missing submissions stay visible even without a cached
result. Personal manager recording tools remain in a collapsed Your scouting
section below the overview.
Studio summary figures share one strip with dividers. Panels belong to actual working groups, not every text block.
Nested panels use a subtle surface without a shadow stack.

## Navigation and responsive behavior

One shared header spans the viewport and shows event and account context.
Scout navigation has Home and Settings, docked below 40rem and displayed as a
top strip above that breakpoint. Manager navigation uses a 15rem sidebar from
48rem, a wrapping top strip on tablets, and a bottom bar with a More menu on
phones. Plan, Run, Review and Pick group the work; Accounts and Settings remain
reachable from the same shell. Home and management pages read the shared event
data so coverage, scout activity and assignments agree across views.

Every page must fit 320, 375, 414 and 768px, as well as desktop. Root overflow is
clipped; wide tables scroll inside their own wrappers. Grid tracks must shrink.
Buttons and navigation labels stay on one line. Long headings wrap inside words.
Safe-area insets remain part of the installed app layout.

## Controls and interactions

Primary actions use purple, secondary actions a quiet outline, and destructive
actions a danger outline. Full-width buttons fill their form's available width.
Keep at least 44px touch targets on scout-facing controls. Studio may use denser
pointer controls only where the existing desktop workflow requires it.

Focus is visible and instant. Disabled controls retain native disabled behavior
and a not-allowed cursor. Errors are inline; success updates the relevant content.
Native dialogs handle confirmations, the scout event prompt and the match editor, including keyboard
focus, an inert background and Escape. The editor returns focus to its trigger.
Recording actions keep single-line labels; desktop shortcuts hide on phones.

Motion stays brief (`--dur-short`: 150ms), with no entrance or scroll animation.
Reduced-motion preferences are supported. No motion library or webfont is added.

## Scope

Routes, component ownership, auth, event permissions, recording, draft recovery,
sync and data fetching retain their existing boundaries. Scouts with no selected
or accessible event receive a dismissible event prompt and explicitly choose
from their membership-limited event list. Practice remains available without
an event. Managers and supers receive the event overview on Home. No sample figures enter production.
Visual QA uses an isolated local copy with synthetic event data.

## Exports

### tokens.css

`tokens.css` contains the complete four-palette snapshot, including typography,
spacing, geometry, semantic colors and chart series. Regenerate it when the
layout's tokens change; do not import it back into the running app.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: #f6f5f2;
  --color-surface: #ffffff;
  --color-ink: #252525;
  --color-muted: #595750;
  --color-accent: #5f24a2;
  --color-rule: #dedcd6;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --spacing-panel: 1.5rem;
  --radius-control: 0.375rem;
  --radius-panel: 0.5rem;
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "#f6f5f2", "$type": "color" },
    "surface": { "$value": "#ffffff", "$type": "color" },
    "ink": { "$value": "#252525", "$type": "color" },
    "accent": { "$value": "#5f24a2", "$type": "color" }
  },
  "space": { "panel": { "$value": "1.5rem", "$type": "dimension" } },
  "radius": { "panel": { "$value": "0.5rem", "$type": "dimension" } }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: #f6f5f2;
  --foreground: #252525;
  --card: #ffffff;
  --card-foreground: #252525;
  --primary: #5f24a2;
  --primary-foreground: #ffffff;
  --muted: #eeede9;
  --muted-foreground: #595750;
  --border: #dedcd6;
  --input: #8a877f;
  --ring: #5f24a2;
  --radius: 0.5rem;
}
```

## Shared components

Pages consume these rather than restyling the same thing. A page that
reimplements one in its own `<style>` block is drifting.

- **`Dialog.svelte`** — the only confirm surface. Driven through
  `$lib/dialog.svelte.js`, mounted once in `+layout.svelte`. Built on the
  native `<dialog>` element so the focus trap, inert background, Escape
  handling and backdrop come from the platform rather than from a library this
  project has no room for. Bottom-anchored under `40rem` so the buttons land
  near the thumb; centred above it. Cancel is first in the DOM, so a stray
  Enter hits the safe option. Destructive confirms are outlined in `--danger`
  and fill only on hover — a delete button should not look like the obvious
  thing to press.

  `window.confirm()` is banned. It blocks the main thread, ignores this file
  entirely, and in an installed iOS PWA renders with the origin in the title,
  which reads as a phishing prompt.

- **`Button.svelte`** — the CTA voice, in one place. Three variants:
  `primary` (filled accent, one per screen region), `secondary` (outlined, and
  the default because most buttons are not the primary action), `danger`
  (outlined, filling only on hover). 44px floor via `var(--tap-min)`.
  `type="button"` by default, since the HTML default of `submit` inside a form
  is a bug that only appears when someone presses Enter.

  Not every button belongs here. A ✕ in a modal header, a match-number chip, a
  remove-row × — those are page furniture with their own shape, and routing
  them through a variant prop would turn this into a dumping ground.

### Page ownership

Extracting them was attempted and abandoned on evidence. The copies have
**drifted**: `.muted` has four different definitions across 18 uses, `h2` five
across 16, `.page-head` six across 8, `main` five across 9. Some of that drift
is deliberate — `main` is 32rem on form pages and 60rem on the compare table,
which is correct — and some is accidental, like `.muted` at 0.90 / 0.92 / 0.95rem.

Consolidating blind would silently change the type scale on five pages with no
way to see the result. That is a per-page design decision, so it happens during
each page's migration, not as one mechanical refactor. `Button.svelte` was
different: sixteen buttons, one voice, and the duplication was genuine.

### Migration status

| Surface | |
|---|---|
| `+layout.svelte` | done — tokens, docked nav, contrast fixed |
| `Dialog.svelte` | done |
| `Button.svelte` | done |
| `/settings` | done — the first full page |
| `/login`, `/register`, `/accounts` | done — built on the system from the start |
| `/` (home) | done |
| `/scouting`, `/scouting/new`, `/scouting/edit` | done |
| `/insights` and its four sub-pages | done |
| `lib/components/*` (16 files) | done |

**All surfaces use this system.** The remaining visual work is composition — what
each page leads with and how dense it is — not tokens. Two checks keep it that
way, and both run on `npm test`:

- `check_components.mjs` sweeps every `.svelte` file and fails on a raw `rem`
  in spacing or type, a hex literal outside `+layout.svelte`, or a
  `var(--token)` that is not defined.
- `check_contrast.mjs` measures every rendered colour pair in both themes.

The sweep is what makes the "no Card component" decision below survivable: the
copies may stay separate, but they can no longer drift off the scale.

A page counts as migrated when its spacing comes from tokens, its buttons come
from `Button.svelte`, and every interactive control clears 44px.

### The scoping trap

Svelte scopes component styles by injecting a hash class into every selector,
which **silently changes specificity**. `.thing` becomes `.thing.svelte-xxxx` —
(0,1,0) becomes (0,2,0). This has caused two shipped bugs here:

- `:global(main) { padding-bottom }` in the layout looked like it reserved room
  for the docked nav. A page's own scoped `main` is (0,1,1) and beat it.
- `.dlg { display: flex }` outranked the browser's
  `dialog:not([open]) { display: none }`, so the closed dialog rendered inline
  on every page with its buttons showing.

There is a third form, and it is the worst of the three because the compiler
stays silent:

- `<Button class="mb-add" />` with `.mb-add {}` in the parent's `<style>`.
  Svelte scopes the parent's selector with the *parent's* hash, while the
  element the child renders carries the *child's*. They never match. And
  unlike an unused selector, nothing warns — the compiler can see the class
  right there in the markup.

  **Style a wrapper the parent owns.** Never reach into a child through a
  class prop.

None of these appear in the source, in a compiler warning, or in any test that
doesn't render a browser. `scripts/check_components.mjs` reads the *emitted*
CSS and asserts against it; it runs in `npm test`, and it catches all three.
Add a case there when a component's styling depends on beating — or losing
to — a rule it doesn't own.

## Variants

Studio shares the main canvas, type, purple accent, controls and motion. Its
sidebar, wider content area and denser tables serve the manager's work. Its
chart-series tokens remain distinct and are contrast-tested on both panel
surfaces. Studio follows the user's light/dark preference.

## Amending this file

Amend this system before introducing a visual exception. Keep changes shared
where the meaning is shared; let page content determine its layout.
