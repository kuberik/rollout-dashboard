// This dashboard is entirely API-driven. There's no data to prerender at
// build time, and attempting to SSR/prerender the data-backed pages produces
// broken static HTML (with 500 status) for the dynamic rollout routes that
// the static server then happily serves on direct URL load.
//
// Force every route to pure client-side SPA mode so the static adapter only
// emits index.html plus the JS bundle; all routes fall through to the SPA
// fallback and render from scratch in the browser.
export const prerender = false;
export const ssr = false;
