/**
 * DEPLOY DAY BUCKETS — the one place a deploy's `status.history` timestamp
 * becomes "N days ago". Shared by `DeployVolumeSparkline.svelte` (every page
 * that draws the product's one green deploy-volume bar chart) and
 * `fleet/AppsDeploySpark.svelte` (`/apps`'s neutral/failure variant, which
 * needs the same bucketing plus a per-bucket failure flag).
 *
 * ⛔ THE BUG THIS REPLACES (round 5, squad-fleet /apps review): the inline
 * version compared a day BOUNDARY (`todayStart`) to a raw, not day-aligned
 * timestamp — `Math.floor((todayStart - ts) / day)`. For any deploy that
 * happened after today's midnight, `todayStart - ts` is a small NEGATIVE
 * number (between `-day` and `0`), and `Math.floor` of that is `-1`, not
 * `0` — so "today" computed as one day further back than it should, pushing
 * every one of today's deploys out of the bucket range entirely. Every
 * sparkline on every page silently showed zero bars for today, regardless
 * of how many deploys actually happened, for as long as this ran (no test
 * caught it because none existed). Day-aligning BOTH sides before
 * differencing fixes it: `startOfDayMs(ts)` vs `startOfDayMs(now)` are both
 * already on day boundaries, so the difference is an exact whole number of
 * days and `Math.round` (not `floor`) is safe.
 */
import { startOfDayMs } from '$lib/display-time';
import type { Rollout } from '../../types';

export type DeployBucket = { count: number; failed: boolean };

/**
 * `bucketCount` buckets, most recent (today) last, spanning that many
 * CALENDAR days ending today. `nowMs` anchors "today" — callers pass the
 * live clock (`$now`), never `Date.now()` directly, so this agrees with the
 * rest of a demo-clock-driven page. A bucket's `failed` is true when at
 * least one deploy in it has `bakeStatus === 'Failed'` — a historical fact
 * about that day, independent of whether the app is STILL failing now (that
 * verdict is the caller's, from the app's current state, not this bucket).
 */
export function dayDeployBuckets(rollouts: Rollout[], bucketCount: number, nowMs: number): DeployBucket[] {
	const out: DeployBucket[] = Array.from({ length: bucketCount }, () => ({ count: 0, failed: false }));
	const day = 24 * 60 * 60 * 1000;
	const todayStart = startOfDayMs(new Date(nowMs));
	for (const r of rollouts) {
		for (const h of r.status?.history ?? []) {
			if (!h.timestamp) continue;
			const ts = new Date(h.timestamp).getTime();
			const tsDayStart = startOfDayMs(new Date(ts));
			const daysAgo = Math.round((todayStart - tsDayStart) / day);
			const idx = bucketCount - 1 - daysAgo;
			if (idx < 0 || idx >= bucketCount) continue;
			out[idx].count++;
			if (h.bakeStatus === 'Failed') out[idx].failed = true;
		}
	}
	return out;
}
