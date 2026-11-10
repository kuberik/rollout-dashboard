import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { environmentsPage } from '$lib/components/new/environments-page';
import { placeHolds } from '$lib/components/new/data';
import { waveHold } from '$lib/components/new/app/app-model';
import { plural } from '$lib/components/new/envs-model';
import { behindOfStatus } from '$lib/view-models/behind';
import { newerReleaseCountLive } from '$lib/view-models/failed-builds';
import w33 from '$lib/components/new/fixtures/film-world-33.json';
import w46 from '$lib/components/new/fixtures/film-world-46.json';

/**
 * batch4 #3d: the landing film's REAL CRs. film-world-33/46.json are scenario-derived (website islands/src/islands/film/scenario.ts, worldAt(33)
 * and worldAt(46)): t=33 us-east-1 has just failed the bake and still runs 4.46.0-46; t=46 it is rolled back and runs 4.45.0-45 again
 * (history [45 ok, 46 FAILED, 45 ok]). The scenario gives wave-2 FOLLOWERS no blocker, but the controller writes them WaitingFor/Selection
 * with site = their leader (environment-controller internal/wave/wave.go decideFollower), so `controller()` adds it. After a rollback the
 * controller either records a new wave-1 deployment (blocker cleared, case a: the scenario) or still names the failed revision (case b: `stale`).
 * The assertions are the EXACT strings EnvTile.svelte prints for the Production tile (held: "<n> regions held · <because>", waiting: "<n> regions <because>").
 */
const REV = 'e1c7a04b8d2f19a3c5e7091b3d5f7a9c1e3b5d72';
type W = typeof w33;
const LEADER = 'checkout-api-prod-ap-southeast-2';
const WAVE2 = ['us-east-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-2'];
const controller = (w: W, stale = false): W => ({
	...w,
	environments: (w.environments as any[]).map((e) => {
		const ns: string = e.metadata.namespace;
		const wave2 = WAVE2.some((s) => ns.endsWith(s));
		const follower = wave2 && ns !== LEADER;
		const blocked = (message: string, blocker: any) => ({ ...e, status: { ...e.status, conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message }], wave: { ...e.status.wave, blocker: { reason: 'WaitingFor', environment: 'prod', ...blocker } } } });
		if (follower && (w === w33 || stale)) return blocked('prod/ap-southeast-2 selection', { site: 'ap-southeast-2', waitingOn: 'Selection' });
		if (stale && ns === LEADER) return blocked('prod/us-east-1 bake on e1c7a04', { site: 'us-east-1', waitingOn: 'Bake', revision: REV });
		return e;
	})
}) as W;
const render = (w: W): string[] => {
	installLiveSource({ ...(fixtureSource() as any), rollouts: w.rollouts, environments: w.environments } as any);
	const r = (environmentsPage('incident') as any).prod.regions;
	return [r?.held && `${plural(r.held.regions, 'region')} held · ${r.held.because}`, r?.waiting && `${plural(r.waiting.regions, 'region')} ${r.waiting.because}`].filter(Boolean);
};
const fleetOf = (w: W) => ({ environments: w.environments as any, rollouts: w.rollouts as any });
const roOf = (w: W, site: string) => (w.rollouts as any[]).find((r) => r.metadata.namespace.endsWith(site));

describe('landing film worlds: the Production tile wave line, exact strings', () => {
	afterEach(() => installLiveSource(null));
	it('t=33, the scenario as exported: every wave-2 region is held by the failure, none is merely waiting', () => {
		expect(render(w33)).toEqual(['4 regions held · us-east-1 failed the bake']);
	});
	it("t=33 with the controller's follower blockers (Selection on the leader): the same four, no neutral waiting group", () => {
		expect(render(controller(w33))).toEqual(['4 regions held · us-east-1 failed the bake']);
	});
	it('t=46 case (a), the controller cleared the blocker after a new wave-1 deployment: nothing held, nothing waiting', () => {
		expect(render(w46)).toEqual([]);
		expect(render(controller(w46))).toEqual([]);
	});
	it('t=46 case (b), the blocker still names the failed revision: the rolled-back site holds nobody', () => {
		expect(render(controller(w46, true))).toEqual([]);
	});
	it('t=46: 4.46.0-46 is not behind for any wave-2 region nor for us-east-1 (one rule: behind, rank count)', () => {
		for (const w of [w46, controller(w46, true)]) for (const s of [...WAVE2, 'us-east-1']) {
			expect(behindOfStatus(roOf(w, s), fleetOf(w))).toBe(0);
			expect(newerReleaseCountLive(roOf(w, s), fleetOf(w))).toBe(0);
		}
	});
	it('t=33: while us-east-1 still runs the failed build the wave-2 regions already do not count it', () => {
		for (const s of WAVE2) expect(behindOfStatus(roOf(w33, s), fleetOf(w33))).toBe(0);
	});
	it('t=33 the wave line names us-east-1; at t=46 (rolled back, retained Failed entry) no place prints any failed-wave sentence', () => {
		const lines = (w: W) => { render(w); const P = placeHolds('checkout-api', 'incident'); return P.map((p) => waveHold(p, P)).filter(Boolean); };
		expect(lines(w33).some((h) => h!.failed === 'us-east-1')).toBe(true);
		expect(lines(w46).filter((h) => h!.failed)).toEqual([]);
	});
	it('t=33 with a NEWER b-47 awaiting approval in every wave-2 place: the approval hold does not mask us-east-1 failure (failure first)', () => {
		const REV47 = 'f'.repeat(40);
		const cand = { tag: 'b-47', version: '4.47.0-47', revision: REV47, created: '2026-11-10T09:30:00.000Z' };
		const withB47 = (w: W): W => ({ ...w, rollouts: (w.rollouts as any[]).map((r) => WAVE2.some((s) => r.metadata.namespace.endsWith(s))
			? { ...r, status: { ...r.status, releaseCandidates: [cand, ...r.status.releaseCandidates], gates: [...r.status.gates, { name: 'release-approval', allowedVersions: ['b-44', 'b-45', 'b-46'], message: 'Waiting for approval' }].filter((g, i, a) => a.findIndex((x) => x.name === g.name) === i || g.message === 'Waiting for approval') } }
			: r) }) as W;
		expect(render(withB47(w33))).toEqual(['4 regions held · us-east-1 failed the bake']);
		const P = placeHolds('checkout-api', 'incident'), ap = P.find((p) => p.label === 'ap-southeast-2')!;
		expect(ap.heldBuilds.map((b) => b.build)).toContain('4.47.0-47');
		expect(waveHold(ap, P)!.failed).toBe('us-east-1');
	});
});
