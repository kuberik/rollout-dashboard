import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { placesOf, placeHolds } from '$lib/components/new/data';
import { ledgerOf } from '$lib/components/new/app/app-model';
import { homeModel } from '$lib/components/home/sketch/home-data';
import { releaseSwitchCatalogue, install } from './release-switch-fixtures';
import type { Environment, Rollout } from '../../types';

/**
 * FIXTURES F (`ledger-api`) and G (`search-web`): the apps the pipeline's release switch is drawn against. Same state in
 * every scenario (the point is releases in flight, not an incident), so each is checked in calm and incident.
 */
const load = (scenario: 'calm' | 'incident') => {
	resetDemoState(scenario);
	const b = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	installLiveSource({ rollouts: b.rollouts.items, environments: b.environments.items, rolloutDependencies: b.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	return b as { rollouts: { items: Rollout[] }; environments: { items: Environment[] } };
};
beforeAll(() => install(true));
afterAll(() => {
	install(false);
	resetDemoState('calm');
});
afterEach(() => installLiveSource(null));

const WANT: Record<string, Record<string, string>> = {
	'ledger-api': { dev: '4.46.0-46', staging: '4.45.0-45', 'eu-west-1': '4.44.0-44', 'us-east-1': '4.44.0-44', 'ap-south-1': '4.43.0-43' },
	'search-web': { dev: '2.20.0-20', staging: '2.12.0-12', 'eu-central-1': '2.4.0-4', 'us-west-2': '2.3.0-3' }
};
const OLDEST: Record<string, string> = { 'ledger-api': '4.43.0-43', 'search-web': '2.3.0-3' };

for (const scenario of ['calm', 'incident'] as const) {
	for (const app of Object.keys(WANT)) {
		describe(`${app} (${scenario})`, () => {
			it('has a semver catalogue, newest last', () => {
				const c = releaseSwitchCatalogue(app);
				expect(c.length).toBe(app === 'ledger-api' ? 7 : 20);
				for (const r of c) expect(r.version).toMatch(/^\d+\.\d+\.0-\d+$/);
			});
			it('every place runs the build it should', () => {
				load(scenario);
				const got = Object.fromEntries(placesOf(scenario, app).map((p) => [p.label, p.version]));
				expect(got).toEqual(WANT[app]);
			});
			it('the ledger lists the catalogue newest first, down to the lowest deployed build', () => {
				load(scenario);
				const cat = releaseSwitchCatalogue(app).map((r) => r.version);
				const lowest = OLDEST[app];
				const seq = ledgerOf(placeHolds(app, scenario)).map((s) => s.build);
				expect(seq).toEqual([...cat].reverse().slice(0, cat.length - cat.indexOf(lowest)));
			});
			it('is on the Apps list and its Environments exist in every place', () => {
				const l = load(scenario);
				const envs = l.environments.items.filter((e) => e.spec?.name === app);
				expect(envs).toHaveLength(Object.keys(WANT[app]).length);
			});
		});
	}
}

describe('ledger-api prod is rolling', () => {
	it('eu-west-1 done, us-east-1 deploying, ap-south-1 not reached', () => {
		const l = load('calm');
		const bake = (ns: string) => l.rollouts.items.find((r) => r.metadata?.namespace === ns)!.status!.history![0].bakeStatus;
		expect(bake('ledger-api-prod-eu-west-1')).toBe('Succeeded');
		expect(bake('ledger-api-prod-us-east-1')).toBe('Deploying');
		expect(bake('ledger-api-dev')).toBe('InProgress');
	});
});

describe('opt-in', () => {
	it('with the flag off neither app is in the model, the rollouts or the changes feed', () => {
		install(false);
		try {
			const l = load('calm');
			const names = homeModel('calm').apps.map((a) => a.app);
			expect(names).not.toContain('ledger-api');
			expect(names).not.toContain('search-web');
			expect(l.rollouts.items.some((r) => /^(ledger-api|search-web)-/.test(r.metadata?.namespace ?? ''))).toBe(false);
			expect(JSON.stringify(JSON.parse(respond('GET', '/api/github/changes?days=365').body!))).not.toMatch(/ledger-api|search-web/);
		} finally {
			install(true);
		}
	});
});
