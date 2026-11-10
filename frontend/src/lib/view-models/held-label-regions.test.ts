import { describe, it, expect, afterEach } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { cardContext } from './card-context';
import { fleetFacts, heldLabel } from './fleet-facts';

/** Coordinator ruling 2026-10-12: partial regions are named; "prod" only when every prod region is held. */
afterEach(() => resetDemoState('calm'));
function factsFor(scenario: 'calm' | 'incident') {
	resetDemoState(scenario);
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const ctx = cardContext({ rollouts: l.rollouts.items, environments: l.environments, rolloutDependencies: l.rolloutDependencies });
	const cards = buildRolloutCards(l.rollouts.items, l.environments.items, new Date(), ctx.gateContext, ctx.contractHoldsFor);
	return { cards, f: fleetFacts(cards, l.rollouts.items, Date.now(), '7d', ctx as never) };
}
describe('heldLabel names partial prod regions', () => {
	// SITES AND WAVES: prod is waves of sites, not parallel regions each after staging, so only staging is refused by the contract; the prod sites wait on their wave (`held.ts`).
	it('checkout-api: only staging is held, and it is named', () => {
		const { cards } = factsFor('calm');
		const held = cards.filter((c) => c.name === 'checkout-api' && c.held && c.heldCause !== 'person').map((c) => c.envName).sort();
		expect(held).toEqual(['staging']);
		// Built on checkout-api's own facts only, so the one-app branch is exercised.
		const only = cards.filter((c) => c.name === 'checkout-api');
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const ctx = cardContext({ rollouts: l.rollouts.items, environments: l.environments, rolloutDependencies: l.rolloutDependencies });
		const label = heldLabel(fleetFacts(only, l.rollouts.items.filter((r: { metadata?: { name?: string } }) => r.metadata?.name === 'checkout-api'), Date.now(), '7d', ctx as never));
		expect(label).toMatch(/^checkout-api held in staging · waits on payments-svc$/);
		expect(label).not.toMatch(/ and prod ·/);
	});
	it('the fleet label never says "prod" alone for a partial set', () => {
		for (const sc of ['calm', 'incident'] as const) expect(heldLabel(factsFor(sc).f)).not.toMatch(/held in [^·]*\bprod ·/);
	});
});
