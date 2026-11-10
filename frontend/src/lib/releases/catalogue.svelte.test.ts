import { beforeEach, describe, expect, it } from 'vitest';
import {
	availableReleases,
	gatedReleaseCandidates,
	ingestReleaseSlices,
	releaseCandidates,
	removeReleaseSlice,
	resetReleaseCatalogue,
	upsertReleaseSlice
} from './registry.svelte';
import { catalogueKey, mergeSlices } from './catalogue';
import { rel, rollout, slice } from './fixtures';

const K = catalogueKey('', 'ns', 'src');
const tags = (l: { tag: string }[] | undefined) => l?.map((v) => v.tag);

beforeEach(() => resetReleaseCatalogue());

describe('fallback path', () => {
	const old = {
		availableReleases: [{ tag: 'a' }],
		releaseCandidates: [{ tag: 'b' }],
		gatedReleaseCandidates: [{ tag: 'c' }]
	};
	it('no ref: old fields verbatim, even when a catalogue exists', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('x', 1)])], [K]);
		const r = rollout({ status: old });
		expect(availableReleases(r)).toBe(old.availableReleases);
		expect(releaseCandidates(r)).toBe(old.releaseCandidates);
		expect(gatedReleaseCandidates(r)).toBe(old.gatedReleaseCandidates);
	});
	it('ref set but catalogue unknown: old fields', () => {
		const r = rollout({ ref: 'src', status: old });
		expect(availableReleases(r)).toBe(old.availableReleases);
		expect(releaseCandidates(r)).toBe(old.releaseCandidates);
	});
	it('keeps undefined vs []', () => {
		expect(availableReleases(rollout({ status: {} }))).toBeUndefined();
		expect(releaseCandidates(rollout({ status: {} }))).toBeUndefined();
		const e = rollout({ status: { availableReleases: [], releaseCandidates: [], gatedReleaseCandidates: [] } });
		expect(availableReleases(e)).toEqual([]);
		expect(releaseCandidates(e)).toEqual([]);
		expect(gatedReleaseCandidates(e)).toEqual([]);
		expect(availableReleases(null)).toBeUndefined();
	});
});

describe('slices path', () => {
	it('merges slices sorted by sequence, interleaved, with a duplicate tag and an empty slice', () => {
		ingestReleaseSlices(
			[
				slice('s2', 'src', [rel('v4', 4), rel('v2', 2), rel('dup', 3)]),
				slice('s1', 'src', [rel('v1', 1), rel('v3', 3, { digest: 'sha' }), rel('dup', 6)]),
				slice('s3', 'src', [])
			],
			[K]
		);
		const r = rollout({ ref: 'src', status: { availableReleases: [{ tag: 'OLD' }] } });
		expect(tags(availableReleases(r))).toEqual(['v1', 'v2', 'v3', 'v4', 'dup']);
		// the duplicate keeps its highest-sequence entry
		expect(mergeSlices([slice('a', 'src', [rel('dup', 3)]), slice('b', 'src', [rel('dup', 6)])])).toHaveLength(1);
	});
	it('known but empty catalogue is slices mode (empty list, not the old fields)', () => {
		ingestReleaseSlices([], [K]);
		const r = rollout({ ref: 'src', status: { availableReleases: [{ tag: 'OLD' }] } });
		expect(availableReleases(r)).toEqual([]);
	});
	it('maps entries field for field', () => {
		ingestReleaseSlices(
			[slice('s1', 'src', [rel('v1', 1, { digest: 'd', version: '1.0', revision: 'abc', requires: { a: '1' }, metadataUnresolved: true })])],
			[K]
		);
		expect(availableReleases(rollout({ ref: 'src' }))).toEqual([
			{ tag: 'v1', digest: 'd', version: '1.0', revision: 'abc', created: '2026-01-02T00:00:00Z', requires: { a: '1' }, metadataUnresolved: true }
		]);
	});
});

describe('candidates', () => {
	const cat = [slice('s1', 'src', [rel('v1', 1), rel('v2', 2)]), slice('s2', 'src', [rel('v3', 3), rel('v4', 4)])];
	beforeEach(() => ingestReleaseSlices(cat, [K]));

	const hist = (tag: string) => [{ version: { tag } }];
	it('newer-than-deployed comes from the catalogue (uncapped), newest first; gated from status.candidates', () => {
		const r = rollout({
			ref: 'src',
			status: {
				history: hist('v1'),
				// the controller capped its working set at K = 2: v2 is beyond K
				candidates: [
					{ tag: 'v4', gated: false },
					{ tag: 'v3', gated: true, blockedBy: ['g'] }
				]
			}
		});
		expect(tags(releaseCandidates(r))).toEqual(['v4', 'v3', 'v2']);
		expect(tags(gatedReleaseCandidates(r))).toEqual(['v3']);
		expect(releaseCandidates(r)![0].created).toBe('2026-01-05T00:00:00Z'); // catalogue entries, not stubs
	});
	it('no history → every catalogue release; deployed newest → undefined (omitempty)', () => {
		expect(tags(releaseCandidates(rollout({ ref: 'src', status: {} })))).toEqual(['v4', 'v3', 'v2', 'v1']);
		const top = rollout({ ref: 'src', status: { history: hist('v4'), candidates: [] } });
		expect(releaseCandidates(top)).toBeUndefined();
		expect(gatedReleaseCandidates(top)).toBeUndefined();
	});
	it('deployed tag left the catalogue → the controller\'s own status.candidates, stubs in place', () => {
		const r = rollout({
			ref: 'src',
			status: {
				history: hist('gone'),
				candidates: [
					{ tag: 'ghost', created: '2026-12-01T00:00:00Z', gated: true },
					{ tag: 'v4', gated: false }
				]
			}
		});
		const out = releaseCandidates(r)!;
		expect(out[0]).toEqual({ tag: 'ghost', created: '2026-12-01T00:00:00Z' });
		expect(tags(out)).toEqual(['ghost', 'v4']);
		expect(tags(gatedReleaseCandidates(r))).toEqual(['ghost']);
		expect(releaseCandidates(rollout({ ref: 'src', status: { history: hist('gone') } }))).toBeUndefined();
	});
});

describe('cluster isolation', () => {
	it('same namespace and source on two clusters never mix', () => {
		ingestReleaseSlices(
			[slice('s', 'src', [rel('a1', 1)], { cluster: 'east' }), slice('s', 'src', [rel('b1', 1), rel('b2', 2)], { cluster: 'west' })],
			[catalogueKey('east', 'ns', 'src'), catalogueKey('west', 'ns', 'src')]
		);
		expect(tags(availableReleases(rollout({ ref: 'src', cluster: 'east' })))).toEqual(['a1']);
		expect(tags(availableReleases(rollout({ ref: 'src', cluster: 'west' })))).toEqual(['b1', 'b2']);
		// a rollout with no cluster annotation reads cluster '' → unknown → old fields
		expect(availableReleases(rollout({ ref: 'src' }))).toBeUndefined();
		removeReleaseSlice('east', 'ns', 's');
		expect(availableReleases(rollout({ ref: 'src', cluster: 'east' }))).toEqual([]);
		expect(tags(availableReleases(rollout({ ref: 'src', cluster: 'west' })))).toEqual(['b1', 'b2']);
	});
});

describe('registry', () => {
	it('ingest replaces a source wholesale: a retention-deleted slice disappears', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)]), slice('s2', 'src', [rel('v2', 2)])], [K]);
		const r = rollout({ ref: 'src' });
		expect(tags(availableReleases(r))).toEqual(['v1', 'v2']);
		ingestReleaseSlices([slice('s2', 'src', [rel('v2', 2)])], [K]);
		expect(tags(availableReleases(r))).toEqual(['v2']);
	});
	it('a source absent from an ingest is left untouched', () => {
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)])], [K]);
		ingestReleaseSlices([slice('o', 'other', [rel('x', 1)])], []);
		expect(tags(availableReleases(rollout({ ref: 'src' })))).toEqual(['v1']);
	});
	it('upsert adds and replaces; remove deletes', () => {
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1)]));
		const r = rollout({ ref: 'src' });
		expect(tags(availableReleases(r))).toEqual(['v1']);
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1), rel('v2', 2)]));
		upsertReleaseSlice(slice('s2', 'src', [rel('v3', 3)]));
		expect(tags(availableReleases(r))).toEqual(['v1', 'v2', 'v3']);
		removeReleaseSlice('', 'ns', 's1');
		expect(tags(availableReleases(r))).toEqual(['v3']);
	});
	it('is reactive: a $derived re-runs when slices change', async () => {
		const { flushSync } = await import('svelte');
		const seen: string[][] = [];
		const cleanup = $effect.root(() => {
			$effect(() => {
				seen.push(tags(availableReleases(rollout({ ref: 'src' }))) ?? []);
			});
		});
		flushSync();
		upsertReleaseSlice(slice('s1', 'src', [rel('v1', 1)]));
		flushSync();
		cleanup();
		expect(seen.at(-1)).toEqual(['v1']);
	});
});
