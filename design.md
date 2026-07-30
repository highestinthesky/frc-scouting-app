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
| `--border-strong` | `#cccccc` | `oklch(84.5% 0 0)` |
| `--accent` | `#5f24a2` | `oklch(42.1% 0.187 299.3)` |
| `--accent-soft` | `#f4ebfa` | `oklch(95.1% 0.022 312.2)` |
| `--alliance-red` | `#c0392b` | `oklch(54.3% 0.174 29.7)` |
| `--alliance-blue` | `#2c5cb0` | `oklch(48.8% 0.144 260.7)` |
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
| `--border-strong` | `#38383b` | `oklch(34.2% 0.005 286.1)` |
| `--accent` | `#b18de0` | `oklch(70.8% 0.124 303.3)` |
| `--accent-soft` | `#2a1e3d` | `oklch(26.6% 0.058 300.4)` |
| `--alliance-red` | `#f1746a` | `oklch(70.4% 0.156 26.4)` |
| `--alliance-blue` | `#6fa8ec` | `oklch(72.0% 0.116 253.6)` |
| `--success` | `#6ee7b7` | `oklch(84.5% 0.130 165.0)` |
| `--warning` | `#fcd34d` | `oklch(87.9% 0.153 91.6)` |

### Contrast

Every foreground token clears **WCAG AA (4.5:1)** against every background it can
land on, in both themes. Worst cases: `--text-faint` at 4.54 in both.

`--text-faint` was `#888888` / `#6e6e72` and failed at 3.54 / 3.42. It carries
help text, timestamps and `.muted.small` — the smallest type in the app, where
the requirement is strictest. Re-check this table before changing any of these
values; the margin on the faint tokens is two hundredths.

### Alliance colours are semantic

Red and blue mean alliance, never decoration. Two rules:

- They must survive a retheme. Do not reuse them for state.
- They must never be the only signal. Every place an alliance colour appears, a
  text label or position carries the same information — colour-blind scouts,
  and glare on a phone screen under gym lighting.

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

- **Primary:** filled `--accent`, `--radius-md`, `0.55rem 1rem`, weight 600.
  One per screen region.
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
- Card surface: `--bg-card`, 1px `--border`, `--radius-md`.
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
  --border: #e0e0e0;       --border-strong: #cccccc;
  --accent: #5f24a2;       --accent-soft: #f4ebfa;  --on-accent: #ffffff;
  --alliance-red: #c0392b; --alliance-blue: #2c5cb0;
  --success: #047857;      --warning: #92400e;      --danger: #c0392b;

  --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;    --space-5: 1.5rem;  --space-6: 2rem;
  --radius-sm: 0.3rem; --radius-md: 0.4rem; --radius-lg: 0.6rem;
  --radius-pill: 999px;
  --fs-xs: 0.75rem; --fs-sm: 0.85rem; --fs-md: 0.95rem;
  --fs-lg: 1.1rem;  --fs-xl: 1.5rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 240ms;
  --tap-min: 2.75rem;
}
```

Dark overrides live under `:root[data-theme='dark']` and the
`prefers-color-scheme` query — see `+layout.svelte`.

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

Still to build, in roughly this order: Button, Card, Badge, Chip, EmptyState,
PageHeader. Each one deletes duplicated CSS from every page it lands on.

### The scoping trap

Svelte scopes component styles by injecting a hash class into every selector,
which **silently changes specificity**. `.thing` becomes `.thing.svelte-xxxx` —
(0,1,0) becomes (0,2,0). This has caused two shipped bugs here:

- `:global(main) { padding-bottom }` in the layout looked like it reserved room
  for the docked nav. A page's own scoped `main` is (0,1,1) and beat it.
- `.dlg { display: flex }` outranked the browser's
  `dialog:not([open]) { display: none }`, so the closed dialog rendered inline
  on every page with its buttons showing.

Neither appears in the source, in a compiler warning, or in any test that
doesn't render a browser. `scripts/check_components.mjs` reads the *emitted*
CSS and asserts against it; it runs in `npm test`. Add a case there when a
component's styling depends on beating — or losing to — a rule it doesn't own.

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

**Does not differ on:** the accent, the fonts, the CTA voice, or the enrichment
ban. "Futuristic" is delivered through density, layout and data, not through a
second palette or a glow. Two unrelated systems in one product means two to
maintain and an app that feels like two apps.

Schedule stays in the main app. A manager may need to publish or reassign from a
phone on the venue floor.

## Amending this file

If a page needs something this system doesn't allow, **amend here first**, then
redesign. Per-page overrides are how a design system dies.
