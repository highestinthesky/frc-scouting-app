// Tell SvelteKit to build this app as a pure client-side SPA.
// We don't have a server — everything runs in the browser, and all data
// is stored locally in IndexedDB. Disabling SSR avoids "window is not
// defined" errors at build time and is what we want for a PWA.
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'always';
