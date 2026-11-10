import type { ClientInit } from '@sveltejs/kit';

/**
 * ⭐ THE DEMO BUILD INSTALLS ITS BACKEND BEFORE THE APP EXISTS.
 *
 * SvelteKit awaits `init` before it starts the router, so this is the only
 * place a `fetch` shim can be installed with a guarantee that no `load` and no
 * query has fired yet. Doing it from a layout's `onMount` would be a race with
 * the first fetch, not a fix.
 *
 * ⛔ THE IMPORT IS DYNAMIC ON PURPOSE. `import.meta.env.VITE_DEMO` is replaced
 * with a literal at build time, so in a normal (non-demo) build this whole
 * body is unreachable and Rollup drops the mock — ~1600 lines of fixtures that
 * must never reach a real dashboard bundle.
 */
export const init: ClientInit = async () => {
	if (!import.meta.env.VITE_DEMO) return;
	const { installDemoApi } = await import('$lib/demo/install');
	installDemoApi();
};
