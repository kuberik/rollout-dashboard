import { describe, it, expect } from 'vitest';
import { computeBakeProgress } from './bake-progress';

describe('computeBakeProgress', () => {
	const now = new Date('2026-07-19T12:10:00Z');
	it('returns null when start time missing', () => {
		expect(computeBakeProgress(undefined, '30m', now)).toBeNull();
	});
	it('returns null when bakeTime missing or unparseable', () => {
		expect(computeBakeProgress('2026-07-19T12:00:00Z', undefined, now)).toBeNull();
		expect(computeBakeProgress('2026-07-19T12:00:00Z', 'nonsense', now)).toBeNull();
	});
	it('computes fraction clamped to [0,1]', () => {
		const r = computeBakeProgress('2026-07-19T12:00:00Z', '30m', now)!;
		expect(r.totalMs).toBe(30 * 60 * 1000);
		expect(r.elapsedMs).toBe(10 * 60 * 1000);
		expect(r.fraction).toBeCloseTo(1 / 3, 5);
	});
	it('clamps fraction at 1 when elapsed exceeds total', () => {
		const r = computeBakeProgress('2026-07-19T11:00:00Z', '30m', now)!;
		expect(r.fraction).toBe(1);
	});
});
