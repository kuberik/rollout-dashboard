import { describe, expect, it } from 'vitest';
import { activityAnnouncement, entryKey, findEntryIndex } from './activity-deeplink';

describe('entryKey — the correlation key shared by chart marks and feed rows', () => {
	it('joins cluster, namespace, name, timestamp and history id', () => {
		expect(
			entryKey({ cluster: 'spoke', rolloutNamespace: 'dev', rolloutName: 'hello-world-app', timestamp: '2026-08-29T10:31:17Z', historyId: 7 })
		).toBe('spoke/dev/hello-world-app/2026-08-29T10:31:17Z/7');
	});

	it('differs for two entries of one rollout in the same second (failed deploy + its automatic rollback)', () => {
		// hello-multi-app on the kind preview: ids 25 and 26 share 14:18:11Z.
		const base = { rolloutNamespace: 'hello-multi-dev', rolloutName: 'hello-multi-app', timestamp: '2026-11-21T14:18:11Z' };
		expect(entryKey({ ...base, historyId: 25 })).not.toBe(entryKey({ ...base, historyId: 26 }));
	});

	it('differs for the same ns/name/time on two clusters', () => {
		const base = { rolloutNamespace: 'dev', rolloutName: 'a', timestamp: '2026-11-21T14:18:11Z', historyId: 3 };
		expect(entryKey({ ...base, cluster: '' })).not.toBe(entryKey({ ...base, cluster: 'spoke' }));
	});

	it('a precomputed key wins over the fields (a feed row whose timestamp is a display instant)', () => {
		expect(entryKey({ rolloutNamespace: 'x', rolloutName: 'y', timestamp: 'z', key: 'k' })).toBe('k');
	});

	it('differs when only the rollout differs (same moment, two apps)', () => {
		const t = '2026-08-29T10:31:17Z';
		const a = entryKey({ rolloutNamespace: 'dev', rolloutName: 'hello-world-app', timestamp: t });
		const b = entryKey({ rolloutNamespace: 'dev', rolloutName: 'hello-multi-app', timestamp: t });
		expect(a).not.toBe(b);
	});

	it('differs when only the timestamp differs (a rollback re-deploying the same build)', () => {
		const base = { rolloutNamespace: 'dev', rolloutName: 'hello-world-app' };
		const a = entryKey({ ...base, timestamp: '2026-08-29T10:31:17Z' });
		const b = entryKey({ ...base, timestamp: '2026-08-31T09:00:00Z' });
		expect(a).not.toBe(b);
	});

	it('is the same string whether computed off a feed row or a chart lane history entry', () => {
		// The two shapes this key has to unify: ActivityEntry (the page) and
		// chartServices[i].history[j] (fed to DeploymentTimeline) — both only
		// need to structurally satisfy FeedEntryLike.
		const feedRow = {
			rolloutNamespace: 'staging',
			rolloutName: 'hello-multi-app',
			timestamp: '2026-08-30T00:00:00Z',
			displayName: 'hello-multi-app', // extra fields a feed row carries
			bakeStatus: 'Succeeded'
		};
		const chartHistoryEntry = {
			rolloutNamespace: 'staging',
			rolloutName: 'hello-multi-app',
			timestamp: '2026-08-30T00:00:00Z',
			version: { tag: 'v1' } // extra fields a chart entry carries
		};
		expect(entryKey(feedRow)).toBe(entryKey(chartHistoryEntry));
	});
});

describe('findEntryIndex', () => {
	const entries = [
		{ rolloutNamespace: 'dev', rolloutName: 'a', timestamp: '2026-08-29T10:00:00Z' },
		{ rolloutNamespace: 'dev', rolloutName: 'b', timestamp: '2026-08-29T11:00:00Z' },
		{ rolloutNamespace: 'staging', rolloutName: 'a', timestamp: '2026-08-29T10:00:00Z' }
	];

	it('finds the matching index', () => {
		expect(findEntryIndex(entries, entryKey(entries[1]))).toBe(1);
	});

	it('a different namespace with the same name/timestamp does not collide', () => {
		expect(findEntryIndex(entries, entryKey(entries[2]))).toBe(2);
	});

	it('returns -1 for a key that names nothing (stale link, filtered out, evicted)', () => {
		expect(findEntryIndex(entries, 'prod/gone/2020-01-01T00:00:00Z')).toBe(-1);
	});

	it('returns -1 for null/undefined inputs rather than throwing', () => {
		expect(findEntryIndex(entries, null)).toBe(-1);
		expect(findEntryIndex(entries, undefined)).toBe(-1);
		expect(findEntryIndex(null, 'x')).toBe(-1);
		expect(findEntryIndex(undefined, 'x')).toBe(-1);
	});

	it('returns -1 on an empty want string', () => {
		expect(findEntryIndex(entries, '')).toBe(-1);
	});

	describe('same-second entries', () => {
		const t = '2026-11-21T14:18:11Z';
		const same = [
			{ rolloutNamespace: 'hello-multi-dev', rolloutName: 'hello-multi-app', timestamp: t, historyId: 26 },
			{ rolloutNamespace: 'hello-multi-dev', rolloutName: 'hello-multi-app', timestamp: t, historyId: 25 }
		];
		it('a new key resolves to its own entry', () => {
			expect(findEntryIndex(same, entryKey(same[1]))).toBe(1);
			expect(findEntryIndex(same, entryKey(same[0]))).toBe(0);
		});
		it('a legacy key (no id) resolves to the newest match', () => {
			expect(findEntryIndex(same, `hello-multi-dev/hello-multi-app/${t}`)).toBe(0);
			expect(findEntryIndex([...same].reverse(), `hello-multi-dev/hello-multi-app/${t}`)).toBe(1);
		});
		it('a legacy key matches a precomputed key by its deploy timestamp, not the display one', () => {
			const rows = [{ rolloutNamespace: 'n', rolloutName: 'a', timestamp: '2026-11-21T14:23:02Z', key: '/n/a/2026-11-21T14:22:00Z/27', historyId: 27 }];
			expect(findEntryIndex(rows, 'n/a/2026-11-21T14:22:00Z')).toBe(0);
			expect(findEntryIndex(rows, 'n/a/2026-11-21T14:23:02Z')).toBe(-1);
		});
		it('a legacy key with nothing matching is -1', () => {
			expect(findEntryIndex(same, 'hello-multi-dev/hello-multi-app/2020-01-01T00:00:00Z')).toBe(-1);
		});
	});
});

describe('activityAnnouncement', () => {
	it('says Selected on first arrival', () => {
		const msg = activityAnnouncement({
			version: '0afab6f',
			subject: 'hello-world-app',
			envLabel: 'dev',
			timestamp: '2026-08-29T10:31:17Z',
			wasAlreadySelected: false
		});
		expect(msg).toContain('Selected 0afab6f on hello-world-app in dev');
	});

	it('says Showing when the row was already the selected one', () => {
		const msg = activityAnnouncement({
			version: '0afab6f',
			subject: 'hello-world-app',
			envLabel: 'dev',
			timestamp: '2026-08-29T10:31:17Z',
			wasAlreadySelected: true
		});
		expect(msg.startsWith('Showing')).toBe(true);
	});

	it('omits the place when there is no env label', () => {
		const msg = activityAnnouncement({
			version: '0afab6f',
			subject: 'hello-world-app',
			envLabel: null,
			timestamp: '2026-08-29T10:31:17Z',
			wasAlreadySelected: false
		});
		expect(msg).not.toContain(' in ');
		expect(msg).toContain('Selected 0afab6f on hello-world-app,');
	});
});
