import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import {
	applyChangeEvents,
	_resetThrottleForTests,
	type ChangeEvent,
	type ChangeEventDerived
} from './events';
import type { DeploymentChildrenResponse } from './rollouts';
import type { ManagedResourceStatus } from '../../types';

// `cluster` defaults to the hub's own name — every fixture below that doesn't
// say otherwise is a hub-local event, matching the contract ("hub-local
// events carry the hub's name").
const ev = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'Rollout',
	namespace: 'team-a',
	name: 'app-1',
	cluster: 'hub',
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
		rolloutA1: ['rollout', 'team-a', 'app-1', 'hub'],
		rolloutA2: ['rollout', 'team-a', 'app-2', 'hub'], // same ns/cluster, different rollout
		rolloutB1: ['rollout', 'team-b', 'app-1', 'hub'], // different ns, same name
		// ⭐ SAME namespace/name as rolloutA1, DIFFERENT cluster — the exact
		// collision the multi-cluster fan-in must not confuse. A hub-local
		// `Rollout` event for team-a/app-1 must invalidate rolloutA1 and must
		// NOT invalidate this one, and vice versa.
		rolloutA1SpokeA: ['rollout', 'team-a', 'app-1', 'spoke-a'],
		permissionsA1: ['rollout-permissions', 'team-a', 'app-1', 'hub'],
		testsA1: ['rollout-tests', 'team-a', 'app-1', 'hub'],
		testsA1SpokeA: ['rollout-tests', 'team-a', 'app-1', 'spoke-a'],
		scheduleWindowA1: ['rollout-schedule-window', 'team-a', 'app-1', ''],
		healthChecksA1: ['health-checks', 'team-a', 'app-1', 'hub'],
		healthChecksA1SpokeA: ['health-checks', 'team-a', 'app-1', 'spoke-a'],
		eventsA1: ['events', 'team-a', 'app-1', 'hub'],
		managedResourcesKustA: ['managed-resources', 'team-a', 'app-1', 'hub', ['kust-a']],
		managedResourcesKustB: ['managed-resources', 'team-a', 'app-1', 'hub', ['kust-b']],
		managedResourcesOtherNs: ['managed-resources', 'team-b', 'app-1', 'hub', ['kust-a']],
		managedResourcesKustASpokeA: ['managed-resources', 'team-a', 'app-1', 'spoke-a', ['kust-a']],
		networkSchedules: ['network-schedules', ['', 'spoke-a']],
		clusterInfo: ['cluster-info'],
		// ⭐ `deployment-children` — cluster sits at index 1, not last (see
		// `deploymentChildrenQueryKey` in rollouts.ts).
		depChildrenDep1: ['deployment-children', 'hub', 'team-a', 'dep-1'],
		depChildrenDep2: ['deployment-children', 'hub', 'team-a', 'dep-2'], // same ns/cluster, different deployment
		depChildrenDep1OtherNs: ['deployment-children', 'hub', 'team-b', 'dep-1'], // different namespace
		depChildrenDep1SpokeA: ['deployment-children', 'spoke-a', 'team-a', 'dep-1'] // different cluster
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
	| 'rolloutA1SpokeA'
	| 'permissionsA1'
	| 'testsA1'
	| 'testsA1SpokeA'
	| 'scheduleWindowA1'
	| 'healthChecksA1'
	| 'healthChecksA1SpokeA'
	| 'eventsA1'
	| 'managedResourcesKustA'
	| 'managedResourcesKustB'
	| 'managedResourcesOtherNs'
	| 'managedResourcesKustASpokeA'
	| 'networkSchedules'
	| 'clusterInfo'
	| 'depChildrenDep1'
	| 'depChildrenDep2'
	| 'depChildrenDep1OtherNs'
	| 'depChildrenDep1SpokeA';
const ALL_LABELS: Label[] = [
	'fleetAll',
	'fleetNsA',
	'fleetNsB',
	'rolloutA1',
	'rolloutA2',
	'rolloutB1',
	'rolloutA1SpokeA',
	'permissionsA1',
	'testsA1',
	'testsA1SpokeA',
	'scheduleWindowA1',
	'healthChecksA1',
	'healthChecksA1SpokeA',
	'eventsA1',
	'managedResourcesKustA',
	'managedResourcesKustB',
	'managedResourcesOtherNs',
	'managedResourcesKustASpokeA',
	'networkSchedules',
	'clusterInfo',
	'depChildrenDep1',
	'depChildrenDep2',
	'depChildrenDep1OtherNs',
	'depChildrenDep1SpokeA'
];

function assertOnly(invalidated: (l: Label) => boolean, expectedTrue: Label[]) {
	for (const label of ALL_LABELS) {
		expect(invalidated(label), `${label} invalidated=${invalidated(label)}`).toBe(
			expectedTrue.includes(label)
		);
	}
}

describe('applyChangeEvents — mapping SSE change events to TanStack invalidations, PER KIND', () => {
	// ⭐ `deployment-children`/`managed-resources` invalidation is throttled
	// per TARGET STRING now (`throttledInvalidate`, keyed e.g.
	// `deployment-children|hub|team-a|dep-1`), and that state is module-level
	// — several `it()`s below reuse the SAME target (same namespace/cluster/
	// deployment fixtures throughout this file), so without a reset the
	// SECOND test to touch a given target would land inside the first test's
	// still-open throttle window and get a scheduled trailing timer instead
	// of the synchronous leading-edge invalidate every assertion here
	// expects. Reset before every test, not just once.
	beforeEach(() => {
		_resetThrottleForTests();
	});

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

	// ── ⭐ MULTI-CLUSTER — the collision case. Two clusters can each host a
	// Rollout named team-a/app-1 (a spoke-hosted rollout and a hub-local one
	// of the same name), and their caches must not cross-invalidate. The
	// fleet list is the one exception: it aggregates every cluster, so it
	// still flips for a spoke's own event. ──
	it("a hub-local Rollout event does not invalidate a SPOKE's rollout of the same namespace/name", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Rollout', namespace: 'team-a', name: 'app-1', cluster: 'hub' })]);
		assertOnly(invalidated, ['fleetAll', 'fleetNsA', 'rolloutA1']);
		expect(invalidated('rolloutA1SpokeA')).toBe(false);
	});

	it("a SPOKE's Rollout event invalidates only that spoke's entry, not the hub's same-named one", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'Rollout', namespace: 'team-a', name: 'app-1', cluster: 'spoke-a' })
		]);
		assertOnly(invalidated, ['fleetAll', 'fleetNsA', 'rolloutA1SpokeA']);
		expect(invalidated('rolloutA1')).toBe(false);
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

	it("a HealthCheck event on one cluster does not invalidate a DIFFERENT cluster's health-checks entry", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'HealthCheck', namespace: 'team-a', name: 'hello-probe', cluster: 'spoke-a' })
		]);
		assertOnly(invalidated, ['healthChecksA1SpokeA']);
		expect(invalidated('healthChecksA1')).toBe(false);
	});

	it("a RolloutTest event on one cluster does not invalidate a DIFFERENT cluster's rollout-tests entry", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'RolloutTest', namespace: 'team-a', name: 'some-test', cluster: 'spoke-a' })
		]);
		assertOnly(invalidated, ['testsA1SpokeA']);
		expect(invalidated('testsA1')).toBe(false);
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

	it("a hub-local Kustomization event does not touch a SPOKE's managed-resources entry for the same kustomization name", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'Kustomization', namespace: 'team-a', name: 'kust-a', cluster: 'hub' })
		]);
		expect(invalidated('managedResourcesKustA')).toBe(true);
		expect(invalidated('managedResourcesKustASpokeA')).toBe(false);
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
			'OCIRepository',
			'Deployment',
			'ReplicaSet'
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
			'OCIRepository',
			'Deployment',
			'ReplicaSet'
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
			'OCIRepository',
			'Deployment',
			'ReplicaSet'
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

	// ── Deployment / ReplicaSet: `deployment-children` (ResourcesCard's
	// expanded-pods panel), replacing that component's own hand-rolled
	// `setInterval` poll. Neither touches the fleet list or the exact
	// `rollout` entry — a Deployment/ReplicaSet event names a workload, not
	// the kuberik Rollout that owns its Kustomization. ──
	it('Deployment invalidates its own deployment-children entry and every managed-resources entry in its namespace+cluster', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [ev({ kind: 'Deployment', namespace: 'team-a', name: 'dep-1' })]);
		assertOnly(invalidated, ['depChildrenDep1', 'managedResourcesKustA', 'managedResourcesKustB']);
	});

	it("a Deployment event does not touch a DIFFERENT deployment's children, a different namespace, or a different cluster", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'Deployment', namespace: 'team-a', name: 'dep-1', cluster: 'hub' })
		]);
		expect(invalidated('depChildrenDep2')).toBe(false);
		expect(invalidated('depChildrenDep1OtherNs')).toBe(false);
		expect(invalidated('depChildrenDep1SpokeA')).toBe(false);
		expect(invalidated('managedResourcesOtherNs')).toBe(false);
		expect(invalidated('managedResourcesKustASpokeA')).toBe(false);
	});

	it('ReplicaSet with an ownerReferences Deployment invalidates ONLY that owner’s children — not managed-resources, not a sibling deployment', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({
				kind: 'ReplicaSet',
				namespace: 'team-a',
				name: 'dep-1-7c9f8b',
				object: {
					metadata: {
						name: 'dep-1-7c9f8b',
						namespace: 'team-a',
						ownerReferences: [{ kind: 'Deployment', name: 'dep-1' }]
					}
				}
			})
		]);
		assertOnly(invalidated, ['depChildrenDep1']);
	});

	it('ReplicaSet with NO object (delete, or dropped for size) falls back to every deployment-children entry in its namespace+cluster', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ type: 'delete', kind: 'ReplicaSet', namespace: 'team-a', name: 'dep-1-7c9f8b' })
		]);
		assertOnly(invalidated, ['depChildrenDep1', 'depChildrenDep2']);
	});

	it('ReplicaSet with an object that names no Deployment owner ALSO falls back to the namespace (not silently ignored)', () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({
				kind: 'ReplicaSet',
				namespace: 'team-a',
				name: 'orphan-rs',
				object: {
					metadata: {
						name: 'orphan-rs',
						namespace: 'team-a',
						ownerReferences: [{ kind: 'StatefulSet', name: 'not-a-deployment' }]
					}
				}
			})
		]);
		assertOnly(invalidated, ['depChildrenDep1', 'depChildrenDep2']);
	});

	it("the ReplicaSet fallback stays scoped to its OWN cluster — a hub-local orphan ReplicaSet does not touch a spoke's deployment-children", () => {
		const { qc, invalidated } = seededClient();
		applyChangeEvents(qc, [
			ev({ kind: 'ReplicaSet', namespace: 'team-a', name: 'orphan-rs', cluster: 'hub' })
		]);
		expect(invalidated('depChildrenDep1SpokeA')).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// DERIVED PUSH — PERF-2026-09-04 "Workloads on the stream" follow-up.
//
// `ChangeEvent.derived` lets a Deployment/ReplicaSet event carry the
// backend's OWN precomputed `deployment-children`/`managed-resources`
// response instead of just enough identity to invalidate. These tests seed
// realistically-shaped caches (not the `{ seeded: true }` stand-in the suite
// above uses, which the identity-matching logic below would reject as
// malformed) and assert the cache is PATCHED — content changed, no fetch
// triggered — rather than merely marked stale.
// ─────────────────────────────────────────────────────────────────────────
describe('applyChangeEvents — derived push (Deployment/ReplicaSet `derived.children`/`derived.managedResource`)', () => {
	beforeEach(() => {
		_resetThrottleForTests();
	});

	function childrenResponse(overrides: Partial<DeploymentChildrenResponse> = {}): DeploymentChildrenResponse {
		return {
			replicaSets: [
				{ name: 'dep-1-aaa', desiredReplicas: 2, readyReplicas: 2, replicas: 2, isCurrentRS: true }
			],
			...overrides
		};
	}

	function managedResource(overrides: Partial<ManagedResourceStatus> = {}): ManagedResourceStatus {
		return {
			groupVersionKind: 'apps/v1/Deployment',
			name: 'dep-1',
			namespace: 'team-a',
			status: 'Current',
			message: 'Deployment is available.',
			lastModified: '2026-09-04T00:00:00Z',
			...overrides
		};
	}

	function deployment(derived?: ChangeEventDerived): ChangeEvent {
		return ev({ kind: 'Deployment', namespace: 'team-a', name: 'dep-1', derived });
	}

	function replicaSet(derived?: ChangeEventDerived, overrides: Partial<ChangeEvent> = {}): ChangeEvent {
		return ev({
			kind: 'ReplicaSet',
			namespace: 'team-a',
			name: 'dep-1-aaa',
			derived,
			...overrides
		});
	}

	// ── `deployment-children` ──

	it('Deployment event with `derived.children` sets the EXACT cache entry with no fetch, and does not invalidate it', () => {
		const qc = new QueryClient();
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		qc.setQueryData(key, childrenResponse({ replicaSets: [] })); // stale — the row was expanded before this update
		const fetchSpy = vi.spyOn(qc, 'fetchQuery');

		const pushed = childrenResponse();
		// `derived.managedResource` provided too — a real Deployment event
		// always carries both (see `ChangeEvent.derived`'s own doc comment) —
		// so this isolates the CHILDREN assertion from the SEPARATE
		// managed-resources fallback a children-only event would legitimately
		// still trigger.
		applyChangeEvents(qc, [deployment({ children: pushed, managedResource: managedResource() })]);

		expect(qc.getQueryData(key)).toEqual(pushed);
		expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('Deployment event with `derived.children` does NOT create a cache entry for a collapsed row', () => {
		const qc = new QueryClient();
		// No `setQueryData` — this row was never expanded, so there is no
		// cache entry to begin with.
		applyChangeEvents(qc, [deployment({ children: childrenResponse() })]);
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		expect(qc.getQueryState(key)).toBeUndefined();
	});

	it('ReplicaSet event with `derived.children` + `derived.ownerDeployment` sets the OWNER\'s exact cache entry with no fetch', () => {
		const qc = new QueryClient();
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		qc.setQueryData(key, childrenResponse({ replicaSets: [] }));
		const fetchSpy = vi.spyOn(qc, 'fetchQuery');
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

		const pushed = childrenResponse();
		applyChangeEvents(qc, [
			replicaSet({ ownerDeployment: { namespace: 'team-a', name: 'dep-1' }, children: pushed })
		]);

		expect(qc.getQueryData(key)).toEqual(pushed);
		expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(invalidateSpy).not.toHaveBeenCalled();
	});

	it('a ReplicaSet delete with `derived.children` applies it (the RS is gone from the pushed list) with no invalidate', () => {
		const qc = new QueryClient();
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		qc.setQueryData(key, childrenResponse()); // has dep-1-aaa
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

		const afterDelete = childrenResponse({ replicaSets: [] }); // backend already excludes it
		applyChangeEvents(qc, [
			replicaSet(
				{ ownerDeployment: { namespace: 'team-a', name: 'dep-1' }, children: afterDelete },
				{ type: 'delete' }
			)
		]);

		expect(qc.getQueryData(key)).toEqual(afterDelete);
		expect(invalidateSpy).not.toHaveBeenCalled();
	});

	it('ReplicaSet fast-path count patch still runs alongside `derived` (no regression to the pre-`derived` behavior)', () => {
		const qc = new QueryClient();
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		qc.setQueryData(key, childrenResponse({ replicaSets: [{ name: 'dep-1-aaa', desiredReplicas: 2, readyReplicas: 1, replicas: 1 }] }));
		applyChangeEvents(qc, [
			ev({
				kind: 'ReplicaSet',
				namespace: 'team-a',
				name: 'dep-1-aaa',
				object: {
					metadata: {
						name: 'dep-1-aaa',
						namespace: 'team-a',
						ownerReferences: [{ kind: 'Deployment', name: 'dep-1' }]
					},
					status: { replicas: 2, readyReplicas: 2 },
					spec: { replicas: 2 }
				}
				// no `derived` — the fast-path count patch is the ONLY thing
				// that should fire here, same as before `derived` existed.
			})
		]);
		const data = qc.getQueryData<DeploymentChildrenResponse>(key);
		expect(data?.replicaSets[0].readyReplicas).toBe(2);
	});

	it('a Deployment event with `derived.children` for cluster A does not touch cluster B\'s cache entry for the same namespace/name', () => {
		const qc = new QueryClient();
		const keyHub = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		const keySpoke = ['deployment-children', 'spoke-a', 'team-a', 'dep-1'];
		qc.setQueryData(keyHub, childrenResponse({ replicaSets: [] }));
		qc.setQueryData(keySpoke, childrenResponse({ replicaSets: [] }));

		applyChangeEvents(qc, [
			ev({
				kind: 'Deployment',
				namespace: 'team-a',
				name: 'dep-1',
				cluster: 'hub',
				derived: { children: childrenResponse() }
			})
		]);

		expect(qc.getQueryData(keyHub)).toEqual(childrenResponse());
		expect(qc.getQueryData(keySpoke)).toEqual(childrenResponse({ replicaSets: [] }));
	});

	it('Deployment event with NO `derived` falls back to the throttled invalidate (unchanged pre-`derived` behavior)', () => {
		const qc = new QueryClient();
		const key = ['deployment-children', 'hub', 'team-a', 'dep-1'];
		qc.setQueryData(key, childrenResponse());
		applyChangeEvents(qc, [deployment()]);
		expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
	});

	// ── `managed-resources` ──

	it('Deployment event with `derived.managedResource` replaces the matching entry in place, other entries untouched, no invalidate', () => {
		const qc = new QueryClient();
		const key = ['managed-resources', 'team-a', 'rollout-1', 'hub', ['kust-a']];
		const otherDeployment = managedResource({ name: 'dep-2' });
		qc.setQueryData(key, {
			'kust-a': [managedResource({ status: 'InProgress', message: 'Rolling out' }), otherDeployment]
		});
		const fetchSpy = vi.spyOn(qc, 'fetchQuery');

		const pushed = managedResource({ status: 'Current', message: 'Deployment is available.' });
		// `derived.children` provided too, matching a real Deployment event's
		// shape — isolates this assertion from the SEPARATE
		// deployment-children fallback a managedResource-only event would
		// legitimately still trigger (no children cache seeded here at all).
		applyChangeEvents(qc, [deployment({ managedResource: pushed, children: childrenResponse() })]);

		const data = qc.getQueryData<Record<string, ManagedResourceStatus[]>>(key);
		expect(data?.['kust-a']).toEqual([pushed, otherDeployment]); // dep-1 replaced, dep-2 untouched
		expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('Deployment event with `derived.managedResource` leaves a DIFFERENT namespace/cluster\'s cache entry byte-identical', () => {
		const qc = new QueryClient();
		const otherNsKey = ['managed-resources', 'team-b', 'rollout-1', 'hub', ['kust-a']];
		const spokeKey = ['managed-resources', 'team-a', 'rollout-1', 'spoke-a', ['kust-a']];
		const otherNsData = { 'kust-a': [managedResource({ namespace: 'team-b' })] };
		const spokeData = { 'kust-a': [managedResource()] };
		qc.setQueryData(otherNsKey, otherNsData);
		qc.setQueryData(spokeKey, spokeData);

		applyChangeEvents(qc, [deployment({ managedResource: managedResource({ status: 'Current' }) })]);

		expect(qc.getQueryData(otherNsKey)).toBe(otherNsData); // same reference — untouched
		expect(qc.getQueryData(spokeKey)).toBe(spokeData); // different cluster — untouched
	});

	it('a Deployment delete removes the managed-resources entry by identity, with no `derived` needed', () => {
		const qc = new QueryClient();
		const key = ['managed-resources', 'team-a', 'rollout-1', 'hub', ['kust-a']];
		const otherDeployment = managedResource({ name: 'dep-2' });
		qc.setQueryData(key, { 'kust-a': [managedResource(), otherDeployment] });

		applyChangeEvents(qc, [
			ev({ kind: 'Deployment', namespace: 'team-a', name: 'dep-1', type: 'delete' })
		]);

		const data = qc.getQueryData<Record<string, ManagedResourceStatus[]>>(key);
		expect(data?.['kust-a']).toEqual([otherDeployment]);
		// A delete carries no `derived.managedResource` (there is no live
		// object to compute a status FROM) — identity alone is enough to
		// remove it, so this cache entry is patched, not merely invalidated.
		expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
	});

	it('Deployment event with NO `derived` falls back to the throttled invalidate for managed-resources (unchanged pre-`derived` behavior)', () => {
		const qc = new QueryClient();
		const key = ['managed-resources', 'team-a', 'rollout-1', 'hub', ['kust-a']];
		qc.setQueryData(key, { 'kust-a': [managedResource()] });
		applyChangeEvents(qc, [deployment()]);
		expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
	});
});
