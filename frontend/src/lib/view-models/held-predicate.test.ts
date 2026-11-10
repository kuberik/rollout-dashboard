/**
 * ⭐ THE THREE REFERENCE CASES, AGAINST THE REAL DEMO FIXTURES. (shared/held-
 * predicate, 2026-10-11, coordinator ruling.) See `held.ts`'s own doc for
 * the ruling this pins. Built off `respond()`/`buildRolloutCards()` — the
 * SAME layer Home and `/rollouts` read — never a hand-rolled rollout, so a
 * future fixture edit that changes the SHAPE of these apps re-runs this
 * exact assertion rather than a stale copy of it.
 */
import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { RolloutCard } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { heldVerdict, waitsFor, type HeldContext } from './held';
import type { BlockingStory, ClassifiedGate } from './blocking-story';

type Scenario = 'calm' | 'incident' | 'wide';

function fetchFleet(scenario: Scenario) {
	resetDemoState(scenario);
	const payload = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const rollouts = payload.rollouts?.items ?? [];
	const environments = payload.environments?.items ?? [];
	const dependencies = payload.rolloutDependencies?.items ?? [];
	const gateContext = buildGateContext({ environments: { items: environments }, rolloutDependencies: { items: dependencies } });
	const network = buildRolloutGraph({
		rollouts,
		environments,
		dependencies,
		envOrder: [],
		gates: gateContext
	});
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(network, r)
	);
	return cards;
}

function cardsFor(cards: RolloutCard[], appName: string): Map<string, RolloutCard> {
	const byEnv = new Map<string, RolloutCard>();
	for (const c of cards) {
		if (c.name === appName && c.envName) byEnv.set(c.envName, c);
	}
	return byEnv;
}

describe('reference case 1 — hello-world (calm): not reached dev, never held', () => {
	const cards = fetchFleet('calm');
	const byEnv = cardsFor(cards, 'hello-world');

	it('staging has not caught up with dev — behind, never held', () => {
		const staging = byEnv.get('staging');
		expect(staging).toBeTruthy();
		expect(staging!.held).toBe(false);
		expect(staging!.waitsForEnv).toBe('dev');
	});

	it('prod has not caught up with staging — behind, never held', () => {
		const prod = byEnv.get('prod');
		expect(prod).toBeTruthy();
		expect(prod!.held).toBe(false);
		expect(prod!.waitsForEnv).toBe('staging');
	});

	it('waitsFor names the stage ahead, with no fabricated heldCause when that stage is only behind itself', () => {
		const peersByEnv = byEnv as HeldContext['peersByEnv'];
		const staging = byEnv.get('staging')!;
		const w = waitsFor(staging, { peersByEnv });
		expect(w).toEqual({ stage: 'dev' });
	});
});

/**
 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
 * tl-integrate ruling — the frontier rule). The OLD reference case here
 * ("checkout-api held once, at staging, never in a prod region") was an
 * assumption the whole-rollout `heldVerdict` could not actually tell apart
 * from the truth: it unioned every held candidate's gates into ONE list,
 * so a NEWER candidate's chain gate (refusing `4.44.0-44`/`4.45.0-45`
 * because staging has not deployed them) silently outranked an OLDER
 * candidate's real, LOCAL hold.
 *
 * Verified against the real fixture (`$lib/demo/mock-data.ts`), not
 * inferred: `ckHistory('staging')`'s head entry is `{ tag: 'b-43', version:
 * '4.43.0-43', bakeStatus: 'Succeeded' }` — staging has ALREADY deployed
 * and succeeded on `4.43.0-43`. `prod-us-east-2`'s own chain gate
 * (`promotion-prod-us-east-2`, allows whatever staging has deployed) does
 * NOT refuse `4.43.0-43` — it is ELIGIBLE, having cleared staging — and
 * the `payments-svc` contract (`mockDependencies`, `admitted: ['b-40',
 * 'b-41', 'b-42']`) refuses it directly. The frontier rule: `held`
 * applies to the NEWEST candidate that has cleared every earlier stage,
 * and `4.43.0-43` is exactly that one for `prod-us-east-2` — so the place
 * IS held, genuinely, not merely chain-queued.
 *
 * `prod-ap-southeast-2` carries the IDENTICAL shape — a second
 * `ckDep({ env: 'prod-ap-southeast-2', … admitted: ['b-40','b-41','b-42'],
 * blocked: [{ tag: 'b-43' }] })` entry in `mockDependencies` — so it is
 * ALSO held on `payments-svc` at `4.43.0-43`, the same way. checkout-api
 * is held in THREE places now, not two: `staging`, `prod-us-east-2` and
 * `prod-ap-southeast-2`.
 */
describe('reference case 2 — checkout-api (calm): held in staging on payments-svc; the prod sites wait on their wave', () => {
	const cards = fetchFleet('calm');
	const byEnv = cardsFor(cards, 'checkout-api');

	it('staging is held, on the payments-svc contract', () => {
		const staging = byEnv.get('staging');
		expect(staging).toBeTruthy();
		expect(staging!.held).toBe(true);
		expect(staging!.heldCause).toBe('dependency');
		expect(staging!.heldCauseLabel).toBe('payments-svc');
	});

	/**
	 * SITES AND WAVES: prod is five sites in waves (eu-central and us-east-1
	 * in wave 1, us-east-2 wave 2, af-south-1 / ap-southeast-2 wave 3), not
	 * five regions each "after staging". A site's build has to clear the stage in
	 * front of it (its wave's predecessor, or its leader) first, so a later wave
	 * is `behind`, never `held`, until its own stage has the build — the
	 * topology-derived same-tier edge is chain sequencing (`held.ts`).
	 */
	it('a later wave waits for the wave in front of it, and a follower for its leader — never held', () => {
		const east2 = byEnv.get('prod-us-east-2')!;
		expect(east2.held).toBe(false);
		expect(east2.waitsForEnv).toBe('wave 1 (eu-central, us-east-1)');
		const ap = byEnv.get('prod-ap-southeast-2')!;
		expect(ap.held).toBe(false);
		expect(ap.role).toBe('Follower');
		expect(ap.waitsForEnv).toBe('af-south-1');
	});

	it('the wave-1 leader waits for staging, and names staging\'s own cause', () => {
		const peersByEnv = byEnv as HeldContext['peersByEnv'];
		const c = byEnv.get('prod-eu-central')!;
		expect(c.held).toBe(false);
		expect(c.waitsForEnv).toBe('staging');
		const w = waitsFor(c, { peersByEnv });
		expect(w).toEqual({ stage: 'staging', heldCause: 'staging held on payments-svc' });
	});

	it('a wave-1 follower with a candidate its leader already took is merely trailing, not waiting', () => {
		const c = byEnv.get('prod-us-east-1')!;
		expect(c.role).toBe('Follower');
		expect(c.held).toBe(false);
		expect(c.waitsForEnv).toBeNull();
	});
});

describe('reference case 3 — an explicit order gate between parallel siblings', () => {
	/**
	 * No live/demo fixture carries a same-tier order gate
	 * that is NOT a wave/leader edge (every topology edge in `mock-data.ts`
	 * is a wave or a tier step — see `held.ts`'s own doc). This is the one
	 * case in the ruling with no fixture to read it off, so it is pinned as
	 * a focused unit test against a hand-built `BlockingStory`, the same
	 * pattern `promotion-hold-breakdown.test.ts` already uses for a gate
	 * shape no live payload has shown yet.
	 */
	function promotionGate(after: string): ClassifiedGate {
		return {
			id: `promotion-${after}`,
			kind: 'promotion',
			clears: 'upstream',
			label: `after ${after}`,
			clause: `${after} deploys it first`,
			short: `Waiting for ${after} to deploy it first`,
			clearsAt: null,
			timezone: null,
			subject: after,
			subjectKind: 'environment',
			predicate: 'deploys it first',
			contract: null,
			have: null,
			need: null
		};
	}
	function story(gates: ClassifiedGate[]): BlockingStory {
		return {
			blocked: true,
			candidateCount: 1,
			pinnedTo: null,
			pinnedToDisplay: null,
			gates,
			person: [],
			clock: [],
			upstream: gates,
			checks: [],
			unknown: [],
			clearsAt: null,
			selfClearing: false,
			headline: '',
			consequence: '',
			verdict: '',
			resolution: '',
			severity: 'warning',
			iconKind: 'promotion',
			kindPending: false
		};
	}

	/**
	 * ⭐ qa12: these hand-built `BlockingStory` fixtures carry no `candidates`
	 * (`perBuild`) field at all — the one case `heldVerdict`'s frontier rule
	 * cannot apply (there is no per-candidate list to walk), so it falls
	 * back to the whole-story gate read. The frontier/waitingBehind fields
	 * are still populated (derived from that fallback, `frontier.build`
	 * degenerate `''`) — asserted explicitly rather than dropped from
	 * `.toEqual`, so a regression in the fallback's own shape still fails
	 * loudly here.
	 */
	it('refuses an ELIGIBLE build (only a same-tier sibling gate) — held, cause order', () => {
		const v = heldVerdict(story([promotionGate('prod-us-east-1')]), 'prod-us-east-2');
		expect(v).toEqual({
			held: true,
			cause: 'order',
			waitsForEnv: null,
			frontier: { build: '', held: true, cause: 'order', causeLabel: 'promotion order' },
			waitingBehind: []
		});
	});

	it('a build NOT yet eligible (an earlier-tier chain gate also present) — not held, waits for the chain', () => {
		const v = heldVerdict(story([promotionGate('prod-us-east-1'), promotionGate('staging')]), 'prod-us-east-2');
		expect(v).toEqual({
			held: false,
			cause: null,
			waitsForEnv: 'staging',
			frontier: null,
			waitingBehind: [{ stage: 'staging', count: 1 }]
		});
	});

	it('normal chain sequencing (an earlier-tier gate alone) is never "order"', () => {
		const v = heldVerdict(story([promotionGate('staging')]), 'prod-us-east-2');
		expect(v).toEqual({
			held: false,
			cause: null,
			waitsForEnv: 'staging',
			frontier: null,
			waitingBehind: [{ stage: 'staging', count: 1 }]
		});
	});
});
