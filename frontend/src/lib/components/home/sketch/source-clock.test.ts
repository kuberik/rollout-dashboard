import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource, type FleetSource } from './fleet-source.svelte';
import { NOW } from './home-data';

const src = (o: Partial<FleetSource>) => ({ rollouts: [], environments: [], rolloutDependencies: null, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'ok', healthChecks: null, github: { configured: true, connected: true, login: 'x' }, me: 'x', now: new Date('2020-01-01T00:00:00Z'), ...o }) as unknown as FleetSource;

describe('the clock pages count ages from', () => {
	afterEach(() => installLiveSource(null));
	it("is the source's own instant for a pinned source", () => {
		installLiveSource(src({}));
		expect(NOW.getTime()).toBe(Date.parse('2020-01-01T00:00:00Z'));
	});
	it('is the wall clock for the app gate, so an age and a banner that ticks agree', () => {
		installLiveSource(src({ liveClock: true }));
		expect(Math.abs(NOW.getTime() - Date.now())).toBeLessThan(1000);
	});
});
