import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * ⭐ THE DEMO BUILD IS THE SAME APP UNDER A SUB-PATH. (2026-09-12)
 *
 * `scripts/build-demo.sh` sets `DEMO_BASE=/demo` and `DEMO_OUT=build-demo`;
 * everything else about the build is untouched, and with neither variable set
 * this is byte-for-byte the configuration that shipped before. `paths.base`
 * has to be baked in at build time (SvelteKit resolves every asset and every
 * `goto` against it), which is why the demo is a second build rather than a
 * flag on the existing one.
 */
const base = process.env.DEMO_BASE ?? '';
const out = process.env.DEMO_OUT ?? 'build';

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: out,
			assets: out,
			fallback: 'index.html'
		}),
		paths: { base },
		/**
		 * Content-Security-Policy. This is an adapter-static SPA, so SvelteKit
		 * emits it as a <meta http-equiv> tag in index.html (hash mode; the
		 * frame-ancestors / report-uri / sandbox directives are ignored in a
		 * meta tag and must come from a response header).
		 *
		 * - script-src 'self': the theme bootstrap is the external
		 *   static/theme-init.js, not an inline script; kit hashes its own
		 *   bootstrap script. No 'unsafe-inline' / 'unsafe-eval' for scripts.
		 * - style-src 'unsafe-inline': needed for inline <style> elements
		 *   injected by svelte-highlight and the Datadog SVG, and for the
		 *   style="" attribute on the root <div>. Scripts stay locked down.
		 * - img-src: GitHub avatars come from the API as
		 *   avatars.githubusercontent.com URLs; data: for inline icons.
		 * - connect-src 'self': API and SSE are same-origin (the hub proxies
		 *   spokes).
		 * - worker-src 'self' blob: for the log-parser Web Worker.
		 */
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'https://avatars.githubusercontent.com', 'https://github.com'],
				'font-src': ['self', 'data:'],
				'connect-src': ['self'],
				'worker-src': ['self', 'blob:'],
				'manifest-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		},
		prerender: {
			entries: ['*']
		}
	}
};

export default config;
