import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PromotionLane from './PromotionLane.svelte';
import { laneOf } from './new/Footprint.svelte';

/** Without per-site marks (sites: false) the box's own mark still says failing or failed by the recovered rule. */
const place = (tier: string, over: Record<string, unknown> = {}) => ({ env: tier, label: tier, tier, state: 'healthy', href: `/${tier}`, version: 'bbb', onNewest: true, onBuild: true, currency: 'newest', ...over });
const lane = () => laneOf({ app: 'checkout-worker', newest: 'bbb', placeList: [place('staging'), place('prod', { state: 'failed' })] } as never, { apps: [] } as never, [{ t: 1, app: 'checkout-worker', sha: 'bbb' }] as never).lane;

describe('PromotionLane: a failed box without site marks', () => {
	it('the box mark label says failed when recovered, failing otherwise', () => {
		for (const [recovered, word] of [[false, 'failing'], [true, 'failed']] as const) {
			const { container, unmount } = render(PromotionLane, { props: { lane: lane(), hrefFor: () => '/x', words: true, sites: false, recovered: () => recovered } as never });
			const prod = container.querySelector('[data-tier="prod"]')!;
			const labels = [...prod.querySelectorAll('[aria-label],[title],.sr-only')].map((e) => `${e.getAttribute('aria-label') ?? ''}|${e.getAttribute('title') ?? ''}|${e.textContent}`).join(' ## ');
			expect(labels, labels).toMatch(new RegExp(`\\b${word}\\b`));
			unmount();
		}
	});
});
