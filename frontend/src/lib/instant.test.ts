import { describe, it, expect } from 'vitest';
import { instantMs, oldestFirst, newestFirst, earliest, latest, isLater, isNotEarlier } from './instant';

/* string order and time order DISAGREE for each pair: the offset one and the fractional one */
const EARLY_OFFSET = '2026-11-12T10:00:00+02:00'; // 08:00Z, but sorts AFTER the Z string below
const LATE_Z = '2026-11-12T09:30:00Z';
const HALF = '2026-11-12T10:00:00.5Z'; // later than the whole-second one, but sorts BEFORE it ('.' < 'Z')
const WHOLE = '2026-11-12T10:00:00Z';

describe('instant helper', () => {
	it('orders instants, not strings', () => {
		expect(EARLY_OFFSET > LATE_Z).toBe(true); // the trap
		expect(oldestFirst(EARLY_OFFSET, LATE_Z)).toBeLessThan(0);
		expect(newestFirst(EARLY_OFFSET, LATE_Z)).toBeGreaterThan(0);
		expect(HALF < WHOLE).toBe(true); // the trap
		expect(oldestFirst(HALF, WHOLE)).toBeGreaterThan(0);
		expect(newestFirst(HALF, WHOLE)).toBeLessThan(0);
		expect(oldestFirst(WHOLE, '2026-11-12T11:00:00+01:00')).toBe(0); // same instant
	});
	it('missing and unparseable sort LAST in both directions, never NaN', () => {
		for (const bad of [null, undefined, '', 'nope']) {
			expect(oldestFirst(bad, WHOLE)).toBeGreaterThan(0);
			expect(oldestFirst(WHOLE, bad)).toBeLessThan(0);
			expect(newestFirst(bad, WHOLE)).toBeGreaterThan(0);
			expect(newestFirst(WHOLE, bad)).toBeLessThan(0);
			expect(oldestFirst(bad, null)).toBe(0);
		}
		const xs = [null, WHOLE, 'x', EARLY_OFFSET, undefined, HALF];
		expect([...xs].sort(oldestFirst).slice(0, 3)).toEqual([EARLY_OFFSET, WHOLE, HALF]);
		expect([...xs].sort(newestFirst).slice(0, 3)).toEqual([HALF, WHOLE, EARLY_OFFSET]);
	});
	it('earliest / latest / isLater / isNotEarlier', () => {
		expect(earliest([LATE_Z, EARLY_OFFSET, null])).toBe(EARLY_OFFSET);
		expect(latest([LATE_Z, EARLY_OFFSET, undefined])).toBe(LATE_Z);
		expect(earliest([WHOLE, HALF])).toBe(WHOLE);
		expect(latest([WHOLE, HALF])).toBe(HALF);
		expect(earliest(['nope', WHOLE])).toBe(WHOLE);
		expect(earliest([])).toBeNull();
		expect(latest([null, undefined])).toBeNull();
		expect(isLater(HALF, WHOLE)).toBe(true);
		expect(isLater(LATE_Z, EARLY_OFFSET)).toBe(true);
		expect(isLater(null, WHOLE)).toBe(false);
		expect(isLater(WHOLE, 'nope')).toBe(false);
		expect(isNotEarlier(WHOLE, '2026-11-12T11:00:00+01:00')).toBe(true);
		expect(isNotEarlier(null, WHOLE)).toBe(false);
		expect(instantMs('2026-11-12T10:00:00Z')).toBe(Date.parse('2026-11-12T10:00:00Z'));
		expect(instantMs('nope')).toBeNull();
	});
	it('same-format input keeps its string order', () => {
		const a = '2026-10-24T10:33:26.893Z', b = '2026-10-24T19:21:32.506Z';
		expect(oldestFirst(a, b)).toBeLessThan(0);
		expect(newestFirst(a, b)).toBeGreaterThan(0);
	});
});
