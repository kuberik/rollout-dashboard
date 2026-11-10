import { describe, it, expect } from 'vitest';
import { groupActivityEntries, type GroupableEntry } from './activity-groups';

function entry(partial: Partial<GroupableEntry> & { key: string; envLabel: string }): GroupableEntry {
	return {
		rolloutName: 'checkout-api',
		rolloutNamespace: 'ns',
		displayName: 'checkout-api',
		envKey: partial.envLabel,
		version: '4.43.0',
		previousVersion: '4.42.0',
		timestamp: '2026-10-09T21:36:00Z',
		href: '/rollouts/x',
		bakeStatus: 'Succeeded',
		...partial
	};
}

describe('groupActivityEntries', () => {
	it('collapses the same app + release + minute into one row', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev' }),
			entry({ key: 'b', envLabel: 'staging' }),
			entry({ key: 'c', envLabel: 'prod-us-east-1' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(1);
		expect(groups[0].members).toHaveLength(3);
	});

	it('collapses 3+ regions of one tier, lists fewer individually', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev' }),
			entry({ key: 'b', envLabel: 'staging' }),
			entry({ key: 'c', envLabel: 'prod-us-east-1' }),
			entry({ key: 'd', envLabel: 'prod-ap-southeast-2' }),
			entry({ key: 'e', envLabel: 'prod-af-south-1' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups[0].envText).toBe('dev · staging · 3 prod regions');
	});

	it('several prod entries on one default site never print "regions" (QA2)', () => {
		const entries = ['a', 'b', 'c'].map((k) => entry({ key: k, envLabel: 'prod', envKey: 'prod' }));
		expect(groupActivityEntries(entries)[0].envText).not.toMatch(/regions/);
	});

	it('lists prod individually when there are fewer than 3', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev' }),
			entry({ key: 'b', envLabel: 'prod-us-east-1' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups[0].envText).toBe('dev · prod-us-east-1');
	});

	it('does not group a different release of the same app', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev', version: '4.43.0' }),
			entry({ key: 'b', envLabel: 'staging', version: '4.42.0' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(2);
	});

	it('does not group the same release more than a minute apart', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev', timestamp: '2026-10-09T21:36:00Z' }),
			entry({ key: 'b', envLabel: 'staging', timestamp: '2026-10-09T21:41:00Z' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(2);
	});

	it('does not group mixed kinds — a release that failed in one env and succeeded in another breaks into two rows', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'staging', bakeStatus: 'Succeeded' }),
			entry({ key: 'b', envLabel: 'prod', bakeStatus: 'Failed' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(2);
		expect(groups.find((g) => g.worstBakeStatus === 'Failed')?.envText).toBe('prod');
		expect(groups.find((g) => g.worstBakeStatus === 'Succeeded')?.envText).toBe('staging');
	});

	it('does not group a rollback with a plain success, even at the same bakeStatus', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev', bakeStatus: 'Succeeded', isRollback: false }),
			entry({ key: 'b', envLabel: 'staging', bakeStatus: 'Succeeded', isRollback: true })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(2);
	});

	it('does not group a different app', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev', displayName: 'checkout-api' }),
			entry({ key: 'b', envLabel: 'dev', displayName: 'hello-world' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(2);
	});

	it('a homogeneous group reports its one shared state', () => {
		// Grouping is scoped to one kind (see the "mixed kinds" tests above),
		// so a group's members never actually disagree on `bakeStatus` — this
		// just proves the field reads that shared state correctly.
		const entries = [
			entry({ key: 'a', envLabel: 'dev', bakeStatus: 'Failed' }),
			entry({ key: 'b', envLabel: 'staging', bakeStatus: 'Failed' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups).toHaveLength(1);
		expect(groups[0].worstBakeStatus).toBe('Failed');
	});

	it('preserves newest-group-first order from the input', () => {
		const entries = [
			entry({ key: 'a', envLabel: 'dev', displayName: 'app-a', timestamp: '2026-10-09T22:00:00Z' }),
			entry({ key: 'b', envLabel: 'dev', displayName: 'app-b', timestamp: '2026-10-09T21:00:00Z' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups.map((g) => g.displayName)).toEqual(['app-a', 'app-b']);
	});

	it('a member with no env joins nothing, never a leading separator (round 7, AD finding 8)', () => {
		// "payments-svc deployed · 2.4.1" — a release-level member with no
		// recorded environment grouped alongside one that HAS one used to
		// push '' into `envParts`, and ''.join(' · ', 'dev') puts the
		// separator first with nothing before it.
		const entries = [
			entry({ key: 'a', envLabel: '', envKey: '' }),
			entry({ key: 'b', envLabel: 'dev' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups[0].envText).toBe('dev');
		expect(groups[0].envText.startsWith('·')).toBe(false);
	});

	it('every member with no env yields empty envText, not a bare separator', () => {
		const entries = [
			entry({ key: 'a', envLabel: '', envKey: '' }),
			entry({ key: 'b', envLabel: '', envKey: '' })
		];
		const groups = groupActivityEntries(entries);
		expect(groups[0].envText).toBe('');
	});
});
