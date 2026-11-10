import { beforeEach, describe, expect, it, vi } from 'vitest';

// `base` needs to vary per test (empty build vs. `/demo` sub-path build), but
// SvelteKit resolves `$app/paths` from `svelte.config.js` once, at build time.
// Mock it with a getter backed by a mutable module-scoped variable: `paths.ts`
// reads `base` inside each function body (not at import time), so every call
// sees whatever `mockBase` currently holds.
let mockBase = '';
vi.mock('$app/paths', () => ({
	get base() {
		return mockBase;
	}
}));

const { href, appPath } = await import('./paths');

describe('paths', () => {
	describe('empty base (plain build)', () => {
		beforeEach(() => {
			mockBase = '';
		});

		it('href is the identity function', () => {
			expect(href('/x')).toBe('/x');
			expect(href('/rollouts')).toBe('/rollouts');
			expect(href('/changes/github.com/acme/widget/pull/1')).toBe(
				'/changes/github.com/acme/widget/pull/1'
			);
		});

		it('href of root is root', () => {
			expect(href('/')).toBe('/');
		});

		it('appPath is the identity function', () => {
			expect(appPath('/x')).toBe('/x');
			expect(appPath('/rollouts')).toBe('/rollouts');
		});

		it('appPath of root is root', () => {
			expect(appPath('/')).toBe('/');
		});

		it('round-trips', () => {
			for (const p of ['/', '/rollouts', '/changes/x', '/apps/hello-world']) {
				expect(appPath(href(p))).toBe(p);
			}
		});
	});

	describe('/demo base (sub-path build)', () => {
		beforeEach(() => {
			mockBase = '/demo';
		});

		it('href prefixes ordinary paths', () => {
			expect(href('/rollouts')).toBe('/demo/rollouts');
			expect(href('/rollouts/dev/default/hello-world')).toBe(
				'/demo/rollouts/dev/default/hello-world'
			);
		});

		it('href of root is the base, not base + trailing slash', () => {
			expect(href('/')).toBe('/demo');
		});

		it('appPath strips the base back off', () => {
			expect(appPath('/demo/rollouts')).toBe('/rollouts');
			expect(appPath('/demo/rollouts/dev/default/hello-world')).toBe(
				'/rollouts/dev/default/hello-world'
			);
		});

		it('appPath of the bare base is root', () => {
			expect(appPath('/demo')).toBe('/');
			expect(appPath('/demo/')).toBe('/');
		});

		it('does NOT mangle a path that merely starts with the same letters as base', () => {
			// The classic bug: a naive `pathname.startsWith(base) ? pathname.slice(base.length) : pathname`
			// would turn `/demonstration` into `nstration`. It must come back untouched.
			expect(appPath('/demonstration')).toBe('/demonstration');
			expect(appPath('/demonstration/foo')).toBe('/demonstration/foo');
		});

		it('leaves an unrelated path (outside base) untouched', () => {
			expect(appPath('/rollouts')).toBe('/rollouts');
		});

		it('round-trips', () => {
			for (const p of ['/', '/rollouts', '/changes/x', '/apps/hello-world']) {
				expect(appPath(href(p))).toBe(p);
			}
		});
	});
});
