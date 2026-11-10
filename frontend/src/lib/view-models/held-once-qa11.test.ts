/**
 * qa11 B1/B2: the app and env pages take HELD from the joined card (held.ts'
 * verdict over gates + the dependency-contract join, built the way Home builds
 * it). hello-world in calm is held nowhere; checkout-api is held exactly once,
 * at staging, and its prod regions only wait for staging.
 */
import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { RolloutCard } from '$lib/rollout-cards';
import { buildGateContext } from './blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from './dependency-graph';
import type { Environment, Rollout, RolloutDependency } from '../../types';

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fleetCards(scenario: 'calm' | 'incident' | 'wide') {
	resetDemoState(scenario);
	const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
	const rollouts = list.rollouts.items;
	const environments = list.environments.items;
	const gateContext = buildGateContext({
		environments: list.environments,
		rolloutDependencies: list.rolloutDependencies
	});
	const graph = buildRolloutGraph({
		rollouts,
		environments,
		dependencies: list.rolloutDependencies.items,
		envOrder: [],
		gates: gateContext
	});
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(graph, r)
	);
	return { cards, graph };
}


const heldEnvs = (cards: ReturnType<typeof fleetCards>['cards'], app: string) =>
	cards.filter((c) => c.name === app && c.held).map((c) => c.envName).sort();

describe('held is counted once, at the stage actually refused (qa11 B1/B2)', () => {
	it('hello-world in calm is held nowhere', () => {
		const { cards } = fleetCards('calm');
		expect(heldEnvs(cards, 'hello-world')).toEqual([]);
	});
	/**
	 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
	 * tl-integrate ruling — the frontier rule). `prod-us-east-2` and
	 * `prod-ap-southeast-2` each read held too now: their frontier
	 * candidate, `4.43.0-43`, already cleared staging and is refused
	 * directly by `payments-svc` at both regions (`mock-data.ts`). Only
	 * `prod-eu-central`, `prod-us-east-1` and `prod-af-south-1` are
	 * genuinely not held themselves.
	 */
	// SITES AND WAVES: prod is waves of sites, not parallel regions each after staging, so only staging is refused by the contract; the prod sites wait on their wave (`held.ts`).
	it('checkout-api in calm is held at staging only; the prod sites wait on their wave', () => {
		const { cards } = fleetCards('calm');
		expect(heldEnvs(cards, 'checkout-api')).toEqual(['staging']);
		const otherProd = cards.filter(
			(c) => c.name === 'checkout-api' && c.envName.startsWith('prod-')
		);
		expect(otherProd.length).toBeGreaterThan(0);
		for (const c of otherProd) expect(c.held, c.envName).toBe(false);
	});
});
