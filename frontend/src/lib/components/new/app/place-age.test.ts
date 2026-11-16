/** A place row that reads Failing / Failed dates from when its check began failing, not from the deploy. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { install } from '../../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { ago, failureSinceAt, placesOf, rowsOf } from '../data';
import { placeAge } from './app-model';

const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};

describe('placeAge on a failed place', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it.each(['checkout-gateway', 'catalog-api'])('%s: the age is the failure age (failure.since), the same one the banner prints', (app) => {
		load();
		const p = placesOf('calm', app).find((x) => x.state === 'failed')!;
		const row = rowsOf('calm', p.tier, p.label).find((r) => r.app === app && r.group === 'failed');
		expect(row).toBeTruthy();
		const since = failureSinceAt(row!.href);
		expect(since).toBeTruthy();
		expect(placeAge(row!, 'calm')).toBe(ago(since));
	});
});
