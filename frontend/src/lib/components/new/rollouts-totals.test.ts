import { describe, it, expect } from 'vitest';
import { pinOnlyPlaces, rollouts, fleetCounts } from './data';
import { rolloutsPage } from './rollouts-page';

/** Every total on /rollouts is the length of the list under it; a place only the pin holds is listed under Held, never at rest. */
for (const hs of ['incident', 'calm'] as const) {
	describe(`/rollouts totals equal their lists (${hs})`, () => {
		const P = rolloutsPage(hs);
		const pins = pinOnlyPlaces(rollouts(hs).c.m.apps as never, rollouts(hs).rows);
		it('each header count is its rendered rows', () => {
			for (const g of P.groups) expect(P.counts[g.key]).toBe(g.rows.length);
			expect(P.counts.rest).toBe(P.rest.length);
			for (const k of ['moving', 'waiting', 'held'] as const) if (!P.groups.some((g) => g.key === k)) expect(P.counts[k]).toBe(0);
		});
		it('a pin-only place is a Held row, not an at-rest row', () => {
			const held = P.groups.find((g) => g.key === 'held')?.rows ?? [];
			for (const p of pins) {
				expect(held.some((r) => r.href === p.href && r.lead === 'Held by the pin')).toBe(true);
				expect(P.rest.some((r) => r.href === p.href)).toBe(false);
			}
		});
	});
}
describe('home-incident literal', () => {
	it('checkout-api af-south-1 is listed under Held', () => {
		const held = rolloutsPage('incident').groups.find((g) => g.key === 'held')!.rows;
		expect(held.some((r) => r.app === 'checkout-api' && r.href.includes('af-south-1') && r.lead === 'Held by the pin')).toBe(true);
	});
});
