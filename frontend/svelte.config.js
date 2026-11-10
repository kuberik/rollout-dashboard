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
		prerender: {
			entries: ['*']
		}
	}
};

export default config;
