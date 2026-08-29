import type { AppGroup, AppCell } from '$lib/version-utils';
import { getDisplayVersion } from '$lib/utils';
import { buildLadder, divergedFromLine } from './build-ladder';

/**
 * ONE DENOMINATOR FOR "HOW FAR BEHIND IS THIS ENVIRONMENT", PRODUCT-WIDE.
 *
 * `/apps/[name]` already had the right answer and called it THE ONE
 * DENOMINATOR: a build's rank is a property OF THE BUILD, so the same build
 * prints the same `−N` wherever it appears. It computed that rank inline from
 * `buildLadder`, which meant every OTHER page that wanted a `−N` had to invent
 * one. Three did, and measured on one fixture rollout — `checkout-edge` in
 * prod — they disagreed:
 *
 *   /apps/[name]    −19   ladder rank (correct: 19 builds newer than d09e6f4)
 *   /apps           −17   `cellLag`, the HOP to its upstream (staging is −2)
 *   /envs/prod      −17   same hop
 *   /environments    −2   the index of the version in the list of DISTINCT
 *                         versions currently deployed, capped at
 *                         `versionCount − 1`. Not a lag at all.
 *
 * All four printed into the same chip geometry, so one glyph carried three
 * different meanings and one of them was arithmetic noise. This module is that
 * derivation lifted out of the page, unchanged, so the pages share it instead
 * of each keeping an opinion.
 *
 * WHY THE HOP LAG LOST. "staging is 2 behind dev" is a real question, but it is
 * not the question the `−N` chip is asking anywhere else in the product, and it
 * is not stable: it changes when a DIFFERENT environment deploys. A rank is a
 * fact about the build in the row; a hop is a fact about two rows. Only one of
 * those can be printed in a chip beside a sha without lying about what the
 * number counts.
 */
export type RankVerdict =
	/** Rank 0 on this app's ladder — nothing newer exists. */
	| { kind: 'newest' }
	/** `by` builds newer than this one exist on the app's ladder. */
	| { kind: 'behind'; by: number }
	/**
	 * Running a build that is on no environment's release line, deployed inside
	 * the window that line still covers. A rank here is not a distance:
	 * promoting N times never arrives at it. See `divergedFromLine`.
	 */
	| { kind: 'diverged' }
	/**
	 * Nothing deployed, or the comparison cannot be resolved. Callers must
	 * print NO NUMBER — never a `0`, which reads as "newest".
	 */
	| { kind: 'unknown' };

function cellVersion(cell: AppCell): string | null {
	const v = cell.rollout?.status?.history?.[0]?.version;
	return v ? getDisplayVersion(v) || null : null;
}

function cellDeployedMs(cell: AppCell): number {
	const ts = cell.rollout?.status?.history?.[0]?.timestamp;
	if (!ts) return 0;
	const t = new Date(ts).getTime();
	return Number.isFinite(t) ? t : 0;
}

/**
 * Every cell in the group, ranked against the app's ONE ladder.
 *
 * Returned as a map keyed by cell so callers pay for the ladder once per app
 * rather than once per row — `/environments` renders 22 environments over 6
 * apps and would otherwise rebuild the same ladder 22 times.
 */
export function rankVerdicts(group: AppGroup): Map<AppCell, RankVerdict> {
	const ladder = buildLadder(group.cells);
	const out = new Map<AppCell, RankVerdict>();
	for (const cell of group.cells) {
		const version = cellVersion(cell);
		if (!version) {
			out.set(cell, { kind: 'unknown' });
			continue;
		}
		if (divergedFromLine(ladder, version, cellDeployedMs(cell))) {
			out.set(cell, { kind: 'diverged' });
			continue;
		}
		const rank = ladder.rankOf(version);
		if (rank < 0) out.set(cell, { kind: 'unknown' });
		else if (rank === 0) out.set(cell, { kind: 'newest' });
		else out.set(cell, { kind: 'behind', by: rank });
	}
	return out;
}

/** One environment tier's verdict within an app, or `unknown` if unbound. */
export function rankVerdictFor(group: AppGroup, envTier: string): RankVerdict {
	const cell = group.cells.find(
		(c) => (c.environment?.spec?.environment ?? c.envName) === envTier
	);
	if (!cell) return { kind: 'unknown' };
	return rankVerdicts(group).get(cell) ?? { kind: 'unknown' };
}

/**
 * The chip label, or null when there is nothing honest to print.
 *
 * `unknown` returns null on purpose. DESIGN.md: never render an unresolvable
 * comparison as a definite claim — silence beats a confident wrong number.
 */
export function rankLabel(v: RankVerdict): string | null {
	switch (v.kind) {
		case 'newest':
			return 'newest';
		case 'behind':
			return `−${v.by}`;
		case 'diverged':
			return 'diverged';
		default:
			return null;
	}
}

/** The Chip role that matches the verdict, or null when nothing prints. */
export function rankRole(v: RankVerdict): 'newest' | 'rank' | 'diverged' | null {
	switch (v.kind) {
		case 'newest':
			return 'newest';
		case 'behind':
			return 'rank';
		case 'diverged':
			return 'diverged';
		default:
			return null;
	}
}

/**
 * How many builds behind, for sorting and counting only — 0 for every state
 * that is not `behind`. Do NOT render this: a `0` from `unknown` and a `0`
 * from `newest` mean different things and neither is a lag.
 */
export function rankBehindBy(v: RankVerdict): number {
	return v.kind === 'behind' ? v.by : 0;
}

/** Anything that needs a person's attention about propagation. */
export function rankIsAdverse(v: RankVerdict): boolean {
	return v.kind === 'behind' || v.kind === 'diverged';
}
