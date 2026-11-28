import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import FailureBanner from './FailureBanner.svelte';
import ChangeDetail from './change/ChangeDetail.svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps, changes } from './data';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';

/** Retry is a link to the rollout carrying `?action=retry`, which makes the rollout page open its typed confirm. Every surface that prints Retry must carry it. */
const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
const retries = (c: HTMLElement) => [...c.querySelectorAll('a')].filter((a) => /^Retry\s*[›]?$/.test(a.textContent?.trim() ?? ''));

describe('Retry links carry ?action=retry', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));

	it('FailureBanner (a recovered failure)', () => {
		const b = { title: 'app failed in prod', check: { name: 'hit ratio', message: 'ok' }, line: null, change: null, openHref: '/rollouts/prod/ns/app', rollbackHref: '/rollouts/prod/ns/app?action=rollback', recovered: true, meta: { since: '5m', sinceAt: null, build: 'abc1234' } };
		const r = retries(render(FailureBanner, { props: { b } as never }).container);
		expect(r.length).toBeGreaterThan(0);
		for (const a of r) expect(a.getAttribute('href')).toBe('/rollouts/prod/ns/app?action=retry');
	});

	it('Facia (an app tile whose failure recovered)', () => {
		load();
		const m = apps('calm');
		const item = m.items.find((a) => a.app === 'search-indexer')!;
		const { lane, last } = laneOf(item as never, m.R.c.m as never, m.R.c.events as never);
		const r = retries(render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'calm', last, recent: [], lead: false, attention: true } as never }).container);
		expect(r.length).toBeGreaterThan(0);
		for (const a of r) expect(a.getAttribute('href')).toMatch(/\?action=retry$/);
	});

	it('ChangeDetail (a change whose failed place recovered)', () => {
		load();
		const list = (changes('calm') as unknown as { items: { title: string; failure: { recovered?: boolean } | null }[] }).items;
		const hits = list.filter((c) => c.failure?.recovered);
		expect(hits.length).toBeGreaterThan(0);
		let seen = 0;
		for (const change of hits) {
			for (const a of retries(render(ChangeDetail, { props: { change, scenario: 'calm' } as never }).container)) {
				seen++;
				expect(a.getAttribute('href')).toMatch(/\?action=retry$/);
			}
		}
		expect(seen).toBeGreaterThan(0);
	});
});
