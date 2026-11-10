import { describe, it, expect } from 'vitest';
import type { Environment, Rollout, RolloutDependency } from '../../types';
import type { RolloutCard } from '$lib/rollout-cards';
import { homeInput, FIXTURE_NOW } from './home/fixture';
/** Ported from the home lab: its demo scenarios become the pinned incident fixture. */
type Scenario = 'incident';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { fleetFacts } from './fleet-facts';
import { isHeldByApproval } from './held';
import { tierOf } from './promotion-lanes';
import { prodTargets, heldByRule } from './home-status';

type List = { rollouts: { items: Rollout[] }; environments: { items: Environment[] }; rolloutDependencies: { items: RolloutDependency[] } };
const NOW = FIXTURE_NOW;

function build(scenario: Scenario) {
	void scenario;
	const input = homeInput();
	const list: List = {
		rollouts: { items: input.rollouts },
		environments: { items: input.environments },
		rolloutDependencies: { items: input.rolloutDependencies.items }
	};
	const gateContext = buildGateContext({ environments: list.environments, rolloutDependencies: list.rolloutDependencies });
	const graph = buildRolloutGraph({ rollouts: list.rollouts.items, environments: list.environments.items, dependencies: list.rolloutDependencies.items, envOrder: [] });
	const contractHoldsFor = (r: Rollout) => contractHoldsForRollout(graph, r);
	const cards = buildRolloutCards(list.rollouts.items, list.environments.items, NOW, gateContext, contractHoldsFor);
	const facts = fleetFacts(cards, list.rollouts.items, NOW.getTime(), '24h', { gateContext, contractHoldsFor });
	const isApproval = (c: (typeof cards)[number]) => isHeldByApproval(c, gateContext, NOW);
	return { cards, facts, isApproval };
}

describe.each(['incident'] as Scenario[])('home status — %s', (scenario) => {
	it('prod is counted in targets (app × prod region), never in environment names', () => {
		const { cards, isApproval } = build(scenario);
		const p = prodTargets(cards, isApproval);
		const targets = cards.filter((c) => c.envName && tierOf(c.envName) === 'prod').length;
		expect(p.total).toBe(targets);
		const names = new Set(cards.filter((c) => c.envName && tierOf(c.envName) === 'prod').map((c) => c.envName)).size;
		// The unit that collided with "N apps": distinct names are far fewer than targets.
		expect(p.total).toBeGreaterThanOrEqual(names);
		expect(p.failing).toBeLessThanOrEqual(p.total);
	});

	it('every held-by-a-rule app comes from fleet-facts, approvals excluded, and none is unnamed', () => {
		const { cards, facts } = build(scenario);
		const held = heldByRule(facts, cards);
		const ask = new Set(facts.held.approvalAppIds);
		expect(held.map((h) => h.app).sort()).toEqual(facts.held.appIds.filter((a) => !ask.has(a)).sort());
		for (const h of held) if (h.env == null) expect(h.running ?? h.waiting).toBeTruthy();
	});
});

import { clampToMerge } from './home-status';
describe('clampToMerge — one rule for every wait', () => {
	it('never lets a wait start before the change merged (calm: behind; incident: held)', () => {
		const merged = '2026-10-10T11:00:00Z';
		expect(clampToMerge('2026-10-10T10:00:00Z', merged)).toBe(merged); // the gate's 2h, a 1h-old change
		expect(clampToMerge('2026-10-10T11:30:00Z', merged)).toBe('2026-10-10T11:30:00Z');
		expect(clampToMerge(null, merged)).toBeNull();
		expect(clampToMerge('2026-10-10T10:00:00Z', null)).toBe('2026-10-10T10:00:00Z');
		// A step cannot have waited since before the change reached the step upstream of it.
		expect(clampToMerge('2026-10-10T10:00:00Z', merged, '2026-10-10T11:12:00Z')).toBe('2026-10-10T11:12:00Z');
	});
});

import { regionTally } from './home-status';
import { buildLanes } from './promotion-lanes';
import { kApp } from '$lib/view-models/kstairs';

describe.each(['incident'] as Scenario[])('a prod set tally accounts for every target (round S) — %s', (scenario) => {
	it('the buckets sum to the region count', () => {
		const { cards, isApproval } = build(scenario);
		let sets = 0;
		for (const m of buildLanes(cards).map((l) => kApp(l, isApproval)))
			for (const p of m.plates.filter((x) => x.set)) {
				sets++;
				const t = regionTally(p.nodes, (v) => v ?? '');
				expect(t.buckets.reduce((n, b) => n + b.count, 0), `${m.app}`).toBe(p.nodes.length);
				expect(t.total, `${m.app}`).toBe(p.nodes.length);
			}
		expect(sets).toBeGreaterThan(0);
	});
});

describe('regionTally', () => {
	it('buckets the round S patterns: failing, moving, builds by count, then nothing deployed', () => {
		const c = (v: string | null) => ({ version: v }) as unknown as RolloutCard;
		const n = (state: string, v: string | null) => ({ state: state as never, card: c(v) });
		const nodes = [n('newest', '#89'), n('newest', '#89'), n('newest', '#89'), n('behind', '#89'), n('behind', 'd0ff17e'), n('none', null)];
		expect(regionTally(nodes, (v) => v ?? '')).toEqual({
			total: 6,
			buckets: [
				{ count: 4, word: 'on', id: '#89' },
				{ count: 1, word: 'on', id: 'd0ff17e' },
				{ count: 1, word: 'not deployed', id: null }
			],
			heldBefore: null
		});
		const held = [n('behind', '4.43.0-43'), n('behind', '4.43.0-43'), n('held', '4.43.0-43'), n('behind', '4.42.0-42'), n('checking', '4.42.0-42')];
		expect(regionTally(held, (v) => v ?? '', '4.45.0-45')).toEqual({
			total: 5,
			buckets: [
				{ count: 1, word: 'checking', id: '4.42.0-42' },
				{ count: 3, word: 'on', id: '4.43.0-43' },
				{ count: 1, word: 'on', id: '4.42.0-42' }
			],
			heldBefore: '4.45.0-45'
		});
	});
});
