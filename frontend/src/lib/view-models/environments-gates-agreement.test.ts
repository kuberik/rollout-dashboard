import { describe, it, expect } from 'vitest';
import { fleet, now, rollouts, rolloutIn, envOf, gatesTabCause } from './gates-tab-reference.testkit';
import { heldHereStory } from './held';

/**
 * /environments (and /envs/<name>, /changes/<slug>) build each row's story as
 * `heldHereStory(cardContext().storyFor(rollout, { place: tier }), tier)`. That
 * is what the Gates tab's lead row names for the same environment.
 */
const pageCause = (ns: string) =>
	heldHereStory(fleet.storyFor(rolloutIn(ns), { place: envOf(ns), now }), envOf(ns)).consequence;

describe('page stories name the Gates tab’s cause (home-incident, checkout-api)', () => {
	it('staging: a newer payments than 2.4.1', () => {
		const ref = gatesTabCause('checkout-api-staging');
		expect(ref).toContain('payments-svc ships a newer payments than 2.4.1');
		expect(pageCause('checkout-api-staging')).toContain(ref);
	});

	it('prod-ap-southeast-2: payments-svc ships ~2.9.0, not the staging clause', () => {
		const ref = gatesTabCause('checkout-api-prod-ap-southeast-2');
		expect(ref).toContain('~2.9.0');
		const page = pageCause('checkout-api-prod-ap-southeast-2');
		expect(page).toContain(ref);
		expect(page).not.toContain('a newer payments than 2.4.1');
	});

	it('every checkout-api environment agrees', () => {
		const namespaces = rollouts
			.filter((r) => r.metadata?.name === 'checkout-api')
			.map((r) => r.metadata!.namespace!);
		expect(namespaces.length).toBeGreaterThan(5);
		for (const ns of namespaces) {
			const ref = gatesTabCause(ns);
			if (ref) expect([ns, pageCause(ns)]).toEqual([ns, expect.stringContaining(ref)]);
		}
	});
});
