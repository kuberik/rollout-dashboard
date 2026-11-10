import { describe, expect, it } from 'vitest';
import type { Environment } from '../../types';
import { behindOfRollout } from './behind';
import { promotionCandidates } from './promotion';
import { waveBlockingRevisions, waveFailedRevisions } from './failed-builds';

/**
 * batch4 #3b/#3c with the controller's REAL blocker shapes (environment-controller fleet.go): the wave-2 LEADER carries
 * WaitingFor/Bake/<site>/<revision> with NO outcome; its followers carry no blocker; a wave-3 leader waits on wave 2 with no revision of its own.
 * Phase "catch": us-east-1 runs the failed 4.46.0-46 (rev bbbbbbb). Phase "rolledBack": it runs 4.45.0-45 again (pinned).
 */
const v45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const v46 = { tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222' };
const env = (site: string, wave: number, status: Record<string, unknown> = {}): Environment =>
	({ metadata: { name: `app-${site}`, namespace: `app-prod-${site}` }, spec: { name: 'app', environment: 'prod', site, wave, rolloutRef: { name: 'app' } }, status: { conditions: [], ...status } }) as unknown as Environment;
const wait = (message: string, blocker: Record<string, unknown>) => ({ conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message }], wave: { blocker: { reason: 'WaitingFor', environment: 'prod', waitingOn: 'Bake', ...blocker } } });
const SITES = ['ap-southeast-2', 'eu-central-1', 'eu-west-1', 'us-west-2'];
const envs = () => [
	env('us-east-1', 1),
	env('ap-southeast-2', 2, wait('bake failed on bbbbbbb', { site: 'us-east-1', revision: 'bbbbbbb' })), /* leader: no outcome */
	env('eu-central-1', 2), env('eu-west-1', 2), env('us-west-2', 2), /* followers: no blocker */
	env('af-south-1', 3, wait('waiting for ap-southeast-2', { site: 'ap-southeast-2' })) /* wave-3 leader: no revision, no member failure of its own */
];
const ro = (site: string, phase: 'catch' | 'rolledBack') => {
	const failedRun = site === 'us-east-1';
	const history = failedRun ? [...(phase === 'rolledBack' ? [{ bakeStatus: 'Succeeded', version: v45, timestamp: '2026-11-10T10:30:00Z' }] : []), { bakeStatus: 'Failed', version: v46, timestamp: '2026-11-10T10:00:00Z' }, { bakeStatus: 'Succeeded', version: v45, timestamp: '2026-11-10T09:00:00Z' }] : [{ bakeStatus: 'Succeeded', version: v45 }];
	return { metadata: { name: 'app', namespace: `app-prod-${site}` }, status: { currentVersion: failedRun && phase === 'catch' ? 'b-46' : 'b-45', releaseCandidates: [v46], availableReleases: [v45, v46], history } } as never;
};
const fleet = (phase: 'catch' | 'rolledBack') => ({ environments: envs(), rollouts: [...SITES, 'us-east-1', 'af-south-1'].map((s) => ro(s, phase)) });

describe('a build that failed upstream in the wave chain is not a candidate for the places the wave holds', () => {
	for (const site of [...SITES, 'af-south-1']) {
		it(`${site}: not behind, and the wave blocks on it while us-east-1 still runs it`, () => {
			const f = fleet('catch');
			expect(waveFailedRevisions(ro(site, 'catch'), f)).toEqual(['bbbbbbb']);
			expect(waveBlockingRevisions(ro(site, 'catch'), f)).toEqual(['bbbbbbb']);
			expect(behindOfRollout(ro(site, 'catch'), null, f)).toBe(0);
		});
		it(`${site}: after the rollback it is still no count (not behind) but holds nobody`, () => {
			const f = fleet('rolledBack');
			expect(waveFailedRevisions(ro(site, 'rolledBack'), f)).toEqual(['bbbbbbb']);
			expect(waveBlockingRevisions(ro(site, 'rolledBack'), f)).toEqual([]);
			expect(behindOfRollout(ro(site, 'rolledBack'), null, f)).toBe(0);
		});
	}
	it('us-east-1 itself (wave 1, no blocker) reads nothing from the wave chain', () => {
		expect(waveFailedRevisions(ro('us-east-1', 'catch'), fleet('catch'))).toEqual([]);
	});
	it('a genuinely newer build still counts for a held place, and a later b-47 does not resurrect b-46', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		const r = ro('eu-west-1', 'catch') as { status: { releaseCandidates: unknown[] } };
		r.status.releaseCandidates = [v47, v46];
		expect(behindOfRollout(r as never, null, fleet('catch'))).toBe(1);
	});
	it('a site the dashboard cannot see falls back to the blocker outcome; none and no history means nothing failed', () => {
		const blocked = (extra: Record<string, unknown>) => [env('ap-southeast-2', 2, wait('bake', { site: 'us-east-1', revision: 'bbbbbbb', ...extra })), env('eu-west-1', 2)];
		expect(waveFailedRevisions(ro('eu-west-1', 'catch'), { environments: blocked({ outcome: 'Failed' }), rollouts: [] })).toEqual(['bbbbbbb']);
		expect(waveFailedRevisions(ro('eu-west-1', 'catch'), { environments: blocked({}), rollouts: [] })).toEqual([]);
	});
	it('no hidden registry: without a fleet argument or a live source nothing is subtracted', () => {
		expect(behindOfRollout(ro('eu-west-1', 'catch'))).toBe(1);
	});
	it('promotionCandidates is untouched: the failed build stays a candidate (clear-pin redeploys it)', () => {
		expect(promotionCandidates(ro('eu-west-1', 'catch')).map((c) => c.tag)).toEqual(['b-46']);
	});
});
