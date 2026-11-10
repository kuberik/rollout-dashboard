import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { demoRedirectTarget } from '$lib/demo/page-param';
import { syncMockScenario } from '$lib/demo/scenario-cookie';
import type { LayoutLoad } from './$types';

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

/**
 * ⭐ `?page=` — THE DEMO BUILD'S ONLY ROUTING CONCESSION. (2026-09-12)
 *
 * kuberik.com serves this build as static files from GitHub Pages under
 * `/demo/`, and GitHub Pages cannot rewrite `/demo/rollouts/...` to
 * `/demo/index.html`. So each showcase iframe opens `/demo/?page=<app path>`
 * and the router does the rewrite itself, here — before the home page renders,
 * not after, so no showcase ever flashes Home on its way to a rollout.
 *
 * ⚠️ IT CAN REDIRECT TWICE, AND THAT IS FINE — the earlier claim here, that
 * "the target carries no `page` param so this cannot loop", was simply wrong.
 * The param's own VALUE may contain a query string, so
 * `?page=/rollouts/dev/default/hello-world%3Fpage=/apps` lands on `/demo/apps`
 * in two hops, the second honouring the nested param (measured, 2026-09-12).
 * What actually bounds it is that each hop CONSUMES one level of nesting, so a
 * finite URL terminates; there is no fixed point that re-emits itself. In a
 * normal build `import.meta.env.VITE_DEMO` is a literal `undefined` and the
 * whole body is dropped.
 *
 * ⛔ WHAT COUNTS AS A PATH IS `$lib/demo/page-param`'S JOB, NOT A
 * `startsWith('/')` HERE — `//evil.com` passes that test and is an off-site
 * redirect. See that file's doc comment and its tests.
 */
export const load: LayoutLoad = ({ url }) => {
	if (import.meta.env.VITE_DEMO) {
		const target = demoRedirectTarget(url, base);
		if (target) redirect(307, target);
	}
	/* r39: `?scenario=calm|quiet|incident` (and the old `?calm=1` / `?quiet=1`) pick the MOCK API's scenario; inert without those params */
	syncMockScenario(url);
};
