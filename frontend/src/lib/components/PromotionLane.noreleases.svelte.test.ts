import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PromotionLane from './PromotionLane.svelte';
import { laneOf } from './new/Footprint.svelte';

/* checkout-worker's mixed lane: dev has no releases, the others are on the newest. A plain box reads as current, so the none node says so. */
const place = (tier: string, over: Record<string, unknown> = {}) => ({
	env: tier,
	label: tier,
	tier,
	state: 'healthy',
	href: `/${tier}`,
	version: 'bbb',
	onNewest: true,
	onBuild: true,
	currency: 'newest',
	...over
});
const lane = () =>
	laneOf(
		{
			app: 'checkout-worker',
			newest: 'bbb',
			placeList: [
				place('dev', { version: null, onNewest: false, currency: 'none' }),
				place('staging'),
				place('prod')
			]
		} as never,
		{ apps: [] } as never,
		[{ t: 1, app: 'checkout-worker', sha: 'bbb' }] as never
	).lane;

describe('PromotionLane: a no-release place is not drawn as current', () => {
	for (const fill of ['L', 'M'] as const) {
		it(`says "no releases" in the fact slot and the title (fill ${fill}); newest cells carry no fact`, () => {
			const { container } = render(PromotionLane, {
				props: { lane: lane(), hrefFor: () => '/x', fill } as never
			});
			const cell = (t: string) => container.querySelector(`[data-tier="${t}"]`)!;
			expect(cell('dev').querySelector('.env-fact')?.textContent).toBe('no releases');
			expect(cell('dev').querySelector('[data-env-box]')?.getAttribute('title')).toMatch(
				/ · no releases$/
			);
			for (const t of ['staging', 'prod']) {
				expect(cell(t).querySelector('.env-fact')).toBeNull();
				expect(cell(t).querySelector('[data-env-box]')?.getAttribute('title')).not.toMatch(
					/no releases/
				);
			}
		});
	}
});
