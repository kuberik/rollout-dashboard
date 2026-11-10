/**
 * ACTIVITY FIGURES (QA #21) — the three KPI facts that used to mislead, as pure functions.
 *
 * - observed span: the rate denominator is the time the cluster has actually been observed inside the window, never the nominal
 *   range. 32 deploys in the 25 minutes a young cluster has existed is not "1.3 an hour".
 * - in flight is counted in ROLLOUTS (one rollout = one thing moving), the unit Home and /rollouts count, not in history rows.
 */

/**
 * THE ONE "IN FLIGHT" PREDICATE (QA #21). A rollout is in flight while its CURRENT deploy (the newest history entry, `isLive`) is still
 * going out or being checked. An older history entry that never finished is history, not motion. The tile, the filter pill, the day
 * rollup and the filter itself all read this, so they cannot disagree; counted per rollout it is the same fact /rollouts calls "In flight".
 */
export function isInFlightEntry(e: { bakeStatus: string | null | undefined; isLive: boolean }): boolean {
	return e.isLive && (e.bakeStatus === 'InProgress' || e.bakeStatus === 'Deploying');
}

export type InFlightEntry = { rolloutKey: string; bakeStatus: string };

export function inFlightRollouts(entries: readonly InFlightEntry[]): { total: number; checking: number; deploying: number } {
	const deploying = new Set<string>();
	const checking = new Set<string>();
	for (const e of entries) {
		if (e.bakeStatus === 'Deploying') deploying.add(e.rolloutKey);
		else if (e.bakeStatus === 'InProgress') checking.add(e.rolloutKey);
	}
	// a rollout that is deploying one tier and checking another is moving once; deploying wins the word
	for (const k of deploying) checking.delete(k);
	return { total: deploying.size + checking.size, checking: checking.size, deploying: deploying.size };
}

const HOUR = 3_600_000;

/**
 * The "N an hour" / "N a day" subline for the Deploys tile. `windowMs` is the nominal range (null for All), `oldestMs` the oldest
 * event in scope. Returns undefined when less than an hour has been observed (a per-hour rate would only restate the count).
 */
export function deployRateSub(count: number, windowMs: number | null, oldestMs: number | null, nowMs: number): string | undefined {
	const observed = oldestMs !== null ? Math.max(nowMs - oldestMs, 0) : null;
	const span = windowMs === null ? observed : observed === null ? windowMs : Math.min(windowMs, observed);
	if (!span || span < HOUR) return undefined;
	if (span <= 24 * HOUR) return `${Math.round((count / (span / HOUR)) * 10) / 10} an hour`;
	return `${Math.round(count / (span / (24 * HOUR)))} a day`;
}
