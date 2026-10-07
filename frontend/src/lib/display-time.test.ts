import { afterEach, describe, expect, test } from 'vitest';
import { displayTimeZoneName, formatTimestamp, startOfDayMs, zonedYMD } from './display-time';
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
