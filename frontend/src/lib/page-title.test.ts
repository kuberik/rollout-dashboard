import { describe, expect, test } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
	test('names a page as "<page> · Kuberik" — capital K, dot separator', () => {
		expect(pageTitle('Apps')).toBe('Apps · Kuberik');
		expect(pageTitle('checkout-api (checkout-api-prod-us-east-2)')).toBe(
			'checkout-api (checkout-api-prod-us-east-2) · Kuberik'
		);
	});

	test('Home is the one exception: bare "Kuberik", no page name prefixed', () => {
		expect(pageTitle()).toBe('Kuberik');
	});

	test('never the retired "kuberik | <page>" pipe shape or a lowercase product name', () => {
		const title = pageTitle('Changes');
		expect(title).not.toContain('|');
		expect(title).not.toContain('kuberik');
		expect(title).toContain('Kuberik');
	});
});

/**
 * ⛔ EVERY ROUTE GOES THROUGH `pageTitle`. (Design rollout QA 5, 2026-10-09.)
 * The integration merge dropped `pageTitle()` from /apps and /apps/<name>,
 * and those two pages shipped the retired "kuberik | …" title again. This
 * reads every Svelte file under routes/ and lib/ and fails on a `<title>`
 * that does not call `pageTitle(` — so a merge can't silently bring the
 * old shape back.
 */
describe('every <title> is built by pageTitle()', () => {
	const files = import.meta.glob(['../routes/**/*.svelte', './**/*.svelte'], {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;

	test('the glob actually found the routes', () => {
		expect(Object.keys(files).some((f) => f.includes('/routes/apps/+page.svelte'))).toBe(true);
	});

	for (const [file, src] of Object.entries(files)) {
		/* an SVG mark's own <title> (the tooltip of a drawn atom) is not the document title: only a <title> that is not the first child of a shape is checked */
		const titles = [...src.matchAll(/(?<!<(?:line|rect|circle|path|g|svg)\b[^>]*>)<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]);
		if (titles.length === 0) continue;
		test(`${file.replace(/^.*?src\//, '')}`, () => {
			for (const t of titles) {
				expect(t, `a <title> in ${file} must be {pageTitle(…)}`).toMatch(/\{\s*pageTitle\(/);
				expect(t).not.toMatch(/kuberik \|/i);
			}
		});
	}
});
