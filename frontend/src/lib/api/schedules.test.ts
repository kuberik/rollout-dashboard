import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { formatAbsoluteReopen, formatTransitionAt, scheduleMetaText } from './schedules';
import { setDisplayTimeZone } from '$lib/timezone.svelte';

beforeEach(() => setDisplayTimeZone('utc'));
afterEach(() => setDisplayTimeZone('local'));

// Wednesday 2026-10-07 10:00 UTC.
const now = new Date('2026-10-07T10:00:00Z');

const freeze = (active: boolean, nextTransition?: string) => ({
	metadata: {
		name: 'no-friday-afternoon-or-weekend-deploys',
		annotations: { 'gate.kuberik.com/pretty-name': 'Weekend Deploy Freeze' }
	},
	spec: { action: 'Deny' as const, timezone: 'Europe/Zurich' },
	status: { active, nextTransition }
});

const businessHours = (active: boolean, nextTransition?: string) => ({
	metadata: {
		name: 'business-hours',
		annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
	},
	spec: { action: 'Allow' as const, timezone: 'UTC' },
	status: { active, nextTransition }
});

describe('scheduleMetaText', () => {
	test('idle Deny freeze names when it starts, not a reopening', () => {
		expect(scheduleMetaText([freeze(false, '2026-10-09T12:00:00Z')], now)).toBe(
			'Deploys pause for Weekend Deploy Freeze from Fri 12:00 UTC'
		);
	});

	test('active Deny freeze reopens when it ends', () => {
		expect(scheduleMetaText([freeze(true, '2026-10-11T22:00:00Z')], now)).toBe(
			'Deploys held by Weekend Deploy Freeze · reopens Sun 22:00 UTC'
		);
	});

	test('closed Allow window reopens', () => {
		expect(scheduleMetaText([businessHours(false, '2026-10-07T13:00:00Z')], now)).toBe(
			'Deploys pause outside the Business Hours Only deploy window · reopens 13:00 UTC'
		);
	});

	test('open Allow window closes', () => {
		expect(scheduleMetaText([businessHours(true, '2026-10-07T17:00:00Z')], now)).toBe(
			'Deploys pause outside the Business Hours Only deploy window · closes 17:00 UTC'
		);
	});

	test('several windows report the earliest change by instant', () => {
		expect(
			scheduleMetaText(
				[freeze(false, '2026-10-09T12:00:00Z'), businessHours(true, '2026-10-07T17:00:00.000Z')],
				now
			)
		).toBe('2 deploy windows apply to this rollout · next change 17:00 UTC');
	});

	test('no schedules, no text', () => {
		expect(scheduleMetaText([], now)).toBeNull();
	});
});

describe('formatTransitionAt', () => {
	test('same day in the display zone has no day prefix', () => {
		expect(formatTransitionAt('2026-10-07T12:00:00Z', now)).toBe('12:00 UTC');
	});

	test('the day is the display zone day, not the browser day', () => {
		// 23:30 UTC Wednesday is Thursday in Zurich; in UTC it is still today.
		expect(formatTransitionAt('2026-10-07T23:30:00Z', now)).toBe('23:30 UTC');
	});

	test('more than a week out uses the date', () => {
		expect(formatTransitionAt('2026-10-16T12:00:00Z', now)).toBe('16 Oct 12:00 UTC');
	});
});

describe('formatAbsoluteReopen', () => {
	test('local follows the browser zone and names it', () => {
		setDisplayTimeZone('local');
		const iso = '2026-10-09T12:00:00Z';
		const clock = new Date(iso).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		expect(formatAbsoluteReopen(iso).startsWith(`${clock} `)).toBe(true);
	});
});
