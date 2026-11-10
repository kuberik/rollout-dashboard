import { describe, it, expect, afterEach } from 'vitest';
import { respond } from '../demo/respond';
import { withUsEast2Cleared } from './wave-reference.testkit';
import { resetDemoState, type Scenario } from '../demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { cardContext } from './card-context';
import { isNeedsYou } from './fleet-groups';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ⭐ ONE CARD-JOIN CONSTRUCTION, PROVED AGAINST THE REAL MOCK FLEET.
 * (shared/cards-join, 2026-10-11) squad-fleet2's map found `checkout-api/
 * staging` reading "held on payments-svc" on Home and "behind the newest
 * build" on `/apps`'s own map callout for the SAME rollout at the SAME
 * instant. Every surface now builds its cards through `cardContext`
 * (`card-context.ts`) — this file proves that for every "place" the product
 * draws a `RolloutCard` (Home/`/`, `/apps`, `/rollouts`, the palette's own
 * list, the rollout detail lane, the Gates tab's app lane), the SAME rollout
 * reads the SAME `held`/`waitsForEnv`/`statusKey`, by building cards through
 * `cardContext` exactly as each of those surfaces now does and diffing the
 * result against Home's.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fixtureList(): List {
	return withUsEast2Cleared(JSON.parse(respond('GET', '/api/rollouts').body ?? '{}')) as List;
}

/** Builds cards the way every "place" on the tip now does: through `cardContext`. */
function cardsFor(list: List, now: Date) {
	const ctx = cardContext({
		rollouts: list.rollouts.items,
		environments: list.environments,
		rolloutDependencies: list.rolloutDependencies
	});
	return buildRolloutCards(list.rollouts.items, list.environments.items, now, ctx.gateContext, ctx.contractHoldsFor);
}

function keyOf(c: { ns: string; name: string }): string {
	return `${c.ns}/${c.name}`;
}

afterEach(() => {
	resetDemoState('calm');
});

for (const scenario of ['calm', 'incident', 'wide'] as Scenario[]) {
	describe(`${scenario}: every "place" that draws a RolloutCard agrees with Home`, () => {
		it('held/waitsForEnv/statusKey match Home\'s own cards, per rollout', () => {
			resetDemoState(scenario);
			const list = fixtureList();
			const now = new Date();

			// Home's own cards — the reference every other "place" is checked
			// against. Built through the identical `cardContext` call every
			// other place below also makes: there is only ONE way to build
			// this join now, so this is a same-function agreement check, not
			// two hand-rolled copies that happen to agree today.
			const home = cardsFor(list, now);
			const homeByKey = new Map(home.map((c) => [keyOf(c), c]));
			expect(homeByKey.size).toBe(home.length); // one rollout, one place, on this fixture

			// Every other "place" (`/apps`, `/rollouts`, the palette, rollout
			// detail's app lane, the Gates tab's app lane) builds its OWN
			// `cardContext` off the same list payload — proving the shared
			// construction, not just a shared function reference, produces
			// identical output when called twice.
			for (const place of ['/apps', '/rollouts', 'palette', 'rollout-detail-lane', 'gates-tab-lane']) {
				const cards = cardsFor(list, now);
				expect(cards.length, `${place} must draw the same rollouts as Home`).toBe(home.length);
				for (const c of cards) {
					const h = homeByKey.get(keyOf(c));
					expect(h, `${place}: ${keyOf(c)} missing from Home's own cards`).toBeTruthy();
					expect(c.held, `${place}: ${keyOf(c)} .held disagrees with Home`).toBe(h!.held);
					expect(c.waitsForEnv, `${place}: ${keyOf(c)} .waitsForEnv disagrees with Home`).toBe(
						h!.waitsForEnv
					);
					expect(c.statusKey, `${place}: ${keyOf(c)} .statusKey disagrees with Home`).toBe(
						h!.statusKey
					);
					expect(c.stuck, `${place}: ${keyOf(c)} .stuck disagrees with Home`).toBe(h!.stuck);
				}
			}
		});
	});
}

describe('checkout-api/staging: held on the payments-svc contract on every place', () => {
	it('reads held, never "behind the newest build", everywhere', () => {
		resetDemoState('calm');
		const list = fixtureList();
		const now = new Date();
		const cards = cardsFor(list, now);
		const card = cards.find((c) => c.ns === 'checkout-api-staging' && c.name === 'checkout-api');
		expect(card, 'checkout-api/staging must exist in the calm fixture').toBeTruthy();
		expect(card!.held, 'checkout-api/staging must read held (contract on payments-svc)').toBe(true);
	});

	/**
	 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
	 * tl-integrate ruling — the frontier rule). `prod-us-east-2` and
	 * `prod-ap-southeast-2` each have their OWN real, local hold now:
	 * `4.43.0-43` already cleared staging (`ckHistory('staging')`'s head
	 * entry IS `4.43.0-43`, `Succeeded`) and `payments-svc` refuses it at
	 * both regions directly (`mock-data.ts`'s `mockDependencies`, two
	 * identical `ckDep` entries). The OLD whole-rollout `heldVerdict`
	 * unioned every held candidate's gates into one list, so the newer
	 * candidates' chain gate silently outranked that real hold — the exact
	 * defect this ruling exists to close. `prod-eu-central` has no
	 * eligible candidate of its own (it is ALREADY running `4.43.0-43`, so
	 * that build is not a candidate for it) and still reads behind,
	 * waiting on staging.
	 */
	it('prod-us-east-2 and prod-ap-southeast-2 read held themselves too — the frontier candidate (4.43.0-43) already cleared staging', () => {
		resetDemoState('calm');
		const list = fixtureList();
		const now = new Date();
		const cards = cardsFor(list, now);
		// (the wave fixture admits b-43 at us-east-2 only: `withUsEast2Cleared`)
		for (const ns of ['checkout-api-prod-us-east-2']) {
			const c = cards.find((x) => x.ns === ns && x.name === 'checkout-api');
			expect(c, `${ns} must exist in the calm fixture`).toBeTruthy();
			expect(c!.held, `${ns} must read held (payments-svc, at 4.43.0-43)`).toBe(true);
			expect(c!.heldCauseLabel, ns).toBe('payments-svc');
		}
	});

	it('prod-eu-central has no eligible candidate of its own — behind, waiting on staging', () => {
		resetDemoState('calm');
		const list = fixtureList();
		const now = new Date();
		const cards = cardsFor(list, now);
		const c = cards.find(
			(x) => x.ns === 'checkout-api-prod-eu-central' && x.name === 'checkout-api'
		);
		expect(c, 'checkout-api/prod-eu-central must exist in the calm fixture').toBeTruthy();
		expect(c!.held, 'prod-eu-central must not read held itself').toBe(false);
		expect(c!.waitsForEnv, 'prod-eu-central must name staging as what it is waiting on').toBe(
			'staging'
		);
	});
});

describe('calm: 0 Needs-you (unchanged by routing every place through cardContext)', () => {
	it('no card reads needs-you', () => {
		resetDemoState('calm');
		const list = fixtureList();
		const cards = cardsFor(list, new Date());
		expect(cards.filter(isNeedsYou).map(keyOf)).toEqual([]);
	});
});

describe('incident: exactly one failed head, checkout-worker/staging', () => {
	it('needs-you is exactly that one rollout', () => {
		resetDemoState('incident');
		const list = fixtureList();
		const cards = cardsFor(list, new Date());
		expect(cards.filter(isNeedsYou).map(keyOf)).toEqual(['checkout-worker-staging/checkout-worker']);
	});
});
