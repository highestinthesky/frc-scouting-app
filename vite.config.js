import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// Same BASE_PATH the SvelteKit config reads. Empty in local dev, "/frc-scouting-app"
// in CI. The manifest's start_url, scope, and icon paths all need this prefix or the
// "Add to Home Screen" install will 404 once the app is hosted under a subpath.
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
				theme_color: '#0b3d91',
				background_color: '#0b3d91',
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
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff,woff2}']
			},
			devOptions: {
				// Lets the PWA work in `npm run dev` so you can test offline mode locally.
				enabled: true,
				type: 'module'
			}
		})
	]
});
