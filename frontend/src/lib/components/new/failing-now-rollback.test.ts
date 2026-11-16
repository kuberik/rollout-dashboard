/**
 * A failing-now place offers Roll back wherever it is listed, whoever owns the app: the viewer is often not the author.
 * The action comes from the rollouts model (home/roster/roster-data.ts), so a place that is not the viewer's still has one.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { rolloutsPage } from './rollouts-page';
import { rollouts, actionFor } from './data';

describe('failing-now places that are not the viewer\'s still offer Roll back', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('every failed row (the banner lead included) carries a rollback action', () => {
		resetDemoState('calm');
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
		installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as never);
		const failed = rollouts('calm').rows.filter((r) => r.group === 'failed');
		expect(failed.length).toBeGreaterThan(3);
		expect(failed.some((r) => !r.needsYou)).toBe(true);
		for (const r of failed) expect(actionFor(r)?.kind, r.key).toBe('rollback');
		for (const a of rolloutsPage('calm').attention.filter((x) => x.model.state === 'failed')) expect(a.rollbackHref, a.app).toBeTruthy();
	});
});
