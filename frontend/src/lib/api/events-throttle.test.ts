import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import {
	applyChangeEvents,
	throttledInvalidate,
	_resetThrottleForTests,
	type ChangeEvent
} from './events';
import { deploymentChildrenQueryKey, type DeploymentChildrenResponse } from './rollouts';

/**
 * PERF-2026-09-04 §C.7 churn follow-up — `throttledInvalidate` (a leading +
 * trailing throttle keyed by an arbitrary string) and its two call sites,
 * `deployment-children`/`managed-resources` invalidation during a rolling
 * update. `events.test.ts` covers the per-kind invalidation MAP with
 * synchronous, single-event assertions (the throttle's own leading edge
 * fires synchronously, so those stay valid unmodified); this file is the
 * throttle's own timing behavior, which needs fake timers.
 */

const ev = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'ReplicaSet',
	namespace: 'team-a',
	name: 'dep-1-7c9f8b',
	cluster: 'hub',
	resourceVersion: '1',
	ts: 1,
	...overrides
});

const rsObject = (overrides: {
	replicas?: number;
	readyReplicas?: number;
	desiredReplicas?: number;
	name?: string;
} = {}) => ({
	metadata: {
		name: overrides.name ?? 'dep-1-7c9f8b',
		namespace: 'team-a',
		ownerReferences: [{ kind: 'Deployment', name: 'dep-1' }]
	},
	status: {
		replicas: overrides.replicas ?? 3,
		readyReplicas: overrides.readyReplicas ?? 3
	},
	spec: {
		replicas: overrides.desiredReplicas ?? 3
	}
});

describe('throttledInvalidate — leading + trailing, keyed', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		_resetThrottleForTests();
	});
	afterEach(() => {
		_resetThrottleForTests();
		vi.useRealTimers();
	});

	it('a single call runs immediately (leading) and schedules nothing else', () => {
		const run = vi.fn();
		throttledInvalidate({} as never, 'k', 2000, run);
		expect(run).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(5000);
		expect(run).toHaveBeenCalledTimes(1); // no phantom trailing run
	});

	it('N calls inside one 2s window collapse to exactly 2 runs — leading + trailing', () => {
		const run = vi.fn();
		throttledInvalidate({} as never, 'k', 2000, run); // t=0, leading
		vi.advanceTimersByTime(200);
		throttledInvalidate({} as never, 'k', 2000, run); // t=200, schedules trailing
		vi.advanceTimersByTime(200);
		throttledInvalidate({} as never, 'k', 2000, run); // t=400, already scheduled
		vi.advanceTimersByTime(200);
		throttledInvalidate({} as never, 'k', 2000, run); // t=600, already scheduled
		expect(run).toHaveBeenCalledTimes(1); // only the leading run so far
		vi.advanceTimersByTime(2000 - 600); // t=2000, trailing fires
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('spacing is preserved after the window — sustained churn settles to one run per window', () => {
		const run = vi.fn();
		// Fire an event every 100ms for 6 seconds — three 2s windows.
		for (let t = 0; t <= 6000; t += 100) {
			throttledInvalidate({} as never, 'k', 2000, run);
			vi.advanceTimersByTime(100);
		}
		// leading@0, trailing@~2000, trailing@~4000, trailing@~6000.
		expect(run).toHaveBeenCalledTimes(4);
	});

	it('a key going quiet for a full window resumes on the next call\'s leading edge', () => {
		const run = vi.fn();
		throttledInvalidate({} as never, 'k', 2000, run); // t=0, leading
		vi.advanceTimersByTime(3000); // fully idle past the window, no further calls
		expect(run).toHaveBeenCalledTimes(1); // no trailing fired — nothing scheduled it
		throttledInvalidate({} as never, 'k', 2000, run); // t=3000, leading again (idle > ms)
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('two different keys throttle independently', () => {
		const run = vi.fn();
		throttledInvalidate({} as never, 'a', 2000, run);
		throttledInvalidate({} as never, 'b', 2000, run);
		expect(run).toHaveBeenCalledTimes(2); // both lead immediately, unrelated keys
	});

	it('ms <= 0 always runs immediately, no throttling', () => {
		const run = vi.fn();
		throttledInvalidate({} as never, 'k', 0, run);
		throttledInvalidate({} as never, 'k', 0, run);
		throttledInvalidate({} as never, 'k', 0, run);
		expect(run).toHaveBeenCalledTimes(3);
	});
});

describe('applyChangeEvents — deployment-children churn during a rollout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		_resetThrottleForTests();
	});
	afterEach(() => {
		_resetThrottleForTests();
		vi.useRealTimers();
	});

	function seeded() {
		const qc = new QueryClient();
		const key = deploymentChildrenQueryKey('team-a', 'dep-1', 'hub');
		const seed: DeploymentChildrenResponse = {
			replicaSets: [{ name: 'dep-1-7c9f8b', desiredReplicas: 3, readyReplicas: 1, isCurrentRS: true }]
		};
		qc.setQueryData(key, seed);
		return { qc, key };
	}

	it('a burst of ReplicaSet events within 2s patches counts on every event but invalidates at most twice', () => {
		const { qc, key } = seeded();
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

		applyChangeEvents(qc, [ev({ object: rsObject({ readyReplicas: 1 }) })]);
		expect(qc.getQueryData<DeploymentChildrenResponse>(key)?.replicaSets[0].readyReplicas).toBe(1);

		vi.advanceTimersByTime(300);
		applyChangeEvents(qc, [ev({ object: rsObject({ readyReplicas: 2 }) })]);
		expect(qc.getQueryData<DeploymentChildrenResponse>(key)?.replicaSets[0].readyReplicas).toBe(2);

		vi.advanceTimersByTime(300);
		applyChangeEvents(qc, [ev({ object: rsObject({ readyReplicas: 3 }) })]);
		expect(qc.getQueryData<DeploymentChildrenResponse>(key)?.replicaSets[0].readyReplicas).toBe(3);

		// Counts moved on every single event above with zero network cost —
		// `setQueriesData` never calls `invalidateQueries`. Only the throttled
		// invalidate (scheduled by the FIRST event, still pending) has run so far.
		expect(invalidateSpy).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2000); // let the trailing invalidate fire
		expect(invalidateSpy).toHaveBeenCalledTimes(2);

		// No further events, no further calls — idle is quiet.
		vi.advanceTimersByTime(10_000);
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});

	it('a lone ReplicaSet event (no churn) still patches and invalidates exactly once', () => {
		const { qc, key } = seeded();
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

		applyChangeEvents(qc, [ev({ object: rsObject({ readyReplicas: 3 }) })]);

		expect(qc.getQueryData<DeploymentChildrenResponse>(key)?.replicaSets[0].readyReplicas).toBe(3);
		expect(invalidateSpy).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(10_000);
		expect(invalidateSpy).toHaveBeenCalledTimes(1); // no phantom trailing run
	});

	it('isCurrentRS and the pods list are left untouched by the patch — only counts move', () => {
		const { qc, key } = seeded();
		applyChangeEvents(qc, [ev({ object: rsObject({ readyReplicas: 2 }) })]);
		const rs = qc.getQueryData<DeploymentChildrenResponse>(key)!.replicaSets[0];
		expect(rs.isCurrentRS).toBe(true); // unchanged from the seed
		expect(rs.pods).toBeUndefined(); // unchanged from the seed
	});

	it('a ReplicaSet this cache does not know about is left alone by the patch (discovered by the invalidate instead)', () => {
		const { qc, key } = seeded();
		applyChangeEvents(qc, [
			ev({ name: 'dep-1-newrev', object: rsObject({ name: 'dep-1-newrev', readyReplicas: 1 }) })
		]);
		const data = qc.getQueryData<DeploymentChildrenResponse>(key)!;
		expect(data.replicaSets).toHaveLength(1); // still just the seeded one
		expect(data.replicaSets[0].name).toBe('dep-1-7c9f8b');
	});

	it('two DIFFERENT deployments churning at once throttle independently, not as one shared window', () => {
		const qc = new QueryClient();
		const key1 = deploymentChildrenQueryKey('team-a', 'dep-1', 'hub');
		const key2 = deploymentChildrenQueryKey('team-a', 'dep-2', 'hub');
		qc.setQueryData<DeploymentChildrenResponse>(key1, {
			replicaSets: [{ name: 'dep-1-rs', desiredReplicas: 1, readyReplicas: 0 }]
		});
		qc.setQueryData<DeploymentChildrenResponse>(key2, {
			replicaSets: [{ name: 'dep-2-rs', desiredReplicas: 1, readyReplicas: 0 }]
		});
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

		applyChangeEvents(qc, [
			ev({
				name: 'dep-1-rs',
				object: rsObject({ name: 'dep-1-rs', readyReplicas: 1 })
			})
		]);
		applyChangeEvents(qc, [
			ev({
				name: 'dep-2-rs',
				object: {
					...rsObject({ name: 'dep-2-rs', readyReplicas: 1 }),
					metadata: {
						name: 'dep-2-rs',
						namespace: 'team-a',
						ownerReferences: [{ kind: 'Deployment', name: 'dep-2' }]
					}
				}
			})
		]);
		// Both are independent leading edges — two calls, not one throttled down.
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});
});
