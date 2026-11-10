import { describe, it, expect } from 'vitest';
import { formatAgoCompact, formatTimeAgoCompact } from './utils';
import { formatShortDuration } from './view-models/stage-advance';
import { waveFactOf, waveClause } from './components/new/app/app-model';

describe('one display-time format per view', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	it('formatAgoCompact is the compact idiom plus "ago", never the long form', () => {
		expect(formatAgoCompact('2026-11-10T11:59:20Z', now)).toBe('40s ago');
		expect(formatAgoCompact('2026-11-10T11:58:30Z', now)).toBe('1m ago');
		expect(formatAgoCompact('2026-11-10T09:00:00Z', now)).toBe('3h ago');
		expect(formatAgoCompact('2026-11-10T11:59:20Z', now)).toBe(`${formatTimeAgoCompact('2026-11-10T11:59:20Z', now)} ago`);
	});
	it('a bake duration drops the empty minutes: 15s, not 0m 15s', () => {
		expect(formatShortDuration(15_000)).toBe('15s');
		expect(formatShortDuration(60_000)).toBe('1m 0s');
		expect(formatShortDuration(75_000)).toBe('1m 15s');
	});
});

describe('wave clause beside a state word', () => {
	it('names the wave or the leader it follows; silent for a one-wave tier', () => {
		expect(waveFactOf({ site: 'a', wave: 2, leader: true, follows: null, multi: true })).toBe('wave 2');
		expect(waveFactOf({ site: 'a', wave: 1, leader: true, follows: null, multi: false })).toBeNull();
		expect(waveFactOf({ site: 'a', wave: 2, leader: false, follows: 'eu-west-1', multi: true })).toBe('follows eu-west-1');
		expect(waveFactOf(null)).toBeNull();
	});
	it('the dot is glued to the clause by a non-breaking space', () => {
		expect(waveClause('wave 2')).toBe('· wave 2');
	});
});
