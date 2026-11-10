/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { applyChangeEvents, _resetThrottleForTests, type ChangeEvent } from './events';
import { rolloutsListQueryKey } from './rollouts';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import { installReleaseCatalogueFeed } from '../releases/feed';
import { availableReleases, resetReleaseCatalogue } from '../releases/registry.svelte';
import { rel, rollout, slice, source } from '../releases/fixtures';

const ev = (o: Partial<ChangeEvent>): ChangeEvent => ({
	type: 'update',
	kind: 'ReleaseSlice',
	namespace: 'ns',
	name: 's1',
	cluster: 'east',
	resourceVersion: '2',
	ts: 1,
	...o
});
const tags = (cluster: string) => availableReleases(rollout({ ref: 'src', cluster }))?.map((v) => v.tag);

let qc: QueryClient;
let stop: () => void;
beforeEach(() => {
	resetReleaseCatalogue();
	_resetThrottleForTests();
	qc = new QueryClient();
	qc.setQueryData(rolloutsListQueryKey, {
		rollouts: { items: [] },
		releaseSources: { items: [source('src', { cluster: 'east' }), source('src', { cluster: 'west' })] },
		releaseSlices: {
			items: [
				slice('s1', 'src', [rel('e1', 1)], { cluster: 'east', rv: '1' }),
				slice('s1', 'src', [rel('w1', 1)], { cluster: 'west', rv: '1' })
			]
		}
	});
	stop = installReleaseCatalogueFeed(qc);
});
afterEach(() => stop());

const items = (field: string) => (qc.getQueryData(rolloutsListQueryKey) as any)[field].items as any[];

describe('applyChangeEvents — ReleaseSlice / ReleaseSource', () => {
	it('slice update with object patches only that cluster, stamps the annotation, updates the registry', () => {
		const obj = slice('s1', 'src', [rel('e1', 1), rel('e2', 2)], { rv: '2' }); // no annotation, like an event object
		applyChangeEvents(qc, [ev({ object: obj })]);
		expect(items('releaseSlices')).toHaveLength(2);
		const east = items('releaseSlices').find((s) => s.metadata.annotations?.[SOURCE_CLUSTER_ANNOTATION] === 'east');
		expect(east.releases).toHaveLength(2);
		expect(tags('east')).toEqual(['e1', 'e2']);
		expect(tags('west')).toEqual(['w1']);
	});
	it('a new slice is added', () => {
		applyChangeEvents(qc, [ev({ type: 'add', name: 's2', object: slice('s2', 'src', [rel('e2', 2)], { rv: '1' }) })]);
		expect(items('releaseSlices')).toHaveLength(3);
		expect(tags('east')).toEqual(['e1', 'e2']);
	});
	it('delete removes from the list and the registry for that cluster only', () => {
		applyChangeEvents(qc, [ev({ type: 'delete' })]);
		expect(items('releaseSlices')).toHaveLength(1);
		expect(tags('east')).toEqual([]);
		expect(tags('west')).toEqual(['w1']);
	});
	it('ReleaseSource patch and delete hit releaseSources by cluster', () => {
		applyChangeEvents(qc, [ev({ kind: 'ReleaseSource', name: 'src', object: { ...source('src'), status: { count: 5 } } })]);
		expect(items('releaseSources')).toHaveLength(2);
		expect(items('releaseSources').find((s) => s.status?.count === 5).metadata.annotations[SOURCE_CLUSTER_ANNOTATION]).toBe('east');
		applyChangeEvents(qc, [ev({ kind: 'ReleaseSource', name: 'src', type: 'delete' })]);
		expect(items('releaseSources')).toHaveLength(1);
		expect(items('releaseSources')[0].metadata.annotations[SOURCE_CLUSTER_ANNOTATION]).toBe('west');
	});
	it('no object: throttled invalidate of the list, no patch', () => {
		const before = qc.getQueryData(rolloutsListQueryKey);
		applyChangeEvents(qc, [ev({})]);
		expect(qc.getQueryData(rolloutsListQueryKey)).toBe(before);
		expect(qc.getQueryState(rolloutsListQueryKey)?.isInvalidated).toBe(true);
	});
	it('an unrelated kind does not touch the catalogue', () => {
		applyChangeEvents(qc, [ev({ kind: 'RolloutGate', object: slice('s1', 'src', [rel('zz', 9)]) as any })]);
		expect(tags('east')).toEqual(['e1']);
	});
});
