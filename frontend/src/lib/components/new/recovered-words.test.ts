/** A failure whose checks have all recovered reads `failed`; `failing` is a check failing now. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { changes, placesOf, tabPill } from './data';
import { serviceWord } from './changes-plumb';
import { todayRollupOf } from './env/env-page';
import { squaresWords, failedPartsOfHrefs } from './change/detail-model';

describe('squaresWords', () => {
	it('splits failing from recovered', () => {
		expect(squaresWords(['failed', 'failed', 'healthy'], 1)).toBe('1 failing · 1 failed · 1 deployed');
		expect(squaresWords(['failed', 'healthy'], 1)).toBe('1 failed · 1 deployed');
		expect(squaresWords(['failed', 'healthy'])).toBe('1 failing · 1 deployed');
	});
});
describe('serviceWord', () => {
	const s = { app: 'a', tier: 'prod', state: 'failed' as const, next: null, since: null, href: null, done: false };
	it('Failed in a place whose checks recovered, Failing otherwise', () => {
		expect(serviceWord({ ...s, recovered: true })).toBe('Failed in prod');
		expect(serviceWord(s)).toBe('Failing in prod');
	});
});
const load = () => {
		resetDemoState('calm');
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
		installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
describe('change facts from the roster', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('a change failing only where checks recovered says `Failed in`, a live failure says `Failing in`', () => {
		load();
		const facts = changes('calm').items.filter((i) => i.group === 'failed').map((i) => `${i.apps.join(',')}: ${i.fact}`);
		/* catalog-api's failed change is the viewer's own (Your changes), so the team list's recovered case is search-indexer */
		expect(facts.find((f) => f.startsWith('search-indexer'))).toMatch(/: Failed in /);
		expect(facts.find((f) => f.startsWith('checkout-gateway'))).toMatch(/: Failing in /);
	});
});

describe('failedPartsOfHrefs (Builds card, app stage rollup)', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	const failedHrefs = (app: string) => placesOf('calm', app).filter((p) => p.state === 'failed').map((p) => p.href);
	it('a recovered failure is `1 failed`, a live one `1 failing`', () => {
		load();
		expect(failedPartsOfHrefs(failedHrefs('catalog-api'))).toEqual(['1 failed']);
		expect(failedPartsOfHrefs(failedHrefs('checkout-gateway'))).toEqual(['1 failing']);
	});
});

describe('tabPill (app header, tile and rollout tab pill)', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	const failedHref = (app: string) => placesOf('calm', app).find((p) => p.state === 'failed')!.href;
	it('FAILING while a check fails now, FAILED once every check recovered', () => {
		load();
		expect(tabPill({ href: failedHref('checkout-gateway') }).word).toBe('FAILING');
		expect(tabPill({ href: failedHref('catalog-api') }).word).toBe('FAILED');
	});
});

describe('todayRollupOf (Today in <env> header)', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	const failedHref = (app: string) => placesOf('calm', app).find((p) => p.state === 'failed')!.href;
	it('a failed deploy whose checks recovered is neutral `failed`; one failing now is danger `failing`', () => {
		load();
		expect(todayRollupOf(4, [failedHref('catalog-api')])).toEqual(['4 deploys', '1 failed']);
		expect(todayRollupOf(4, [failedHref('checkout-gateway')])).toEqual(['4 deploys', { text: '1 failing', ink: 'danger' }]);
		expect(todayRollupOf(4, [failedHref('checkout-gateway'), failedHref('catalog-api')])).toEqual(['4 deploys', { text: '1 failing', ink: 'danger' }, '1 failed']);
		expect(todayRollupOf(1, [])).toEqual(['1 deploy']);
	});
});
