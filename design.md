# Design — FRC Scout

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Produced by a Hallmark multi-page redesign, 2026-07-29. Across pages of one app
the diversification rule is **inverted**: consistency is the goal. A page that
drifts from this file is the bug.

---

## The brief this system serves

A scout standing in a loud gym, holding a phone one-handed, watching a match
that lasts two and a half minutes. They are not sitting at a desk and they are
not browsing. Every decision below resolves in favour of that person.

The manager's surfaces have a different shape — dense tables read while making
alliance-selection decisions — but they inherit the same system.

## Genre

**modern-minimal.** A dense operational tool, not editorial prose. Restrained,
declarative, monochrome-plus-one-accent.

## Macrostructure family

- **App pages (all nine routes): Workbench.** "Less marketing copy, more here's
  what you do with it." The content is the app in use.
- Marketing pages: none exist. If one is ever added, amend this file first.
- Content pages: none exist.

Variation knobs within the family: section density, whether a page leads with a
summary strip, table vs. card rendering of rows. Everything else is shared.

## Three deviations from stock Hallmark, and why

Recorded so they are not "fixed" by a later run.

1. **System fonts, not a webfont.** Both modern-minimal themes specify one
   (Coral: Geist. Cobalt: Space Grotesk + Inter + JetBrains Mono). This app is a
   PWA used on venue wifi shared by several hundred phones. A webfont is a
   first-paint risk exactly when the app matters most. Type discipline comes
   from scale, weight and tracking instead of from a face.

2. **Bottom tab bar on phones.** All fourteen Hallmark nav archetypes
   (N1a–N13) are top-of-page marketing bars, because the catalogue is for
   landing pages. A top tab strip is the hardest place on a phone for a thumb to
   reach. Below `40rem` the nav is fixed to the bottom; above it, a top strip.

3. **The accent stays purple** (`#5f24a2`). It is the team's colour, not a
   theme pick. The catalog accents (Coral's warm, Cobalt's electric blue) were
   considered and rejected.

## Theme

Anchored on the existing brand purple. Hex is the implementation (already
shipped and contrast-tested); OKLCH is given for portability.

### Light

| Token | Hex | OKLCH |
|---|---|---|
| `--bg-page` | `#fafafa` | `oklch(98.5% 0 0)` |
| `--bg-card` | `#ffffff` | `oklch(100% 0 0)` |
| `--bg-subtle` | `#f5f5f5` | `oklch(97.0% 0 0)` |
| `--text-primary` | `#1a1a1a` | `oklch(21.8% 0 0)` |
| `--text-muted` | `#555555` | `oklch(45.0% 0 0)` |
| `--text-faint` | `#707070` | `oklch(54.5% 0 0)` |
| `--border` | `#e0e0e0` | `oklch(90.7% 0 0)` |
| `--border-strong` | `#8f8f8f` | `oklch(65.0% 0 0)` |
| `--accent` | `#5f24a2` | `oklch(42.1% 0.187 299.3)` |
| `--accent-soft` | `#f4ebfa` | `oklch(95.1% 0.022 312.2)` |
| `--on-accent` | `#ffffff` | `oklch(100% 0 0)` |
| `--alliance-red` | `#c0392b` | `oklch(54.3% 0.174 29.7)` |
| `--alliance-blue` | `#2c5cb0` | `oklch(48.8% 0.144 260.7)` |
| `--on-alliance` | `#ffffff` | `oklch(100% 0 0)` |
| `--success` | `#047857` | `oklch(50.8% 0.105 165.6)` |
| `--warning` | `#92400e` | `oklch(47.3% 0.125 46.2)` |

### Dark

| Token | Hex | OKLCH |
|---|---|---|
| `--bg-page` | `#0e0e10` | `oklch(16.5% 0.004 285.9)` |
| `--bg-card` | `#1a1a1c` | `oklch(21.9% 0.004 286.1)` |
| `--bg-subtle` | `#1f1f22` | `oklch(24.1% 0.006 286.0)` |
| `--text-primary` | `#e8e8e8` | `oklch(93.1% 0 0)` |
| `--text-muted` | `#a0a0a3` | `oklch(70.7% 0.004 286.3)` |
| `--text-faint` | `#8a8a8a` | `oklch(63.3% 0 0)` |
| `--border` | `#2a2a2d` | `oklch(28.6% 0.005 286.1)` |
| `--border-strong` | `#6a6a70` | `oklch(52.0% 0.006 286.1)` |
| `--accent` | `#b18de0` | `oklch(70.8% 0.124 303.3)` |
| `--accent-soft` | `#2a1e3d` | `oklch(26.6% 0.058 300.4)` |
| `--on-accent` | `#1a1a1c` | `oklch(21.9% 0.004 286.1)` |
| `--alliance-red` | `#f1746a` | `oklch(70.4% 0.156 26.4)` |
| `--alliance-blue` | `#6fa8ec` | `oklch(72.0% 0.116 253.6)` |
| `--on-alliance` | `#101014` | `oklch(17.7% 0.005 286.0)` |
| `--success` | `#6ee7b7` | `oklch(84.5% 0.130 165.0)` |
| `--warning` | `#fcd34d` | `oklch(87.9% 0.153 91.6)` |

### Contrast

Every foreground token clears **WCAG AA (4.5:1)** against every background it can
land on, in both themes. Worst case: `--text-faint` at 4.54 in both.

**This is enforced, not asserted.** `scripts/check_contrast.mjs` parses the real
token values out of `+layout.svelte` and measures every pair the app renders, in
both themes, on every `npm test`. Do not edit the table above by hand and trust
it — change the layout and run the check.

Three failures it has already caught, none of which were visible by looking:

| | Was | Why it mattered |
|---|---|---|
| `--text-faint` | 3.54 / 3.42 | the smallest type in the app — timestamps, help text |
| `--on-accent` (dark) | 2.71 on `--accent`, 2.06 on `--accent-hover` | white on light lavender: **every primary button**, in the theme people use in a dark gym |
| `--border-strong` | 1.61 / 1.49 | an input's border is the only thing that says "input" (WCAG 1.4.11 → 3:1) |

Two pairs are deliberately **not** checked: `--warning-border` on `--warning-bg`
and `--success-border` on `--success-bg`. 1.4.11 covers boundaries required to
identify a component; a banner is identified by its fill and its text, and
deleting its border loses nothing. Forcing decoration to 3:1 would darken those
tints until they read as errors.

### Alliance colours are semantic

Red and blue mean alliance, never decoration. Three rules:

- They must survive a retheme. Do not reuse them for state.
- They must never be the only signal. Every place an alliance colour appears, a
  text label or position carries the same information — colour-blind scouts,
  and glare on a phone screen under gym lighting.
- **Text on an alliance fill uses `--on-alliance`, never `#fff`.** The fills
  lighten in dark mode; white collapses to 2.47:1 on blue. The ink flips instead
  of the fill, so red stays red.

The literals `#c0392b`, `#2c5cb0`, `#e24b4a` and `#378add` appeared in six
places between them — light-mode alliance values, hardcoded, which stayed dark
against a dark card once dark mode existed. Each looked deliberate in isolation.
`check_components.mjs` now rejects a hex literal anywhere outside
`+layout.svelte`.

### One dark block

The dark palette is defined **once**, under `:root[data-theme='dark']`. There is
no `@media (prefers-color-scheme: dark)` copy; "system" is resolved to an
explicit `data-theme` by an inline script in `app.html` (before first paint) and
kept in sync by `+layout.svelte` thereafter.

This is not a preference. The two blocks existed, and they had already drifted —
`--on-alliance` was in one and not the other, so a scout on OS-level dark saw
white text on a light blue pill while a scout who chose dark in Settings saw the
correct ink, and neither could reproduce what the other was looking at.
`check_contrast.mjs` fails if a second block returns.

## Typography

- **Display / body / mono:** `system-ui, -apple-system, sans-serif`. One family.
- **Display tracking:** `-0.02em` at `--fs-xl` and above; `0` below.
- **Section labels:** uppercase, `0.06em` tracking, `--text-muted`. Existing
  `h2` voice — keep it.
- Headings are always roman. No italic display type anywhere.
- Numerals in any table, stat or team number use `font-variant-numeric:
  tabular-nums`, so columns align and a changing count doesn't jitter.

## Spacing

The 4-point scale already in `+layout.svelte`: `--space-1` (0.25rem) through
`--space-6` (2rem). Pages must consume the named tokens, not raw rem values.
Radii: `--radius-sm` 0.3, `--radius-md` 0.4, `--radius-lg` 0.6, `--radius-pill`.

## Touch targets

**Minimum 44×44px for anything tappable. Non-negotiable** — this is the one
rule most likely to be broken by a visual pass, because a 32px chip looks
better in a screenshot and fails in a gym. Counter buttons are already 3rem.

## Motion

Motion-cut. No library, and none is to be added.

- Permitted: `opacity` and `width` transitions up to 240ms, `--ease-out`
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- Banned: scroll reveals, entrance animations, overshoot/bounce easings,
  parallax, skeleton shimmer.
- `prefers-reduced-motion: reduce` → opacity only, ≤150ms.

Nothing in this app should animate to feel designed. The coverage bar animates
because a changing number is easier to read when it moves.

## Microinteractions stance

- **Silent success.** A saved entry updates the list. No toast, no confetti.
- Errors are inline and specific, next to the thing that failed.
- Focus is always visible: `2px solid var(--accent)`, `outline-offset: 1px`.
  Never remove an outline without replacing it.
- Destructive actions confirm with a dialog naming what will be lost.

## CTA voice

- **Primary:** filled `--accent`, `--radius-md`, `var(--tap-min)` tall with
  `var(--space-4)` of horizontal padding, weight 600. One per screen region.
- **Secondary:** `--bg-card` with a `--border-strong` outline, same geometry.
- **Danger:** outlined in `--danger`, filled only on hover.
- Copy is a verb: "Save assignments", "Publish to teammates". Never "Submit",
  never "Click here".

## Per-page allowances

- App pages **must not** use enrichment — no hero art, no decorative SVG, no
  illustration. Function carries the page.
- No re-drawn chrome: no fake phone frames, no fake browser bars.
- No invented data. Every number on screen traces to a recorded entry.

## What pages MUST share

- The accent and its placement (≤5% of any viewport).
- The type scale, weights and tracking.
- The CTA voice — button shape, radius, padding rhythm.
- Section heading rhythm: uppercase tracked label, then content.
- Card surface: `--bg-card`, 1px `--border`, `--radius-lg`.

  The radius ladder, which this file previously collapsed into one value:

  | | |
  |---|---|
  | `--radius-sm` 0.3 | dense rows inside a surface — schedule rows, match rows |
  | `--radius-md` 0.4 | **controls** — buttons, inputs, selects, chips with square ends |
  | `--radius-lg` 0.6 | **surfaces** — cards, panels, dialogs |
  | `--radius-pill` | badges and filter chips |

  Corrected in v0.75 rather than enforced: the line said `--radius-md` for
  cards, and eighteen places used `--radius-lg` — including `Dialog`, which
  predates every one of them. The code was coherent (controls at md, surfaces at
  lg) and the document was the part that had drifted. Changing eighteen files to
  match a sentence that never described them would have been enforcing a typo.
- The nav: bottom bar under `40rem`, top strip above.

## What pages MAY differ on

- Density — the manager's tables may be tighter than the scout's forms.
- Whether a page leads with a summary strip.
- Table vs. card rendering, chosen per surface by what the data needs.

## Exports

### tokens.css

```css
:root {
  /* light */
  --bg-page: #fafafa;      --bg-card: #ffffff;      --bg-subtle: #f5f5f5;
  --text-primary: #1a1a1a; --text-muted: #555555;   --text-faint: #707070;
  --border: #e0e0e0;       --border-strong: #8f8f8f;
  --accent: #5f24a2;       --accent-soft: #f4ebfa;  --on-accent: #ffffff;
  --alliance-red: #c0392b; --alliance-blue: #2c5cb0; --on-alliance: #ffffff;
  --success: #047857;      --warning: #92400e;      --danger: #c0392b;

  --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;    --space-5: 1.5rem;  --space-6: 2rem;
  --radius-sm: 0.3rem; --radius-md: 0.4rem; --radius-lg: 0.6rem;
  --radius-pill: 999px;
  --fs-xs: 0.75rem; --fs-sm: 0.85rem; --fs-md: 0.95rem;
  --fs-lg: 1.1rem;  --fs-xl: 1.5rem;
  --fs-display: 2.25rem;   /* Home's greeting only */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 240ms;
  --tap-min: 2.75rem;
}
```

Dark overrides live under `:root[data-theme='dark']` — one block, no media
query. See "One dark block" above.

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

### Why there is no Card or PageHeader component

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

**All surfaces are migrated.** The remaining visual work is composition — what
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

### Studio (desktop-first)

`/studio/*` is the manager's laptop surface. It is the **only** surface allowed
to escape phone-first, and the permission is specific to it.

**Shares** — every colour token, the type scale, weights and tracking, the accent
and its placement rule, the CTA voice, the card surface, motion stance.

**Differs on:**

- **Nav** — a left sidebar, not the bottom tab bar. Studio has more
  destinations than a thumb-reachable bar can carry.
- **Breakpoint floor** — designed at 1024px and up. It should stay legible
  narrower, but it is not optimised for a phone and does not pretend to be.
- **Density** — tighter row rhythm and smaller type steps are permitted, because
  the reader is seated with a mouse rather than standing in a gym.
- **Touch targets** — the 44px floor relaxes to 32px for pointer-only controls
  inside Studio. It still applies to anything that can be reached on a tablet.

**Does not differ on:** the fonts, the CTA voice, or the enrichment ban.

**Amended v0.74–v0.75 — Studio does have its own palette.** This section used to
read "not through a second palette or a glow", and that was overtaken by a
decision taken with its eyes open, so it is recorded here rather than left as a
rule the code quietly breaks.

What changed, and why the original worry does not apply:

- The block **remaps the base tokens** rather than adding a parallel set. Every
  shared component — `Button`, `Select`, `Dialog`, `Field` — reads `--bg-card`
  and `--accent` and is dressed correctly with no Studio-specific branch. There
  is one system with a second set of values, not two systems.
- The type scale, spacing, radii, motion stance and CTA geometry are untouched.
- `check_contrast.mjs` runs the **same PAIRS table** over all four palettes —
  light, dark, Studio light, Studio dark — at 170 assertions. The second palette
  costs a table row, not a second system to maintain.
- Studio follows the app theme as of v0.75. It was dark in both themes on the
  reasoning that the four brand colours only work on a dark ground; that was
  reasoning about the palette rather than about the reader, and the reader could
  not read it.

The roles invert between the two Studio palettes, and that inversion is the
design: on dark, cyan and aqua are ink and purple is a fill; on light, purple is
the only one of the four that reads and the others are decorative. See
`CLAUDE.md` § Design system for the numbers.

Schedule stays in the main app. A manager may need to publish or reassign from a
phone on the venue floor.

## Amending this file

If a page needs something this system doesn't allow, **amend here first**, then
redesign. Per-page overrides are how a design system dies.
