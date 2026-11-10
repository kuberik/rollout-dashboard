import { describe, it, expect } from 'vitest';
import { fleet, now, rolloutIn, envOf, gatesTabCause } from './gates-tab-reference.testkit';
import { heldHereStory } from './held';

/**
 * /changes/<slug> builds its repo-held stories and the change's held story as
 * `heldHereStory(cardContext().storyFor(rollout, { place: env }), env)` (it
 * called `blockingStory` with no contract holds before). The text lives in the
 * banner's consequence and in the gates `repoHeldPrimary` reads the provider
 * from; both must match the Gates tab for the same environment.
 */
const storyOf = (ns: string) =>
	heldHereStory(fleet.storyFor(rolloutIn(ns), { place: envOf(ns), now }), envOf(ns));

describe('/changes stories name the Gates tab’s cause (home-incident, checkout-api)', () => {
	it('staging: a newer payments, same as its Gates tab', () => {
		const story = storyOf('checkout-api-staging');
		expect(story.consequence).toContain(gatesTabCause('checkout-api-staging'));
		expect(story.gates.some((g) => g.kind === 'dependency' && g.subject === 'payments-svc')).toBe(true);
	});

	it('prod-ap-southeast-2: ~2.9.0 in the consequence and in the dependency gate', () => {
		const ns = 'checkout-api-prod-ap-southeast-2';
		const story = storyOf(ns);
		expect(story.consequence).toContain(gatesTabCause(ns));
		const dep = story.gates.find((g) => g.kind === 'dependency' && g.subject === 'payments-svc');
		expect(dep?.clause).toBe('payments-svc ships ~2.9.0');
	});
});
