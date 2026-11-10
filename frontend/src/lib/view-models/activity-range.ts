/**
 * ACTIVITY RANGE — picks the default time window from the data, so the
 * chart never opens on a mostly-empty plot. (Round 4 review, 2026-10-09, AD
 * finding 1(a): "choose the default range from the data: the narrowest of
 * 1d/7d/30d that holds at least 80% of the window's deploys.")
 *
 * ⭐ ROUND 7 ADDENDUM (2026-10-10, AD finding 1): coverage alone picked 30d
 * for a fleet whose last-30-days baseline is 1-8 deploys/day plus two
 * incident days at 33 and 75 — legitimately ≥80% coverage, but
 * `scaleCeiling` (deploy-bars.ts, shared, not ours to change) deliberately
 * clips an extreme outlier bar to keep the baseline legible, and at 30d/All
 * BOTH incident days clip. A narrower range's own bucket grid often does
 * NOT clip the same days (finer buckets split one huge day into several
 * smaller ones), so the pick now also asks deploy-bars.ts's own
 * `bucketize`/`scaleCeiling` "would this actually render clean" — not a
 * second heuristic, the SAME one the chart itself uses to decide what's an
 * outlier. "At most one broken bar" (AD's own cap) is honoured by walking
 * 1d → 7d → 30d and taking the first with ≥80% coverage AND ≤1 bar over
 * the computed ceiling, falling back to the narrowest range that at least
 * met coverage if none clear the bar cleanly.
 */
import { bucketize, scaleCeiling } from './deploy-bars';

export type RangePreset = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';

export const RANGE_MS: Record<Exclude<RangePreset, 'all'>, number> = {
	'1h': 3_600_000,
	'6h': 21_600_000,
	'1d': 86_400_000,
	'7d': 604_800_000,
	'30d': 2_592_000_000
};

/**
 * ⭐ ROUND 7 (squad-changes, 2026-10-10) — EXPORTED, NOT MIRRORED. This
 * module is ours (not a shared file), so a caller building its own chart
 * on the same grid `pickDefaultRange` reasons about (the repository page's
 * `DeployBars` strip) imports this constant/helper instead of keeping a
 * private copy that could drift from it.
 */
export const BUCKET_WIDTH_MS: Record<'1d' | '7d' | '30d', number> = {
	'1d': 3_600_000,
	'7d': 21_600_000,
	'30d': 86_400_000
};

/** The bucket width for a given range preset — `30d`'s own default (1d) for
 *  `all`, since there is no narrower grid defined for an open-ended span. */
export function bucketWidthFor(range: RangePreset): number {
	return range === 'all' ? BUCKET_WIDTH_MS['30d'] : (BUCKET_WIDTH_MS[range as '1d' | '7d' | '30d'] ?? BUCKET_WIDTH_MS['30d']);
}

function brokenBarCount(timestampsMs: readonly number[], startMs: number, endMs: number, bucketWidthMs: number): number {
	const count = Math.max(1, Math.ceil((endMs - startMs) / bucketWidthMs));
	const buckets = bucketize(timestampsMs, startMs, endMs, count);
	const { ceiling } = scaleCeiling(buckets.map((b) => b.count));
	return buckets.filter((b) => b.count > ceiling).length;
}

/**
 * The narrowest of `1d`/`7d`/`30d` that contains at least `coverage` (default
 * 80%) of `timestampsMs` AND renders with at most one bar past the chart's
 * own clip ceiling. `30d` is the preferred floor — this does not auto-open
 * on `all` just because coverage falls short of 80%. But it DOES fall
 * through to `all` when even `30d` would be EMPTY (never a falsely empty
 * window beats "never opens wider than 30d without being asked" — an empty
 * default is the worse failure of the two, and the one this whole function
 * exists to prevent). Empty input keeps the caller's own fallback (`7d`),
 * since there is no data to fit a window to either way.
 */
/** Below this, a range is too empty to call "data-fit" even with a clean
 *  plot — a lone bar at the far right is still the wrong story. Well under
 *  the 80% "ideal" bar; just enough to rule out an accidentally-sparse pick. */
const MIN_DENSITY = 0.3;

function coverageOf(timestampsMs: readonly number[], nowMs: number, span: number): number {
	let within = 0;
	for (const t of timestampsMs) if (nowMs - t <= span) within++;
	return within / timestampsMs.length;
}

export function pickDefaultRange(
	timestampsMs: readonly number[],
	nowMs: number,
	coverage = 0.8
): RangePreset {
	if (timestampsMs.length === 0) return '7d';
	// Pass A: narrowest range that is both reasonably dense (≥30% of the
	// deploys) AND renders clean (≤1 bar past the chart's own clip ceiling).
	// Density beats the 80%-coverage ideal here on purpose — AD finding 1
	// (round 7): a range that clears 80% coverage only by including a
	// clipped outlier day is the worse chart, even though it is the "more
	// complete" one by raw count.
	for (const r of ['1d', '7d', '30d'] as const) {
		const span = RANGE_MS[r];
		if (coverageOf(timestampsMs, nowMs, span) < MIN_DENSITY) continue;
		if (brokenBarCount(timestampsMs, nowMs - span, nowMs, BUCKET_WIDTH_MS[r]) <= 1) return r;
	}
	// Pass B: the original rule — narrowest range holding ≥80%, broken bars
	// or not. Only reached when every range is either too sparse or clips
	// more than one bar at every width (nothing to pick a "clean" winner
	// from), so completeness is the tiebreaker again.
	let firstCovering: RangePreset | null = null;
	for (const r of ['1d', '7d', '30d'] as const) {
		if (coverageOf(timestampsMs, nowMs, RANGE_MS[r]) >= coverage) {
			firstCovering = r;
			break;
		}
	}
	if (firstCovering !== null) return firstCovering;
	const within30d = timestampsMs.some((t) => nowMs - t <= RANGE_MS['30d']);
	return within30d ? '30d' : 'all';
}
