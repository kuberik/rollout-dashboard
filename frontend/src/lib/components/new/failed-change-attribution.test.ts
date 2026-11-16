/** A failed place names the change its head build holds, not the repo's newest: while dev and staging run a newer build, that one is only held. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { changes, rollouts } from './data';
import { changesPage } from './changes-page';

const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};

describe('search-indexer: prod failed on #64 while dev and staging already run #65', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('the failed change is #64, the one in the failed place', () => {
		load();
		const mine = changes('calm').items.filter((i) => i.apps.includes('search-indexer'));
		expect(mine.find((i) => i.group === 'failed')?.ref).toBe('#64');
		expect(mine.find((i) => i.ref === '#65')?.group).not.toBe('failed');
		expect(rollouts('calm').rows.find((r) => r.key === 'search-indexer@prod')?.change?.ref).toBe('#64');
	});
	it('the Team header counts 4 failing and 1 failed (catalog-api, the other recovered one, is the viewer\'s own)', () => {
		load();
		const parts = changesPage('calm').teamRollup.map((p) => (typeof p === 'string' ? p : p.text));
		expect(parts).toContain('4 failing');
		expect(parts).toContain('1 failed');
	});
});
