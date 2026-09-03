import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import HowItsGoing from './HowItsGoing.svelte';
import type { HowItsGoingScope, FurthestBehind } from './HowItsGoing.svelte';
import type { Rollout } from '../../types';

/** Every OPTIONAL field a fixture below might set, plus the two required
 *  ones — typed so `svelte-check` verifies each fixture actually satisfies
 *  `HowItsGoing`'s own props, not a loose `Record<string, unknown>` that
 *  would wave a missing required prop through. */
type CardProps = {
	deploys: number;
	sparklineRollouts: Rollout[];
	population?: string;
	typicalDeployMs?: number | null;
	typicalToProd?: { ms: number | null; title: string };
	failed?: { count: number; title: string };
	furthestBehind?: { entry: FurthestBehind | null; title: string };
};

/**
 * ⭐ ONE CARD, FOUR SCOPES — the drift this file exists to catch.
 *
 * Two independent critics measured `How it's going` as four different cards:
 * `/` and `/apps` printed the `dd` figure at `text-base font-semibold`
 * (16px/600, no declared type role); `/apps/[name]` printed it at
 * `t-headline` (17px/600, the WRONG declared role); `dt` was `text-xs`
 * (12px) on three pages and `t-dense` (12.5px) on the fourth; the sparkline
 * lived in a `dl` ROW on three pages and in the CARD HEADER on the fourth;
 * and `/envs/[name]` silently swapped its window from 7 days to 24 hours
 * with nothing on the card saying so.
 *
 * Each fixture below is the shape one real call site actually passes —
 * `HomeRail.svelte`, `routes/apps/+page.svelte`, `routes/apps/[name]/
 * +page.svelte`, `routes/envs/[name]/+page.svelte` — not an invented one.
 */
const SCOPES: {
	name: string;
	scope: HowItsGoingScope;
	windowLabel: string;
	props: CardProps;
	expectedRows: string[];
}[] = [
	{
		name: 'fleet (`/`)',
		scope: 'fleet',
		windowLabel: '7d',
		props: {
			population: '15 rollouts',
			deploys: 12,
			sparklineRollouts: [],
			typicalToProd: { ms: 3_600_000, title: 'typical to prod' },
			failed: { count: 0, title: 'failed' }
		},
		expectedRows: ['Deploys', 'Typical to prod', 'Failed']
	},
	{
		name: 'apps (`/apps`)',
		scope: 'apps',
		windowLabel: '7d',
		props: {
			population: '4 apps',
			deploys: 34,
			sparklineRollouts: [],
			typicalToProd: { ms: null, title: 'typical to prod' },
			furthestBehind: {
				entry: { appName: 'hello-frontend-app', by: 2 },
				title: 'furthest behind'
			}
		},
		expectedRows: ['Deploys', 'Typical to prod', 'Furthest behind']
	},
	{
		name: 'app (`/apps/[name]`)',
		scope: 'app',
		windowLabel: '7d',
		props: {
			deploys: 5,
			sparklineRollouts: [],
			typicalDeployMs: 45_000,
			typicalToProd: { ms: 9 * 3_600_000, title: 'typical to prod' }
		},
		expectedRows: ['Deploys', 'Typical deploy', 'Typical to prod']
	},
	{
		name: 'env (`/envs/[name]`)',
		scope: 'env',
		windowLabel: '24h',
		props: {
			deploys: 3,
			sparklineRollouts: [],
			typicalDeployMs: null,
			furthestBehind: { entry: null, title: 'furthest behind' }
		},
		expectedRows: ['Deploys', 'Typical deploy', 'Furthest behind']
	}
];

describe('HowItsGoing: the same dt/dd shape across all four scopes', () => {
	for (const { name, scope, windowLabel, props, expectedRows } of SCOPES) {
		test(`${name} renders exactly its own rows, in the fixed order`, () => {
			const { container } = render(HowItsGoing, {
				props: { scope, windowLabel, ...props }
			});

			// One `<dt>` per row this scope's population actually has — never a
			// row synthesised for a fact this population does not carry.
			const dts = Array.from(container.querySelectorAll('dl > div > dt'));
			expect(dts.map((dt) => dt.textContent?.trim().slice(0, 20))).toHaveLength(
				expectedRows.length
			);
			expectedRows.forEach((label, i) => {
				expect(dts[i].textContent?.trim().startsWith(label)).toBe(true);
			});
		});

		test(`${name}: every dt is .t-dense and every figure is .t-figure`, () => {
			const { container } = render(HowItsGoing, {
				props: { scope, windowLabel, ...props }
			});

			const dts = container.querySelectorAll('dl > div > dt');
			expect(dts.length).toBeGreaterThan(0);
			for (const dt of dts) {
				expect(dt.className).toContain('t-dense');
			}

			// The defect this test exists to catch: a `dd` figure escaping the
			// one declared role via a private `text-base font-semibold` pair, or
			// via `t-headline` (declared, but the wrong one — see `app.css`'s
			// `.t-figure` note).
			expect(container.querySelectorAll('.t-figure').length).toBeGreaterThan(0);
			expect(container.innerHTML).not.toContain('t-headline');
			expect(container.innerHTML).not.toContain('text-base font-semibold');
		});

		test(`${name}: the window is printed on the Deploys row`, () => {
			const { container } = render(HowItsGoing, {
				props: { scope, windowLabel, ...props }
			});

			const deploysRow = container.querySelector('dl > div:first-child dt');
			expect(deploysRow?.textContent).toContain(`Deploys · ${windowLabel}`);
		});
	}

	test('the population, when given, rides on the same row as the window — never a second row', () => {
		const { container } = render(HowItsGoing, {
			props: {
				scope: 'fleet',
				windowLabel: '7d',
				population: '15 rollouts',
				deploys: 12,
				sparklineRollouts: []
			}
		});
		const dts = container.querySelectorAll('dl > div > dt');
		expect(dts).toHaveLength(1);
		expect(dts[0].textContent).toContain('Deploys · 7d · 15 rollouts');
	});

	test('`Typical to prod` renders "— no measured trip yet" rather than a bare dash', () => {
		const { container } = render(HowItsGoing, {
			props: {
				scope: 'app',
				windowLabel: '7d',
				deploys: 1,
				sparklineRollouts: [],
				typicalToProd: { ms: null, title: 'no trip yet' }
			}
		});
		expect(container.textContent).toContain('no measured trip yet');
	});

	test('`Furthest behind` with nothing behind renders a GREEN dash, not the neutral figure ink', () => {
		const { container } = render(HowItsGoing, {
			props: {
				scope: 'apps',
				windowLabel: '7d',
				population: '4 apps',
				deploys: 1,
				sparklineRollouts: [],
				furthestBehind: { entry: null, title: 'nothing behind' }
			}
		});
		const dash = container.querySelector('.t-figure.text-green-700');
		expect(dash?.textContent?.trim()).toBe('—');
	});

	test('`Failed` with a non-zero count takes the product red, not the neutral figure ink', () => {
		const { container } = render(HowItsGoing, {
			props: {
				scope: 'fleet',
				windowLabel: '7d',
				population: '15 rollouts',
				deploys: 12,
				sparklineRollouts: [],
				failed: { count: 2, title: 'two failed' }
			}
		});
		const figure = container.querySelector('.t-figure.text-red-700');
		expect(figure?.textContent?.trim()).toBe('2');
	});
});
