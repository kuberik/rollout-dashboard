import { describe, it, expect, afterEach } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { buildLanes, appsWithoutEnvironment } from '$lib/view-models/promotion-lanes';
import { fleetMap } from '$lib/view-models/promotion-map';
import { heldFor } from '$lib/view-models/held-for';
import { fleetFacts } from '$lib/view-models/fleet-facts';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ONE "HELD" ON HOME (coordinator 2026-10-10: the KPI read "5 apps held in 8
 * places" over a Fleet with two Held rows). The KPI's apps are exactly the
 * Fleet rows whose state is held (worst wins), and its places are the held
 * blocks of those apps on the map, in calm and incident, built the way Home
 * builds its cards (gates + dependency contracts).
 */
type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

afterEach(() => resetDemoState('calm'));

for (const scenario of ['calm', 'incident'] as const) {
	describe(`${scenario}: Home's held KPI agrees with the Fleet rows and the map`, () => {
		it('apps held == Fleet rows reading Held; places == held blocks on the map', () => {
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
			const heldRows = lanes.filter((l) => l.state === 'held').map((l) => l.app).sort();
			expect(heldRows.length).toBeGreaterThan(0);

			// ⭐ shared/fleet-facts-ids (2026-10-11): `held.apps`/`held.appIds`
			// widened to also count an app with NO Environment at all when
			// its own worst place is held (a dependency-contract hold on an
			// unmapped consumer is a real hold, never "outside the map") — so
			// the KPI's app count is the mapped Fleet rows reading Held PLUS
			// those unmapped held apps, computed here rather than assumed.
			const unmappedHeldApps = facts.held.appIds.filter((app) => !heldRows.includes(app)).sort();
			expect(facts.held.apps).toBe(facts.held.appIds.length);
			expect([...heldRows, ...unmappedHeldApps].sort()).toEqual(facts.held.appIds);

			// (1) KPI apps held == Fleet rows reading Held (fleet-facts, and the
			// heldFor the KPI reads, which delegates to it).
			expect(facts.held.apps).toBe(heldRows.length + unmappedHeldApps.length);
			expect(heldFor(cards, now.getTime(), { gateContext, contractHoldsFor: (r) => contractHoldsForRollout(graph, r) }).apps).toBe(heldRows.length + unmappedHeldApps.length);

			// (2) KPI "in N places" == the orange blocks on the map == the sum of
			// the map's stage captions (they read fleet-facts' per-app plates).
			const map = fleetMap({ lanes }, { facts });
			const heldBlocks = map.steps.reduce((n, s) => n + s.cubes.filter((c) => c.state === 'held').length, 0);
			expect(facts.held.plates).toBe(heldBlocks);
			expect(map.steps.reduce((n, s) => n + (s.counts.held ?? 0), 0)).toBe(heldBlocks);

			// Every caption counts the blocks drawn on its plate, state by state.
			for (const st of map.steps) {
				for (const state of ['held', 'failed', 'deploying', 'checking', 'behind'] as const) {
					expect(st.counts[state] ?? 0, `${st.key} ${state}`).toBe(st.cubes.filter((c) => c.state === state).length);
				}
			}

			// Every held app is drawn held on at least one plate of the map.
			const heldOnMap = new Set(map.steps.flatMap((s) => s.cubes.filter((c) => c.state === 'held').map((c) => c.app)));
			for (const app of heldRows) expect(heldOnMap.has(app)).toBe(true);

			// The tile's "N wait for you" is apps held on an approval.
			expect(facts.held.byCauseApps.approval).toBeLessThanOrEqual(facts.held.apps);
		});
	});
}

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
