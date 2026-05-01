# FRC Scout

An offline-first FRC scouting PWA.

## First-time setup

You need [Node.js](https://nodejs.org/) 20 or newer. Check with:

```sh
node --version
```

Then, from this folder:

```sh
npm install
```

That downloads everything in `package.json` into a `node_modules/` folder
(this can take a minute the first time). It only needs to happen once,
and again whenever dependencies change.

## Day-to-day commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts a local dev server, usually at http://localhost:5173. Hot-reloads as you save files. |
| `npm run build` | Builds the production version into a `build/` folder. |
| `npm run preview` | Serves the production build locally so you can sanity-check it. |

## Project layout

```
src/
  app.html            Page shell (title, meta tags, theme color).
  routes/
    +layout.js        SPA settings (no SSR).
    +layout.svelte    Wraps every page (favicon, future shared chrome).
    +page.svelte      The home page. Currently a placeholder.
  lib/
    db.js             IndexedDB (local storage) via Dexie.
static/
  icons/              App icons. Drop PNGs here before deploying.
  .nojekyll           Tells GitHub Pages not to mangle file names.
svelte.config.js      Adapter + compiler config.
vite.config.js        PWA plugin config.
```

## Deploy (later)

`npm run build` produces a `build/` folder of plain static files.
You can drop that folder on:

- **Cloudflare Pages** — connect your GitHub repo, set build command to
  `npm run build`, output directory to `build`. Free.
- **GitHub Pages** — push the `build/` folder to a `gh-pages` branch.
  Free.
- **Netlify** — same idea as Cloudflare. Free.

No server, no database, no recurring cost.
