import { describe, expect, it } from 'vitest';
import type { Rollout } from '../../types';
import { dayDeployBuckets } from './deploy-buckets';

const DAY = 24 * 60 * 60 * 1000;

function rollout(history: { timestamp: string; bakeStatus?: string }[]): Rollout {
	return { status: { history } } as unknown as Rollout;
}

describe('dayDeployBuckets', () => {
	it('counts a deploy that happened after today\'s midnight in the "today" bucket', () => {
		// ⛔ THE BUG THIS PINS: the previous inline math compared a day
		// BOUNDARY to a raw timestamp (`Math.floor((todayStart - ts) / day)`),
		// which floors to -1 — not 0 — for anything after today's midnight,
		// silently dropping every one of today's deploys from every bucket.
		const now = Date.UTC(2026, 9, 10, 21, 45); // 2026-10-10 21:45 UTC
		const deployedMinutesAgo = new Date(now - 3 * 60 * 1000).toISOString(); // same calendar day
		const r = rollout([{ timestamp: deployedMinutesAgo, bakeStatus: 'Succeeded' }]);

		const buckets = dayDeployBuckets([r], 7, now);

		expect(buckets).toHaveLength(7);
		expect(buckets[6].count).toBe(1); // last bucket = today
		expect(buckets.slice(0, 6).every((b) => b.count === 0)).toBe(true);
	});

	it('places deploys in the correct day bucket across a 7-day window', () => {
		const now = Date.UTC(2026, 9, 10, 12); // noon today
		const rollouts = [
			rollout([
				{ timestamp: new Date(now).toISOString() }, // today
				{ timestamp: new Date(now - DAY).toISOString() }, // yesterday
				{ timestamp: new Date(now - 6 * DAY).toISOString() }, // 6 days ago (oldest in window)
				{ timestamp: new Date(now - 8 * DAY).toISOString() } // outside the 7-day window
			])
		];

		const buckets = dayDeployBuckets(rollouts, 7, now);

		expect(buckets[6].count).toBe(1); // today
		expect(buckets[5].count).toBe(1); // yesterday
		expect(buckets[0].count).toBe(1); // 6 days ago
		expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3); // the 8-day-old one is excluded
	});

	it('flags a bucket as failed only when one of its deploys failed', () => {
		const now = Date.UTC(2026, 9, 10, 12);
		const r = rollout([
			{ timestamp: new Date(now).toISOString(), bakeStatus: 'Failed' },
			{ timestamp: new Date(now - DAY).toISOString(), bakeStatus: 'Succeeded' }
		]);

		const buckets = dayDeployBuckets([r], 7, now);

		expect(buckets[6].failed).toBe(true);
		expect(buckets[5].failed).toBe(false);
	});
});
