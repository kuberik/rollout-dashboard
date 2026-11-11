import { beforeEach, describe, expect, it } from 'vitest';
import { availableReleases, ingestReleaseSlices, removeReleaseSlice, resetReleaseCatalogue, upsertReleaseSlice } from './registry.svelte';
import { catalogueKey } from './catalogue';
import { rel, rollout, slice } from './fixtures';

const K = catalogueKey('', 'ns', 'src');
const tags = (l: { tag: string }[] | undefined) => l?.map((v) => v.tag);
const r = () => rollout({ ref: 'src' });

beforeEach(() => resetReleaseCatalogue());

describe('an older slice never replaces a newer one', () => {
	it('SSE newer, then a stale refetch: the newer slice stays', () => {
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1), rel('v2', 2)], { gen: 5, rv: '900' }), 0);
		// the fan-in cache serves the slice as it was before v2 (older generation, resourceVersion that sorts HIGHER as a string)
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 4, rv: '1000' })], [K], { now: 1000 });
		expect(tags(availableReleases(r()))).toEqual(['v1', 'v2']);
	});
	it('a genuinely newer refetch replaces', () => {
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1)], { gen: 5 }), 0);
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1), rel('v2', 2), rel('v3', 3)], { gen: 7 })], [K], { now: 1000 });
		expect(tags(availableReleases(r()))).toEqual(['v1', 'v2', 'v3']);
	});
	it('an older SSE event does not replace a newer held slice', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1), rel('v2', 2)], { gen: 5 })], [K]);
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1)], { gen: 3 }));
		expect(tags(availableReleases(r()))).toEqual(['v1', 'v2']);
	});
	it('equal generation keeps what is held', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 2, rv: 'a' })], [K]);
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 2, rv: 'b' })], [K]);
		expect(tags(availableReleases(r()))).toEqual(['v1']);
	});
	it('a slice recreated under the same name (new uid, later creation) wins even with a lower generation', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('old', 1)], { gen: 9, uid: 'u1', created: '2026-01-01T00:00:00Z' })], [K]);
		ingestReleaseSlices([slice('s1', 'src', [rel('new', 1)], { gen: 1, uid: 'u2', created: '2026-02-01T00:00:00Z' })], [K]);
		expect(tags(availableReleases(r()))).toEqual(['new']);
	});
	it('without generations (old API) the incoming slice wins', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)])], [K]);
		ingestReleaseSlices([slice('s1', 'src', [rel('v2', 2)])], [K]);
		expect(tags(availableReleases(r()))).toEqual(['v2']);
	});
});

describe('deletion and complete lists', () => {
	it('a list that no longer names a long-held slice drops it', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 }), slice('s2', 'src', [rel('v2', 2)], { gen: 1 })], [K]);
		ingestReleaseSlices([slice('s2', 'src', [rel('v2', 2)], { gen: 1 })], [K]);
		expect(tags(availableReleases(r()))).toEqual(['v2']);
	});
	it('a stale list that lacks a slice delivered by SSE moments ago keeps it; after the grace window it is dropped', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 })], [K], { now: 0 });
		upsertReleaseSlice(slice('s2', 'src', [rel('v2', 2)], { gen: 1 }), 10_000);
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 })], [K], { now: 15_000 });
		expect(tags(availableReleases(r()))).toEqual(['v1', 'v2']);
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 })], [K], { now: 100_000 });
		expect(tags(availableReleases(r()))).toEqual(['v1']);
	});
	it('a slice the list confirms stops being protected', () => {
		upsertReleaseSlice(slice('s2', 'src', [rel('v2', 2)], { gen: 1 }), 0);
		ingestReleaseSlices([slice('s2', 'src', [rel('v2', 2)], { gen: 1 })], [K], { now: 1000 });
		ingestReleaseSlices([], [K], { now: 2000 });
		expect(availableReleases(r())).toEqual([]);
	});
	it('SSE deletion removes the slice, and its protection', () => {
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1)], { gen: 1 }), 0);
		removeReleaseSlice('', 'ns', 's1');
		ingestReleaseSlices([], [K], { now: 1000 });
		expect(availableReleases(r())).toEqual([]);
	});
	it('a complete fleet list drops catalogues it no longer names', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 })], [K]);
		ingestReleaseSlices([], [], { dropUnnamed: true });
		expect(availableReleases(r())).toBeUndefined();
	});
});

describe('a deleted slice stays deleted', () => {
	it('a stale list that still carries a slice deleted over SSE does not bring it back, until the tombstone ages out', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 }), slice('s2', 'src', [rel('v2', 2)], { gen: 1 })], [K], { now: 0 });
		removeReleaseSlice('', 'ns', 's1', 1_000);
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 }), slice('s2', 'src', [rel('v2', 2)], { gen: 1 })], [K], { now: 5_000 });
		expect(tags(availableReleases(r()))).toEqual(['v2']);
		// the hub has caught up, then a new slice is created under the same name
		ingestReleaseSlices([slice('s1', 'src', [rel('v9', 9)], { gen: 1, uid: 'new' })], [K], { now: 120_000 });
		expect(tags(availableReleases(r()))).toEqual(['v9']);
	});
	it('an SSE add of the same name clears the tombstone at once', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)], { gen: 1 })], [K], { now: 0 });
		removeReleaseSlice('', 'ns', 's1', 1_000);
		upsertReleaseSlice(slice('s1', 'src', [rel('v2', 2)], { gen: 1, uid: 'again' }), 2_000);
		ingestReleaseSlices([slice('s1', 'src', [rel('v2', 2)], { gen: 1, uid: 'again' })], [K], { now: 3_000 });
		expect(tags(availableReleases(r()))).toEqual(['v2']);
	});
});

describe('release source image', () => {
	it('reads the registry image of the Rollout\'s ReleaseSource, per cluster', async () => {
		const { ingestReleaseSources, releaseSourceImage } = await import('./registry.svelte');
		ingestReleaseSources([
			{ metadata: { name: 'src', namespace: 'ns' }, spec: { oci: { image: 'registry.example/app' } } },
			{ metadata: { name: 'src', namespace: 'ns', annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'east' } }, spec: { oci: { image: 'registry.example/east' } } }
		]);
		expect(releaseSourceImage(rollout({ ref: 'src' }))).toBe('registry.example/app');
		expect(releaseSourceImage(rollout({ ref: 'src', cluster: 'east' }))).toBe('registry.example/east');
		expect(releaseSourceImage(rollout({}))).toBeUndefined();
		expect(releaseSourceImage(rollout({ ref: 'other' }))).toBeUndefined();
	});
});
