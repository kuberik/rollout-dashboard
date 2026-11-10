/**
 * qa11 B2: `/environments` and `/envs/<name>` took HELD from the raw
 * promotion block / blocking story (`block.blocked`, `row.block.blocked`,
 * `heldCount`, `story.blocked`) off cards built WITHOUT the gate context and
 * the dependency-contract join — so hello-world ("waits for dev to deploy
 * it first", plain chain sequencing) drew a HELD chip and the prod header
 * counted it ("1 held"). Both pages now build their `RolloutCard`s the way
 * Home does — `buildRolloutCards(rollouts, environments, now, gateContext,
 * (r) => contractHoldsForRollout(graph, r))` — and read `card.held` (held.ts'
 * verdict: refused HERE, never just "not reached yet").
 *
 * This fixture-level test is the thing both pages' `heldCount`/`EnvApp.held`/
 * `Row.held` actually reduce to: `apps.filter((a) => a.held).length` and
 * `rows.filter((r) => r.held).length` are plain filters over the SAME
 * `cardByRollout.get(rollout)?.held` this test exercises directly — there is
 * no separate counting logic on either page worth a second test; the card's
 * own verdict IS the count. (Follows `offerable-deploy.test.ts`'s
 * `fleetCards()` convention — demo fixture, never a hand-rolled rollout.)
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

const heldEnvsOf = (cards: RolloutCard[], app: string) =>
	cards
		.filter((c) => c.name === app && c.held)
		.map((c) => c.envName)
		.sort();

describe('qa11 B2 — /environments and /envs/<name> read the joined card\'s held verdict', () => {
	it('hello-world (calm) is held nowhere — no env card is held for it', () => {
		const { cards } = fleetCards('calm');
		expect(heldEnvsOf(cards, 'hello-world')).toEqual([]);
		// This is exactly what both pages' HELD chip and header count must
		// agree with: no card for hello-world has `held: true` anywhere, so
		// neither `/environments`' `heldCount` nor `/envs/prod`'s `heldCount`
		// may count it, and neither page's row/card may draw a HELD chip for it.
		const forPage = cards.filter((c) => c.name === 'hello-world');
		expect(forPage.filter((c) => c.held).length).toBe(0);
	});

	/**
	 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
	 * tl-integrate ruling — the frontier rule). `prod-us-east-2` and
	 * `prod-ap-southeast-2` each read held too now: their frontier
	 * candidate, `4.43.0-43`, already cleared staging
	 * (`ckHistory('staging')`'s head entry, `Succeeded`) and is refused
	 * directly by `payments-svc` at both regions (`mock-data.ts`'s
	 * `mockDependencies`). The OLD whole-rollout verdict unioned every
	 * held candidate's gates into one list, so the newer candidates'
	 * chain gate silently outranked that real, local hold.
	 */
	// SITES AND WAVES: prod is waves of sites, not parallel regions each after staging, so only staging is refused by the contract; the prod sites wait on their wave (`held.ts`).
	it('checkout-api (calm) is held at staging; the prod sites only wait', () => {
		const { cards } = fleetCards('calm');
		expect(heldEnvsOf(cards, 'checkout-api')).toEqual(['staging']);

		const staging = cards.filter((c) => c.name === 'checkout-api' && c.envName === 'staging');
		expect(staging.length).toBe(1);
		expect(staging[0].held).toBe(true);
		expect(staging[0].heldCause).toBe('dependency');

		// Every prod site only WAITS (wave / leader / staging) — sequencing,
		// not a hold — so neither page may count or chip them as held.
		const prod = cards.filter((c) => c.name === 'checkout-api' && c.envName.startsWith('prod-'));
		expect(prod.length).toBeGreaterThan(0);
		for (const c of prod) expect(c.held, c.envName).toBe(false);
	});

	it('a held count built the way the pages build it counts every real hold, over these two apps', () => {
		const { cards } = fleetCards('calm');
		// `/environments`' `heldCount` per tier is `apps.filter((a) => a.held)
		// .length`, and `/envs/<name>`'s is `rows.filter((r) => r.held).length`
		// — both plain filters over this same field. Scoped to the two apps
		// this bug named (other, unrelated apps in the fixture may be
		// legitimately held elsewhere and are not this test's concern):
		// THREE held cards for checkout-api now (staging, prod-us-east-2,
		// prod-ap-southeast-2), zero for hello-world (its prod regions
		// merely have not reached yet).
		const scoped = cards.filter((c) => c.name === 'hello-world' || c.name === 'checkout-api');
		const heldCards = scoped.filter((c) => c.held);
		expect(heldCards.map((c) => c.envName).sort()).toEqual(['staging']);
		expect(heldCards.every((c) => c.name === 'checkout-api')).toBe(true);
	});
});
