import { describe, it, expect, afterEach } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { buildLanes, appsWithoutEnvironment } from '$lib/view-models/promotion-lanes';
import { fleetFacts } from '$lib/view-models/fleet-facts';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/** Home's held Fleet rows and the envless fold's held count, built the way Home builds its cards (gates + dependency contracts). */
type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

afterEach(() => resetDemoState('calm'));

/**
 * ⭐ shared/fleet-facts-ids (2026-10-11, integration TL follow-up): the Fleet
 * card's envless fold ("+N apps without an environment") names how many of
 * those apps are held — `ControlCenter.svelte`'s own `envlessHeldAppIds`,
 * computed as `envless ∩ held.appIds`, never a local recount of cause or
 * state. Pins the identity the fold's "· N held" and its expanded held rows
 * both rely on: Home's VISIBLE held rows (the mapped Fleet rows whose lane
 * reads Held) plus the fold's own held count equal `held.appIds.length` —
 * no held app is silently missing from both populations, and none is
 * double-counted.
 */
for (const scenario of ['calm', 'incident', 'wide'] as const) {
	describe(`${scenario}: the envless fold's held count agrees with held.appIds`, () => {
		it("Home's visible held Fleet rows plus the fold's held count equal held.appIds.length", () => {
			resetDemoState(scenario);
			const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
			const rollouts = list.rollouts.items;
			const environments = list.environments.items;
			const gateContext = buildGateContext({ environments: list.environments, rolloutDependencies: list.rolloutDependencies });
			const graph = buildRolloutGraph({ rollouts, environments, dependencies: list.rolloutDependencies.items, envOrder: [], gates: gateContext });
			const now = new Date();
			const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) => contractHoldsForRollout(graph, r));

			const lanes = buildLanes(cards);
			const facts = fleetFacts(cards, rollouts, now.getTime(), '7d', { gateContext, contractHoldsFor: (r) => contractHoldsForRollout(graph, r) });

			// Home's visible held Fleet rows: the lane-gated, mapped population.
			const visibleHeldRows = lanes.filter((l) => l.state === 'held').map((l) => l.app);

			// The fold's own held count — `ControlCenter.svelte`'s
			// `envlessHeldAppIds`, reproduced here exactly (envless apps that
			// are also in `held.appIds`), never re-derived from cause/state.
			const envless = appsWithoutEnvironment(cards);
			const foldHeldAppIds = envless.filter((app) => facts.held.appIds.includes(app));

			expect(visibleHeldRows.length + foldHeldAppIds.length).toBe(facts.held.appIds.length);
			expect([...visibleHeldRows, ...foldHeldAppIds].sort()).toEqual(facts.held.appIds);
		});
	});
}
