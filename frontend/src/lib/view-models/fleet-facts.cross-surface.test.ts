import { describe, it, expect } from 'vitest';
import { resetDemoState, type Scenario } from '$lib/demo/state';
import { respond } from '$lib/demo/respond';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { isNeedsYou } from '$lib/view-models/fleet-groups';
import { severityRank } from '$lib/view-models/severity';
import { buildLanes, nodeState } from '$lib/view-models/promotion-lanes';
import { fleetFacts } from './fleet-facts';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ⭐ THE CROSS-SURFACE TEST, shared/fleet-facts (2026-10-10). For each mock
 * scenario (calm, incident, wide — `lib/demo/state.ts`'s own `Scenario`),
 * builds the SAME cards every real page builds and asserts every surface
 * this commit rewired reads the identical numbers:
 *   - Home's Fleet list (the lanes `buildLanes` draws) counts the same
 *     mapped-apps total as `fleetFacts.mappedApps`.
 *
 * `/apps` and `/environments` are OUT OF SCOPE here (squad-fleet2 owns
 * their own rewiring and equality test) — this file asserts on
 * `fleetFacts`'s own outputs for those two pages' units (`byTier`/`byEnv`),
 * not on the pages themselves.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fixtureList(): List {
	return JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
}

const NOW = new Date('2026-10-10T12:00:00Z');

function buildAll(scenario: Scenario) {
	resetDemoState(scenario);
	const list = fixtureList();
	const gateContext = buildGateContext({
		environments: list.environments,
		rolloutDependencies: list.rolloutDependencies
	});
	const graph = buildRolloutGraph({
		rollouts: list.rollouts.items,
		environments: list.environments.items,
		dependencies: list.rolloutDependencies.items,
		envOrder: []
	});
	const contractHoldsFor = (r: Rollout) => contractHoldsForRollout(graph, r);
	const cards = buildRolloutCards(list.rollouts.items, list.environments.items, NOW, gateContext, contractHoldsFor);
	const facts = fleetFacts(cards, list.rollouts.items, NOW.getTime(), '7d', { gateContext, contractHoldsFor });
	return { list, gateContext, contractHoldsFor, cards, facts };
}

const SCENARIOS: Scenario[] = ['calm', 'incident', 'wide'];

describe.each(SCENARIOS)('cross-surface agreement — %s', (scenario) => {



	it('Home’s Fleet list (lanes) counts the same mapped apps as fleetFacts.mappedApps', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);
		expect(lanes.length).toBe(facts.mappedApps);
	});


	it('shared/fleet-facts-ids: held.appIds/approvalAppIds and behind.appIds/apps agree with the lanes plus unmapped apps', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);

		// held.apps/appIds: mapped Fleet rows reading Held, plus apps with NO
		// Environment at all whose own worst place is held.
		const heldRows = lanes.filter((l) => l.state === 'held').map((l) => l.app).sort();
		const mappedAppNames = new Set(lanes.map((l) => l.app));
		const unmappedAppCards = new Map<string, typeof cards>();
		for (const c of cards) {
			if (mappedAppNames.has(c.name)) continue;
			unmappedAppCards.set(c.name, [...(unmappedAppCards.get(c.name) ?? []), c]);
		}
		function worstOf(appCards: typeof cards) {
			let best = 'none';
			for (const c of appCards) {
				const state = nodeState(c);
				if (severityRank(state) < severityRank(best)) best = state;
			}
			return best;
		}
		const unmappedHeldApps = [...unmappedAppCards.keys()].filter((n) => worstOf(unmappedAppCards.get(n)!) === 'held');
		const unmappedBehindApps = [...unmappedAppCards.keys()].filter(
			(n) => worstOf(unmappedAppCards.get(n)!) === 'behind'
		);

		expect(facts.held.apps).toBe(facts.held.appIds.length);
		expect([...new Set([...heldRows, ...unmappedHeldApps])].sort()).toEqual(facts.held.appIds);
		expect(facts.held.approvalAppIds).toEqual([...facts.held.approvalAppIds].sort());
		for (const app of facts.held.approvalAppIds) expect(facts.held.appIds).toContain(app);

		const behindRows = lanes.filter((l) => l.state === 'behind').map((l) => l.app).sort();
		expect(facts.behind.apps).toBe(facts.behind.appIds.length);
		expect([...new Set([...behindRows, ...unmappedBehindApps])].sort()).toEqual(facts.behind.appIds);
	});

	it('held byCause sums to the lane-gated held population, never more than the raw places count', () => {
		// byCause classifies the SAME lane-gated population `apps`/the
		// durations read (an app failing elsewhere is excluded even from a
		// genuinely-held place of its own) — so the sum can be LESS than
		// `held.places` (the raw, ungated count) whenever a held place
		// belongs to an app whose headline is worse elsewhere, never more.
		const { facts } = buildAll(scenario);
		const sum = facts.held.byCause.order + facts.held.byCause.approval + facts.held.byCause.dependency + facts.held.byCause.other;
		expect(sum).toBeLessThanOrEqual(facts.held.places);
		expect(sum).toBeGreaterThanOrEqual(0);
	});
});

/**
 * ⭐ THE SHARED HELD PREDICATE'S REFERENCE CASES, AGAIN HERE. (shared/
 * held-predicate, 2026-10-11) `fleet-facts.ts`'s `placeState` delegates to
 * `nodeState`, which reads the corrected `RolloutCard.held` — these two
 * cases pin that the fix reaches THIS surface too, not only
 * `held-predicate.test.ts`'s own direct read of the cards. See
 * `view-models/held.ts` for the ruling.
 */
describe('held-predicate reference cases, through fleetFacts', () => {
	it('calm: hello-world is not held at staging or prod — it has not reached dev yet', () => {
		const { cards } = buildAll('calm');
		const hw = cards.filter((c) => c.name === 'hello-world');
		const staging = hw.find((c) => c.envName === 'staging');
		const prod = hw.find((c) => c.envName === 'prod');
		expect(staging?.held).toBe(false);
		expect(staging?.waitsForEnv).toBe('dev');
		expect(prod?.held).toBe(false);
		expect(prod?.waitsForEnv).toBe('staging');
	});

	/**
	 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
	 * tl-integrate ruling — the frontier rule). `prod-us-east-2` and
	 * `prod-ap-southeast-2` each read held now too: their own frontier
	 * candidate, `4.43.0-43`, already cleared staging
	 * (`ckHistory('staging')`'s head entry) and is refused directly by
	 * `payments-svc` at both regions (`mock-data.ts`'s `mockDependencies`).
	 * checkout-api is held in THREE places, not one.
	 */
	// SITES AND WAVES: prod is waves of sites, not parallel regions each after staging, so only staging is refused by the contract; the prod sites wait on their wave (`held.ts`).
	it('calm: checkout-api is held in staging on payments-svc; no prod site is its own hold', () => {
		const { cards } = buildAll('calm');
		const ck = cards.filter((c) => c.name === 'checkout-api');
		const staging = ck.find((x) => x.envName === 'staging');
		expect(staging?.held).toBe(true);
		expect(staging?.heldCauseLabel).toBe('payments-svc');
		for (const c of ck.filter((c) => c.envName !== 'staging')) {
			expect(c.held, `${c.envName} should not be its own hold`).toBe(false);
		}
	});
});

describe('known invariants (kept green)', () => {
	it('calm: 0 Needs-you', () => {
		const { facts } = buildAll('calm');
		expect(facts.needsYou.apps).toBe(0);
		expect(facts.needsYou.places).toBe(0);
	});

	it('incident: exactly one failed head (checkout-worker/staging)', () => {
		const { cards, facts } = buildAll('incident');
		expect(facts.failed.live.apps).toBe(1);
		expect(facts.failed.live.places).toBe(1);
		const failing = cards.filter(isNeedsYou);
		expect(failing.map((c) => `${c.ns}/${c.name}`)).toEqual(['checkout-worker-staging/checkout-worker']);
	});
});
