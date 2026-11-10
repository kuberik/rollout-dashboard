import { afterEach, describe, expect, test } from 'vitest';
import { displayTimeZoneName, formatClockTime, formatTimestamp, startOfDayMs, zonedYMD } from './display-time';
import { setDisplayTimeZone } from './timezone.svelte';

afterEach(() => setDisplayTimeZone('local'));

describe('display timezone helpers', () => {
	test('UTC mode names UTC and buckets by the UTC day', () => {
		setDisplayTimeZone('utc');
		const late = new Date('2026-10-07T23:30:00Z');
		expect(displayTimeZoneName(late)).toBe('UTC');
		expect(zonedYMD(late)).toEqual({ year: 2026, month: 9, day: 7 });
		expect(startOfDayMs(late)).toBe(Date.UTC(2026, 9, 7));
		expect(formatTimestamp(late).endsWith(' UTC')).toBe(true);
	});

	test('local mode buckets by the browser day', () => {
		setDisplayTimeZone('local');
		const d = new Date('2026-10-07T23:30:00Z');
		expect(zonedYMD(d)).toEqual({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() });
		expect(startOfDayMs(d)).toBe(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
	});

	test('an unparseable timestamp prints nothing', () => {
		expect(formatTimestamp('not a date')).toBe('');
	});
});

/**
 * D-10/D-17 (2026-10-08): ONE clock formatter. `/activity`, the change page
 * and `ActivityRail` must print the identical string for the same instant
 * because they all call `formatClockTime` — this pins its output matrix and
 * guards that none of those call sites formats a clock time itself.
 */
describe('formatClockTime — the one 24h clock', () => {
	test('UTC: zero-padded 24h, seconds only on request, never AM/PM', () => {
		setDisplayTimeZone('utc');
		expect(formatClockTime('2026-10-08T09:05:07Z')).toBe('09:05');
		expect(formatClockTime('2026-10-08T10:05:07Z')).toBe('10:05');
		expect(formatClockTime('2026-10-08T21:05:07Z')).toBe('21:05');
		expect(formatClockTime('2026-10-08T09:05:07Z', { seconds: true })).toBe('09:05:07');
		expect(formatClockTime('2026-10-08T21:05:07Z')).not.toMatch(/AM|PM/i);
	});

	test('Local follows the toggle: same instant, browser zone, still 24h', () => {
		setDisplayTimeZone('local');
		const d = new Date('2026-10-08T21:05:07Z');
		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		expect(formatClockTime(d)).toBe(`${hh}:${mm}`);
	});

	test('an unparseable value prints nothing', () => {
		expect(formatClockTime('nope')).toBe('');
	});

	test('the activity and activity-rail clocks hold formatClockTime, not their own', async () => {
		const files = import.meta.glob(
			['../routes/activity/+page.svelte', './components/ActivityRail.svelte'],
			{ query: '?raw', import: 'default', eager: true }
		) as Record<string, string>;
		// the change page (Folio, r34 v2) draws no wall-clock times any more; ages only
		expect(Object.keys(files)).toHaveLength(2);
		for (const [path, src] of Object.entries(files)) {
			expect(src, path).toContain('formatClockTime');
			// a comment may still NAME the old call; code may not CALL it
			expect(src.replace(/\/\/.*$/gm, ""), path).not.toMatch(/\.toLocaleTimeString\(/);
		}
	});
});
