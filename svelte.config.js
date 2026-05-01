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
			fallback: 'index.html', // SPA fallback so client-side routing works on any host
			precompress: false,
			strict: true
		})
	}
};

export default config;
