import { describe, expect, test } from 'vitest';

/**
 * CHANGES-2026-09-10.md §1 — `/versions` was already a redirect (to
 * `/revisions`); it now points straight at `/changes`, since `/revisions`
 * itself is only a redirect now — this keeps every `/versions` link a
 * SINGLE hop instead of chaining through `/revisions` a second time.
 */
function caught(fn: () => unknown): { status: number; location: string } {
	try {
		fn();
	} catch (e) {
		return e as { status: number; location: string };
	}
	throw new Error('load() did not redirect');
}

describe('/versions → /changes (retargeted, never chained through /revisions)', () => {
	test('the index redirects straight to /changes', async () => {
		const { load } = await import('./+page');
		const result = caught(() => load());
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes');
	});

	test('a deep link redirects straight to /changes/<slug>', async () => {
		const { load } = await import('./[...slug]/+page');
		const result = caught(() =>
			load({ params: { slug: 'github.com/acme/widget/9f10e494d560' } } as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes/github.com/acme/widget/9f10e494d560');
	});
});
