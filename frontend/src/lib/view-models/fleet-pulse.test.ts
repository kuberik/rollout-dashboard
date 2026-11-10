import { describe, expect, it } from 'vitest';
import type { Rollout } from '../../types';
import { deltaPct, fleetPulse } from './fleet-pulse';

const D = 86_400_000;
const NOW = Date.UTC(2026, 9, 9, 12);
const r = (name: string, env: string, entries: [number, string, string][]): Rollout =>
	({
		metadata: { name, namespace: `${name}-${env}` },
		status: {
			history: entries.map(([agoMs, version, bake]) => ({
				version: { version, tag: version },
				timestamp: new Date(NOW - agoMs).toISOString(),
				bakeStatus: bake
			}))
		}
	}) as unknown as Rollout;

const dev = r('api', 'dev', [[1 * D, 'v2', 'Succeeded'], [3 * D, 'v1', 'Succeeded'], [13.9 * D, 'v0', 'Succeeded']]);
const prod = r('api', 'prod', [[0.5 * D, 'v2', 'Succeeded'], [2 * D, 'v1', 'Failed'], [9 * D, 'v0', 'Succeeded']]);
const env = new Map([[dev, 'dev'], [prod, 'prod']]);
const envFor = (x: Rollout) => env.get(x) ?? '';

describe('fleetPulse', () => {
	const p = fleetPulse([dev, prod], NOW, '7d', { envFor });
	it('counts deploys and failures inside the window, and the window before', () => {
		expect(p.deploys).toEqual({ value: 4, prev: 2 });
		expect(p.failed).toEqual({ value: 1, prev: 0 });
		expect(p.hasPrev).toBe(true);
	});
	it('bins every deploy exactly once', () => {
		expect(p.bins.reduce((n, b) => n + b.succeeded + b.failed + b.inFlight, 0)).toBe(4);
	});
	it('measures lead time from the first environment to production, arrivals in the window only', () => {
		// v2: dev 1d ago → prod 0.5d ago = 12h; v1: dev 3d → prod 2d = 24h. Median = 18h.
		expect(p.leadMs.value).toBe(18 * 3_600_000);
		expect(p.leadApps).toBe(1);
	});
	it('marks first production arrivals and failures', () => {
		expect(p.markers.map((m) => m.kind).sort()).toEqual(['failed', 'release']);
	});
	it('never draws a previous period the history does not reach', () => {
		const q = fleetPulse([r('x', 'dev', [[1 * D, 'v1', 'Succeeded']])], NOW, '7d');
		expect(q.hasPrev).toBe(false);
		expect(q.deploys.prev).toBeNull();
		expect(q.bins.every((b) => b.prev === null)).toBe(true);
	});
});

describe('deltaPct', () => {
	it('stays silent on a thin previous sample', () => {
		expect(deltaPct({ value: 30, prev: 4 })).toBeNull();
		expect(deltaPct({ value: 30, prev: 20 })).toBe(50);
		expect(deltaPct({ value: 1, prev: null })).toBeNull();
	});
});
