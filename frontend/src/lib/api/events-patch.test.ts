/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { applyChangeEvents, type ChangeEvent } from './events';
import { fleet, CLUSTERS } from '../messages/fleet-fixture';
import { rolloutsListQueryKey, rolloutQueryKey, type RolloutsListResponse } from './rollouts';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';

/**
 * PERF-2026-09-04 §C.7 event-object follow-up — `applyChangeEvents` now
 * PATCHES caches in place when an event carries `object`, instead of only
 * invalidating them (which forces a network refetch). `events.test.ts`
 * covers the pre-existing invalidate mapping (still exercised by every event
 * here that omits `object`, byte-for-byte unchanged); this file is the new
 * behavior only — seeded with the SAME fixture the message-scan suite uses,
 * so "the cache equals what a refetch would produce" is checked against a
 * real `RolloutsListResponse`/`RolloutResponse` shape, not a hand-rolled
 * stand-in.
 */
const ev = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'Rollout',
	namespace: '',
	name: '',
	cluster: CLUSTERS[0],
	resourceVersion: '999',
	ts: 2,
	...overrides
});

function findRollout(payload: any, name: string, namespace: string) {
	return payload.rollouts.items.find(
		(r: any) => r.metadata.name === name && r.metadata.namespace === namespace
	);
}

describe('applyChangeEvents — patch from object, fleet list', () => {
	it('a Rollout update upserts the fleet list entry to exactly what a refetch would return', () => {
		const before = fleet(); // default: every rollout held by an approval gate
		const after = fleet((app, tier) =>
			app === 'alpha-app' && tier === 'dev'
				? { hold: 'approval', pinned: 'r3ccccc' }
				: { hold: 'approval' }
		);
		const targetBefore = findRollout(before, 'alpha-app', 'alpha-dev');
		const targetAfter = findRollout(after, 'alpha-app', 'alpha-dev');
		expect(targetBefore).not.toEqual(targetAfter); // the fixture actually changed something

		const qc = new QueryClient();
		qc.setQueryData(rolloutsListQueryKey, before);

		applyChangeEvents(qc, [
			ev({
				kind: 'Rollout',
				namespace: 'alpha-dev',
				name: 'alpha-app',
				cluster: CLUSTERS[0],
				object: targetAfter
			})
		]);

		const cached = qc.getQueryData<RolloutsListResponse>(rolloutsListQueryKey)!;
		const patched = findRollout(cached, 'alpha-app', 'alpha-dev');
		// Exactly what fleet() itself produces for the "after" shape — not an
		// approximation of it.
		expect(patched).toEqual(targetAfter);
		expect((patched as any).metadata.annotations[SOURCE_CLUSTER_ANNOTATION]).toBe(CLUSTERS[0]);

		// Every OTHER item is untouched (same reference — nothing was rebuilt
		// for a change that doesn't concern it).
		const untouchedBefore = before.rollouts.items.filter((r: any) => r !== targetBefore);
		const untouchedAfter = cached.rollouts.items.filter((r: any) => r !== patched);
		expect(untouchedAfter).toEqual(untouchedBefore);
		for (const item of untouchedAfter) {
			expect(untouchedBefore).toContain(item); // same references, not just equal
		}

		// The whole point: a patch, not a refetch trigger.
		expect(qc.getQueryState(rolloutsListQueryKey)?.isInvalidated).toBe(false);
	});

	it("a Rollout on a DIFFERENT cluster does not overwrite the same-named rollout on this one", () => {
		const before = fleet();
		const qc = new QueryClient();
		qc.setQueryData(rolloutsListQueryKey, before);

		const target = findRollout(before, 'alpha-app', 'alpha-dev'); // lives on CLUSTERS[0]
		const foreignObject = { ...target, spec: { wantedVersion: 'IMPOSTER' } };

		applyChangeEvents(qc, [
			ev({
				kind: 'Rollout',
				namespace: 'alpha-dev',
				name: 'alpha-app',
				cluster: CLUSTERS[1], // wrong cluster for this rollout
				object: foreignObject
			})
		]);

		const cached = qc.getQueryData<RolloutsListResponse>(rolloutsListQueryKey)!;
		// Not overwritten in place...
		expect(findRollout(cached, 'alpha-app', 'alpha-dev')).toEqual(target);
		// ...and not silently dropped either — appended as a distinct entry
		// for its own (namespace, name, cluster) identity, exactly as a
		// real second cluster hosting a same-named rollout would appear in
		// a genuine refetch.
		expect(cached.rollouts.items).toHaveLength(before.rollouts.items.length + 1);
	});

	it('a Rollout delete removes exactly that entry and nothing else', () => {
		const before = fleet();
		const qc = new QueryClient();
		qc.setQueryData(rolloutsListQueryKey, before);
		const target = findRollout(before, 'beta-app', 'beta-staging');

		applyChangeEvents(qc, [
			ev({
				type: 'delete',
				kind: 'Rollout',
				namespace: 'beta-staging',
				name: 'beta-app',
				cluster: CLUSTERS[1] // beta-app is on CLUSTERS[1] (i=1, 1 % 2)
			})
		]);

		const cached = qc.getQueryData<RolloutsListResponse>(rolloutsListQueryKey)!;
		expect(cached.rollouts.items).toHaveLength(before.rollouts.items.length - 1);
		expect(findRollout(cached, 'beta-app', 'beta-staging')).toBeUndefined();
		// Everything else survives, CONTENT-identical (exactly what a refetch
		// minus this one entry would produce). Not a reference check past this
		// point: TanStack's own structural-sharing walks the two arrays
		// POSITIONALLY, and removing an entry shifts every later index, so an
		// untouched item can legitimately come back as an equal-but-rebuilt
		// object rather than the literal same reference — that's a
		// TanStack Query mechanism, not something this patch controls.
		expect(cached.rollouts.items).toEqual(
			before.rollouts.items.filter((item: any) => item !== target)
		);
		expect(qc.getQueryState(rolloutsListQueryKey)?.isInvalidated).toBe(false);
	});

	it('a delete for an entry that was never cached is a harmless no-op', () => {
		const before = fleet();
		const qc = new QueryClient();
		qc.setQueryData(rolloutsListQueryKey, before);

		applyChangeEvents(qc, [
			ev({ type: 'delete', kind: 'Rollout', namespace: 'ghost-ns', name: 'ghost-app' })
		]);

		const cached = qc.getQueryData<RolloutsListResponse>(rolloutsListQueryKey)!;
		expect(cached).toBe(before); // untouched, same reference
		expect(qc.getQueryState(rolloutsListQueryKey)?.isInvalidated).toBe(false);
	});

	it('an Environment update with an object upserts environments.items without touching rollouts.items', () => {
		const before = fleet();
		const qc = new QueryClient();
		qc.setQueryData(rolloutsListQueryKey, before);
		const envBefore = before.environments.items.find(
			(e: any) => e.metadata.name === 'alpha-app-dev'
		);
		const envAfter = { ...envBefore, spec: { ...envBefore.spec, note: 'changed' } };

		applyChangeEvents(qc, [
			ev({
				kind: 'Environment',
				namespace: 'alpha-dev',
				name: 'alpha-app-dev',
				cluster: CLUSTERS[0],
				object: envAfter
			})
		]);

		const cached = qc.getQueryData<RolloutsListResponse>(rolloutsListQueryKey)!;
		const patched = cached.environments!.items.find((e: any) => e.metadata.name === 'alpha-app-dev');
		expect((patched as any).spec.note).toBe('changed');
		expect(cached.rollouts.items).toEqual(before.rollouts.items);
	});
});

describe('applyChangeEvents — patch from object, rollout detail composite', () => {
	function seedRolloutDetail(qc: QueryClient, ns: string, name: string, cluster: string, data: any) {
		qc.setQueryData(rolloutQueryKey(ns, name, cluster), data);
	}

	it("a Rollout update replaces the composite's .rollout field", () => {
		const before = fleet();
		const target = findRollout(before, 'alpha-app', 'alpha-dev');
		const updated = { ...target, spec: { wantedVersion: 'r3ccccc' } };

		const qc = new QueryClient();
		seedRolloutDetail(qc, 'alpha-dev', 'alpha-app', CLUSTERS[0], {
			rollout: target,
			environment: null,
			rolloutGates: { items: [] }
		});

		applyChangeEvents(qc, [
			ev({
				kind: 'Rollout',
				namespace: 'alpha-dev',
				name: 'alpha-app',
				cluster: CLUSTERS[0],
				object: updated
			})
		]);

		const cached = qc.getQueryData<any>(rolloutQueryKey('alpha-dev', 'alpha-app', CLUSTERS[0]));
		expect(cached.rollout).toEqual(updated);
		expect(
			qc.getQueryState(rolloutQueryKey('alpha-dev', 'alpha-app', CLUSTERS[0]))?.isInvalidated
		).toBe(false);
	});

	it('a Rollout delete does NOT patch the composite — it falls to the existing invalidate path', () => {
		const before = fleet();
		const target = findRollout(before, 'alpha-app', 'alpha-dev');
		const qc = new QueryClient();
		seedRolloutDetail(qc, 'alpha-dev', 'alpha-app', CLUSTERS[0], {
			rollout: target,
			rolloutGates: { items: [] }
		});

		applyChangeEvents(qc, [
			ev({
				type: 'delete',
				kind: 'Rollout',
				namespace: 'alpha-dev',
				name: 'alpha-app',
				cluster: CLUSTERS[0]
			})
		]);

		// Unchanged in place (a delete has nothing sensible to patch WITH)...
		const cached = qc.getQueryData<any>(rolloutQueryKey('alpha-dev', 'alpha-app', CLUSTERS[0]));
		expect(cached.rollout).toEqual(target);
		// ...but genuinely invalidated, so the page refetches into its own
		// 404/error state instead of silently going stale.
		expect(
			qc.getQueryState(rolloutQueryKey('alpha-dev', 'alpha-app', CLUSTERS[0]))?.isInvalidated
		).toBe(true);
	});

	it('a Kustomization update replaces the matching entry in kustomizations.items', () => {
		const qc = new QueryClient();
		const rolloutKey = rolloutQueryKey('team-a', 'app-1', 'hub');
		qc.setQueryData(rolloutKey, {
			rollout: { metadata: { name: 'app-1', namespace: 'team-a' } },
			kustomizations: {
				items: [
					{ metadata: { name: 'kust-a', namespace: 'team-a' }, status: { ready: false } },
					{ metadata: { name: 'kust-b', namespace: 'team-a' }, status: { ready: true } }
				]
			}
		});

		applyChangeEvents(qc, [
			ev({
				kind: 'Kustomization',
				namespace: 'team-a',
				name: 'kust-a',
				cluster: 'hub',
				object: { metadata: { name: 'kust-a', namespace: 'team-a' }, status: { ready: true } }
			})
		]);

		const cached = qc.getQueryData<any>(rolloutKey);
		expect(cached.kustomizations.items).toEqual([
			{ metadata: { name: 'kust-a', namespace: 'team-a' }, status: { ready: true } },
			{ metadata: { name: 'kust-b', namespace: 'team-a' }, status: { ready: true } }
		]);
		expect(qc.getQueryState(rolloutKey)?.isInvalidated).toBe(false);
	});

	it('a Kustomization update for a name NOT in this composite leaves it untouched and un-invalidated', () => {
		const qc = new QueryClient();
		const rolloutKey = rolloutQueryKey('team-a', 'app-1', 'hub');
		const seeded = {
			rollout: { metadata: { name: 'app-1', namespace: 'team-a' } },
			kustomizations: { items: [{ metadata: { name: 'kust-a', namespace: 'team-a' } }] }
		};
		qc.setQueryData(rolloutKey, seeded);

		applyChangeEvents(qc, [
			ev({
				kind: 'Kustomization',
				namespace: 'team-a',
				name: 'unrelated-kustomization',
				cluster: 'hub',
				object: { metadata: { name: 'unrelated-kustomization', namespace: 'team-a' } }
			})
		]);

		expect(qc.getQueryData(rolloutKey)).toBe(seeded); // same reference — never rebuilt
		expect(qc.getQueryState(rolloutKey)?.isInvalidated).toBe(false);
	});

	it('an Environment delete clears the composite field instead of leaving stale data', () => {
		const qc = new QueryClient();
		const rolloutKey = rolloutQueryKey('team-a', 'app-1', 'hub');
		qc.setQueryData(rolloutKey, {
			rollout: { metadata: { name: 'app-1', namespace: 'team-a' } },
			environment: { metadata: { name: 'app-1-dev', namespace: 'team-a' } }
		});

		applyChangeEvents(qc, [
			ev({
				type: 'delete',
				kind: 'Environment',
				namespace: 'team-a',
				name: 'app-1-dev',
				cluster: 'hub'
			})
		]);

		const cached = qc.getQueryData<any>(rolloutKey);
		expect(cached.environment).toBeUndefined();
		expect(qc.getQueryState(rolloutKey)?.isInvalidated).toBe(false);
	});
});

describe('applyChangeEvents — patch from object, health-checks', () => {
	function key(ns: string, name: string, cluster: string) {
		return ['health-checks', ns, name, cluster];
	}

	it('a HealthCheck update replaces the matching item in place', () => {
		const qc = new QueryClient();
		qc.setQueryData(key('team-a', 'app-1', 'hub'), {
			healthChecks: [
				{ metadata: { name: 'probe-1', namespace: 'team-a' }, status: { status: 'Healthy' } }
			]
		});

		applyChangeEvents(qc, [
			ev({
				kind: 'HealthCheck',
				namespace: 'team-a',
				name: 'probe-1',
				cluster: 'hub',
				object: { metadata: { name: 'probe-1', namespace: 'team-a' }, status: { status: 'Unhealthy' } }
			})
		]);

		const cached = qc.getQueryData<any>(key('team-a', 'app-1', 'hub'));
		expect(cached.healthChecks[0].status.status).toBe('Unhealthy');
		expect(qc.getQueryState(key('team-a', 'app-1', 'hub'))?.isInvalidated).toBe(false);
	});

	it('a HealthCheck delete removes the matching item', () => {
		const qc = new QueryClient();
		qc.setQueryData(key('team-a', 'app-1', 'hub'), {
			healthChecks: [
				{ metadata: { name: 'probe-1', namespace: 'team-a' }, status: {} },
				{ metadata: { name: 'probe-2', namespace: 'team-a' }, status: {} }
			]
		});

		applyChangeEvents(qc, [
			ev({ type: 'delete', kind: 'HealthCheck', namespace: 'team-a', name: 'probe-1', cluster: 'hub' })
		]);

		const cached = qc.getQueryData<any>(key('team-a', 'app-1', 'hub'));
		expect(cached.healthChecks).toEqual([{ metadata: { name: 'probe-2', namespace: 'team-a' }, status: {} }]);
		expect(qc.getQueryState(key('team-a', 'app-1', 'hub'))?.isInvalidated).toBe(false);
	});

	it('a HealthCheck new to this rollout (not already cached) is left alone, not invalidated', () => {
		const qc = new QueryClient();
		const seeded = { healthChecks: [{ metadata: { name: 'probe-1', namespace: 'team-a' }, status: {} }] };
		qc.setQueryData(key('team-a', 'app-1', 'hub'), seeded);

		applyChangeEvents(qc, [
			ev({
				kind: 'HealthCheck',
				namespace: 'team-a',
				name: 'brand-new-probe',
				cluster: 'hub',
				object: { metadata: { name: 'brand-new-probe', namespace: 'team-a' }, status: {} }
			})
		]);

		expect(qc.getQueryData(key('team-a', 'app-1', 'hub'))).toBe(seeded);
		expect(qc.getQueryState(key('team-a', 'app-1', 'hub'))?.isInvalidated).toBe(false);
	});

	it('a HealthCheck KNOWN to belong here but missing its object (oversized) still invalidates', () => {
		const qc = new QueryClient();
		qc.setQueryData(key('team-a', 'app-1', 'hub'), {
			healthChecks: [{ metadata: { name: 'probe-1', namespace: 'team-a' }, status: { status: 'Healthy' } }]
		});

		applyChangeEvents(qc, [
			// No `object` — the >64KiB / Get-failed case.
			ev({ kind: 'HealthCheck', namespace: 'team-a', name: 'probe-1', cluster: 'hub' })
		]);

		expect(qc.getQueryState(key('team-a', 'app-1', 'hub'))?.isInvalidated).toBe(true);
	});
});
