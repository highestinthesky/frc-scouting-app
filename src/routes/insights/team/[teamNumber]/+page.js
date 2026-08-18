// Not prerenderable for the same reason its destination is not: a team number
// is only known from IndexedDB at runtime. It resolves through the SPA fallback,
// which is why svelte.config.js writes that fallback to 404.html.
export const prerender = false;
