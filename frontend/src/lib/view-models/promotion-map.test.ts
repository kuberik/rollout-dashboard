import { describe, expect, it } from 'vitest';
import type { RolloutCard } from '$lib/rollout-cards';
import type { Lane, LaneNode, NodeState, Tier } from './promotion-lanes';
import { fleetMap, stepFacts } from './promotion-map';

const card = (app: string, env: string, version = 'abc1234'): RolloutCard =>
	({ name: app, envName: env, version, theme: { name: env }, rollout: {} }) as unknown as RolloutCard;
const node = (app: string, env: string, tier: Tier, state: NodeState): LaneNode => ({
	card: card(app, env),
	tier,
	env,
	state,
	behind: state === 'behind' ? 1 : 0
});
const lane = (app: string, nodes: LaneNode[]): Lane => ({
	app,
	byTier: {},
	stages: nodes.filter((n) => n.tier !== 'prod'),
	prod: nodes.filter((n) => n.tier === 'prod'),
	state: nodes[0].state,
	lead: nodes[0]
});

const lanes = [
	lane('api', [node('api', 'dev', 'dev', 'newest'), node('api', 'staging', 'staging', 'deploying'), node('api', 'prod-eu', 'prod', 'held'), node('api', 'prod-us', 'prod', 'newest')]),
	lane('web', [node('web', 'dev', 'dev', 'deploying'), node('web', 'prod-eu', 'prod', 'newest')]),
	lane('job', [node('job', 'dev', 'dev', 'failed'), node('job', 'staging', 'staging', 'behind')])
];

describe('fleetMap (tier)', () => {
	const m = fleetMap({ lanes });
	it('orders stages on a line and folds production into one step', () => {
		expect(m.steps.map((s) => s.key)).toEqual(['dev', 'staging', 'prod']);
		expect(m.steps.at(-1)!.prod).toBe(true);
		expect(m.steps.at(-1)!.regions.map((r) => r.name)).toEqual(['prod-eu', 'prod-us']);
	});
	it('one cube per app per step, at its worst state there', () => {
		const prod = m.steps.find((s) => s.key === 'prod')!;
		expect(prod.cubes.map((c) => [c.app, c.state])).toEqual([
			['api', 'held'],
			['web', 'newest']
		]);
		expect(prod.onNewest).toBe(1);
		expect(prod.apps).toBe(2);
	});
	it('a deploy travels from the previous step of its OWN chain', () => {
		const api = m.packets.find((p) => p.app === 'api')!;
		expect([api.from, api.to]).toEqual(['dev', 'staging']);
		const web = m.packets.find((p) => p.app === 'web')!;
		expect([web.from, web.to]).toEqual([null, 'dev']);
	});
	it('counts gates, failures and motion', () => {
		expect(m.gates).toEqual({ prod: 1 });
		expect(m.failing).toBe(1);
		expect(m.held).toBe(1);
		expect(m.moving).toBe(2);
	});
	it('states facts adverse first, zeros dropped', () => {
		const dev = m.steps.find((s) => s.key === 'dev')!;
		expect(stepFacts(dev).map((f) => f.word)).toEqual(['failing', 'deploying']);
	});
});

describe('fleetMap (environment)', () => {
	it('gives every stage environment its own step', () => {
		const m = fleetMap(
			{ lanes: [lane('a', [node('a', 'dev-1', 'dev', 'newest'), node('a', 'dev-2', 'dev', 'newest'), node('a', 'prod', 'prod', 'newest')])] },
			{ granularity: 'environment' }
		);
		expect(m.steps.map((s) => s.key)).toEqual(['dev-1', 'dev-2', 'prod']);
		expect(m.steps[0].env).toBe('dev-1');
	});
});

import { appMap, appStageWord, appPeersByEnv } from './promotion-map';

describe('appMap (one app, /apps/[name])', () => {
	const regions = ['prod-a', 'prod-b', 'prod-c', 'prod-d', 'prod-e', 'prod-f'];
	const l = lane('pay', [
		node('pay', 'dev', 'dev', 'newest'),
		node('pay', 'staging', 'staging', 'newest'),
		...regions.map((r) => node('pay', r, 'prod', r === 'prod-c' ? 'held' : 'behind'))
	]);
	const m = appMap(l);
	it('has one step per environment and the production set as one step', () => {
		expect(m.granularity).toBe('app');
		expect(m.steps.map((s) => s.key)).toEqual(['dev', 'staging', 'prod']);
	});
	it('lists only exceptions in the set and folds the healthy rest', () => {
		const prod = m.steps.at(-1)!;
		expect(prod.exceptions.map((r) => r.name)).toEqual(['prod-c']);
		expect(prod.foldGroups.flatMap((g) => g.regions)).toHaveLength(5);
		expect(prod.apps).toBe(6);
		expect(prod.cubes).toHaveLength(6);
	});
	it('names the frontier and the newest build path', () => {
		expect(m.path).toEqual(['dev', 'staging']);
		expect(m.frontier).toBe('prod');
	});
});

describe('appMap: the prod step states its build (squad-fleet app AD r5 #1)', () => {
	const withVersion = (n: LaneNode, v: string): LaneNode => ({ ...n, card: { ...n.card, version: v } as RolloutCard });
	it('a one-region prod collapses to a plain stage with its own build and state', () => {
		const m = appMap(
			lane('hw', [node('hw', 'dev', 'dev', 'newest'), withVersion(node('hw', 'prod', 'prod', 'behind'), 'a1b2c3d')])
		);
		const prod = m.steps.at(-1)!;
		expect(prod.prod).toBe(false);
		expect(prod.version).toBe('a1b2c3d');
		expect(prod.status).toBe('behind');
		expect(prod.env).toBe('prod');
		expect(prod.exceptions).toEqual([]);
	});
	it('a set on one build reads "<build> ×N"', () => {
		const m = appMap(
			lane('pay', ['prod-a', 'prod-b', 'prod-c'].map((r) => withVersion(node('pay', r, 'prod', 'newest'), '9b7e410')))
		);
		expect(m.steps.at(-1)!.version).toBe('9b7e410 ×3');
	});
	it('a set on several builds reads "N builds" up top; the breakdown belongs to the fold, not the headline (lead, real-page read)', () => {
		const m = appMap(
			lane('pay', [
				withVersion(node('pay', 'prod-a', 'prod', 'newest'), '9b7e410'),
				withVersion(node('pay', 'prod-b', 'prod', 'behind'), 'd0ff17e')
			])
		);
		expect(m.steps.at(-1)!.version).toBe('2 builds');
	});
});

describe('appMap: the prod set fold states the build it folds (AD app r6 #1)', () => {
	const withVersion = (n: LaneNode, v: string): LaneNode => ({ ...n, card: { ...n.card, version: v } as RolloutCard });
	it('groups the healthy fold by build, biggest group first, never one false "same build" line', () => {
		// edge-mesh: 10 regions on a92c6f4, 2 on 16d8b70 — all healthy ("behind"
		// is not an exception), yet two different builds.
		const ten = Array.from({ length: 10 }, (_, i) => withVersion(node('edge-mesh', `prod-a${i}`, 'prod', 'behind'), 'a92c6f4'));
		const two = Array.from({ length: 2 }, (_, i) => withVersion(node('edge-mesh', `prod-b${i}`, 'prod', 'behind'), '16d8b70'));
		const m = appMap(lane('edge-mesh', [node('edge-mesh', 'dev', 'dev', 'newest'), ...ten, ...two]));
		const prod = m.steps.at(-1)!;
		expect(prod.exceptions).toEqual([]);
		expect(prod.foldGroups.map((g) => [g.version, g.regions.length])).toEqual([
			['a92c6f4', 10],
			['16d8b70', 2]
		]);
		// The headline is the short count (lead, real-page read: the full
		// breakdown in `t-code-lg` wrapped over 2-3 lines and broke equal
		// plate heights) — the breakdown lives only in the fold's own rows.
		expect(prod.version).toBe('2 builds');
	});
	it('a held exception names its own cause; a diverged build says "custom build", never "behind the newest build"', () => {
		const held = node('checkout-api', 'prod-held', 'prod', 'held');
		held.card = { ...held.card, held: true, heldCauseLabel: 'payments-svc' } as RolloutCard;
		const diverged = node('checkout-api', 'prod-custom', 'prod', 'behind');
		diverged.card = { ...diverged.card, rank: { kind: 'diverged' } } as RolloutCard;
		const healthy = node('checkout-api', 'prod-ok', 'prod', 'newest');
		const m = appMap(lane('checkout-api', [node('checkout-api', 'dev', 'dev', 'newest'), held, diverged, healthy]));
		const prod = m.steps.at(-1)!;
		const byName = new Map(prod.exceptions.map((r) => [r.name, r.reason]));
		expect(byName.get('prod-held')).toBe('held · payments-svc');
		expect(byName.get('prod-custom')).toBe('custom build');
		expect(prod.exceptions.some((r) => r.reason?.includes('behind the newest build'))).toBe(false);
	});
});

describe('appStageWord on the prod SET (squad-fleet lead, real-page read, m7 t2)', () => {
	it('names the shared upstream hold even while one region checks a candidate of its own', () => {
		const stagingHeld = node('checkout-api', 'staging', 'staging', 'held');
		stagingHeld.card = { ...stagingHeld.card, held: true, heldCauseLabel: 'payments-svc' } as RolloutCard;
		const checking = node('checkout-api', 'prod-us-east-2', 'prod', 'checking');
		const behind1 = node('checkout-api', 'prod-a', 'prod', 'behind');
		behind1.card = { ...behind1.card, waitsForEnv: 'staging' } as RolloutCard;
		const behind2 = node('checkout-api', 'prod-b', 'prod', 'behind');
		behind2.card = { ...behind2.card, waitsForEnv: 'staging' } as RolloutCard;
		const m = appMap(lane('checkout-api', [node('checkout-api', 'dev', 'dev', 'newest'), stagingHeld, checking, behind1, behind2]));
		const prod = m.steps.at(-1)!;
		const peers = appPeersByEnv(m);
		expect(appStageWord(prod, m, peers)).toBe('waits for staging · staging held on payments-svc');
	});
	it('says nothing extra when the set has nothing shared to add (e.g. every region names its own reason)', () => {
		const held = node('checkout-api', 'prod-held', 'prod', 'held');
		held.card = { ...held.card, held: true, heldCauseLabel: 'payments-svc' } as RolloutCard;
		const healthy = node('checkout-api', 'prod-ok', 'prod', 'newest');
		const m = appMap(
			lane('checkout-api', [node('checkout-api', 'dev', 'dev', 'newest'), node('checkout-api', 'staging', 'staging', 'newest'), held, healthy])
		);
		const prod = m.steps.at(-1)!;
		const peers = appPeersByEnv(m);
		expect(appStageWord(prod, m, peers)).toBeNull();
	});
});
