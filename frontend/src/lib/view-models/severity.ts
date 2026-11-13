/**
 * THE ONE SEVERITY ORDER. "Which state is worse?" is answered here and nowhere else: every headline, list sort, rollup, tile mark and
 * "worst place" fold (Home, /apps, the app page, /envs, /environments, /rollouts, /changes, the change page) ranks with `severityRank`.
 *
 *   failed > stuck > approval > held > deploying > checking > rolled back > behind > healthy > not reached
 *
 * Why this order:
 *  - failed, stuck, approval, held: each needs a PERSON. Nothing on screen changes until someone acts, so they outrank anything that
 *    moves by itself. Approval before held: an approval is a person's decision waiting right now, a held place is waiting on a rule.
 *  - deploying before checking: deploying is earlier in the pipeline and is the thing currently moving; checking is the bake after it.
 *    (Three orders used to disagree: /apps and the app page put deploying first, /envs/prod put checking first, and the /environments
 *    tile put approval last. This module replaces all of them.)
 *  - then the settled states, worst first: rolled back, behind, healthy; a place that was never reached ("none") is last.
 *
 * Each surface speaks its own vocabulary (place states `awaiting-approval`, lane states `newest`, bead states `approval-yours`, tile
 * marks), so the table below maps every spelling onto one slot. Callers pass THEIR word; nobody keeps a private order.
 * Within one slot the caller breaks ties (a place the viewer can act on first; production before the rest; newest first).
 */
export const SEVERITY_ORDER = ['failed', 'stuck', 'approval', 'held', 'deploying', 'checking', 'rolled-back', 'behind', 'healthy', 'none'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/** every spelling of the ten slots the product uses (place states, lane states, bead states, tile marks, state-word aliases) */
const SLOT: Record<string, Severity> = {
	failed: 'failed', failing: 'failed',
	stuck: 'stuck',
	approval: 'approval', 'awaiting-approval': 'approval', 'approval-yours': 'approval', waiting: 'approval',
	held: 'held', 'held-by-rule': 'held', hold: 'held',
	deploying: 'deploying', current: 'deploying',
	checking: 'checking',
	'rolled-back': 'rolled-back',
	behind: 'behind', queued: 'behind',
	healthy: 'healthy', newest: 'healthy', landed: 'healthy', live: 'healthy', running: 'healthy',
	none: 'none'
};

/** the slot a state word belongs to; null for a word the order does not know */
export const severityOf = (state: string | null | undefined): Severity | null => (state ? (SLOT[state] ?? null) : null);

/** 0 = worst. An unknown word ranks after every known slot. */
export const severityRank = (state: string | null | undefined): number => {
	const s = severityOf(state);
	return s ? SEVERITY_ORDER.indexOf(s) : SEVERITY_ORDER.length;
};

/** the most severe item (first among equals), by the item's state word */
export const mostSevere = <T>(xs: readonly T[], stateOf: (x: T) => string | null | undefined): T | null =>
	xs.reduce<T | null>((b, x) => (!b || severityRank(stateOf(x)) < severityRank(stateOf(b)) ? x : b), null);

/** the most severe state word of a list ('none' when empty) */
export const worstState = (states: readonly string[]): string => mostSevere(states, (s) => s) ?? 'none';

/** the beads' rank: the severity slot, and among approvals the one the viewer can give first (`approval-yours`) */
export const beadRank = (state: string): number => severityRank(state) * 2 + (state === 'approval' ? 1 : 0);
