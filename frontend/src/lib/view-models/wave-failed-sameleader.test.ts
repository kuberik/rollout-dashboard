import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { environmentsPage } from '$lib/components/new/environments-page';
import { placeHolds, bakeFailedOn } from '$lib/components/new/data';
import { waveHold } from '$lib/components/new/app/app-model';
import { plural } from '$lib/components/new/envs-model';
import type { Environment } from '../../types';
import { behindOfRollout } from './behind';
import { blockingStory } from './blocking-story';
import { buildRolloutCards, detectRolloutStuck } from '../rollout-cards';
import { waveFailedRevisions, waveBlockingRevisions } from './failed-builds';
import w46 from '$lib/components/new/fixtures/film-world-46.json';

/* QA17 M3 counter-example: the wave-2 LEADER (ap-southeast-2) tried b-47 after wave 1 passed it, FAILED the bake and ROLLED BACK to b-45
   (retained Failed entry). Followers' blockers cleared (case a). b-47 failed only in the SAME wave, so waveFailures (blockers + EARLIER waves
   only) never names it: it stays a follower candidate, refused by the promotion gate (rule hold). Rule: a rolled-back failure holds nobody. */
const B47 = { tag: 'b-47', version: '4.47.0-47', revision: 'a'.repeat(40), created: '2026-11-10T10:00:00.000Z' };
const h = (v: any, s: string, t: string) => ({ id: 9, version: v, timestamp: t, bakeStatus: s, bakeStartTime: t, bakeEndTime: t, triggeredBy: { kind: 'System', name: 'System' } });
const world = () => {
	const w = JSON.parse(JSON.stringify(w46));
	for (const r of w.rollouts as any[]) {
		const ns: string = r.metadata.namespace;
		if (ns.endsWith('staging')) continue;
		r.status.availableReleases = [...r.status.availableReleases, B47];
		const b45 = r.status.history.find((x: any) => x.version.tag === 'b-45').version;
		if (ns.endsWith('us-east-1')) { r.status.history = [h(B47, 'Succeeded', '2026-11-10T10:30:00Z'), ...r.status.history]; r.status.currentVersion = 'b-47'; r.status.releaseCandidates = []; continue; }
		r.status.releaseCandidates = [B47, ...r.status.releaseCandidates];
		for (const g of r.status.gates) if (g.name === 'release-approval' || g.name.startsWith('dependency-')) g.allowedVersions = [...g.allowedVersions, 'b-47'];
		if (ns.endsWith('ap-southeast-2')) r.status.history = [h(b45, 'Succeeded', '2026-11-10T11:30:00Z'), h(B47, 'Failed', '2026-11-10T11:00:00Z'), ...r.status.history];
	}
	if (true) w.environments = (w.environments as any[]).map((e) => { const ns: string = e.metadata.namespace; const f = ['us-east-2', 'eu-west-1', 'eu-central-1'].some((x) => ns.endsWith(x));
		return f ? { ...e, status: { ...e.status, conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'prod/ap-southeast-2 selection' }], wave: { ...e.status.wave, blocker: { reason: 'WaitingFor', environment: 'prod', site: 'ap-southeast-2', waitingOn: 'Selection' } } } } : e; });
	return w;
};
const render = (w: any) => {
	installLiveSource({ ...(fixtureSource() as any), rollouts: w.rollouts, environments: w.environments } as any);
	const r = (environmentsPage('incident') as any).prod.regions;
	return [r?.held && `${plural(r.held.regions, 'region')} held · ${r.held.because}`, r?.waiting && `${plural(r.waiting.regions, 'region')} ${r.waiting.because}`].filter(Boolean);
};
describe('same-wave leader that rolled back holds nobody', () => {
	afterEach(() => installLiveSource(null));
	it('same-wave leader rolled back from b-47 (controller Selection blocker on the followers): nobody prints "failed the bake"', () => {
		const tile = render(world());
		const P = placeHolds('checkout-api', 'incident');
		expect(bakeFailedOn(P.find((p) => p.label === 'ap-southeast-2')!, '4.47.0-47')).toBe(false);
		expect(P.filter((p) => waveHold(p, P)?.failed).map((p) => p.label)).toEqual([]);
		expect(tile.join(' ')).not.toMatch(/failed the bake/);
	});
});

/* the same-wave gap: a follower waits on its own wave's LEADER; a build the leader still runs failed counts as failed for the follower too */
const sv45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const sv46 = { tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222' };
const senv = (site: string, wave: number): Environment => ({ metadata: { name: `app-${site}`, namespace: `app-prod-${site}` }, spec: { name: 'app', environment: 'prod', site, wave, rolloutRef: { name: 'app' } }, status: { conditions: [] } }) as unknown as Environment;
const sro = (site: string, leaderPhase: 'running' | 'rolledBack') => {
	const lead = site === 'ap-southeast-2';
	const history = lead ? [...(leaderPhase === 'rolledBack' ? [{ bakeStatus: 'Succeeded', version: sv45, timestamp: '2026-11-10T10:30:00Z' }] : []), { bakeStatus: 'Failed', version: sv46, timestamp: '2026-11-10T10:00:00Z' }, { bakeStatus: 'Succeeded', version: sv45, timestamp: '2026-11-10T09:00:00Z' }] : [{ bakeStatus: 'Succeeded', version: sv45 }];
	return { metadata: { name: 'app', namespace: `app-prod-${site}` }, status: { currentVersion: lead && leaderPhase === 'running' ? 'b-46' : 'b-45', releaseCandidates: [sv46], availableReleases: [sv45, sv46], history } } as never;
};
const sfleet = (p: 'running' | 'rolledBack') => ({ environments: [senv('us-east-1', 1), senv('ap-southeast-2', 2), senv('eu-west-1', 2), senv('us-west-2', 2)], rollouts: ['us-east-1', 'ap-southeast-2', 'eu-west-1', 'us-west-2'].map((x) => sro(x, p)) });
describe('same-wave leader failure', () => {
	it('followers of a wave leader that still RUNS the failed build do not count it as behind, and the wave blocks on it', () => {
		for (const site of ['eu-west-1', 'us-west-2']) {
			expect(waveFailedRevisions(sro(site, 'running'), sfleet('running'))).toEqual(['bbbbbbb2222222']);
			expect(waveBlockingRevisions(sro(site, 'running'), sfleet('running'))).toEqual(['bbbbbbb2222222']);
			expect(behindOfRollout(sro(site, 'running'), null, sfleet('running'))).toBe(0);
		}
	});
	it('the leader itself reads nothing from its own wave (it did not wait on itself)', () => {
		expect(waveFailedRevisions(sro('ap-southeast-2', 'running'), sfleet('running'))).toEqual([]);
	});
	it('once the leader rolled back only its ACTIVE failure counts: the build is a plain candidate again for the followers', () => {
		expect(waveFailedRevisions(sro('eu-west-1', 'rolledBack'), sfleet('rolledBack'))).toEqual([]);
		expect(behindOfRollout(sro('eu-west-1', 'rolledBack'), null, sfleet('rolledBack'))).toBe(1);
	});
});

describe('every printed "N newer builds" uses the live rule (batch4 #3d, QA17 ruling 4)', () => {
	const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444', created: '2026-01-01T00:00:00Z' };
	const follower = (extra: Record<string, unknown> = {}) => { const r = sro('eu-west-1', 'running') as any; r.status.releaseCandidates = [v47, { ...sv46, created: '2026-01-01T00:00:00Z' }]; r.status.availableReleases = [sv45, sv46, v47]; Object.assign(r, extra); return r; };
	it('blockingStory: the pinned sentence counts only the live build; blocked keeps the raw candidates', () => {
		const st = blockingStory(follower({ spec: { wantedVersion: 'b-45' } }), undefined, { fleet: sfleet('running') });
		expect(st.candidateCount).toBe(2);
		expect(st.newerCount).toBe(1);
		expect(st.consequence).toMatch(/^1 newer build is available/);
	});
	it('the promotion stuck reason (StuckBadge, BlockedRow) carries the live count', () => {
		const stuck = detectRolloutStuck(follower(), [], { now: new Date('2026-06-01T00:00:00Z'), fleet: sfleet('running') }) as any;
		expect(stuck?.kind).toBe('promotion');
		expect(stuck.candidateCount).toBe(2);
		expect(stuck.newerCount).toBe(1);
	});
	it('settled:false (fleet still loading): no sentence prints a count; settled (default): the live count', () => {
		const pinned = follower({ spec: { wantedVersion: 'b-45' } });
		const pending = blockingStory(pinned, undefined, { settled: false });
		expect(pending.consequence).toBe('Newer builds are available and none of them will deploy while the pin is set.');
		expect(pending.countPending).toBe(true);
		expect(blockingStory(pinned, undefined, { fleet: sfleet('running'), settled: true }).consequence).toMatch(/^1 newer build is available/);
	});
	/* QA21 W5: the card builder hands detectRolloutStuck its OWN fleet. Dropping or replacing that argument left every direct-call test green. */
	it('buildRolloutCards passes the fleet to detectRolloutStuck: the card stuck reason carries the live count', () => {
		const f = sfleet('running');
		const mk = () => { const rs = f.rollouts.map((r: any) => JSON.parse(JSON.stringify(r))); const r = rs.find((x: any) => x.metadata.namespace.endsWith('eu-west-1')); r.status.releaseCandidates = [v47, { ...sv46, created: '2026-01-01T00:00:00Z' }]; r.status.availableReleases = [sv45, sv46, v47]; return rs; };
		const card = buildRolloutCards(mk(), f.environments, new Date('2026-06-01T00:00:00Z')).find((c) => c.rollout.metadata?.namespace?.endsWith('eu-west-1'))!;
		const stuck = card.stuck as any;
		expect(stuck?.kind).toBe('promotion');
		expect(stuck.candidateCount).toBe(2);
		expect(stuck.newerCount).toBe(1);
	});
});
