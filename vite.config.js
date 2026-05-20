import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// Same BASE_PATH the SvelteKit config reads. Empty means the app is served from
// the domain root (for example https://3419.github.io). When set, manifest URLs get
// that prefix so install links still work under a subpath deployment.
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			strategies: 'generateSW',
			manifest: {
				name: 'FRC Scout',
				short_name: 'FRC Scout',
				description: 'Offline-friendly FRC scouting tool with file-based sync.',
				theme_color: '#5f24a2',
				background_color: '#5f24a2',
				display: 'standalone',
				start_url: `${base}/`,
				scope: `${base}/`,
				icons: [
					// Replace these placeholders with real PNGs in /static/icons/ before deploying.
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
				// Lets the PWA work in `npm run dev` so you can test offline mode locally.
				enabled: true,
				type: 'module'
			}
		})
	]
});
