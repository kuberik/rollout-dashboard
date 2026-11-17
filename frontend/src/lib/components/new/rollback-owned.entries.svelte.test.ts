import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import ChangeDetail from './change/ChangeDetail.svelte';
import { laneOf } from './Footprint.svelte';
import { apps, changes } from './data';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source } from '$lib/components/home/sketch/home-data';
import { WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';

/* The app tile's and the change page's Roll back follow the one ownership rule: disabled, with the reason, and not a link, when another manager owns spec.wantedVersion. */
let owner: string | null = null;
const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	if (owner) for (const r of l.rollouts.items) { r.metadata.managedFields = [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }]; r.spec = { ...(r.spec ?? {}), wantedVersion: 'pinned' }; }
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
beforeAll(() => install(true));
afterEach(() => { owner = null; installLiveSource(null); });

const rollbackOf = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-action="rollback"]')];

describe('app tile (Facia) Roll back', () => {
	const tile = (app: string) => {
		load();
		const m = apps('calm');
		const item = m.items.find((a) => a.app === app)!;
		const { lane, last } = laneOf(item as never, m.R.c.m as never, m.R.c.events as never);
		return render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'calm', last, recent: [], lead: false, attention: true } as never }).container;
	};
	it('owned elsewhere: a disabled button with the reason', () => {
		owner = 'flux-controller';
		const b = rollbackOf(tile('orders-hub'));
		expect(b.length).toBeGreaterThan(0);
		for (const e of b) {
			expect(e.tagName).toBe('BUTTON');
			expect((e as HTMLButtonElement).disabled).toBe(true);
			expect(e.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
		}
	});
	it('owned by the dashboard: a link to the rollback, no disabled button', () => {
		const c = tile('orders-hub');
		expect(rollbackOf(c)).toHaveLength(0);
		expect(c.querySelector('a[href*="action=rollback"]')).not.toBeNull();
	});
});

describe('change page (ChangeDetail) Roll back', () => {
	type R = { metadata: { name: string; namespace: string; managedFields?: unknown[] }; spec?: Record<string, unknown> };
	const own = (on: boolean) => {
		for (const r of (source().rollouts as unknown as R[]).filter((x) => x.metadata.name === 'hello-frontend-app')) {
			r.metadata.managedFields = on ? [{ manager: 'flux-controller', operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }] : undefined;
			r.spec = { ...(r.spec ?? {}), ...(on ? { wantedVersion: 'pinned' } : {}) };
		}
	};
	afterEach(() => own(false));
	const page = () => {
		const list = (changes('incident') as unknown as { items: { title: string }[] }).items;
		const change = list.find((x) => x.title === 'Improve accessibility of nav menu')!;
		return render(ChangeDetail, { props: { change, scenario: 'incident' } as never }).container;
	};
	it('owned elsewhere: a disabled button with the reason', () => {
		own(true);
		const owned = rollbackOf(page()).filter((e) => e.getAttribute('title') === WANTED_VERSION_OWNED_REASON);
		expect(owned.length, 'the failed place\'s Roll back carries the reason').toBeGreaterThan(0);
		for (const e of owned) {
			expect(e.tagName).toBe('BUTTON');
			expect((e as HTMLButtonElement).disabled).toBe(true);
		}
	});
	it('owned by the dashboard: the failed place\'s Roll back is a link, nothing carries the reason', () => {
		const b = rollbackOf(page());
		expect(b.some((e) => e.tagName === 'A' && /action=rollback/.test(e.getAttribute('href') ?? ''))).toBe(true);
		expect(b.some((e) => e.getAttribute('title') === WANTED_VERSION_OWNED_REASON)).toBe(false);
	});
});
