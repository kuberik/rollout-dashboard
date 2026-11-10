/**
 * ⭐ shared/approval-words (2026-10-12, coordinator ruling). `approvalCellText`
 * is the one helper every shared "approval cell" (Home's Fleet row, the
 * PromotionMap's callout/cube, the Needs-you row) now reads instead of
 * printing the rollout's running build alone. Built off the real demo
 * fixtures (`respond()`/`buildRolloutCards()`) for the exact incident named
 * in the brief — telemetry-indexer, prod: `7b3c9f1` RUNS, `4a8d2e6` is the
 * candidate a manual-approval gate refuses (`mock-data.ts`'s `TM_CELLS`) —
 * never a hand-rolled rollout, so a fixture edit that changes this shape
 * re-runs this exact assertion rather than a stale copy of it.
 */
import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { RolloutCard } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { approvalCellText, isHeldByApproval } from './held';

type Scenario = 'calm' | 'incident' | 'wide';

function fetchFleet(scenario: Scenario) {
	resetDemoState(scenario);
	const payload = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const rollouts = payload.rollouts?.items ?? [];
	const environments = payload.environments?.items ?? [];
	const dependencies = payload.rolloutDependencies?.items ?? [];
	const gateContext = buildGateContext({
		environments: { items: environments },
		rolloutDependencies: { items: dependencies }
	});
	const network = buildRolloutGraph({ rollouts, environments, dependencies, envOrder: [], gates: gateContext });
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(network, r)
	);
	return { cards, gateContext };
}

function cardFor(cards: RolloutCard[], appName: string, envName: string): RolloutCard {
	const found = cards.find((c) => c.name === appName && c.envName === envName);
	if (!found) throw new Error(`no card for ${appName}/${envName}`);
	return found;
}

describe('approvalCellText — telemetry-indexer prod (incident)', () => {
	const { cards, gateContext } = fetchFleet('incident');
	const card = cardFor(cards, 'telemetry-indexer', 'prod');

	it('is actually held on an approval (the shared predicate, never a page-local guess)', () => {
		expect(isHeldByApproval(card, gateContext)).toBe(true);
	});

	it('labels the running build "running 7b3c9f1"', () => {
		expect(approvalCellText(card).running).toBe('running 7b3c9f1');
	});

	it('labels the pending build "4a8d2e6 waits for you" — never the running sha', () => {
		const { pending } = approvalCellText(card);
		expect(pending).toBe('4a8d2e6 waits for you');
		expect(pending).not.toContain('7b3c9f1');
	});
});

describe('approvalCellText — telemetry-indexer prod (calm): the approval is granted', () => {
	const { cards, gateContext } = fetchFleet('calm');
	const card = cardFor(cards, 'telemetry-indexer', 'prod');

	it('is not held on an approval once the gate clears', () => {
		expect(isHeldByApproval(card, gateContext)).toBe(false);
	});

	it('has nothing pending', () => {
		expect(approvalCellText(card).pending).toBeNull();
	});
});
