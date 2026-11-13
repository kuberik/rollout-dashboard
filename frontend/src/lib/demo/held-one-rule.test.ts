import { isBypassRollout } from './bypass-demo';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext, blockingStory, holdCausePhrase } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { isHeld, isPinned, isNeedsYou } from '$lib/view-models/fleet-groups';
import { rankBehindBy } from '$lib/view-models/env-rank';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ⭐ THE HOLD-ONE-RULE, ON THE REAL DEMO FIXTURE. (2026-10-09, coordinator
 * ruling, design-rollout TL commit.) "Held" = refused by a gate OR held by a
 * dependency-contract, per build — `promotion-hold-breakdown.test.ts` and
 * `blocking-story.ts`'s own `truth.test.ts` cases pin the RULE against
 * synthetic fixtures; this file pins the PRODUCT's own promise about it:
 * `calm` shows nobody needing a person, `incident` shows exactly its one
 * failure, and `checkout-api/prod-us-east-2` — the live repro — reads held
 * for the right reason.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fixtureList(): List {
	const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
	// the skip-once demo fleet (bypass-demo.ts) is held by a schedule and an approval ON PURPOSE; these invariants are about the story fleet
	const demo = (o: { metadata?: { namespace?: string; name?: string } }) => isBypassRollout(o.metadata?.namespace ?? '', o.metadata?.name ?? '');
	list.rollouts.items = list.rollouts.items.filter((r) => !demo(r));
	list.environments.items = list.environments.items.filter((e) => !demo(e));
	return list;
}

function graphFor(list: List) {
	return buildRolloutGraph({
		rollouts: list.rollouts.items,
		environments: list.environments.items,
		dependencies: list.rolloutDependencies.items,
		envOrder: []
	});
}

afterEach(() => {
	vi.useRealTimers();
	resetDemoState('calm');
});

describe('calm: 0 Needs-you, no alarm pill', () => {
	// Several mock-clock times, including well after a demo's in-flight
	// advance (`clock-rot.test.ts`'s own precedent) — a rotted clock must not
	// silently turn a contract/order hold into something that reads STUCK or
	// NEEDS YOU either.
	for (const advanceMs of [0, 20 * 60_000, 3 * 60 * 60_000, 25 * 60 * 60_000]) {
		it(`advanceMs=${advanceMs}`, () => {
			vi.useFakeTimers();
			resetDemoState('calm');
			if (advanceMs > 0) vi.setSystemTime(Date.now() + advanceMs);

			const list = fixtureList();
			const gateContext = buildGateContext({
				environments: list.environments,
				rolloutDependencies: list.rolloutDependencies
			});
			const cards = buildRolloutCards(list.rollouts.items, list.environments.items, new Date(), gateContext);

			const needsYou = cards.filter(isNeedsYou);
			const heldByApproval = cards.filter(
				(c) =>
					isHeld(c) &&
					!isPinned(c) &&
					rankBehindBy(c.rank) > 0 &&
					blockingStory(c.rollout, gateContext, { place: c.envDisplay, now: new Date() }).person
						.length > 0
			);
			expect(needsYou.map((c) => `${c.ns}/${c.name}`)).toEqual([]);
			expect(heldByApproval.map((c) => `${c.ns}/${c.name}`)).toEqual([]);
		});
	}
});

describe('calm: every rollout banner is contract- or order-held only, never failed/stuck/approval', () => {
	for (const advanceMs of [0, 3 * 60 * 60_000]) {
		it(`advanceMs=${advanceMs}`, () => {
			vi.useFakeTimers();
			resetDemoState('calm');
			if (advanceMs > 0) vi.setSystemTime(Date.now() + advanceMs);

			const list = fixtureList();
			const graph = graphFor(list);
			const gateContext = buildGateContext({
				environments: list.environments,
				rolloutDependencies: list.rolloutDependencies
			});
			for (const r of list.rollouts.items) {
				const contractHolds = contractHoldsForRollout(graph, r);
				const story = blockingStory(r, gateContext, {
					place: r.metadata?.labels?.environment ?? null,
					now: new Date(),
					contractHolds
				});
				if (!story.blocked) continue;
				const key = `${r.metadata?.namespace}/${r.metadata?.name}`;
				expect(story.person, `${key} must not be held by a person in calm`).toHaveLength(0);
				expect(story.unknown, `${key} must not be held by an unattributed rule in calm`).toHaveLength(0);
				// Every held gate is either a dependency contract or a plain
				// promotion order — never a check/clock either, on THIS fleet's
				// own fixture (checked rather than assumed: a clock/check hold
				// would still be a legitimate hold-one-rule state, just not one
				// this demo happens to carry in calm).
				for (const g of story.gates) {
					expect(['promotion', 'dependency'], `${key}'s gate ${g.id} (${g.kind})`).toContain(g.kind);
				}
			}
		});
	}
});

describe('incident: keeps exactly its one failure', () => {
	it('checkout-worker/staging', () => {
		resetDemoState('incident');
		const list = fixtureList();
		const gateContext = buildGateContext({
			environments: list.environments,
			rolloutDependencies: list.rolloutDependencies
		});
		const cards = buildRolloutCards(list.rollouts.items, list.environments.items, new Date(), gateContext);
		const needsYou = cards.filter(isNeedsYou);
		expect(needsYou.map((c) => `${c.ns}/${c.name}`)).toEqual(['checkout-worker-staging/checkout-worker']);
	});
});

describe('checkout-api/prod-us-east-2: the contract reason, with no action', () => {
	it('blockingStory names payments-svc and offers nothing but the Gates link', () => {
		resetDemoState('calm');
		const list = fixtureList();
		const rollout = list.rollouts.items.find(
			(r) =>
				r.metadata?.name === 'checkout-api' &&
				r.metadata?.namespace === 'checkout-api-prod-us-east-2'
		);
		expect(rollout, 'checkout-api/prod-us-east-2 must exist in the calm fixture').toBeTruthy();

		const graph = graphFor(list);
		const gateContext = buildGateContext({
			environments: list.environments,
			rolloutDependencies: list.rolloutDependencies
		});
		const contractHolds = contractHoldsForRollout(graph, rollout!);
		const story = blockingStory(rollout, gateContext, {
			place: 'prod-us-east-2',
			now: new Date(),
			contractHolds
		});

		expect(story.blocked).toBe(true);
		expect(story.person).toHaveLength(0);
		const text = story.headline + ' ' + story.consequence + ' ' + story.verdict + ' ' + story.resolution;
		expect(text).toContain('payments-svc');
		// `ClassifiedGate` carries no action of its own (no deploy/approve
		// button lives on this object at all — see `classifyContractHold`); a
		// caller cannot accidentally offer one by reading the story.
		for (const g of story.gates) {
			expect(g).not.toHaveProperty('action');
		}
		// ⭐ THE HOLD-CAUSE PHRASE, ON THE LIVE REPRO. (2026-10-10,
		// design-rollout TL commit "held-cause-phrase".) The contract leads
		// over the promotion gate riding beside it -- see `holdCausePhrase`'s
		// own doc.
		expect(holdCausePhrase(story, { place: 'prod-us-east-2' })).toBe(
			'prod-us-east-2 is waiting for payments-svc ~2.9.0'
		);
	});
});

describe('telemetry-indexer/prod: the one person-held gate, named as an approval', () => {
	it('holdCausePhrase says "waiting on an approval", never the generic held fact', () => {
		resetDemoState('incident');
		const list = fixtureList();
		const rollout = list.rollouts.items.find(
			(r) => r.metadata?.name === 'telemetry-indexer' && r.metadata?.namespace === 'telemetry-indexer-prod'
		);
		expect(rollout, 'telemetry-indexer/prod must exist in the incident fixture').toBeTruthy();

		const gateContext = buildGateContext({
			environments: list.environments,
			rolloutDependencies: list.rolloutDependencies
		});
		const story = blockingStory(rollout, gateContext, { place: 'prod', now: new Date() });

		expect(story.person.length).toBeGreaterThan(0);
		expect(holdCausePhrase(story, { place: 'prod' })).toBe('prod is waiting on an approval');
	});
});
