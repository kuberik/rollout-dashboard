import { describe, it, expect, vi } from 'vitest';
vi.mock('../data', async (orig) => ({ ...(await orig<typeof import('../data')>()), streamBuilds: () => ['c0', 'c1', 'c2', 'c3'], deployedHistory: () => [] }));
import { ledgerOf, nextOf, waitingSentence, approvalMessage, followSentence, placesAfter } from './app-model';

/* QA #23: a release of the app that a place still runs but the spine no longer lists was SUPERSEDED: it keeps its place in the sequence (counted), never "Custom". */
const hb = (build: string) => ({ build, title: null, author: null, created: null, here: true });
const place = (name: string, deployed: string, held: ReturnType<typeof hb>[]) => ({ wave: null, env: name, label: name, place: name, tier: 'staging', state: 'healthy', href: `/x/${name}`, deployedBuild: deployed, holdReason: null, gate: null, heldBuilds: held, runs: null }) as never;
describe('superseded vs custom', () => {
	it('c1 is in the release stream: positional after the spine; zzz is not: Custom', () => {
		const stops = ledgerOf([place('prod', 'c2', [hb('c3')]), place('stg', 'c1', []), place('dev', 'zzz', [])] as never);
		expect(stops.map((s) => [s.build, s.custom, s.index])).toEqual([['c3', false, 0], ['c2', false, 1], ['c1', false, 2], ['zzz', true, null]]);
	});
	it('nextOf: a build the upstream tier has already passed is "skipped", not "after staging"', () => {
		const prod = { ...(place('prod', 'c0', [hb('c1')]) as object), tier: 'prod', holdReason: 'rule', gate: { name: 'Promotion from staging', sentence: '', label: { kind: 'promotion', source: 'staging' } } };
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

/* landing v5 (2026-11-10): the approval for wave 1 must say the other regions come after it */
describe('approvalMessage: the approval says what follows it', () => {
	const mk = (site: string, wave: number, leader: boolean, tier = 'prod') => ({ tier, wave: { site, wave, leader, follows: leader ? null : 'ap-southeast-2', multi: true } }) as never;
	const places = [mk('us-east-1', 1, true), mk('ap-southeast-2', 2, true), mk('eu-central-1', 2, false), mk('eu-west-1', 2, false), mk('us-east-2', 2, false), { tier: 'staging', wave: null }] as never[];
	it('the wave-1 leader: the other four regions follow', () => {
		expect(approvalMessage(1, places[0], places)).toBe('1 newer build is waiting here. Then 4 more regions follow.');
	});
	it('a wave-2 leader counts its own followers, not the wave before it or the other tiers', () => {
		expect(followSentence(placesAfter(places[1], places))).toBe('Then 3 more regions follow.');
	});
	it('the last place of the order, an unplaced place and a lone follower say nothing', () => {
		expect(followSentence(placesAfter(places[2], places))).toBeNull();
		expect(approvalMessage(null, { tier: 'staging', wave: null } as never, places)).toBe('Newer builds are waiting here.');
		expect(approvalMessage(2, null, places)).toBe('2 newer builds are waiting here.');
	});
	it('one place after is singular; a non-prod tier says places', () => {
		expect(followSentence([{ tier: 'prod' }])).toBe('Then 1 more region follows.');
		expect(followSentence([{ tier: 'staging' }, { tier: 'staging' }])).toBe('Then 2 more places follow.');
	});
});
