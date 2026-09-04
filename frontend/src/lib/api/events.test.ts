import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { applyChangeEvents, type ChangeEvent } from './events';

const ev = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'Rollout',
	namespace: 'team-a',
	name: 'app-1',
	resourceVersion: '123',
	ts: 1,
	...overrides
});

/**
 * ⭐ REAL `QueryClient`, SEEDED — not a fake that records call shapes. The
 * per-kind mapping's whole point is that a HealthCheck event must NOT flip
 * `isInvalidated` on `rollout-permissions`, and a fake that only records
 * "was invalidateQueries called with a predicate matching this shape" can't
 * tell "matched and invalidated" apart from "a DIFFERENT predicate call
 * happened to also match" the way a real cache can. One client, one fixed
 * set of seeded keys, `getQueryState(key)?.isInvalidated` is the assertion.
 */
function seededClient() {
	const qc = new QueryClient();
	const keys: Record<string, unknown[]> = {
		fleetAll: ['rollouts', 'all'],
		fleetNsA: ['rollouts', 'namespace', 'team-a'],
		fleetNsB: ['rollouts', 'namespace', 'team-b'],
		rolloutA1: ['rollout', 'team-a', 'app-1', undefined],
		rolloutA2: ['rollout', 'team-a', 'app-2', undefined], // same ns, different rollout
		rolloutB1: ['rollout', 'team-b', 'app-1', undefined], // different ns, same name
		permissionsA1: ['rollout-permissions', 'team-a', 'app-1', undefined],
		testsA1: ['rollout-tests', 'team-a', 'app-1'],
		scheduleWindowA1: ['rollout-schedule-window', 'team-a', 'app-1', ''],
		healthChecksA1: ['health-checks', 'team-a', 'app-1'],
		eventsA1: ['events', 'team-a', 'app-1'],
		managedResourcesKustA: ['managed-resources', 'team-a', 'app-1', ['kust-a']],
		managedResourcesKustB: ['managed-resources', 'team-a', 'app-1', ['kust-b']],
		managedResourcesOtherNs: ['managed-resources', 'team-b', 'app-1', ['kust-a']],
		networkSchedules: ['network-schedules', ['', 'spoke-a']],
		clusterInfo: ['cluster-info']
	};
	for (const key of Object.values(keys)) qc.setQueryData(key, { seeded: true });
	function invalidated(label: keyof typeof keys): boolean {
		return qc.getQueryState(keys[label])?.isInvalidated ?? false;
	}
	return { qc, keys, invalidated };
}

/** All-false baseline so each test only has to name what it expects TRUE. */
type Label =
	| 'fleetAll'
	| 'fleetNsA'
	| 'fleetNsB'
	| 'rolloutA1'
	| 'rolloutA2'
	| 'rolloutB1'
	| 'permissionsA1'
	| 'testsA1'
	| 'scheduleWindowA1'
	| 'healthChecksA1'
	| 'eventsA1'
	| 'managedResourcesKustA'
	| 'managedResourcesKustB'
	| 'managedResourcesOtherNs'
	| 'networkSchedules'
	| 'clusterInfo';
const ALL_LABELS: Label[] = [
	'fleetAll',
	'fleetNsA',
	'fleetNsB',
	'rolloutA1',
	'rolloutA2',
	'rolloutB1',
	'permissionsA1',
	'testsA1',
	'scheduleWindowA1',
	'healthChecksA1',
	'eventsA1',
	'managedResourcesKustA',
	'managedResourcesKustB',
	'managedResourcesOtherNs',
	'networkSchedules',
	'clusterInfo'
];

function assertOnly(invalidated: (l: Label) => boolean, expectedTrue: Label[]) {
	for (const label of ALL_LABELS) {
		expect(invalidated(label), `${label} invalidated=${invalidated(label)}`).toBe(
			expectedTrue.includes(label)
		);
	}
}

describe('applyChangeEvents — mapping SSE change events to TanStack invalidations, PER KIND', () => {
	it('an empty batch invalidates nothing', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, []);
		assertOnly(invalidated, []);
	});

	it('a kind this module has never heard of invalidates nothing (not "invalidate everything")', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'SomeFutureCachedType' })]);
		assertOnly(invalidated, []);
	});

	// ── Rollout: fleet list + the EXACT rollout entry only — not the sibling
	// rollout in the same namespace, not permissions/health-checks/events/
	// managed-resources/tests/schedule-window at all. ──
	it('Rollout invalidates the fleet list and ONLY its own exact rollout entry', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Rollout', namespace: 'team-a', name: 'app-1' })]);
		assertOnly(invalidated, ['fleetAll', 'fleetNsA', 'rolloutA1']);
	});

	// ── HealthCheck: health-checks in that namespace ONLY. Not the fleet
	// list, not permissions, not the rollout query, not events. This is the
	// residue the coordinator measured: probe-status writes must not touch
	// anything but the health-checks endpoint. ──
	it('HealthCheck invalidates ONLY health-checks in its namespace — nothing else, permissions least of all', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'HealthCheck', namespace: 'team-a', name: 'hello-probe' })]);
		assertOnly(invalidated, ['healthChecksA1']);
	});

	// ── Kustomization: managed-resources for THAT kustomization (matched by
	// name, not every managed-resources entry in the namespace) + fleet
	// list (RolloutsListResponse embeds `kustomizations`). Not the `rollout`
	// query (RolloutResponse's `kustomizations` field is left to its own
	// 60s ceiling — a deliberate, documented trade). ──
	it('Kustomization invalidates the fleet list and ONLY the managed-resources entry naming it', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Kustomization', namespace: 'team-a', name: 'kust-a' })]);
		assertOnly(invalidated, ['fleetAll', 'fleetNsA', 'managedResourcesKustA']);
	});

	it("Kustomization does not touch a managed-resources entry for a DIFFERENT kustomization or namespace", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Kustomization', namespace: 'team-a', name: 'kust-a' })]);
		expect(invalidated('managedResourcesKustB')).toBe(false);
		expect(invalidated('managedResourcesOtherNs')).toBe(false);
	});

	// ── Environment / KruiseRollout / RolloutDependency: fleet list (all
	// three are embedded in RolloutsListResponse) + every `rollout` entry in
	// that namespace (the event names the changed object, not which rollout
	// it belongs to — RolloutResponse embeds `environment`/`kruiseRollout`
	// too, but only namespace is known). Not RolloutGate's own tags, not
	// health-checks/events/managed-resources/permissions/tests. ──
	for (const kind of ['Environment', 'KruiseRollout', 'RolloutDependency']) {
		it(`${kind} invalidates the fleet list and every rollout entry in its namespace`, () => {
			const { qc, invalidated } = seededClient();
			applyChangeEvents(qc, [ev({ kind, namespace: 'team-a', name: 'some-object' })]);
			assertOnly(invalidated, ['fleetAll', 'fleetNsA', 'rolloutA1', 'rolloutA2']);
		});
	}

	// ── RolloutGate / OCIRepository: embedded ONLY in RolloutResponse
	// (`rolloutGates`/`ociRepositories`), NOT in RolloutsListResponse — so
	// unlike Environment/KruiseRollout/RolloutDependency, these must NOT
	// touch the fleet list. ──
	for (const kind of ['RolloutGate', 'OCIRepository']) {
		it(`${kind} invalidates every rollout entry in its namespace but NOT the fleet list`, () => {
			const { qc, invalidated } = seededClient();
			applyChangeEvents(qc, [ev({ kind, namespace: 'team-a', name: 'some-object' })]);
			assertOnly(invalidated, ['rolloutA1', 'rolloutA2']);
		});
	}

	it("a namespace-scoped rollout-tag event does not touch a DIFFERENT namespace's rollout entry", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'RolloutGate', namespace: 'team-a', name: 'some-gate' })]);
		expect(invalidated('rolloutB1')).toBe(false);
	});

	// ── RolloutTest: its own dedicated key only. ──
	it('RolloutTest invalidates ONLY rollout-tests in its namespace', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'RolloutTest', namespace: 'team-a', name: 'some-test' })]);
		assertOnly(invalidated, ['testsA1']);
	});

	// ── rollout-permissions: NEVER invalidated by the stream, for ANY kind
	// — it's a per-user SelfSubjectAccessReview, not per-object. This is the
	// specific defect the coordinator's measurement found. ──
	it('permissions/all is invalidated by NOTHING the stream can send — every known kind, one batch', () => {
		const { qc, invalidated } = seededClient();
		const allKinds = [
			'Rollout',
			'RolloutDependency',
			'RolloutGate',
			'RolloutSchedule',
			'ClusterRolloutSchedule',
			'HealthCheck',
			'RolloutTest',
			'Environment',
			'KruiseRollout',
			'Kustomization',
			'OCIRepository'
		];
		applyChangeEvents(
			qc,
			allKinds.map((kind) => ev({ kind, namespace: 'team-a', name: 'app-1' }))
		);
		expect(invalidated('permissionsA1')).toBe(false);
	});

	// ── the bare `events` key: not reachable via the stream today (core
	// v1.Event isn't a cached/streamed kind on the backend), so every REAL
	// kind must leave it alone — but the mapping is ready for the day a
	// synthetic/future 'Event' kind arrives. ──
	it('events/<ns>/<name> is invalidated by NOTHING today (core Event is not a streamed kind)', () => {
		const { qc, invalidated } = seededClient();
		const allKinds = [
			'Rollout',
			'RolloutDependency',
			'RolloutGate',
			'RolloutSchedule',
			'ClusterRolloutSchedule',
			'HealthCheck',
			'RolloutTest',
			'Environment',
			'KruiseRollout',
			'Kustomization',
			'OCIRepository'
		];
		applyChangeEvents(
			qc,
			allKinds.map((kind) => ev({ kind, namespace: 'team-a', name: 'app-1' }))
		);
		expect(invalidated('eventsA1')).toBe(false);
	});

	it("the mapping IS ready for a future 'Event' kind, forward-compatibility only — not reachable from real traffic yet", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Event', namespace: 'team-a', name: 'app-1' })]);
		assertOnly(invalidated, ['eventsA1']);
	});

	// ── RolloutSchedule / ClusterRolloutSchedule: both schedule tags
	// (`network-schedules`, `rollout-schedule-window`), matched by KIND
	// alone (ClusterRolloutSchedule is cluster-scoped and carries no
	// namespace at all) — nothing rollout- or fleet-shaped moves. ──
	it('RolloutSchedule invalidates both schedule tags and nothing else', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'RolloutSchedule', namespace: 'team-a', name: 'business-hours' })]);
		assertOnly(invalidated, ['networkSchedules', 'scheduleWindowA1']);
	});

	// ⛔ THE REGRESSION THIS GUARDS: a ClusterRolloutSchedule is cluster-scoped
	// BY DEFINITION, so its own ChangeEvent always carries `namespace: ""` —
	// an `ev.namespace` truthiness guard would silently drop it entirely.
	it('ClusterRolloutSchedule with an EMPTY namespace (cluster-scoped) still invalidates both schedule tags', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'ClusterRolloutSchedule', namespace: '', name: 'freeze-window' })]);
		assertOnly(invalidated, ['networkSchedules', 'scheduleWindowA1']);
	});

	it('a non-schedule event does not touch either schedule tag', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Rollout', namespace: 'team-a', name: 'app-1' })]);
		expect(invalidated('networkSchedules')).toBe(false);
		expect(invalidated('scheduleWindowA1')).toBe(false);
	});

	// ── cluster-info: never touched by any of this — it's not per-namespace,
	// not per-rollout, and no kind here claims it. ──
	it('cluster-info is never invalidated by the stream', () => {
		const { qc, invalidated } = seededClient();
		const allKinds = [
			'Rollout',
			'RolloutDependency',
			'RolloutGate',
			'RolloutSchedule',
			'ClusterRolloutSchedule',
			'HealthCheck',
			'RolloutTest',
			'Environment',
			'KruiseRollout',
			'Kustomization',
			'OCIRepository'
		];
		applyChangeEvents(
			qc,
			allKinds.map((kind) => ev({ kind, namespace: 'team-a', name: 'app-1' }))
		);
		expect(invalidated('clusterInfo')).toBe(false);
	});

	it('one batch, mixed kinds — each invalidation is scoped to exactly what its OWN kind should touch', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'HealthCheck', namespace: 'team-a', name: 'hello-probe' }),
			ev({ kind: 'Kustomization', namespace: 'team-a', name: 'kust-b' })
		]);
		assertOnly(invalidated, ['healthChecksA1', 'fleetAll', 'fleetNsA', 'managedResourcesKustB']);
	});
});
