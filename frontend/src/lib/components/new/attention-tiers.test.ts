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
	it('Home Fleet: a failing row ranks above a recovered one', () => {
		load('incident');
		const f = homePage('incident').fleet.trouble.filter((t) => t.mark === 'failed').map((t) => !!t.recovered);
		expect(f).toContain(true);
		expect(f).toEqual([...f].sort((a, b) => Number(a) - Number(b)));
	});
});
it('apps: live failure, recovered failure, approval, rest', () => {
	expect(attentionTier('failed', false)).toBeLessThan(attentionTier('failed', true));
	expect(attentionTier('failed', true)).toBeLessThan(attentionTier('approval', false));
	expect(attentionTier('approval', false)).toBeLessThan(attentionTier('checking', false));
});
it('changes: a recovered failure sorts after a live one even when it is older', () => {
	const mk = (k: string, recovered: boolean) => ({ k, state: 'failed', c: { failure: { recovered } } });
	const ps = [mk('rec', true), mk('live', false)];
	expect(attentionOrder(ps, (p) => (p.k === 'rec' ? '2026-11-14T10:00:00Z' : '2026-11-14T11:00:00Z')).map((p) => p.k)).toEqual(['live', 'rec']);
});
