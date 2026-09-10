import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import ChangeLine from './ChangeLine.svelte';
import type { ChangeRowVM } from '../view-models/changes';
import type { LandingGridVM, LandingMarkVM } from '../view-models/landing-grid';

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
		frontierSince: null,
		noRelease: false,
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

	test('the standing slot caps at 4 words, always — live or not', () => {
		const live = render(ChangeLine, {
			props: { row: mkRow({ verdictTone: 'live', verdictWord: 'live everywhere' } as Partial<ChangeRowVM>) }
		});
		const liveText = live.container.querySelector('.cl-standing')?.textContent?.trim() ?? '';
		expect(liveText.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
		live.unmount();

		const held = render(ChangeLine, {
			props: {
				row: mkRow({
					verdictTone: 'held',
					// A long fused sentence, the shape the round-2 "feedback pass"
					// briefly printed verbatim in this slot — see below.
					verdictWord: 'hello-frontend-app held in dev on hello-api-app'
				})
			}
		});
		const heldText = held.container.querySelector('.cl-standing')?.textContent?.trim() ?? '';
		expect(heldText.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
	});

	/**
	 * ⭐ THE LIVE BUG THIS FIX PASS EXISTS FOR (2026-09-10). Every row on Home
	 * printed the FULL `verdictWord` sentence in the standing slot — with no
	 * `flex-shrink`/`max-width` of its own, that sentence's un-truncated
	 * content basis absorbed 100% of the row's negative flex-shrink space
	 * (a `flex-basis: 0%` sibling like the title contributes ZERO weight to
	 * that distribution), resolving the TITLE to 0px. Four different PRs all
	 * showed "hello-frontend-app held in dev on hello…" where the title
	 * should have been. The fix is two-fold: the standing slot is always the
	 * ≤4-word `standingWords` form (never `verdictWord`), and it is
	 * `shrink-0`/bounded so it can never again eat the title's space. This
	 * test is the regression: the title must render its OWN text, in full,
	 * never the standing sentence.
	 */
	test('the title always renders the PR title, never the standing sentence, even when standing is long', () => {
		const grid: LandingGridVM = {
			services: [
				{
					appName: 'hello-frontend-app',
					marks: [mkMark({ family: 'DEV', familyOrder: 0, state: 'gated', tone: 'stuck', sentence: 'dev: held' })],
					verdictWord: 'held',
					landedCount: 0,
					total: 1
				}
			],
			allSameLabel: null,
			visible: [],
			overflow: null
		};
		const { container } = render(ChangeLine, {
			props: {
				row: mkRow({
					title: 'fix(frontend): retry on 502',
					verdictTone: 'held',
					verdictWord: 'hello-frontend-app held in dev on hello-api-app',
					grid
				})
			}
		});
		const link = container.querySelector('a.tap-link') as HTMLAnchorElement;
		expect(link.textContent).toBe('fix(frontend): retry on 502');
		const standing = container.querySelector('.cl-standing')?.textContent?.trim() ?? '';
		expect(standing).toBe('held in dev');
		expect(standing).not.toBe(link.textContent);
	});

	test('the age answers "how long ago did this merge" when live, "how long stuck" otherwise', () => {
		const now = new Date('2026-09-10T12:00:00Z');
		const mergedAt = new Date(now.getTime() - 30 * 3600_000).toISOString(); // 30h ago
		const frontierSince = new Date(now.getTime() - 5 * 3600_000).toISOString(); // 5h ago

		const live = render(ChangeLine, {
			props: { row: mkRow({ verdictTone: 'live', mergedAt, frontierSince: null }), now }
		});
		expect(live.container.querySelector('.cl-age')?.textContent?.trim()).toBe('1d');
		live.unmount();

		const held = render(ChangeLine, {
			props: { row: mkRow({ verdictTone: 'held', mergedAt, frontierSince }), now }
		});
		expect(held.container.querySelector('.cl-age')?.textContent?.trim()).toBe('in this state for 5h');
	});

	test('the row is a single flex line box — one direct child holding every slot, not two stacked lines', () => {
		const { container } = render(ChangeLine, { props: { row: mkRow() } });
		const row = container.querySelector('.cl-row') as HTMLElement;
		// Exactly one row wrapper; every slot (icon, number, title, standing,
		// age) is a DIRECT child of it, not nested in a second line div.
		expect(row).toBeTruthy();
		expect(container.querySelectorAll('.cl-row').length).toBe(1);
	});

	/**
	 * HOME FEEDBACK PASS, ITEM 1 — the compact per-family meter. Builds a
	 * `LandingGridVM` with two services disagreeing on `dev` (one held, one
	 * live) so the aggregate must keep the WORST mark, never average or
	 * silently drop one service's own state.
	 */
	function mkMark(overrides: Partial<LandingMarkVM> = {}): LandingMarkVM {
		return {
			family: 'DEV',
			familyOrder: 0,
			count: 1,
			state: 'live',
			tone: 'live',
			sentence: 'dev: live',
			href: '/rollouts/hub/ns/name',
			theme: null,
			...overrides
		};
	}

	test('the meter shows one step per family, the WORST mark across services', () => {
		const grid: LandingGridVM = {
			services: [
				{
					appName: 'hello-frontend-app',
					marks: [
						mkMark({ family: 'DEV', familyOrder: 0, state: 'gated', tone: 'stuck', sentence: 'dev: held' }),
						mkMark({ family: 'STG', familyOrder: 1, state: 'not-built', tone: 'none', sentence: 'stg: not built' })
					],
					verdictWord: 'held',
					landedCount: 0,
					total: 2
				},
				{
					appName: 'hello-api-app',
					marks: [
						mkMark({ family: 'DEV', familyOrder: 0, state: 'live', tone: 'live', sentence: 'dev: live' }),
						mkMark({ family: 'STG', familyOrder: 1, state: 'not-built', tone: 'none', sentence: 'stg: not built' })
					],
					verdictWord: 'live',
					landedCount: 1,
					total: 2
				}
			],
			allSameLabel: null,
			visible: [],
			overflow: null
		};
		const { container } = render(ChangeLine, {
			props: { row: mkRow({ verdictTone: 'held', grid }) }
		});
		const meter = container.querySelector('.cl-meter') as HTMLElement;
		expect(meter).toBeTruthy();
		// DEV: one service held, the other live — the aggregate keeps the
		// WORST (held), never averages the two. STG has no build for either
		// service — with DEV as the frontier already stuck, STG reads "not
		// yet" (frontier-frozen), not a second independent amber family.
		expect(meter.getAttribute('aria-label')).toBe('dev held · staging not yet');
		expect(container.querySelectorAll('.cl-step').length).toBe(2);
	});

	// ⭐ ROUND 3 (2026-09-10 ruling A). Superseded: the meter used to be
	// absent for a row with no landing-grid services (the ledger fallback
	// shape, and now also a real `noRelease` change) — `familyProgress` now
	// returns three neutral DEV/STG/PRD placeholders for this exact shape
	// ("meter = three dashed dots" for a `noRelease` row), so the meter
	// always draws something.
	test('the meter draws three dashed placeholders for a row with no landing-grid services (the ledger fallback shape / a noRelease change)', () => {
		const { container } = render(ChangeLine, { props: { row: mkRow({ grid: EMPTY_GRID }) } });
		const meter = container.querySelector('.cl-meter');
		expect(meter).not.toBeNull();
		expect(container.querySelectorAll('.cl-step').length).toBe(3);
		expect(container.querySelectorAll('.cl-dot--dashed').length).toBe(3);
	});

	// ⭐ THE LIVE BUG DEFECT #2 EXISTS FOR: a service held in EVERY family
	// (dev/staging/prod all independently stuck on the real cluster) must
	// still draw only ONE amber step — the frontier — never three.
	test('a service held in every family draws amber only at the frontier, dashed after it', () => {
		const grid: LandingGridVM = {
			services: [
				{
					appName: 'hello-frontend-app',
					marks: [
						mkMark({ family: 'DEV', familyOrder: 0, state: 'gated', tone: 'stuck', sentence: 'dev: held' }),
						mkMark({ family: 'STG', familyOrder: 1, state: 'gated', tone: 'stuck', sentence: 'stg: held' }),
						mkMark({ family: 'PRD', familyOrder: 2, state: 'gated', tone: 'stuck', sentence: 'prd: held' })
					],
					verdictWord: 'held',
					landedCount: 0,
					total: 3
				}
			],
			allSameLabel: null,
			visible: [],
			overflow: null
		};
		const { container } = render(ChangeLine, { props: { row: mkRow({ verdictTone: 'held', grid }) } });
		expect(container.querySelectorAll('.cl-step .bg-orange-500').length).toBe(1);
		expect(container.querySelectorAll('.cl-dot--dashed').length).toBe(2);
	});

	// A partial-live family (some services live, none stuck) draws a green
	// RING, not a filled disc — distinct from the fully-live case.
	test('a partial-live family draws a green ring, not the solid live check', () => {
		const grid: LandingGridVM = {
			services: [
				{
					appName: 'hello-multi-app',
					marks: [mkMark({ family: 'DEV', familyOrder: 0, state: 'live', tone: 'live', sentence: 'dev: live' })],
					verdictWord: 'live',
					landedCount: 1,
					total: 1
				},
				{
					appName: 'hello-frontend-app',
					marks: [
						mkMark({ family: 'DEV', familyOrder: 0, state: 'queued', tone: 'queued', sentence: 'dev: queued' })
					],
					verdictWord: 'active',
					landedCount: 0,
					total: 1
				}
			],
			allSameLabel: null,
			visible: [],
			overflow: null
		};
		const { container } = render(ChangeLine, { props: { row: mkRow({ verdictTone: 'active', grid }) } });
		expect(container.querySelector('.cl-dot--live-ring')).toBeTruthy();
		expect(container.querySelector('.tone-live')).toBeNull();
	});
});
