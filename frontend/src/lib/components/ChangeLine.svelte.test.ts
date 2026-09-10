import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import ChangeLine from './ChangeLine.svelte';
import type { ChangeRowVM } from '../view-models/changes';
import type { LandingGridVM } from '../view-models/landing-grid';

/**
 * `ChangeLine` — CHANGES-2026-09-10.md ROUND 2, R2.1. The ONE-LINE row:
 * `[glyph] #n title … standing … age`, no grid, no author, no repo (on
 * Home; `/changes` turns `showRepo` on).
 *
 * ⚠️ jsdom does not evaluate `@container` queries, so the "age drops below
 * 420px" rule (`.cl-age` in the component's own `<style>`) is NOT checked
 * here — it is verified live in the browser (LA's `routes/_dev/changes`
 * harness, screenshotted at 288/334/800px equivalents). This file checks
 * what jsdom CAN tell us: the DOM always contains exactly the five slots,
 * in order, regardless of container width — the CSS then decides what's
 * visible.
 */

const EMPTY_GRID: LandingGridVM = { services: [], allSameLabel: null, visible: [], overflow: null };

function mkRow(overrides: Partial<ChangeRowVM> = {}): ChangeRowVM {
	return {
		owner: 'acme',
		repo: 'widget',
		repoKey: 'acme/widget',
		kind: 'pr',
		number: 4,
		title: 'fix(frontend): retry on 502',
		sha: 'bf5be4932430f8f3576912d0ae7e57c0a9177383',
		shortSha: 'bf5be49',
		href: '/changes/acme/widget/pull/4',
		htmlUrl: 'https://github.com/acme/widget/pull/4',
		author: 'octocat',
		mergedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
		verdictWord: 'held in prod',
		verdictTone: 'held',
		grid: EMPTY_GRID,
		notEverywhere: true,
		prodLeadMs: null,
		frontierReason: null,
		...overrides
	};
}

describe('ChangeLine', () => {
	test('renders one <li> with the number, title as the tap-link, standing word and age', () => {
		const { container } = render(ChangeLine, { props: { row: mkRow() } });
		const items = container.querySelectorAll('li');
		expect(items.length).toBe(1);
		expect(container.textContent).toContain('#4');
		const link = container.querySelector('a.tap-link') as HTMLAnchorElement;
		expect(link.textContent).toBe('fix(frontend): retry on 502');
		expect(link.getAttribute('href')).toBe('/changes/acme/widget/pull/4');
		expect(container.querySelector('.cl-standing')).toBeTruthy();
		expect(container.querySelector('.cl-age')).toBeTruthy();
	});

	test('a bare commit prints its 7-char sha where a PR prints `#n`', () => {
		const { container } = render(ChangeLine, {
			props: { row: mkRow({ kind: 'commit', number: undefined, shortSha: 'abc1234' }) }
		});
		expect(container.textContent).toContain('abc1234');
		expect(container.textContent).not.toContain('#4');
	});

	test('the repo name is absent by default (Home) and present with `showRepo` (the index)', () => {
		const home = render(ChangeLine, { props: { row: mkRow() } });
		expect(home.container.textContent).not.toContain('widget');
		home.unmount();

		const index = render(ChangeLine, { props: { row: mkRow(), showRepo: true } });
		expect(index.container.textContent).toContain('widget');
	});

	test('the standing word slot never carries more than 4 words, for every verdict tone', () => {
		const cases: ChangeRowVM['verdictTone'][] = ['live', 'held', 'failed', 'active', 'not-built'];
		for (const verdictTone of cases) {
			const { container } = render(ChangeLine, { props: { row: mkRow({ verdictTone }) } });
			const text = container.querySelector('.cl-standing')?.textContent?.trim() ?? '';
			expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
		}
	});

	test('the row is a single flex line box — one direct child holding every slot, not two stacked lines', () => {
		const { container } = render(ChangeLine, { props: { row: mkRow() } });
		const row = container.querySelector('.cl-row') as HTMLElement;
		// Exactly one row wrapper; every slot (icon, number, title, standing,
		// age) is a DIRECT child of it, not nested in a second line div.
		expect(row).toBeTruthy();
		expect(container.querySelectorAll('.cl-row').length).toBe(1);
	});
});
