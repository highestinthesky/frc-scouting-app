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
- `ladder-question`, `warning-question` — the rung was not recorded

## How the app uses these

The path data is inlined into `src/lib/components/AutoField.svelte` — the chips
are drawn straight into the field's SVG, so nothing here is fetched at runtime
and this folder is the source of record rather than a build input.

Two things are changed on the way in, both deliberately:

- **The colours are dropped.** `#111827`, `#DC2626` and white are re-applied from
  design tokens (`--accent`, `--success`, `--danger`, `--bg-card`), because three
  literals would be invisible on a dark carpet and outside the contrast floors
  `scripts/check_contrast.mjs` holds. The shapes are untouched.
- **Nothing is composed any more.** Every climb icon is two slots — ladder or
  warning triangle on the left, numeral on the right — and `ladder-question` /
  `warning-question` fill the right slot for a rung nobody read. They replaced a
  centred-ladder composition, and they are better than it was: an absence now
  has a mark of its own instead of being drawn by leaving something out. Picking
  `climbing-1` as a stand-in would assert a rung nobody reported.

`shooting` is the app's `score` action and `malfunction` is its `fault`; the
names differ because the stored vocabulary predates these icons and renaming a
stored value is a migration, not a rename.

To replace an icon, edit the path data in `AutoField.svelte` to match the file
here. Keep the authored `stroke-width`s — the whole icon is scaled down as one,
so those are what carry legibility at the 25px the chip measures on a phone.
