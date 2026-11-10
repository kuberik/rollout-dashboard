import { afterEach, describe, expect, it } from 'vitest';
import raw from '$lib/view-models/home/fixtures/incident-input.json';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildTopology, deployNameOf, placeKeyOf, upstreamOf, waveReady, lockstepMismatch } from '$lib/view-models/sites-waves';
import type { Environment, Rollout } from '../../types';

/**
 * THE WAVE INVARIANTS OF THE FIXTURES (sites and waves, lane B).
 *
 * The controller (environment-controller feat/sites-and-waves) lets a wave-N site run a revision
 * only after every live site of wave N-1 baked it, unless the site is a follower, which just runs
 * what its leader selected. A fixture that breaks that draws a fleet the controller could never
 * produce, so every fixture list the dashboard is fed is checked: the Home incident fixture and the
 * MOCK_API scenarios (calm, incident, wide).
 *
 * "Baked" is read from the rollouts' own histories: a site baked R when one of its Succeeded entries
 * is R or a LATER build (a newer bake supersedes an older one). Release order is the order a tag
 * first appeared anywhere in the app's histories.
 */
type List = { environments: Environment[]; rollouts: Rollout[] };

const fixtureList = (): List => raw as unknown as List;
const mockList = (scenario: 'calm' | 'incident' | 'wide'): List => {
	resetDemoState(scenario);
	const b = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	return { environments: b.environments.items, rollouts: b.rollouts.items };
};

const LISTS: [string, () => List][] = [
	['incident fixture', fixtureList],
	['mock calm', () => mockList('calm')],
	['mock incident', () => mockList('incident')],
	['mock wide', () => mockList('wide')]
];

const isDup = (e: Environment) =>
	!!e.status?.conditions?.some((c) => c.type === 'WaveReady' && c.reason === 'DuplicateSite');

const rolloutOf = (l: List, e: Environment) =>
	l.rollouts.find(
		(r) => r.metadata?.namespace === e.metadata?.namespace && r.metadata?.name === e.spec?.rolloutRef?.name
	);

/** tag -> first time it appeared in any rollout of the app's environments. */
function releaseOrder(l: List, envs: Environment[]): (tag: string) => number {
	const first = new Map<string, number>();
	for (const e of envs)
		for (const h of rolloutOf(l, e)?.status?.history ?? []) {
			const t = Date.parse(h.timestamp ?? '');
			const tag = h.version?.tag;
			if (tag && Number.isFinite(t) && (!first.has(tag) || t < first.get(tag)!)) first.set(tag, t);
		}
	return (tag) => first.get(tag) ?? Infinity;
}

const apps = (l: List) => {
	const m = new Map<string, Environment[]>();
	for (const e of l.environments) {
		const k = deployNameOf(e);
		m.set(k, [...(m.get(k) ?? []), e]);
	}
	return m;
};

describe.each(LISTS)('%s', (_name, build) => {
	afterEach(() => resetDemoState('calm'));

	it('no wave-N site runs a build some live wave-(N-1) site has not baked (followers excepted)', () => {
		const l = build();
		for (const [app, envs] of apps(l)) {
			const order = releaseOrder(l, envs);
			const topo = buildTopology(envs).get(app)!;
			for (const t of topo.tiers)
				for (const w of t.waves) {
					if (w.wave === 1) continue;
					const prev = t.waves.find((x) => x.wave < w.wave && x.wave === Math.max(...t.waves.filter((y) => y.wave < w.wave).map((y) => y.wave)));
					for (const s of w.sites) {
						if (!s.env || s.deregistered || !s.isLeader) continue;
						const cur = rolloutOf(l, s.env)?.status?.history?.[0]?.version?.tag;
						if (!cur) continue;
						for (const p of prev?.sites.filter((x) => x.env && !x.deregistered) ?? []) {
							const baked = (rolloutOf(l, p.env!)?.status?.history ?? []).some(
								(h) => h.bakeStatus === 'Succeeded' && order(h.version?.tag ?? '') >= order(cur)
							);
							expect(
								baked,
								`${app}: ${t.tier}/${s.site} (wave ${w.wave}) runs ${cur}, ${t.tier}/${p.site} (wave ${p.wave}) has not baked it`
							).toBe(true);
						}
					}
				}
		}
	});

	it('exactly one leader per wave, and it is the one every member reports', () => {
		const l = build();
		for (const [app, envs] of apps(l)) {
			const topo = buildTopology(envs).get(app)!;
			for (const t of topo.tiers)
				for (const w of t.waves) {
					const live = w.sites.filter((s) => !s.deregistered && s.env);
					const leaders = live.filter((s) => s.env!.status?.wave?.role === 'Leader');
					expect(leaders.map((s) => s.site), `${app} ${t.tier} wave ${w.wave}`).toHaveLength(1);
					for (const s of live) expect(s.env!.status?.wave?.leader).toBe(leaders[0].site);
					expect(w.leader).toBe(leaders[0].site);
				}
		}
	});

	it('a DuplicateSite object is never a place: not counted, attached to its owner', () => {
		const l = build();
		for (const [app, envs] of apps(l)) {
			const topo = buildTopology(envs).get(app)!;
			const dups = envs.filter(isDup);
			for (const d of dups) {
				const all = topo.tiers.flatMap((t) => t.sites);
				expect(all.some((s) => s.env === d)).toBe(false);
				const owner = all.find((s) => s.duplicates.includes(d));
				expect(owner, `${app}: the duplicate attaches to a site`).toBeDefined();
				expect(waveReady(d).blocker?.kind).toBe('duplicate');
				// no role, and its gate lets nothing through
				expect(d.status?.wave?.role).toBeUndefined();
				expect(rolloutOf(l, d)?.status?.gates?.[0]?.allowedVersions).toEqual([]);
			}
			const live = envs.filter((e) => !isDup(e));
			const places = new Set(live.map((e) => placeKeyOf(e, envs)));
			expect(places.size).toBe(live.length);
			expect(topo.tiers.reduce((n, t) => n + t.liveCount, 0)).toBe(live.length);
		}
	});

	it('place keys are the old names: the tier, or prod-<site> while the tier has several sites', () => {
		const l = build();
		for (const e of l.environments.filter((x) => !isDup(x))) {
			const ns = e.metadata?.namespace ?? '';
			const key = placeKeyOf(e, l.environments);
			const multi = !!e.spec?.site && e.spec.environment === 'prod' && key !== 'prod';
			if (multi) expect(key).toBe(`prod-${e.spec!.site}`);
			else expect(['dev', 'test', 'staging', 'prod']).toContain(key);
			expect(ns.endsWith(key) || ns === 'default', `${ns} vs ${key}`).toBe(true);
		}
	});
});

describe('the incident fixture wave assignment', () => {
	const l = fixtureList();
	const envs = l.environments.filter((e) => e.spec?.name === 'checkout-api-service');
	const topo = buildTopology(envs).get('kuberik-checkout-api-service')!;
	const prod = topo.tiers.find((t) => t.tier === 'prod')!;

	it('sites on the newest build are wave 1 and the lowest name leads', () => {
		expect(prod.waves.map((w) => [w.wave, w.leader, w.sites.map((s) => s.site)])).toEqual([
			[1, 'eu-central', ['eu-central']],
			[2, 'ap-southeast-2', ['ap-southeast-2', 'us-east-1', 'us-east-2']],
			[3, 'af-south-1', ['af-south-1']]
		]);
		expect(prod.waves[0].sites[0].bakeStatus).toBe('Succeeded');
	});
	it('af-south-1 waits for us-east-2 to finish baking b-42', () => {
		const af = prod.sites.find((s) => s.site === 'af-south-1')!;
		expect(waveReady(af.env!).blocker).toMatchObject({ kind: 'member', tier: 'prod', site: 'us-east-2', what: 'bake' });
		expect(upstreamOf(topo, af).map((s) => s.site)).toEqual(['ap-southeast-2', 'us-east-1', 'us-east-2']);
	});
	it('nothing in the fixture is lockstep or a duplicate', () => {
		for (const e of l.environments) {
			expect(e.spec?.lockstep).toBeUndefined();
			expect(isDup(e)).toBe(false);
			expect(lockstepMismatch(e)).toBeNull();
			expect(e.spec).not.toHaveProperty('relationship');
		}
	});
});

describe('hello-waves scenarios', () => {
	afterEach(() => resetDemoState('calm'));
	const topoOf = (s: 'calm' | 'incident' | 'wide') => {
		const l = mockList(s);
		const envs = l.environments.filter((e) => e.spec?.name === 'hello-waves-app');
		return { l, envs, topo: buildTopology(envs).get('kuberik-hello-waves-app')! };
	};
	const site = (t: ReturnType<typeof topoOf>, tier: string, s: string) =>
		t.topo.tiers.find((x) => x.tier === tier)!.sites.find((x) => x.site === s)!;

	it('calm: every site Ready on one build', () => {
		const t = topoOf('calm');
		expect(t.envs).toHaveLength(5);
		for (const e of t.envs) expect(waveReady(e)).toMatchObject({ ready: true });
		expect(new Set(t.topo.tiers.flatMap((x) => x.sites).map((s) => s.revision)).size).toBe(1);
	});
	it('incident: the follower deploys while the leader bakes, ap-south-1 waits on us-east-1', () => {
		const t = topoOf('incident');
		expect(site(t, 'prod', 'eu-west-1')).toMatchObject({ isLeader: true, bakeStatus: 'InProgress' });
		expect(site(t, 'prod', 'us-east-1')).toMatchObject({ isLeader: false, bakeStatus: 'Deploying' });
		const ap = site(t, 'prod', 'ap-south-1');
		expect(ap.wave).toBe(2);
		expect(waveReady(ap.env!).blocker).toMatchObject({ kind: 'member', tier: 'prod', site: 'us-east-1', what: 'bake', rev: 'c6f19d2' });
	});
	it('wide: lockstep holds the leader, one site disagrees, a scratch namespace duplicates a site', () => {
		const t = topoOf('wide');
		expect(waveReady(site(t, 'prod', 'eu-west-1').env!).blocker).toMatchObject({ kind: 'lockstep', tier: 'prod', site: 'ap-south-1' });
		const mism = t.envs.map(lockstepMismatch).filter((x) => x);
		expect(mism).toHaveLength(1);
		expect(mism[0]).toMatchObject({ leader: 'eu-west-1', lockstep: true, sites: [{ tier: 'prod', site: 'ap-south-1' }] });
		const dup = t.envs.find(isDup)!;
		expect(dup.metadata?.namespace).toBe('hello-waves-prod-us-east-1-scratch');
		expect(waveReady(dup).blocker).toMatchObject({ kind: 'duplicate', site: 'us-east-1', owner: { namespace: 'hello-waves-prod-us-east-1', name: 'hello-waves-app' } });
		expect(t.topo.tiers.find((x) => x.tier === 'prod')!.liveCount).toBe(3);
	});
});
