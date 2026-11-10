import { describe, it, expect, vi } from 'vitest';
vi.mock('../data', async (orig) => ({ ...(await orig<typeof import('../data')>()), streamBuilds: () => ['c0', 'c1', 'c2', 'c3'], deployedHistory: () => [] }));
import { ledgerOf, nextOf, waitingSentence } from './app-model';

/* QA #23: a release of the app that a place still runs but the spine no longer lists was SUPERSEDED: it keeps its place in the sequence (counted), never "Custom". */
const hb = (build: string) => ({ build, title: null, author: null, created: null, here: true });
const place = (name: string, deployed: string, held: ReturnType<typeof hb>[]) => ({ wave: null, env: name, label: name, place: name, tier: 'staging', state: 'healthy', href: `/x/${name}`, deployedBuild: deployed, holdReason: null, gate: null, heldBuilds: held, runs: null }) as never;
describe('superseded vs custom', () => {
	it('c1 is in the release stream: positional after the spine; zzz is not: Custom', () => {
		const stops = ledgerOf([place('prod', 'c2', [hb('c3')]), place('stg', 'c1', []), place('dev', 'zzz', [])] as never);
		expect(stops.map((s) => [s.build, s.custom, s.index])).toEqual([['c3', false, 0], ['c2', false, 1], ['c1', false, 2], ['zzz', true, null]]);
	});
	it('nextOf: a build the upstream tier has already passed is "skipped", not "after staging"', () => {
		const prod = { ...(place('prod', 'c0', [hb('c1')]) as object), tier: 'prod', holdReason: 'rule', gate: { name: 'Promotion staging', sentence: '' } };
		const stg = { ...(place('stg', 'c3', []) as object), tier: 'staging' };
		expect(nextOf([stg, prod] as never, '/x/prod')).toBe('c1 was skipped · staging runs c3');
		const stg2 = { ...stg, deployedBuild: 'c0' };
		expect(nextOf([stg2, prod] as never, '/x/prod')).toBe('next c1 · after staging');
	});
});

/* round 3: the banner prints no number until the place's held-HERE answer is known (it flipped 7 -> 5 on first paint) */
it('waitingSentence: pending carries no count; a known count is exact', () => {
	expect(waitingSentence(null)).toBe('Newer builds are waiting here.');
	expect(waitingSentence(5)).toBe('5 newer builds are waiting here.');
	expect(waitingSentence(1)).toBe('1 newer build is waiting here.');
});
