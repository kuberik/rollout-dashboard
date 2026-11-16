/** Every Attention list ranks a failure live now above a recovered one (its checks are OK again); a person's ask or the age only breaks ties inside a tier. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { envPage } from './env/env-page';
import { homePage } from './home-page';
import { attentionTier } from './apps-page';
import { attentionOrder } from './changes-page';

const load = (hs: 'calm' | 'incident' = 'calm') => {
	resetDemoState(hs);
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'danielreed' }, me: 'danielreed', now: new Date() } as unknown as FleetSource);
};
describe('attention tiers', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	for (const hs of ['calm', 'incident'] as const) it(`${hs}: /envs/<env> has no recovered failure above a live one`, () => {
		load(hs);
		const P = envPage(hs, 'prod')!;
		const flags = P.attention.filter((a) => a.failed).map((a) => !!a.row.failure?.recovered);
		expect(flags.length).toBeGreaterThan(1);
		expect(flags).toEqual([...flags].sort((a, b) => Number(a) - Number(b)));
		expect(flags).toContain(true);
	});
	it('the Attention cards read failing now, then to approve, then recovered (the rollup order), on Home and /envs/<env>', () => {
		load('calm');
		const rank = (a: { failed: boolean; row: { failure?: { recovered?: boolean } | null } }) => (a.failed ? (a.row.failure?.recovered ? 2 : 0) : 1);
		const asks = homePage('calm').asks;
		const envAtt = envPage('calm', 'prod')!.attention;
		for (const list of [asks, envAtt]) {
			const r = list.map(rank);
			expect(r).toEqual([...r].sort((a, b) => a - b));
		}
		expect(asks.map(rank)).toEqual(expect.arrayContaining([1, 2]));
	});
	it('Home Fleet: a failing row ranks above a recovered one', () => {
		load('incident');
		const f = homePage('incident').fleet.trouble.filter((t) => t.mark === 'failed').map((t) => !!t.recovered);
		expect(f).toContain(true);
		expect(f).toEqual([...f].sort((a, b) => Number(a) - Number(b)));
	});
});
it('apps: live failure, approval, recovered failure, rest', () => {
	expect(attentionTier('failed', false)).toBeLessThan(attentionTier('failed', true));
	expect(attentionTier('failed', false)).toBeLessThan(attentionTier('approval', false));
	expect(attentionTier('approval', false)).toBeLessThan(attentionTier('failed', true));
	expect(attentionTier('failed', true)).toBeLessThan(attentionTier('checking', false));
});
it('changes: a recovered failure sorts after a live one even when it is older', () => {
	const mk = (k: string, recovered: boolean) => ({ k, state: 'failed', c: { failure: { recovered } } });
	const ps = [mk('rec', true), mk('live', false)];
	expect(attentionOrder(ps, (p) => (p.k === 'rec' ? '2026-11-14T10:00:00Z' : '2026-11-14T11:00:00Z')).map((p) => p.k)).toEqual(['live', 'rec']);
});
