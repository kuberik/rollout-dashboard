import { describe, it, expect } from 'vitest';
import { repoCardModel, rollupParts } from './repo-card';
import type { RepoChange } from './repo-card';

const c = (ref: string, state: RepoChange['state'], col: string): RepoChange => ({ ref, state, col });
describe('repo card model', () => {
	const changes = [c('#40', 'approval', 'merged'), c('#44', 'deploying', 'dev'), c('#43', 'approval', 'staging'), c('#41', 'approval', 'staging'), c('#90', 'approval-yours', 'staging'), c('#37', 'failed', 'prod')];
	const m = repoCardModel({ repo: 'invoice-api', changes, tiers: ['dev', 'test', 'staging', 'prod'], landed: [{ ref: '#33' }, { ref: '#32', title: 'x' }] });
	it('a merged cell leads, then every tier of the repo, test stays empty', () => {
		expect(m.cells.map((x) => x.tier)).toEqual(['merged', 'dev', 'test', 'staging', 'prod']);
		expect(m.cells[2].beads).toEqual([]);
	});
	it('same-state changes merge into one bead, a change that needs you stays alone', () => {
		const st = m.cells[3].beads;
		expect(st.map((b) => b.state)).toEqual(['approval-yours', 'approval']);
		expect(st[1]).toMatchObject({ refs: ['#43', '#41'], more: 0 });
	});
	it('landed ends the row; worst is the most severe state', () => {
		expect(m.landed).toBe(2);
		expect(m.landedTitle).toContain('#32 x');
		expect(m.worst).toBe(0);
	});
	it('rollup: failing first in danger, waiting held when one is yours, landed excluded', () => {
		expect(rollupParts(changes)).toEqual([{ text: '1 failing', ink: 'danger' }, { text: '4 waiting', ink: 'held' }, { text: '1 moving', ink: 'subtle' }]);
		expect(rollupParts([c('#1', 'landed', 'prod')])).toEqual([]);
	});
	it('defaults the tiers from the changes', () => {
		expect(repoCardModel({ repo: 'r', changes: [c('#1', 'deploying', 'dev'), c('#2', 'approval', 'prod')] }).cells.map((x) => x.tier)).toEqual(['dev', 'prod']);
	});
});
