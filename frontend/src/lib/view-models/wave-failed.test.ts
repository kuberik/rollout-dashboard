import { afterEach, describe, expect, it } from 'vitest';
import type { Environment } from '../../types';
import { behindOfRollout } from './behind';
import { promotionCandidates } from './promotion';
import { failedKeysOf } from './failed-builds';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { newestBuild, placeHolds, candidateBuilds } from '$lib/components/new/data';

/**
 * batch4 #3b. Wave-1 catch: us-east-1 failed the bake of 4.46.0-46 (rev bbbbbbb). The wave-2 leader (ap-southeast-2) carries the Environment
 * blocker `bake failed on bbbbbbb`; eu-central-1, eu-west-1 and us-west-2 are its followers. None of the four ever ran b-46, so their own history
 * is clean; b-46 is still a published candidate for all of them. For these places it is not behind, newer, waiting or arriving.
 */
const v45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const v46 = { tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222' };
const env = (site: string, wave: number, extra: Record<string, unknown> = {}): Environment =>
	({
		metadata: { name: `app-${site}`, namespace: `app-prod-${site}` },
		spec: { name: 'app', environment: 'prod', site, wave, rolloutRef: { name: 'app' } },
		status: { conditions: [], ...extra }
	}) as unknown as Environment;
const blocked = { conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'bake failed on bbbbbbb' }], wave: { blocker: { reason: 'WaitingFor', environment: 'prod', site: 'us-east-1', waitingOn: 'Bake', revision: 'bbbbbbb', outcome: 'Failed' } } };
const waiting = { conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'waiting for ap-southeast-2' }] };
const envs = () => [env('us-east-1', 1), env('ap-southeast-2', 2, blocked), env('eu-central-1', 2, waiting), env('eu-west-1', 2, waiting), env('us-west-2', 2, waiting)];
const ro = (site: string) => ({ metadata: { name: 'app', namespace: `app-prod-${site}` }, status: { currentVersion: 'b-45', releaseCandidates: [v46], availableReleases: [v45, v46], history: [{ bakeStatus: 'Succeeded', version: v45 }] } }) as never;

describe('a build that failed upstream in the wave chain is not a candidate for the places the wave holds', () => {
	for (const site of ['ap-southeast-2', 'eu-central-1', 'eu-west-1', 'us-west-2']) {
		it(`${site}: not behind, not a candidate`, () => {
			expect(failedKeysOf(ro(site), envs()).has('bbbbbbb')).toBe(true);
			expect(behindOfRollout(ro(site), null, envs())).toBe(0);
			expect(promotionCandidates(ro(site), envs())).toEqual([]);
		});
	}
	it('us-east-1 itself (wave 1, no blocker) is unaffected by the helper', () => {
		expect(failedKeysOf(ro('us-east-1'), envs()).has('bbbbbbb')).toBe(false);
	});
	it('a genuinely newer build still counts for a held place', () => {
		const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444' };
		const r = ro('eu-west-1') as { status: { releaseCandidates: unknown[] } };
		r.status.releaseCandidates = [v47, v46];
		expect(behindOfRollout(r as never, null, envs())).toBe(1);
	});
});

describe('data.ts surfaces read the same rule (Runs-in / newer builds / Newer-builds list)', () => {
	afterEach(() => installLiveSource(null));
	it('checkout-api ap-southeast-2: an Environment blocker that failed its newest candidate empties the list and the count', () => {
		const fx = fixtureSource();
		const P = placeHolds('checkout-api', 'incident').find((p) => p.label === 'ap-southeast-2')!;
		const [, , ns, name] = P.href.split('/').filter(Boolean);
		const raw = (fx.rollouts as any[]).find((r) => r.metadata.namespace === ns && r.metadata.name === name);
		const cands = raw.status.releaseCandidates as { tag?: string; version?: string; revision?: string }[];
		expect(cands.length, 'fixture: the place has newer candidates').toBeGreaterThan(0);
		const row = { app: 'checkout-api', href: P.href, state: 'healthy', word: '' } as never;
		const before = candidateBuilds(row).length;
		const rev = cands[0].revision ?? 'eeeeeee0000000';
		const environments = (fx.environments as any[]).map((e) => (e.metadata.namespace === ns && e.spec?.rolloutRef?.name === name
			? { ...e, status: { ...e.status, conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'bake failed' }], wave: { ...(e.status?.wave ?? {}), blocker: { reason: 'WaitingFor', environment: 'prod', site: 'us-east-1', waitingOn: 'Bake', revision: rev, outcome: 'Failed' } } } }
			: e));
		const rollouts = (fx.rollouts as any[]).map((r) => (r === raw ? { ...r, status: { ...r.status, releaseCandidates: cands.map((c, i) => (i === 0 ? { ...c, revision: rev } : c)) } } : r));
		installLiveSource({ ...fx, rollouts, environments } as any);
		expect(candidateBuilds(row).length).toBe(before - 1);
		expect(newestBuild(row)?.count ?? 0).toBeLessThan(before);
	});
});
