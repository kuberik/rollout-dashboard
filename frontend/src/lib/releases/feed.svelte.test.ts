import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/svelte-query';
import { installReleaseCatalogueFeed } from './feed';
import { availableReleases, resetReleaseCatalogue } from './registry.svelte';
import { rel, rollout, slice, source } from './fixtures';
import { rolloutsListQueryKey } from '../api/rollouts';

const payload = () => ({
	rollouts: { items: [rollout({ ref: 'src' })] },
	releaseSources: { items: [source('src')] },
	releaseSlices: { items: [slice('s1', 'src', [rel('v1', 1), rel('v2', 2)])] }
});
const tags = (r: ReturnType<typeof rollout>) => availableReleases(r)?.map((v) => v.tag);

let qc: QueryClient;
let stop: () => void;
beforeEach(() => {
	resetReleaseCatalogue();
	qc = new QueryClient();
});
afterEach(() => stop?.());

describe('installReleaseCatalogueFeed', () => {
	it('ingests on fetch success in the same tick as the observer notification, before any microtask render (no empty first render)', async () => {
		stop = installReleaseCatalogueFeed(qc);
		const r = rollout({ ref: 'src', status: { availableReleases: [{ tag: 'OLD' }] } });
		const seenByObserver: (string[] | undefined)[] = [];
		const observer = new QueryObserver(qc, { queryKey: rolloutsListQueryKey, queryFn: async () => payload() });
		const unsub = observer.subscribe((res) => {
			// Svelte flushes reactive work in a microtask after the notification.
			if (res.data) queueMicrotask(() => seenByObserver.push(tags(r)));
		});
		await new Promise((res) => setTimeout(res, 20));
		unsub();
		expect(seenByObserver.length).toBeGreaterThan(0);
		for (const s of seenByObserver) expect(s).toEqual(['v1', 'v2']);
	});
	it('ingests setQueryData and data already in the cache at install time', () => {
		qc.setQueryData(rolloutsListQueryKey, payload());
		stop = installReleaseCatalogueFeed(qc);
		expect(tags(rollout({ ref: 'src' }))).toEqual(['v1', 'v2']);
		qc.setQueryData(rolloutsListQueryKey, { ...payload(), releaseSlices: { items: [slice('s1', 'src', [rel('v9', 9)])] } });
		expect(tags(rollout({ ref: 'src' }))).toEqual(['v9']);
	});
	it('an empty catalogue still counts as known (sources present, no slices)', () => {
		stop = installReleaseCatalogueFeed(qc);
		qc.setQueryData(['rollouts', 'namespace', 'ns'], { ...payload(), releaseSlices: { items: [] } });
		expect(availableReleases(rollout({ ref: 'src', status: { availableReleases: [{ tag: 'OLD' }] } }))).toEqual([]);
	});
	it('ignores payloads without the keys (old backend / CRDs absent) and unrelated queries', () => {
		stop = installReleaseCatalogueFeed(qc);
		qc.setQueryData(rolloutsListQueryKey, { rollouts: { items: [] }, releaseSources: null, releaseSlices: null });
		qc.setQueryData(['other'], payload());
		expect(availableReleases(rollout({ ref: 'src' }))).toBeUndefined();
	});
	it('unsubscribe stops ingestion', () => {
		stop = installReleaseCatalogueFeed(qc);
		stop();
		qc.setQueryData(rolloutsListQueryKey, payload());
		expect(availableReleases(rollout({ ref: 'src' }))).toBeUndefined();
	});
	it('partialReads (bare or cluster-qualified) keep earlier catalogues; a complete fleet list without the source drops it', () => {
		stop = installReleaseCatalogueFeed(qc);
		qc.setQueryData(rolloutsListQueryKey, payload());
		qc.setQueryData(rolloutsListQueryKey, { ...payload(), releaseSlices: { items: [] }, partialReads: ['releaseSlices'] });
		expect(tags(rollout({ ref: 'src' }))).toEqual(['v1', 'v2']);
		qc.setQueryData(rolloutsListQueryKey, { ...payload(), releaseSlices: { items: [] }, partialReads: ['prod/releaseSlices'] });
		expect(tags(rollout({ ref: 'src' }))).toEqual(['v1', 'v2']);
		// a spoke that could not be reached at all: not the whole truth, keep
		qc.setQueryData(rolloutsListQueryKey, { ...payload(), releaseSources: { items: null }, releaseSlices: { items: null }, clusterErrors: [{}] });
		expect(tags(rollout({ ref: 'src' }))).toEqual(['v1', 'v2']);
		// complete answer with no catalogue (CRDs uninstalled / source deleted): dropped → old fields
		qc.setQueryData(rolloutsListQueryKey, { ...payload(), releaseSources: { items: null }, releaseSlices: { items: null } });
		expect(tags(rollout({ ref: 'src' }))).toBeUndefined();
	});
});
