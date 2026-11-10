/**
 * MEDIAN TIME TO PROD — the rail's "This window" figure. Pure so the "never
 * print 0 seconds" rule (round 5 review, 2026-10-09) is provable without a
 * browser: a release whose first deploy ANYWHERE already IS its first prod
 * deploy has no transit time to measure, not a transit time of zero, so it
 * is excluded rather than counted as `0`.
 */

export type TimeToProdEntry = {
	/** Groups entries into one release — the same (app, version) pair. */
	releaseKey: string;
	timestampMs: number;
	isProd: boolean;
	/** A rollback re-deploys an OLD release: its gap to "first deploy" is how long ago the release was built, not a transit time. Skipped. (QA #21) */
	isRollback?: boolean;
};

export function medianTimeToProdMs(entries: readonly TimeToProdEntry[]): number | null {
	const byRelease = new Map<string, { first: number; prod: number | null }>();
	for (const e of entries) {
		if (e.isRollback) continue;
		const rec = byRelease.get(e.releaseKey) ?? { first: e.timestampMs, prod: null as number | null };
		if (e.timestampMs < rec.first) rec.first = e.timestampMs;
		if (e.isProd && (rec.prod === null || e.timestampMs < rec.prod)) rec.prod = e.timestampMs;
		byRelease.set(e.releaseKey, rec);
	}
	const durations: number[] = [];
	for (const rec of byRelease.values()) {
		if (rec.prod !== null && rec.prod > rec.first) durations.push(rec.prod - rec.first);
	}
	if (durations.length === 0) return null;
	durations.sort((a, b) => a - b);
	const mid = Math.floor(durations.length / 2);
	return durations.length % 2 === 1 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
}
