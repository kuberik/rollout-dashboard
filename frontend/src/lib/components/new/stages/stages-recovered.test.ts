/** An app whose failed place has recovered reads `failed` in the stage rollup, and `failing` only while a check fails now. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { install } from '../../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { stagesOf } from './stages-model';
import { ago, failureSinceAt } from '../data';
import { waveMark } from '$lib/view-models/wave-mark';

const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};

describe('app-scope stage rollup: failed vs failing', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('a recovered failure (catalog-api) reads `1 failed`', () => {
		load();
		const t = stagesOf({ kind: 'app', app: 'catalog-api' }, 'calm').rollup.text;
		expect(t).toMatch(/1 failed/);
		expect(t).not.toMatch(/failing/);
	});
	it('a check failing now (checkout-gateway) reads `1 failing`', () => {
		load();
		expect(stagesOf({ kind: 'app', app: 'checkout-gateway' }, 'calm').rollup.text).toMatch(/1 failing/);
	});
});

describe('a failed stage row follows the same failed/failing rule as the rollup', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	const failedPlaces = (app: string) => stagesOf({ kind: 'app', app }, 'calm').lanes.flatMap((l) => l.cells.flatMap((c) => c.places)).filter((p) => p.state === 'failed');
	it('the word, the recovered flag and the mark label for a check failing now', () => {
		load();
		const [p] = failedPlaces('checkout-gateway');
		expect(p.word).toBe('Failing');
		expect(p.recovered).toBe(false);
		expect(waveMark([{ state: 'failed', recovered: p.recovered }], 'prod').label).toBe('prod: 1 failing');
	});
	it('a recovered failure reads Failed, in the word and in the mark label', () => {
		load();
		const [p] = failedPlaces('catalog-api');
		expect(p.word).toBe('Failed');
		expect(p.recovered).toBe(true);
		expect(waveMark([{ state: 'failed', recovered: true }], 'prod').label).toBe('prod: 1 failed');
	});
	it("the row's age is the failure's age, not the deploy's", () => {
		load();
		const [p] = failedPlaces('checkout-gateway');
		const since = failureSinceAt(p.href);
		expect(since).toBeTruthy();
		expect(p.age).toBe(ago(since));
	});
});
