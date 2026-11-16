import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PromotionLane from './PromotionLane.svelte';
import { laneOf } from './new/Footprint.svelte';

/** A failed box: its word, its mark label and its age follow the failing / failed rule, and the age counts from when the failure began. */
const place = (tier: string, over: Record<string, unknown> = {}) => ({ env: tier, label: tier, tier, state: 'healthy', href: `/${tier}`, version: 'bbb', onNewest: true, onBuild: true, currency: 'newest', ...over });
const lane = () =>
	laneOf(
		{ app: 'checkout-worker', newest: 'bbb', placeList: [place('staging'), place('prod', { state: 'failed'})] } as never,
		{ apps: [] } as never,
		[{ t: 1, app: 'checkout-worker', sha: 'bbb' }] as never
	).lane;

describe('PromotionLane: a failed box', () => {
	it('dates from failedSince (not the deploy), and the mark label says failed when recovered, failing otherwise', () => {
		const since = new Date(Date.now() - 12 * 60_000).toISOString();
		for (const [recovered, word] of [[false, 'failing'], [true, 'failed']] as const) {
			const { container, unmount } = render(PromotionLane, { props: { lane: lane(), hrefFor: () => '/x', words: true, sites: true, recovered: () => recovered, failedSince: () => since } as never });
			const prod = container.querySelector('[data-tier="prod"]')!;
			const tip = [...prod.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).join('|');
			expect(tip).toContain('12m');
			expect(prod.querySelector('[data-wave-mark]')?.getAttribute('aria-label')).toMatch(new RegExp(`${word}$`));
			unmount();
		}
	});
	it('words a recovered box "Failed" in neutral ink beside its ring, a failing one in danger ink', () => {
		for (const sites of [true, false])
			for (const [recovered, ink, word] of [[false, 'text-danger', 'Failing'], [true, 'text-fg-muted', 'Failed']] as const) {
				const { container, unmount } = render(PromotionLane, { props: { lane: lane(), hrefFor: () => '/x', words: true, sites, recovered: () => recovered } as never });
				const w = container.querySelector('[data-tier="prod"] .env-word')!;
				expect(w.textContent).toContain(word);
				expect(w.className).toContain(ink);
				if (recovered) expect(w.className).not.toContain('text-danger');
				unmount();
			}
	});
});
