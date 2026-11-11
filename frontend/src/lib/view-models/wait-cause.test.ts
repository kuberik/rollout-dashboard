import { describe, it, expect } from 'vitest';
import type { Environment, Rollout, RolloutDependency } from '../../types';
import type { RolloutCard } from '$lib/rollout-cards';
import { buildRolloutCards } from '$lib/rollout-cards';
import { homeInput, FIXTURE_NOW } from './home/fixture';
/** Ported from the home lab: its demo scenarios become the pinned incident fixture. */
type Scenario = 'incident';
import { buildGateContext } from './blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from './dependency-graph';
import { isHeldByApproval } from './held';
import { buildLanes } from './promotion-lanes';
import { kApp, type KApp } from '$lib/view-models/kstairs';
import { shortenVersion } from '$lib/utils';
import { waitCause, spanText, NORMAL_CYCLE_MS, type WaitCause } from './wait-cause';

const NOW = new Date('2026-10-12T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

/** A minimal card: the fields `waitCause` reads. */
function card(over: Partial<RolloutCard> & { version: string; head?: Record<string, unknown>; spec?: Record<string, unknown>; gates?: unknown[]; releases?: unknown[] }): RolloutCard {
	return {
		held: false,
		heldCause: null,
		heldCauseLabel: null,
		waitsForEnv: null,
		...over,
		rollout: {
			spec: over.spec ?? {},
			status: { history: [over.head ?? { bakeStatus: 'Succeeded', timestamp: ago(600) }], gates: over.gates ?? [], availableReleases: over.releases ?? [] }
		}
	} as unknown as RolloutCard;
}
function app(plates: { label: string; set?: boolean; nodes: { state: string; card: RolloutCard }[] }[]): KApp {
	return { plates: plates.map((p) => ({ key: p.label, set: !!p.set, ...p })) } as unknown as KApp;
}
const ctx = { now: NOW, idOf: (v: string | null | undefined) => (v === '4a8d2e6' ? '#20' : v === '4b9c2e1' ? '#28' : (v ?? '')), isApproval: (c: RolloutCard) => c.heldCause === 'person' };

describe('waitCause — one named cause per wait (round R table)', () => {
	it('upstream bake running: "prod next · dev bakes #20, 12m left"', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'checking', card: card({ version: '4a8d2e6', head: { bakeStatus: 'InProgress', bakeStartTime: ago(3) }, spec: { bakeTime: '15m' } }) }] },
			{ label: 'prod', nodes: [{ state: 'behind', card: card({ version: '7b3c9f1' }) }] }
		]);
		const c = waitCause(m, ctx)!;
		expect(c.kind).toBe('bake');
		expect(c).toMatchObject({ place: 'prod', upstream: 'dev', id: '#20' });
		expect(Math.ceil((c as Extract<WaitCause, { kind: 'bake' }>).leftMs! / 60_000)).toBe(12);
	});
	it('approval gate: "waits for approval in prod"', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: '4a8d2e6' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: '7b3c9f1', held: true, heldCause: 'person', heldCauseLabel: 'an approval' }) }] }
		]);
		expect(waitCause(m, ctx)).toEqual({ kind: 'approval', place: 'prod' });
	});
	it('rule gate names its blocker: a dependency links its app, a check names its gate', () => {
		const dep = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: 'b' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: 'a', held: true, heldCause: 'dependency', heldCauseLabel: 'payments-svc' }) }] }
		]);
		const d = waitCause(dep, ctx)! as Extract<WaitCause, { kind: 'rule' }>;
		expect(d).toMatchObject({ kind: 'rule', place: 'prod', name: 'payments-svc' });
		expect(d.app).toBe('payments-svc');
		const chk = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: 'b' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: 'a', held: true, heldCause: 'check', heldCauseLabel: 'a check', gates: [{ name: 'promotion-prod', passing: true }, { name: 'offline-eval', passing: false }] }) }] }
		]);
		const k = waitCause(chk, ctx)! as Extract<WaitCause, { kind: 'rule' }>;
		expect(k).toMatchObject({ kind: 'rule', place: 'prod', name: 'offline-eval' });
		expect(k.app).toBeNull();
	});
	it('a live ghd-* promotion gate (kind from the API) is not the named rule', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: 'b' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: 'a', held: true, heldCause: 'check', heldCauseLabel: 'a check', gates: [{ name: 'ghd-prod-7f3a', kind: 'promotion', passing: false }, { name: 'offline-eval', kind: 'unknown', passing: false }] }) }] }
		]);
		expect(waitCause(m, ctx)).toMatchObject({ kind: 'rule', name: 'offline-eval' });
	});
	it('no kind on the summary (older backend): a failing promotion-* gate still counts as promotion', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: 'b' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: 'a', held: true, heldCause: 'check', heldCauseLabel: 'a check', gates: [{ name: 'promotion-prod', passing: false }, { name: 'offline-eval', passing: false }] }) }] }
		]);
		expect(waitCause(m, ctx)).toMatchObject({ kind: 'rule', name: 'offline-eval' });
	});
	it('a promotion-* NAME with a non-promotion kind is a rule: the backend kind wins over the name', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: 'b' }) }] },
			{ label: 'prod', nodes: [{ state: 'held', card: card({ version: 'a', held: true, heldCause: 'check', heldCauseLabel: 'a check', gates: [{ name: 'promotion-freeze', kind: 'schedule', passing: false }] }) }] }
		]);
		expect(waitCause(m, ctx)).toMatchObject({ kind: 'rule', name: 'promotion-freeze' });
	});
	it('inside the normal cycle: "prod next · usually within 5m"', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: '4a8d2e6', head: { bakeStatus: 'Succeeded', bakeEndTime: ago(2) } }) }] },
			{ label: 'prod', nodes: [{ state: 'behind', card: card({ version: '7b3c9f1' }) }] }
		]);
		expect(waitCause(m, ctx)).toMatchObject({ kind: 'cycle', place: 'prod', usualMs: NORMAL_CYCLE_MS });
	});
	it('nothing explains it past the cycle: "stalled 6h · prod hasn\'t picked up #28"', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'newest', card: card({ version: '4b9c2e1', head: { bakeStatus: 'Succeeded', bakeEndTime: ago(6 * 60 + 5) } }) }] },
			{ label: 'prod', nodes: [{ state: 'behind', card: card({ version: '88c0e51' }) }] }
		]);
		const c = waitCause(m, ctx)!;
		expect(c.kind).toBe('stalled');
		expect(c).toMatchObject({ place: 'prod', id: '#28' });
		expect(spanText((c as Extract<WaitCause, { kind: 'stalled' }>).forMs)).toBe('6h');
	});
	it('the first place waits on CI: a release offered a moment ago is inside the cycle, hours ago is a stall', () => {
		const fresh = app([{ label: 'dev', nodes: [{ state: 'behind', card: card({ version: 'a', releases: [{ tag: 'a', created: ago(60) }, { tag: 'b', version: 'b', created: ago(2) }] }) }] }]);
		expect(waitCause(fresh, ctx)!.kind).toBe('cycle');
		const old = app([{ label: 'dev', nodes: [{ state: 'behind', card: card({ version: 'a', releases: [{ tag: 'b', version: 'b', created: ago(180) }] }) }] }]);
		const stalled = waitCause(old, ctx)! as Extract<WaitCause, { kind: 'stalled' }>;
		expect(stalled).toMatchObject({ kind: 'stalled', place: 'dev', id: 'b' });
		expect(spanText(stalled.forMs)).toBe('3h');
	});
	it('a place already running what upstream runs is not the one waiting', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'behind', card: card({ version: 'a', releases: [{ tag: 'b', version: 'b', created: ago(1) }] }) }] },
			{ label: 'staging', nodes: [{ state: 'behind', card: card({ version: 'a' }) }] }
		]);
		expect(waitCause(m, ctx)).toMatchObject({ kind: 'cycle', place: 'dev', usualMs: 5 * 60_000 });
	});
	it('an upstream deploy in flight is the headline, not a wait', () => {
		const m = app([
			{ label: 'dev', nodes: [{ state: 'deploying', card: card({ version: 'b' }) }] },
			{ label: 'staging', nodes: [{ state: 'behind', card: card({ version: 'a' }) }] }
		]);
		expect(waitCause(m, ctx)).toBeNull();
	});
});

type List = { rollouts: { items: Rollout[] }; environments: { items: Environment[] }; rolloutDependencies: { items: RolloutDependency[] } };
function fleet(scenario: Scenario) {
	void scenario;
	const now = FIXTURE_NOW;
	const input = homeInput();
	const list: List = {
		rollouts: { items: input.rollouts },
		environments: { items: input.environments },
		rolloutDependencies: { items: input.rolloutDependencies.items }
	};
	const gateContext = buildGateContext({ environments: list.environments, rolloutDependencies: list.rolloutDependencies });
	const graph = buildRolloutGraph({ rollouts: list.rollouts.items, environments: list.environments.items, dependencies: list.rolloutDependencies.items, envOrder: [] });
	const cards = buildRolloutCards(list.rollouts.items, list.environments.items, now, gateContext, (r) => contractHoldsForRollout(graph, r));
	const isApproval = (c: RolloutCard) => isHeldByApproval(c, gateContext, now);
	const apps = buildLanes(cards).map((l) => kApp(l, isApproval));
	const causeOf = (name: string) => {
		const m = apps.find((a) => a.app === name)!;
		return waitCause(m, { now, idOf: (v) => (v ? shortenVersion(v) : ''), isApproval });
	};
	return { apps, causeOf, now, isApproval };
}

describe.each(['incident'] as Scenario[])('the demo fleet explains every wait but its one deliberate stall — %s', (scenario) => {
	// ⭐ ROUND 8 (2026-10-16, truth item 15): the mock's signal overlay
	// (demo/signal-overlay.ts) gives the SRE one real stall to find:
	// hello-world's newest release has waited 2h in dev with nothing to
	// explain it. Every other wait still has a real cause.
	it('every behind or held app has a real cause; the only stall is hello-world, in the incident', () => {
		const { apps, now, isApproval } = fleet(scenario);
		for (const m of apps.filter((a) => a.state === 'behind' || a.state === 'held')) {
			const c = waitCause(m, { now, idOf: (v) => (v ? shortenVersion(v) : ''), isApproval });
			expect(c, `${m.app} (${m.state}) has a cause`).not.toBeNull();
			if (m.app !== 'hello-world') expect(c!.kind, `${m.app} is not stalled`).not.toBe('stalled');
		}
	});
	it('the causes the mock was given', () => {
		const { causeOf } = fleet(scenario);
		expect(causeOf('telemetry-indexer')!.kind).toBe('approval');
		expect(causeOf('telemetry-worker')!.kind).toBe('bake');
		expect(causeOf('recommender-svc')).toMatchObject({ kind: 'rule', name: 'offline-eval' });
		expect(causeOf('orders-api')).toMatchObject({ kind: 'rule', name: 'integration-tests' });
		expect(causeOf('checkout-api')).toMatchObject({ kind: 'rule', name: 'payments-svc', app: 'payments-svc' });
		expect(causeOf('payments-core')!.kind).toBe('bake');
		expect(causeOf('edge-mesh')!.kind).toBe('bake');
		expect(causeOf('hello-world')!.kind).toBe('stalled');
	});
});
