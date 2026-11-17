import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps } from './data';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';

/** The failure line of an app tile: the check's name takes danger ink while it fails now, neutral ink once its checks are OK again. */
const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
const lead = (app: string) => {
	load();
	const m = apps('calm');
	const item = m.items.find((a) => a.app === app)!;
	const { lane, last } = laneOf(item as never, m.R.c.m as never, m.R.c.events as never);
	const c = render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'calm', last, recent: [], lead: false, attention: true } as never }).container;
	return c.querySelector<HTMLElement>('[data-fp-line2] p > span.font-medium');
};
describe('Facia failure lead ink', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('a recovered failure: neutral ink', () => {
		const el = lead('search-indexer');
		expect(el?.textContent).toMatch(/HighLatency|alerts/i);
		expect(el!.className).toContain('text-fg-muted');
		expect(el!.className).not.toContain('text-danger');
	});
	it('a check failing now: danger ink', () => {
		expect(lead('orders-hub')!.className).toContain('text-danger');
	});
});
