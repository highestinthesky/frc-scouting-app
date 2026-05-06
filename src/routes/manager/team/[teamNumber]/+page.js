// Team numbers are only known from IndexedDB at runtime. Keep this route
// client-routed behind the adapter-static SPA fallback instead of prerendering.
export const prerender = false;
