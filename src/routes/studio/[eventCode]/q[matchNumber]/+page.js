// Neither the event code nor the match number is known until runtime — both
// come from IndexedDB or from a link. Client-routed behind the adapter-static
// SPA fallback, which svelte.config.js writes to 404.html.
export const prerender = false;
