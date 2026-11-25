/**
 * DEPLOY CADENCE (the /rollouts rail's second card): per APP, how many deploys landed on each of the last N calendar days.
 * ROLE: a quiet answer to "which apps ship often" next to the list, without a second mark on every row. It is per app (rollout name), not per place,
 * because a row is app x environment and the same fact would repeat on every one of an app's rows. No new bucketing: `dayDeployBuckets` is the one
 * day-aligned counter every sparkline uses; this only groups rollouts by app and orders the result (busiest first, then name).
 */
import { dayDeployBuckets } from '$lib/view-models/deploy-buckets';
import type { Rollout } from '../../../types';

export type AppCadence = { app: string; counts: number[]; total: number; failed: boolean[] };

export function deployCadence(rollouts: Rollout[], nowMs: number, days = 14): AppCadence[] {
	const byApp = new Map<string, Rollout[]>();
	for (const r of rollouts) { const n = r.metadata?.name; if (n) byApp.set(n, [...(byApp.get(n) ?? []), r]); }
	return [...byApp.entries()]
		.map(([app, rs]) => { const b = dayDeployBuckets(rs, days, nowMs); return { app, counts: b.map((x) => x.count), total: b.reduce((n, x) => n + x.count, 0), failed: b.map((x) => x.failed) }; })
		.filter((a) => a.total > 0)
		.sort((a, b) => b.total - a.total || a.app.localeCompare(b.app));
}
