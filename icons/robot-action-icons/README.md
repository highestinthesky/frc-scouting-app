# Robot action icons

Nine matching action icons for the FRC scouting application.

- Canvas: `256 x 256` for every SVG and PNG
- Background: transparent
- Action color: `#111827`
- Warning color: `#DC2626`
- Warning mark: white

The `svg/` directory contains resolution-independent originals. The `png/`
directory contains 256-pixel raster exports. SVG files deliberately have no
background rectangle, so transparency is preserved.

## Assets

- `collecting`
- `shooting`
- `malfunction`
- `climbing-1`, `climbing-2`, `climbing-3`
- `climbing-warning-1`, `climbing-warning-2`, `climbing-warning-3`

## How the app uses these

The path data is inlined into `src/lib/components/AutoField.svelte` — the chips
are drawn straight into the field's SVG, so nothing here is fetched at runtime
and this folder is the source of record rather than a build input.

Two things are changed on the way in, both deliberately:

- **The colours are dropped.** `#111827`, `#DC2626` and white are re-applied from
  design tokens (`--accent`, `--success`, `--danger`, `--bg-card`), because three
  literals would be invisible on a dark carpet and outside the contrast floors
  `scripts/check_contrast.mjs` holds. The shapes are untouched.
- **Two compositions are derived**, for the case the set does not draw: a climb
  whose rung was not recorded. Every climb icon here is two slots — ladder or
  warning triangle on the left, numeral on the right — so with no numeral the
  left slot is drawn alone and nudged to the centre. Picking `climbing-1` for an
  unknown rung would assert a rung nobody reported.

`shooting` is the app's `score` action and `malfunction` is its `fault`; the
names differ because the stored vocabulary predates these icons and renaming a
stored value is a migration, not a rename.

To replace an icon, edit the path data in `AutoField.svelte` to match the file
here. Keep the authored `stroke-width`s — the whole icon is scaled down as one,
so those are what carry legibility at the 25px the chip measures on a phone.
