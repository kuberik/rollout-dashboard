import { describe, it, expect, vi } from 'vitest';
import { applyChangeEvents, type ChangeEvent } from './events';

/**
 * A fake QueryClient that only implements what `applyChangeEvents` calls,
 * recording every `invalidateQueries` call so tests can assert on the exact
 * key/predicate shape without spinning up a real TanStack QueryClient.
 */
function fakeQueryClient() {
	const calls: unknown[] = [];
	return {
		calls,
		invalidateQueries: vi.fn((filter?: unknown) => {
			calls.push(filter);
		})
	};
}

const ev = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'Rollout',
	namespace: 'team-a',
	name: 'app-1',
	resourceVersion: '123',
	ts: 1,
	...overrides
});

describe('applyChangeEvents — mapping SSE change events to TanStack invalidations', () => {
	it('an empty batch invalidates nothing', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, []);
		expect(qc.invalidateQueries).not.toHaveBeenCalled();
	});

	it('a kind this module has never heard of invalidates nothing (not "invalidate everything")', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'SomeFutureCachedType' })]);
		expect(qc.invalidateQueries).not.toHaveBeenCalled();
	});

	it('a Rollout event invalidates the cluster-wide fleet list', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'Rollout' })]);
		expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'all'] });
	});

	it('a Rollout event invalidates the per-namespace fleet list for its own namespace', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'Rollout', namespace: 'team-a' })]);
		expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'namespace', 'team-a'] });
	});

	it('one event per distinct namespace in the batch, not one call per event', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [
			ev({ kind: 'Rollout', namespace: 'team-a', name: 'a' }),
			ev({ kind: 'Rollout', namespace: 'team-a', name: 'b' }),
			ev({ kind: 'Environment', namespace: 'team-b', name: 'c' })
		]);
		expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'namespace', 'team-a'] });
		expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'namespace', 'team-b'] });
		// 'rollouts'/'all' once + 2 distinct per-namespace calls + 1 predicate call.
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(4);
	});

	// The event only carries the CHANGED OBJECT's own namespace/name — for a
	// RolloutGate/Environment/HealthCheck/schedule object that is NOT the
	// rollout's own name, so "the affected rollout's keys" is approximated by
	// namespace: invalidate every per-rollout query cached for that
	// namespace, via the predicate passed to invalidateQueries.
	const perRolloutTags = [
		'rollout',
		'rollout-permissions',
		'rollout-tests',
		'rollout-schedule-window',
		'health-checks',
		'events',
		'managed-resources'
	];

	function runPredicate(qc: ReturnType<typeof fakeQueryClient>, queryKey: unknown[]) {
		const predicateCall = qc.calls.find(
			(c): c is { predicate: (q: { queryKey: unknown[] }) => boolean } =>
				typeof (c as { predicate?: unknown })?.predicate === 'function'
		);
		if (!predicateCall) throw new Error('no predicate-shaped invalidateQueries call found');
		return predicateCall.predicate({ queryKey });
	}

	for (const kind of ['Environment', 'RolloutDependency', 'RolloutGate', 'RolloutSchedule', 'ClusterRolloutSchedule', 'HealthCheck']) {
		it(`a ${kind} event's predicate matches every per-rollout key tag in its namespace`, () => {
			const qc = fakeQueryClient();
			applyChangeEvents(qc as never, [ev({ kind, namespace: 'team-a', name: 'some-gate-xyz' })]);
			for (const tag of perRolloutTags) {
				expect(runPredicate(qc, [tag, 'team-a', 'app-1'])).toBe(true);
			}
		});
	}

	it("the predicate does not match a different namespace's per-rollout keys", () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'RolloutGate', namespace: 'team-a' })]);
		expect(runPredicate(qc, ['rollout', 'team-b', 'app-1'])).toBe(false);
	});

	it('the predicate does not match unrelated query keys sharing a namespace-shaped second element', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'Rollout', namespace: 'team-a' })]);
		// ['rollouts', 'namespace', 'team-a'] has 'namespace' (not a per-rollout
		// tag) at index 0 — must not be matched by the predicate (it's already
		// invalidated directly, above, by exact key).
		expect(runPredicate(qc, ['rollouts', 'namespace', 'team-a'])).toBe(false);
		// ['cluster-info'] is too short to have a namespace slot at all.
		expect(runPredicate(qc, ['cluster-info'])).toBe(false);
	});

	it('Kustomization/OCIRepository/KruiseRollout/RolloutTest events (also streamed by the backend) are handled the same way', () => {
		for (const kind of ['Kustomization', 'OCIRepository', 'KruiseRollout', 'RolloutTest']) {
			const qc = fakeQueryClient();
			applyChangeEvents(qc as never, [ev({ kind, namespace: 'team-a' })]);
			expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'all'] });
		}
	});

	// `network-schedules` (`ControlCenter`, `/dependencies`, the rollout
	// Dependencies tab's `fetchNetworkSchedules`) is keyed
	// `['network-schedules', clusterNames]` — cluster-wide, no namespace slot,
	// so it can never be reached by the namespace predicate above. See
	// `SCHEDULE_KINDS`'s own comment in `events.ts`.
	function matchesNetworkSchedules(qc: ReturnType<typeof fakeQueryClient>): boolean {
		return qc.calls.some((c) => {
			const predicate = (c as { predicate?: (q: { queryKey: unknown[] }) => boolean })?.predicate;
			return typeof predicate === 'function' && predicate({ queryKey: ['network-schedules', ['', 'spoke-a']] });
		});
	}

	it('a RolloutSchedule event (namespaced) invalidates network-schedules in addition to the namespace-scoped keys', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'RolloutSchedule', namespace: 'team-a' })]);
		expect(qc.calls).toContainEqual({ queryKey: ['rollouts', 'all'] });
		expect(matchesNetworkSchedules(qc)).toBe(true);
	});

	// ⛔ THE REGRESSION THIS GUARDS: a ClusterRolloutSchedule is cluster-scoped
	// BY DEFINITION, so its own ChangeEvent always carries `namespace: ""` —
	// the ORIGINAL loop's `ev.namespace` truthiness check silently dropped
	// these events entirely, and a schedule window opening/closing on a
	// cluster-wide schedule never invalidated anything.
	it('a ClusterRolloutSchedule event with an EMPTY namespace (cluster-scoped) still invalidates network-schedules', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'ClusterRolloutSchedule', namespace: '' })]);
		expect(matchesNetworkSchedules(qc)).toBe(true);
		// No namespace was carried, so the namespace-keyed invalidations must
		// not fire — there is nothing to key them on.
		expect(qc.calls).not.toContainEqual({ queryKey: ['rollouts', 'all'] });
	});

	it('a non-schedule event does not invalidate network-schedules', () => {
		const qc = fakeQueryClient();
		applyChangeEvents(qc as never, [ev({ kind: 'Rollout', namespace: 'team-a' })]);
		expect(matchesNetworkSchedules(qc)).toBe(false);
	});
});
