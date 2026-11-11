import { describe, expect, it } from 'vitest';
import { rollupParts } from './repo-card';
import { standingWords, standingWordsCompact } from './changes';
import { rankVerdicts } from './env-rank';
import { behindOfRollout, behindOfStatus } from './behind';
import { groupRolloutsByApp } from '../version-utils';
import { releaseSourceRequiredMessage } from '../releases/catalogue';
import type { Rollout } from '../../types';

const cond = { type: 'ReleasesUpdated', status: 'False', reason: 'ReleaseSourceRequired', message: 'Create a ReleaseSource.' };
const rollout = (name: string, ns: string, tag: string, withCond = true) =>
	({
		metadata: { name, namespace: ns },
		spec: {},
		status: { currentVersion: tag, history: [{ version: { tag }, timestamp: '2026-11-01T00:00:00Z', bakeStatus: 'Succeeded' }], ...(withCond ? { conditions: [cond] } : {}) }
	}) as unknown as Rollout;

describe('a change or rollout with no release source', () => {
	it('is not "moving": the repo rollup says so', () => {
		expect(rollupParts([{ state: 'checking', noSource: true }]).map((p) => p.text)).toEqual(['no release source']);
		expect(rollupParts([{ state: 'checking' }, { state: 'deploying', noSource: true }]).map((p) => p.text)).toEqual(['1 moving', 'no release source']);
	});
	it('stands as "no release source", never queued or moving (failures still read as failures)', () => {
		const row = { verdictTone: 'moving', grid: { services: [] }, services: [], noSource: true } as never;
		expect(standingWords(row)).toBe('no release source');
		expect(standingWordsCompact(row)).toBe('no release source');
		expect(standingWords({ ...(row as object), verdictTone: 'failed' } as never)).not.toBe('no release source');
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
