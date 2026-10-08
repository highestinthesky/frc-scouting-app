import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// Same BASE_PATH the SvelteKit config reads. Empty means the app is served from
// the domain root, as production is at https://scout.rohawks.org. When set, manifest URLs get
// that prefix so install links still work under a subpath deployment.
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			// The root layout registers the service worker itself. 'auto' wrote a
			// script into an index.html that SvelteKit does not have, so for every
			// release up to the move to scout.rohawks.org nothing registered it at
			// all; and the plugin's own register helper reloads the page whenever
			// an update activates, which would throw away a recording in progress.
			injectRegister: false,
			strategies: 'generateSW',
			kit: {
				// Every route sets trailingSlash = 'always' (routes/+layout.js), so a
				// page's address is /studio/review/. Without this the precache keys
				// it as studio/review, which no request ever matches.
				trailingSlash: 'always',
				// The answer for an address not precached by name — a team or match
				// page, which are not prerendered. It has to be 404.html, the one
				// shell built with absolute asset paths: every prerendered page links
				// its scripts relative to its own folder (./_app at /, ../../_app at
				// /studio/review/), so the plugin's default, /, served at a nested
				// address loads them from a folder that does not exist.
				adapterFallback: '404.html',
				// Puts 404.html in the precache. adapter-static writes it straight
				// to build/, where the precache glob never looks.
				spa: true
			},
			manifest: {
				name: 'FRC Scout',
				short_name: 'FRC Scout',
				description: 'Scouting for FRC team 3419.',
				theme_color: '#5f24a2',
				background_color: '#5f24a2',
				display: 'standalone',
				start_url: `${base}/`,
				scope: `${base}/`,
				icons: [
					// The team logo on white; scripts/make_icons.py builds them.
					{ src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
					{ src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
					{ src: `${base}/icons/icon-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				]
			},
			workbox: {
				// Cache the built app shell so it works offline.
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff,woff2}'],
				// Take over immediately on update. Without these flags a new
				// service worker only activates after every tab to the site is
				// closed — which means a broken deploy keeps serving stale
				// code for hours. Trade-off: an in-flight request when the
				// new SW activates may fail and need a retry. Acceptable
				// because (a) scouting flows are short, (b) the alternative
				// is users stuck on a broken version.
				skipWaiting: true,
				clientsClaim: true,
				// Don't intercept cross-origin requests (TBA, Supabase) — they
				// should always hit the network directly. The default
				// behaviour is fine here, listed explicitly for clarity.
				navigateFallbackDenylist: [/^\/api\//, /thebluealliance\.com/, /supabase\.co/]
			},
			devOptions: {
				// Serves the manifest under `npm run dev`. No service worker is
				// registered there (it would cache the code being edited); test
				// offline against a build with `npm run serve:build`.
				enabled: true,
				type: 'module'
			}
		})
	]
});
