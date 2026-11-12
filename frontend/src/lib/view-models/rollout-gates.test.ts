import { describe, it, expect } from 'vitest';
import type { HealthCheck, Rollout, RolloutGate } from '../../types';
import { buildRolloutGraph, type GraphNode } from './dependency-graph';
import { buildGateContext, withSchedules } from './blocking-story';
import { humanizeGateName, rolloutGateBoxes, schedulePhrase, type ScheduleLike } from './rollout-gates';

const ANN = 'rollout-dashboard.kuberik.com/source-cluster';
const NOW = new Date('2026-10-08T10:00:00Z');

function rollout(o: {
	tag?: string;
	candidates?: string[];
	gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
	pinned?: string;
	deployedAt?: string;
}): Rollout {
	const tag = o.tag ?? 'r1';
	return {
		metadata: { name: 'app', namespace: 'ns', annotations: { [ANN]: 'c' } },
		spec: { healthCheckSelector: {}, ...(o.pinned ? { wantedVersion: o.pinned } : {}) },
		status: {
			history: [{ version: { tag, version: tag }, timestamp: o.deployedAt ?? '2026-10-08T09:00:00Z' }],
			availableReleases: [{ tag, version: tag }, ...(o.candidates ?? []).map((t) => ({ tag: t, version: t }))],
			releaseCandidates: [...(o.candidates ?? [])].reverse().map((t) => ({ tag: t, version: t })),
			gates: o.gates ?? []
		}
	} as unknown as Rollout;
}

function gateObj(name: string, o: { owner?: { kind: string; name: string }; pretty?: string; passing?: boolean; allowed?: string[] } = {}): RolloutGate {
	return {
		metadata: {
			name,
			namespace: 'ns',
			...(o.pretty ? { annotations: { 'gate.kuberik.com/pretty-name': o.pretty } } : {}),
			...(o.owner ? { ownerReferences: [{ apiVersion: 'v1', kind: o.owner.kind, name: o.owner.name, uid: 'u' }] } : {})
		},
		spec: { rolloutRef: { name: 'app' }, passing: o.passing ?? true, ...(o.allowed ? { allowedVersions: o.allowed } : {}) }
	} as unknown as RolloutGate;
}

function schedule(o: { name?: string; action?: 'Allow' | 'Deny'; active: boolean; next?: string; managed?: string[]; pretty?: string }): ScheduleLike {
	return {
		metadata: { name: o.name ?? 'hours', namespace: 'ns', ...(o.pretty ? { annotations: { 'gate.kuberik.com/pretty-name': o.pretty } } : {}) },
		spec: { action: o.action ?? 'Allow', timezone: 'Europe/Zagreb' },
		status: { active: o.active, nextTransition: o.next, managedGates: o.managed ?? [] }
	};
}

/** The focus node, exactly as the tab builds it: one graph, `focus` included. */
function focusOf(r: Rollout, objects: RolloutGate[], schedules: ScheduleLike[]): GraphNode {
	const ctx = withSchedules(
		buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] }, rolloutGates: { items: objects } }),
		'ns',
		schedules as never
	);
	const g = buildRolloutGraph({
		rollouts: [r],
		environments: [],
		dependencies: [],
		envOrder: [],
		gates: ctx,
		focus: { cluster: 'c', namespace: 'ns', name: 'app' }
	});
	const f = g.nodes.find((n) => n.name === 'app');
	if (!f) throw new Error('focus not in graph');
	return f;
}

function boxes(r: Rollout, objects: RolloutGate[], schedules: ScheduleLike[] | null, health: HealthCheck[] | null = null) {
	return rolloutGateBoxes({
		focus: focusOf(r, objects, schedules ?? []),
		rollout: r,
		rolloutGates: objects,
		schedules,
		healthChecks: health,
		edgeGates: new Set(),
		now: NOW
	});
}

describe('buildRolloutGraph focus', () => {
	it('makes an edge-less rollout a node, so its holds exist', () => {
		const r = rollout({ candidates: ['r2'], gates: [{ name: 'sg', passing: false }] });
		const f = focusOf(r, [gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'hours' }, passing: false })], [
			schedule({ active: false, next: '2026-10-09T07:00:00Z', managed: ['sg'] })
		]);
		expect(f.holds.map((h) => h.gate)).toEqual(['sg']);
		expect(f.holds[0].clears).toBe('clock');
	});
});

describe('rolloutGateBoxes', () => {
	it('draws an OPEN deploy window, not holding, with when it closes', () => {
		const r = rollout({ candidates: ['r2'], gates: [{ name: 'sg', passing: true }] });
		const b = boxes(r, [gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'hours' } })], [
			schedule({ active: true, next: '2026-10-08T16:00:00Z', managed: ['sg'], pretty: 'Business hours' })
		]);
		expect(b).toHaveLength(1);
		expect(b[0]).toMatchObject({ kind: 'schedule', state: 'clear', title: 'Business hours', kindWord: 'Deploy window', held: [] });
		expect(b[0].phrase).toMatch(/^open now · closes /);
	});

	it('a CLOSED window holding the build is blocked, by the graph’s own holds', () => {
		const r = rollout({ candidates: ['r2', 'r3'], gates: [{ name: 'sg', passing: false }] });
		const b = boxes(r, [gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'hours' }, passing: false })], [
			schedule({ active: false, next: '2026-10-09T07:00:00Z', managed: ['sg'] })
		]);
		expect(b[0]).toMatchObject({ state: 'blocked', title: 'Deploy window', kindWord: null, held: ['r3', 'r2'] });
		expect(b[0].phrase).toMatch(/^opens /);
	});

	it('a freeze reads until / starts, never opens', () => {
		expect(schedulePhrase(schedule({ action: 'Deny', active: true, next: '2026-10-08T12:00:00Z' }), NOW)).toMatch(/^until /);
		expect(schedulePhrase(schedule({ action: 'Deny', active: false, next: '2026-10-08T12:00:00Z' }), NOW)).toMatch(/^starts /);
		expect(schedulePhrase(schedule({ action: 'Deny', active: true }), NOW)).toBe('in effect');
	});

	it('a ClusterRolloutSchedule names its gates namespace/name', () => {
		const r = rollout({ gates: [{ name: 'sg', passing: true }] });
		const b = boxes(r, [gateObj('sg', { owner: { kind: 'ClusterRolloutSchedule', name: 'fleet' } })], [
			schedule({ name: 'fleet', active: true, managed: ['ns/sg'] })
		]);
		expect(b).toHaveLength(1);
		expect(b[0].gates).toEqual(['sg']);
		expect(b[0].state).toBe('clear');
	});

	it('an external approval that allows the waiting builds is drawn, not holding', () => {
		const r = rollout({ candidates: ['r2', 'r3'], gates: [{ name: 'release-approval', passing: true, allowedVersions: ['r2', 'r3'] }] });
		const b = boxes(r, [gateObj('release-approval', { allowed: ['r2', 'r3'] })], []);
		expect(b[0]).toMatchObject({ kind: 'approval', state: 'clear', title: 'Release approval', kindWord: 'Approval', phrase: 'allows r3, r2' });
	});

	it('an allow-list of unknown kind is a gate with a list, never labelled an approval; the same list with kind approval is one', () => {
		const withKind = (kind: string) => {
			const r = rollout({ candidates: ['r2'], gates: [{ name: 'permits-newest-only', passing: true, allowedVersions: ['r3'], kind } as never] });
			return boxes(r, [gateObj('permits-newest-only', { allowed: ['r3'] })], [])[0];
		};
		expect(withKind('unknown')).toMatchObject({ kind: 'gate', state: 'blocked', kindWord: 'Gate', mark: { kind: 'unknown', clears: 'unknown' } });
		expect(withKind('approval')).toMatchObject({ kind: 'approval', kindWord: 'Approval', mark: { kind: 'approval', clears: 'person' } });
	});

	it('an approval not given for the candidate holds it', () => {
		const r = rollout({ candidates: ['r2'], gates: [{ name: 'approval', passing: false, allowedVersions: [] }] });
		const b = boxes(r, [gateObj('approval', { allowed: [] })], []);
		expect(b[0]).toMatchObject({ kind: 'approval', state: 'blocked', title: 'Approval', kindWord: null, held: ['r2'], phrase: 'not given for r2' });
	});

	it('an approval given for one build still holds the newer one it does not list (never "Nothing held" beside a held build)', () => {
		const r = rollout({ candidates: ['r2', 'r3'], gates: [{ name: 'approval', passing: true, allowedVersions: ['r2'], kind: 'approval' } as never] });
		const b = boxes(r, [gateObj('approval', { allowed: ['r2'] })], []);
		expect(b[0]).toMatchObject({ kind: 'approval', state: 'blocked', held: ['r3'] });
	});

	it('never boxes an edge gate or a schedule-owned gate as external', () => {
		const r = rollout({ gates: [{ name: 'promo', passing: true }, { name: 'dep', passing: true }, { name: 'sg', passing: true }] });
		const b = rolloutGateBoxes({
			focus: focusOf(r, [], []),
			rollout: r,
			rolloutGates: [
				gateObj('promo', { owner: { kind: 'Environment', name: 'e' } }),
				gateObj('dep', { owner: { kind: 'RolloutDependency', name: 'd' } }),
				gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'gone' } })
			],
			schedules: [],
			healthChecks: null,
			edgeGates: new Set(['promo']),
			now: NOW
		});
		expect(b).toEqual([]);
	});

	it('a hold no box claims still gets a box', () => {
		const r = rollout({ candidates: ['r2'], gates: [{ name: 'mystery', passing: false }] });
		const b = boxes(r, [], []);
		expect(b).toHaveLength(1);
		expect(b[0]).toMatchObject({ state: 'blocked', title: 'Mystery', held: ['r2'] });
	});

	it('health checks appear ONLY while they hold a build', () => {
		const failing = { metadata: { name: 'hc' }, status: { status: 'Unhealthy', lastErrorTime: '2026-10-08T09:30:00Z' } } as unknown as HealthCheck;
		const healthy = { metadata: { name: 'hc' }, status: { status: 'Healthy' } } as unknown as HealthCheck;
		const r = rollout({ candidates: ['r2'] });
		expect(boxes(r, [], [], [failing])[0]).toMatchObject({ kind: 'health', state: 'blocked', title: 'Health checks', phrase: '1 failing', held: ['r2'] });
		expect(boxes(r, [], [], [healthy])).toEqual([]);
		// Nothing newer to take: nothing to hold.
		expect(boxes(rollout({}), [], [], [failing])).toEqual([]);
		// A failure from before this deploy is not evidence about it.
		const old = { metadata: { name: 'hc' }, status: { status: 'Unhealthy', lastErrorTime: '2026-10-08T08:00:00Z' } } as unknown as HealthCheck;
		expect(boxes(r, [], [], [old])).toEqual([]);
	});

	it('a pin outranks every gate and is drawn first', () => {
		const r = rollout({ candidates: ['r2'], pinned: 'r1', gates: [{ name: 'sg', passing: false }] });
		const b = boxes(r, [gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'hours' }, passing: false })], [
			schedule({ active: false, managed: ['sg'] })
		]);
		expect(b.map((x) => [x.kind, x.state])).toEqual([
			['pin', 'blocked'],
			['schedule', 'clear']
		]);
	});

	it('the pin box is released by clearing the pin, names the build and who pinned it, and is never an approval', () => {
		const r = rollout({ candidates: ['r2'], pinned: 'r1' });
		(r.metadata!.annotations as Record<string, string>)['rollout.kuberik.com/deploy-user'] = 'luka';
		const pin = boxes(r, [], [])[0];
		expect(pin).toMatchObject({ kind: 'pin', title: 'Pinned to r1 by luka' });
		expect(pin.mark.clears).toBe('pin');
		const noWho = boxes(rollout({ candidates: ['r2'], pinned: 'r1' }), [], [])[0];
		expect(noWho.title).toBe('Pinned to r1');
	});

	it('humanizes a gate name', () => {
		expect(humanizeGateName('release-approval')).toBe('Release approval');
		expect(humanizeGateName('change_freeze')).toBe('Change freeze');
	});

	/**
	 * ⭐ ITEM 1, QA 2026-10-08: a closed schedule gate box's KEY must not
	 * change once its schedule's own status arrives late. Before the fix, the
	 * fallback ("HOLDS NO BOX CLAIMED") keyed a schedule-owned gate by the raw
	 * gate name (`gate:sg`) while the SCHEDULES loop, once `schedules` loaded,
	 * keyed the SAME gate by its schedule (`schedule:ns/hours`) — two
	 * different keys for one logical box, which made `RolloutNeighbourhood`'s
	 * `RetainedRows` think the first box had "resolved" (dropped off the
	 * list) and keep drawing it, stale, captioned "passing now", right next
	 * to the real, closed box.
	 */
	it('a schedule-owned gate box keeps ONE key whether or not the schedule has loaded yet', () => {
		const r = rollout({ candidates: ['r2'], gates: [{ name: 'sg', passing: false }] });
		const obj = gateObj('sg', { owner: { kind: 'RolloutSchedule', name: 'hours' }, passing: false });

		// Before the schedule's own status has arrived: `schedules` is null.
		const before = boxes(r, [obj], null);
		expect(before).toHaveLength(1);
		expect(before[0].key).toBe('schedule:ns/hours');
		expect(before[0].kind).toBe('schedule');

		// After it loads: the SCHEDULES loop claims the same gate.
		const after = boxes(r, [obj], [schedule({ name: 'hours', active: false, next: '2026-10-09T07:00:00Z', managed: ['sg'] })]);
		expect(after).toHaveLength(1);
		expect(after[0].key).toBe(before[0].key);
		expect(after[0].state).toBe('blocked');

		// The box must never read "passing now" while the window is closed —
		// a duplicate retained-and-released row would print exactly that.
		for (const b of [before, after]) {
			expect(b.some((x) => x.phrase === 'passing now')).toBe(false);
		}
	});
});

describe('healthHold — must match rollout detail`s newestHeldByHealth', () => {
	/**
	 * ⭐ ITEM 3, QA 2026-10-08: the clause `healthHold` used to skip entirely.
	 * A real gate already refusing the newest candidate must suppress the
	 * health box — health is additive evidence, never a second independent
	 * reason for the identical hold.
	 */
	it('does not draw a health box when a real gate already blocks the newest candidate', () => {
		const failing = {
			metadata: { name: 'hc' },
			status: { status: 'Unhealthy', lastErrorTime: '2026-10-08T09:30:00Z' }
		} as unknown as HealthCheck;
		const r = rollout({
			candidates: ['r2'],
			gates: [{ name: 'approval', passing: false, allowedVersions: [] }]
		});
		const b = boxes(r, [gateObj('approval', { allowed: [] })], [], [failing]);
		expect(b.some((x) => x.kind === 'health')).toBe(false);
		// The approval box itself still draws, holding r2.
		expect(b.find((x) => x.kind === 'approval')).toMatchObject({ state: 'blocked', held: ['r2'] });
	});

	it('still draws the health box when no gate blocks the newest candidate', () => {
		const failing = {
			metadata: { name: 'hc' },
			status: { status: 'Unhealthy', lastErrorTime: '2026-10-08T09:30:00Z' }
		} as unknown as HealthCheck;
		const r = rollout({ candidates: ['r2'] });
		const b = boxes(r, [], [], [failing]);
		expect(b.find((x) => x.kind === 'health')).toMatchObject({ state: 'blocked', phrase: '1 failing' });
	});

	/**
	 * Pin precedence is applied at `rolloutGateBoxes`'s call site, not inside
	 * `healthHold` — a pinned rollout with a failing check still draws no
	 * health box (the PIN box already explains the hold), matching detail's
	 * `{#if blockStory.pinnedTo} … {:else if newestHeldByHealth}` ordering.
	 */
	it('a pin suppresses the health box even while a check is failing', () => {
		const failing = {
			metadata: { name: 'hc' },
			status: { status: 'Unhealthy', lastErrorTime: '2026-10-08T09:30:00Z' }
		} as unknown as HealthCheck;
		const r = rollout({ candidates: ['r2'], pinned: 'r1' });
		const b = boxes(r, [], [], [failing]);
		expect(b.map((x) => x.kind)).toEqual(['pin']);
	});
});

import { gateDisplayName, isGeneratedGateName } from './rollout-gates';
describe('gateDisplayName (QA #17)', () => {
	it('prefers the published pretty name', () => {
		expect(gateDisplayName('ghd-6p5hd', 'Staging soak')).toBe('Staging soak');
	});
	it('humanizes a hand-authored name', () => {
		expect(gateDisplayName('hello-world-manifests-manual-approval')).toBe('Hello world manifests manual approval');
	});
	it('never promotes a generated id into a sentence', () => {
		expect(isGeneratedGateName('ghd-6p5hd')).toBe(true);
		expect(isGeneratedGateName('schedule-gate-zvsqr')).toBe(true);
		expect(isGeneratedGateName('release-approval')).toBe(false);
		expect(gateDisplayName('ghd-6p5hd')).toBe('Gate');
	});
});
