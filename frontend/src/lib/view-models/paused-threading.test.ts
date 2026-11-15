import { describe, it, expect } from 'vitest';
import type { Rollout, Environment } from '$lib/../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import { nodeState, type NodeState } from './promotion-lanes';
import { fleetFacts, stageKeyOf } from './fleet-facts';
import { isReached, journeyFromCells, journeyFromLane, type JourneyStop } from './journey';
import { buildLanes } from './promotion-lanes';
import { changeSummary } from './home-status';
import { severityRank } from './severity';
import { toneOf } from './state-tone';
import type { PrCell } from './pr-pipeline';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const ALL: NodeState[] = ['failed', 'stuck', 'deploying', 'checking', 'paused', 'held', 'behind', 'newest', 'none'];

const rollout = (name: string, entry: Record<string, unknown>): Rollout =>
	({ metadata: { name, namespace: `${name}-prod` }, spec: {}, status: { history: [{ version: 'v2', timestamp: '2026-10-10T11:00:00Z', ...entry }] } }) as unknown as Rollout;
const env = (name: string): Environment =>
	({ metadata: { name, namespace: `${name}-prod` }, spec: { environment: 'prod', name, rolloutRef: { name } } }) as unknown as Environment;

const heldBake = { bakeStatus: 'InProgress', bakeStartTime: '2026-10-10T11:00:00Z', bakeHoldStartTime: '2026-10-10T11:30:00Z' };
const runningBake = { bakeStatus: 'InProgress', bakeStartTime: '2026-10-10T11:00:00Z' };

describe('every NodeState is placed in the journey and the fleet tallies', () => {
	it('a paused place is reached, like checking', () => {
		for (const s of ALL) expect(typeof isReached(s)).toBe('boolean');
		expect(isReached('paused')).toBe(true);
		expect(isReached('none')).toBe(false);
	});
	it('every NodeState has a severity slot and (but behind) a tone', () => {
		for (const s of ALL) expect(severityRank(s)).toBeLessThan(10);
		for (const s of ALL.filter((x) => x !== 'behind')) expect(toneOf(s)).not.toBeNull();
	});
	it('stageKeyOf counts paused as checking and none as nothing', () => {
		expect(stageKeyOf('paused')).toBe('checking');
		expect(stageKeyOf('none')).toBeNull();
		for (const s of ALL.filter((x) => x !== 'paused' && x !== 'none')) expect(stageKeyOf(s)).toBe(s);
	});
});

describe('a paused place in the fleet counts', () => {
	it('is counted where a checking one is: same apps, places and in-motion figures', () => {
		const run = (entry: Record<string, unknown>) => {
			const r = [rollout('inventory-api', entry)];
			const cards = buildRolloutCards(r, [env('inventory-api')], new Date(NOW));
			return { f: fleetFacts(cards, r, NOW, '24h'), s: nodeState(cards[0]) };
		};
		const held = run(heldBake);
		const live = run(runningBake);
		expect(held.s).toBe('paused');
		expect(live.s).toBe('checking');
		expect(held.f.byTier.prod.placesByState).toEqual(live.f.byTier.prod.placesByState);
		expect(held.f.byTier.prod.appsByState).toEqual(live.f.byTier.prod.appsByState);
		expect(held.f.byTier.prod.appsByState.checking).toBe(1);
		expect(held.f.inMotion.checking).toBe(live.f.inMotion.checking);
	});
});

describe('a failed bake wins over a hold', () => {
	it('reads failed even when the hold fields are still set', () => {
		const r = [rollout('orders-hub', { bakeStatus: 'Failed', bakeStartTime: '2026-10-10T11:00:00Z', bakeHoldStartTime: '2026-10-10T11:30:00Z' })];
		const cards = buildRolloutCards(r, [env('orders-hub')], new Date(NOW));
		expect(nodeState(cards[0])).toBe('failed');
		const lane = buildLanes(cards)[0];
		expect(lane.state).toBe('failed');
	});
});

const cell = (over: Partial<PrCell>): PrCell =>
	({ cluster: 'local', namespace: 'ns', rolloutName: 'inventory-api', theme: null, envRank: 0, reason: '', since: null, usuallyMs: null, bakeLeftMs: null, releaseLabel: '', revision: null, superseded: false, supersededHeadStatus: null, gateHint: null, gateLabel: null, gateSubject: null, gateSubjectKind: null, gatePending: false, gateApprovalGuess: false, gateContract: null, gateRequiredVersion: null, gateProvidedVersion: null, providerHasNoBuild: false, containmentKnown: true, envDisplay: 'prod', envName: 'prod', state: 'baking', ...over }) as PrCell;

describe('journey: a paused stop', () => {
	const stops = (paused: boolean): JourneyStop[] => journeyFromCells({ cells: [cell({ bakePaused: paused })] }, { tiers: ['prod'] });
	it('keeps checking`s action and says paused, never "not reached yet"', () => {
		const p = stops(true)[0];
		const c = stops(false)[0];
		expect(p.state).toBe('paused');
		expect(p.label).toContain('paused');
		expect(p.action?.kind).toBe('open');
		expect(p.action).toEqual(c.action);
		expect(p.label).not.toContain('not reached');
	});
	it('the lane adapter labels a paused node paused', () => {
		const r = [rollout('inventory-api', heldBake)];
		const cards = buildRolloutCards(r, [env('inventory-api')], new Date(NOW));
		const s = journeyFromLane(buildLanes(cards)[0]);
		const last = s[s.length - 1];
		expect(last.state).toBe('paused');
		expect(last.label).toContain('paused');
		expect(last.label).not.toContain('not reached');
		expect(last.action?.kind).toBe('open');
	});
});

describe('changeSummary: a paused frontier', () => {
	it('reads paused in prod with checking`s active tone', () => {
		const sum = (paused: boolean) => changeSummary({ sha: 'abc1234', services: [{ appName: 'inventory-api', cells: [cell({ bakePaused: paused })] }] } as never);
		expect(sum(true).text).toBe('1 paused in prod');
		expect(sum(true).tone).toBe(sum(false).tone);
		expect(sum(false).text).toBe('1 checking in prod');
	});
});
