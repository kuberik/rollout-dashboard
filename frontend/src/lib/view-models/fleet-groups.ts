import type { RolloutCard } from '$lib/rollout-cards';
import { rankBehindBy } from './env-rank';

/**
 * ⛔ ONE GROUPING PREDICATE FOR THE FLEET. `/` AND `/rollouts` READ IT.
 * (2026-08-31)
 *
 * From a live critique: *"`/rollouts` says the fleet is fine while four other
 * surfaces say it isn't."* Its header read
 * `Attention 0 · In motion 1 · Pending 0 · Healthy 14` with `hello-world-app`
 * behind and gate-blocked in all three environments, at the same moment `/`
 * filed those three under **Trailing**, `/apps` drew a full-width amber
 * banner, `/environments` said "furthest behind: 20 versions" and `/versions`
 * said "5 blocked".
 *
 * The two pages were not disagreeing about any FACT. They were using the same
 * four words for four different sets, because `/rollouts` had a `healthy`
 * bucket that `/` does not have: `/` splits `succeeded && !stuck` into
 * **Steady** (at the head of its own release list) and **Trailing** (healthy,
 * but there is newer code it could take). `/rollouts` folded both into one
 * counter — so the page whose whole job is to let an operator scan everything
 * was the one page that could not show a lag at all.
 *
 * ⚠️ THE FIX IS NOT A NEW OPINION, IT IS THE REMOVAL OF THE SECOND ONE. Every
 * predicate below is `ControlCenter.svelte`'s, lifted verbatim. Both pages now
 * import them, so a bucket cannot drift on one surface and not the other, and
 * a rollout cannot be `Healthy` here and `Trailing` there.
 *
 * ⚠️ THE BUCKETS ARE NOT A PARTITION AND MUST NOT BE MADE ONE. A stuck rollout
 * that is also mid-deploy is in `needsYou` AND in `inMotion` — both are true,
 * and a filter tile is a question ("show me what is X"), not a slice of a pie.
 * `trailing` and `steady` ARE disjoint, and their union is exactly `healthy`.
 */

/** Failed, or stuck. The only bucket that means "wake someone up". */
export function isNeedsYou(c: RolloutCard): boolean {
	return c.statusKey === 'failed' || c.stuck != null;
}

/** Deploying or checking right now. */
export function isInMotion(c: RolloutCard): boolean {
	return c.isRunning;
}

/** Nothing deployed here yet. */
export function isPending(c: RolloutCard): boolean {
	return c.statusKey === 'pending';
}

/** Last deploy succeeded and nothing is wedged. Splits into the two below. */
export function isHealthy(c: RolloutCard): boolean {
	return c.statusKey === 'succeeded' && c.stuck == null;
}

/**
 * Healthy, but running older code than its own release list offers — or
 * running a build that is on no release line at all.
 *
 * ⛔ READS `rank`, NEVER a falsy `behind`. `rankBehindBy` is 0 for `newest`,
 * `diverged` and `unknown`, and only the first of those is steady — which is
 * why `diverged` is named explicitly here and `unknown` is not.
 */
export function isTrailing(c: RolloutCard): boolean {
	return isHealthy(c) && (rankBehindBy(c.rank) > 0 || c.rank.kind === 'diverged');
}

/**
 * Healthy and at the head of its own release list — or unresolvable, which is
 * not adverse and must not be counted as one. An `unknown` rollout has no
 * number to show; filing it under Trailing would be inventing a lag out of a
 * retention limit.
 */
export function isSteady(c: RolloutCard): boolean {
	return isHealthy(c) && (c.rank.kind === 'newest' || c.rank.kind === 'unknown');
}

export type FleetGroups = {
	needsYou: RolloutCard[];
	inMotion: RolloutCard[];
	trailing: RolloutCard[];
	steady: RolloutCard[];
	pending: RolloutCard[];
};

/** Every bucket at once, for a page that needs all five counts. */
export function fleetGroups(cards: RolloutCard[]): FleetGroups {
	return {
		needsYou: cards.filter(isNeedsYou),
		inMotion: cards.filter(isInMotion),
		trailing: cards.filter(isTrailing),
		steady: cards.filter(isSteady),
		pending: cards.filter(isPending)
	};
}
