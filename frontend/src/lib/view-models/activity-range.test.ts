import { describe, it, expect } from 'vitest';
import { pickDefaultRange, RANGE_MS } from './activity-range';

const NOW = Date.parse('2026-10-09T12:00:00Z');

describe('pickDefaultRange', () => {
	it('falls back to 7d with no data', () => {
		expect(pickDefaultRange([], NOW)).toBe('7d');
	});

	it('picks 1d when almost everything happened in the last day', () => {
		const ts = Array.from({ length: 10 }, (_, i) => NOW - i * 2 * 60 * 60 * 1000); // last 20h
		expect(pickDefaultRange(ts, NOW)).toBe('1d');
	});

	it('picks 7d when the data is spread across the week, not the day', () => {
		const ts = [
			NOW - 1 * 86_400_000,
			NOW - 2 * 86_400_000,
			NOW - 3 * 86_400_000,
			NOW - 4 * 86_400_000,
			NOW - 5 * 86_400_000,
			NOW - 6 * 86_400_000
		];
		expect(pickDefaultRange(ts, NOW)).toBe('7d');
	});

	it('picks 30d when the week alone would hide most of the data', () => {
		const ts = [
			NOW - 1 * 86_400_000,
			NOW - 10 * 86_400_000,
			NOW - 15 * 86_400_000,
			NOW - 20 * 86_400_000,
			NOW - 25 * 86_400_000
		];
		expect(pickDefaultRange(ts, NOW)).toBe('30d');
	});

	it('falls through past the 30d floor when the data is older still', () => {
		// A single deploy 45 days ago: none of 1d/7d/30d reach 80% coverage
		// AND 30d itself would be empty (0 entries within it), so this
		// widens past the preferred floor to `all` — see the dedicated
		// "never a falsely empty window" test below for the exact rule.
		const ts = [NOW - 45 * 86_400_000];
		expect(pickDefaultRange(ts, NOW)).toBe('all');
	});

	it('falls through to all when even 30d would be empty — never a falsely empty window', () => {
		// Every entry is 40 days old: 1d/7d/30d all cover 0% of the data, so
		// the function must not stop at its preferred floor (30d), which
		// would open on a window with literally nothing in it.
		const ts = [NOW - 40 * 86_400_000, NOW - 41 * 86_400_000];
		expect(pickDefaultRange(ts, NOW)).toBe('all');
	});

	it('prefers 7d over 30d when 30d would clip the incident days (round 7, AD finding 1)', () => {
		// A quiet 30-day baseline (1/day) plus two incident days at 33 and 75,
		// both inside the last 7 days — 30d clears 80% coverage, but at a
		// 1-day bucket width both incident days sit far past `scaleCeiling`'s
		// clip threshold (p90*4) against the quiet baseline. 7d's own 6h
		// buckets split each incident day into four, which does not clip the
		// same way, so 7d is both dense AND renders clean.
		const ts: number[] = [];
		for (let d = 1; d <= 30; d++) ts.push(NOW - d * 86_400_000); // 1/day baseline
		for (let i = 0; i < 33; i++) ts.push(NOW - 2 * 86_400_000 - i * 1000); // day -2 spike
		for (let i = 0; i < 75; i++) ts.push(NOW - 1 * 86_400_000 - i * 1000); // day -1 spike
		expect(pickDefaultRange(ts, NOW)).toBe('7d');
	});

	it('RANGE_MS spans match the preset names', () => {
		expect(RANGE_MS['1d']).toBe(86_400_000);
		expect(RANGE_MS['7d']).toBe(7 * 86_400_000);
		expect(RANGE_MS['30d']).toBe(30 * 86_400_000);
	});
});
