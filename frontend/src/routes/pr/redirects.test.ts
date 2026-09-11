import { describe, expect, test } from 'vitest';

/**
 * CHANGES-2026-09-10.md §1 — `/pr/<owner>/<repo>/<number>` 308s to
 * `/changes/<repoSlug>/pull/<number>` forever (⛔ SUPERSEDED but PERMANENT:
 * the human keeps PR tabs open "for longer time", so this route is never
 * deleted, only ever a redirect from here on).
 */
function caught(fn: () => unknown): { status: number; location: string } {
	try {
		fn();
	} catch (e) {
		return e as { status: number; location: string };
	}
	throw new Error('load() did not redirect');
}

describe('/pr/<owner>/<repo>/<number> → /changes/<repoSlug>/pull/<number>', () => {
	test('one hop, via changePath', async () => {
		const { load } = await import('./[owner]/[repo]/[number]/+page');
		const result = caught(() =>
			load({ params: { owner: 'acme', repo: 'widget', number: '42' } } as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/changes/github.com/acme/widget/pull/42');
	});
});
