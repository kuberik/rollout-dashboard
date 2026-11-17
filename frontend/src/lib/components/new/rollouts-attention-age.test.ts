/** The /rollouts Attention cards date a failure from failure.since (the age the banner prints), not the deploy, and carry the instant so the card ticks. */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { rolloutsPage, attentionItem } from './rollouts-page';
import { ago } from './data';

const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};

describe('rolloutsPage attention age', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('every failed card ages from failure.since and carries it as ageAt', () => {
		load();
		const failed = rolloutsPage('calm').attention.filter((a) => a.model.state === 'failed');
		expect(failed.length).toBeGreaterThan(0);
		for (const a of failed) {
			const since = a.row.failure?.since;
			expect(since).toBeTruthy();
			expect(a.model.forAgeAt).toBe(since);
			expect(a.model.forAge).toBe(`for ${ago(since!)}`);
		}
	});
	it('a deploy older than the failure does not set the age', () => {
		load();
		const a = rolloutsPage('calm').attention.find((x) => x.model.state === 'failed')!;
		const old = { ...a.row, since: new Date(Date.now() - 40 * 86_400_000).toISOString() };
		const m = attentionItem(old, 'calm').model;
		expect(m.forAge).toBe(`for ${ago(a.row.failure!.since!)}`);
		expect(m.forAgeAt).toBe(a.row.failure!.since);
	});
});
