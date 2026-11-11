import { describe, expect, it } from 'vitest';
import { rollupParts } from './repo-card';
import { standingWords, standingWordsCompact } from './changes';
import { rankVerdicts } from './env-rank';
import { behindOfRollout, behindOfStatus } from './behind';
import { groupRolloutsByApp } from '../version-utils';
import { releaseSourceRequiredMessage } from '../releases/catalogue';
import type { Rollout } from '../../types';

const cond = {
	type: 'ReleasesUpdated',
	status: 'False',
	reason: 'ReleaseSourceRequired',
	message: 'Create a ReleaseSource.'
};
const rollout = (name: string, ns: string, tag: string, withCond = true) =>
	({
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			currentVersion: tag,
			history: [{ version: { tag }, timestamp: '2026-11-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			...(withCond ? { conditions: [cond] } : {})
		}
	}) as unknown as Rollout;

describe('a change or rollout with no release source', () => {
	it('is not "moving": the repo rollup says so', () => {
		expect(
			rollupParts([{ state: 'checking', noReleases: 'No release source' }]).map((p) => p.text)
		).toEqual(['no release source']);
		expect(
			rollupParts([
				{ state: 'checking' },
				{ state: 'deploying', noReleases: 'No release source' }
			]).map((p) => p.text)
		).toEqual(['1 moving', 'no release source']);
	});
	it('stands as "no release source", never queued or moving (failures still read as failures)', () => {
		const row = {
			verdictTone: 'moving',
			grid: { services: [] },
			services: [],
			noReleases: 'No release source'
		} as never;
		expect(standingWords(row)).toBe('no release source');
		expect(standingWordsCompact(row)).toBe('no release source');
		expect(standingWords({ ...(row as object), verdictTone: 'failed' } as never)).not.toBe(
			'no release source'
		);
	});
	it('has no lag count and no "newest": the rank is unknown and nothing is behind', () => {
		const dev = rollout('app', 'app-dev', 'b2');
		const prod = rollout('app', 'app-prod', 'b1');
		const groups = [...groupRolloutsByApp([dev, prod], []).values()];
		const ranks = rankVerdicts(groups[0]);
		for (const v of ranks.values()) expect(v.kind).toBe('unknown');
		expect(behindOfStatus(prod)).toBe(0);
		expect(behindOfRollout(prod, { kind: 'behind', by: 1 } as never)).toBe(0);
	});
	it('reads the controller message only when there is no ref', () => {
		expect(releaseSourceRequiredMessage(rollout('a', 'n', 'v'))).toBe('Create a ReleaseSource.');
		const withRef = rollout('a', 'n', 'v');
		(withRef.spec as Record<string, unknown>).releaseSourceRef = { name: 's' };
		expect(releaseSourceRequiredMessage(withRef)).toBeUndefined();
	});
});

import {
	ingestReleaseSlices,
	noReleasesOf,
	resetReleaseCatalogue
} from '../releases/registry.svelte';
import { catalogueKey } from '../releases/catalogue';
import { rel, rollout as fixtureRollout, slice } from '../releases/fixtures';

describe('one rule for "no releases": no source, and a source that published nothing', () => {
	it('no source -> No release source, with the controller message', () => {
		const n = noReleasesOf(fixtureRollout({ status: { conditions: [cond] } }));
		expect(n?.kind).toBe('no-source');
		expect(n?.label).toBe('No release source');
	});
	it('a source with an empty catalogue -> No releases yet; with releases -> null; unknown catalogue -> null (loading)', () => {
		resetReleaseCatalogue();
		const r = fixtureRollout({ ref: 'src' });
		expect(noReleasesOf(r)).toBeNull(); // loading
		ingestReleaseSlices([], [catalogueKey('', 'ns', 'src')]);
		expect(noReleasesOf(r)?.label).toBe('No releases yet');
		ingestReleaseSlices([slice('s1', 'src', [rel('v1', 1)])], [catalogueKey('', 'ns', 'src')]);
		expect(noReleasesOf(r)).toBeNull();
	});
	it('the same state word reaches the shared view-models: behind counts, rank, rollup and standing words', () => {
		resetReleaseCatalogue();
		ingestReleaseSlices([], [catalogueKey('', 'ns', 'src')]);
		const r = fixtureRollout({
			ref: 'src',
			status: { currentVersion: 'v1', history: [{ version: { tag: 'v1' } }] }
		});
		expect(behindOfStatus(r)).toBe(0);
		expect(behindOfRollout(r, { kind: 'behind', by: 2 } as never)).toBe(0);
		expect(
			rollupParts([{ state: 'checking', noReleases: 'No releases yet' }]).map((p) => p.text)
		).toEqual(['no releases yet']);
		expect(
			standingWords({
				verdictTone: 'moving',
				grid: { services: [] },
				services: [],
				noReleases: 'No releases yet'
			} as never)
		).toBe('no releases yet');
	});
});
