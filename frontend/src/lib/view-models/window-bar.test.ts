import { describe, expect, it } from 'vitest';
import { windowBar } from './window-bar';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
// Wednesday 2026-11-11, 12:00 UTC = 13:00 in Zagreb (CET)
const wedNoon = new Date('2026-11-11T12:00:00Z');

describe('windowBar: today in the schedule zone', () => {
	it('draws the allowed hours of a weekday Allow rule, in the rule zone, with the now tick', () => {
		const b = windowBar({ action: 'Allow', timezone: 'Europe/Zagreb', rules: [{ timeRange: { start: '09:00', end: '18:00' }, daysOfWeek: weekdays }], active: true }, wedNoon)!;
		expect(b.allowed).toEqual([[9 / 24, 18 / 24]]);
		expect(b.now).toBeCloseTo(13 / 24);
	});
	it('draws nothing allowed on a day the rule does not name', () => {
		const sat = new Date('2026-11-14T12:00:00Z');
		const b = windowBar({ action: 'Allow', timezone: 'UTC', rules: [{ timeRange: { start: '09:00', end: '17:00' }, daysOfWeek: weekdays }], active: false }, sat)!;
		expect(b.allowed).toEqual([]);
		expect(b.now).toBeCloseTo(0.5);
	});
	it('inverts a Deny rule: the frozen hours are the gap', () => {
		const b = windowBar({ action: 'Deny', timezone: 'UTC', rules: [{ timeRange: { start: '22:00', end: '06:00' } }], active: false }, wedNoon)!;
		expect(b.allowed).toEqual([[6 / 24, 22 / 24]]);
	});
	it('makes no claim about now when the rules disagree with the controller status', () => {
		const b = windowBar({ action: 'Allow', timezone: 'UTC', rules: [{ timeRange: { start: '09:00', end: '17:00' } }], active: false }, wedNoon)!;
		expect(b.allowed).toEqual([[9 / 24, 17 / 24]]);
		expect(b.now).toBeNull();
	});
	it('is null without rules', () => {
		expect(windowBar({ action: 'Allow', rules: [] })).toBeNull();
		expect(windowBar(undefined)).toBeNull();
	});
});
