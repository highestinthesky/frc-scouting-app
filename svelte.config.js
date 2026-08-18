import adapter from '@sveltejs/adapter-static';

// GitHub Pages can serve this app at the domain root or from a subpath.
// BASE_PATH controls that prefix in production; locally it's empty so
// `npm run dev` and `npm run preview` keep serving from "/".
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		paths: {
			base
		},
		// adapter-static turns the app into a folder of plain HTML/CSS/JS
		// that you can drop on any static host (GitHub Pages, Cloudflare Pages, Netlify).
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			// 404.html, NOT index.html, and this is the difference between the team
			// pages working and 404ing in production.
			//
			// GitHub Pages serves a fallback for an unresolved path only when it is
			// named 404.html. Named index.html it is never reached — it just
			// OVERWRITES the prerendered `/` page, which is what the build has been
			// warning about ("Consider using a different name for the fallback")
			// for as long as it has been set this way.
			//
			// /studio/insights/team/[teamNumber] sets prerender = false, because
			// team numbers only exist in IndexedDB at runtime. So it has no built
			// page and depends entirely on this fallback: a static host returned
			// 404 for every team detail page. Measured against `build/`, not
			// assumed. The bare-fallback routes are covered by the redirect check
			// in check_components.mjs.
			fallback: '404.html',
			precompress: false,
			strict: true
		})
	}
};

export default config;
