import { describe, expect, test } from 'vitest';

/**
 * CHANGES-2026-09-10.md §1 — every superseded `/revisions` address 308s to
 * its `/changes` equivalent, ONE hop. `redirect()` (`@sveltejs/kit`) throws
 * rather than returns, so each `load` is called inside a `try`/`catch` that
 * asserts on the thrown object's own `status`/`location` — the same shape
 * SvelteKit itself inspects to build the HTTP response.
 */
function caught(fn: () => unknown): { status: number; location: string } {
	try {
		fn();
	} catch (e) {
		return e as { status: number; location: string };
	}
	throw new Error('load() did not redirect');
}

describe('/revisions → /changes', () => {
	test('the index redirects to /changes', async () => {
		const { load } = await import('./+page');
		const result = caught(() => load());
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes');
	});

	test('a repository/build slug redirects to the identical slug under /changes', async () => {
		const { load } = await import('./[...slug]/+page');
		const result = caught(() =>
			load({ params: { slug: 'github.com/acme/widget/9f10e494d560' } } as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes/github.com/acme/widget/9f10e494d560');
	});

	test('a pull-keyed slug carries its `pull/<n>` tail through unchanged', async () => {
		const { load } = await import('./[...slug]/+page');
		const result = caught(() =>
			load({ params: { slug: 'github.com/acme/widget/pull/4' } } as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes/github.com/acme/widget/pull/4');
	});
});
