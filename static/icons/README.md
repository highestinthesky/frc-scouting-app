# App icons

Drop three PNG files in this folder before deploying:

- `icon-192.png` — 192×192, app icon (required)
- `icon-512.png` — 512×512, app icon (required)
- `icon-maskable.png` — 512×512, maskable variant. Keep the important
  artwork inside the central 80% of the canvas; the surrounding area can
  be cropped to a circle, rounded square, etc. by the OS.

Tools that can generate all three from a single source:

- https://maskable.app/ (paste any image, export both maskable + standard)
- https://realfavicongenerator.net/ (also handles favicons)

Until these files exist the PWA install prompt may not appear in some
browsers, but the app will still run fine in a normal browser tab.
