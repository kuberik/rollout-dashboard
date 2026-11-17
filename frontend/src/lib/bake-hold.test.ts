import { describe, it, expect } from 'vitest';
import { bakeElapsedMs, bakeHeldMs, bakePaused } from './bake-hold';
import { computeBakeProgress } from './view-models/bake-progress';

const now = new Date('2026-01-01T12:10:00Z');
const start = '2026-01-01T12:00:00Z';

describe('bake hold', () => {
	it('absent fields change nothing', () => {
		expect(bakePaused({})).toBe(false);
		expect(bakeHeldMs({}, now)).toBe(0);
		expect(bakeElapsedMs({ bakeStartTime: start }, now)).toBe(600_000);
	});
	it('past holds do not count', () => {
		expect(bakeElapsedMs({ bakeStartTime: start, bakeHeldDuration: '1m30s' }, now)).toBe(510_000);
	});
	it('a current hold stops the clock at its start', () => {
		const e = { bakeStartTime: start, bakeHeldDuration: '1m', bakeHoldStartTime: '2026-01-01T12:05:00Z' };
		expect(bakePaused(e)).toBe(true);
		expect(bakeElapsedMs(e, now)).toBe(240_000);
		expect(bakeElapsedMs(e, new Date('2026-01-01T12:20:00Z'))).toBe(240_000);
	});
	it('computeBakeProgress carries held time and paused', () => {
		const p = computeBakeProgress(start, '20m', now, { bakeHoldStartTime: '2026-01-01T12:05:00Z' });
		expect(p).toMatchObject({ elapsedMs: 300_000, totalMs: 1_200_000, paused: true });
		expect(computeBakeProgress(start, '20m', now)?.paused).toBe(false);
	});
});
