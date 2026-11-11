/**
 * ONE AGE PER EVENT. (shared/age-lag-total, 2026-10-12, six blind reads of
 * Home: checkout-worker's failure read 43m in the Promotion Map, "8m ago" on
 * its Needs-you row, "in this state for 7m" in Your changes, and 10:26 (a
 * clock time) in the activity rail — four surfaces, four different instants
 * for the SAME event, because each one read a different field off the
 * rollout and called it "when this happened".
 *
 * This module is the one place that decides WHICH instant is "the event
 * that put this place in its current state", for every kind a card/lane
 * node/change row can be in. Every surface that prints an age — FleetRow,
 * BlockedRow/NeedsYouCard, ChangeLine (via `pr-pipeline.ts`'s cell `since`),
 * ActivityRail, PromotionMap's callouts, FailurePanel's banner — reads this,
 * never `card.timestamp`/`head.timestamp` directly for anything described as
 * "how long has this been true".
 *
 * ── THE RULES, ONE PER KIND ─────────────────────────────────────────────
 *
 * `failed` — the FAILURE's own instant, and there are genuinely two kinds of
 * failure (health-witness.ts's whole point: a deploy can succeed and the
 * HEALTH CHECK fail afterward — that is a later, separate event):
 *   - a health check is holding the rollout right now (`card.checkFailure`
 *     is set) → `checkFailure.since`, the `DeploymentBlocked` condition's
 *     own `lastTransitionTime` — the instant the controller itself marked
 *     this attempt unhealthy, which can be well after the deploy landed;
 *   - otherwise (the DEPLOY itself failed) → the failed history entry's own
 *     `bakeEndTime` (when the bake attempt concluded), falling back to its
 *     `timestamp` (when it started) if no end time was recorded. This is
 *     not a new choice: `pr-pipeline.ts`'s `since` for a `failed` cell has
 *     used exactly this formula since it was written; `historyEntrySince`
 *     below is that formula, extracted so every OTHER surface can share it
 *     instead of defaulting to the deploy's plain `timestamp` the way
 *     `FleetRow`/`BlockedRow`/`ActivityRail` each did.
 *
 * `deploying` / `checking` / `stuck` — the head history entry's own START
 * (`timestamp`): when the attempt now running (or stuck mid-run) began.
 * Never `bakeStartTime` here — `FleetRow`'s existing sentence already reads
 * plain `timestamp` for these two states and nothing about them disagreed
 * across surfaces, so this keeps that, rather than introducing a THIRD
 * instant (bakeStartTime) nothing asked to fix.
 *
 * `held` / `behind` — `waitingSince` (`fleet-facts.ts`): when the oldest
 * build newer than the one running was released. For `held` that is what
 * the hold is waiting ON; for `behind` it is the same fact under a
 * different name ("behind since …").
 */
import type { RolloutCard } from '../rollout-cards';
import { waitingSince } from './fleet-facts';
import type { NodeState } from './promotion-lanes';

export type EventKind = 'failed' | 'deploying' | 'checking' | 'stuck' | 'held' | 'behind';

/** `eventAge`'s `kind` accepts any `NodeState` so a caller already holding a
 *  `LaneNode`'s own state (`FleetRow`, `PromotionMap`) never has to narrow it
 *  first — `newest`/`none` simply have no event to report (`null`), same as
 *  an unresolvable `held`/`behind`. */
export type EventAgeKind = NodeState;

/** A minimal history-entry shape — enough for `historyEntrySince`, used by
 *  callers (ActivityRail) that hold a raw `status.history[i]`, not a built
 *  `RolloutCard`. */
export type HistoryEntryLike = {
	timestamp?: string | null;
	bakeEndTime?: string | null;
} | null | undefined;

/** The deploy event's own concluding instant — `bakeEndTime` when the
 *  attempt has one (covers `failed`/`cancelled` entries), else its start.
 *  This IS `pr-pipeline.ts`'s `since` formula for a `failed`/`cancelled`
 *  cell, extracted so a caller with only a raw history entry (never a
 *  `RolloutCard`) reads the identical rule. */
export function historyEntrySince(h: HistoryEntryLike): string | null {
	return h?.bakeEndTime ?? h?.timestamp ?? null;
}

/**
 * THE ONE "last failure" of a set of histories: the newest failed entry's own failure instant (`historyEntrySince`: when its bake ended),
 * as epoch ms, or null when none failed. The App summary, the History tab's summary and the Recent activity row all read it, so the card
 * that says "Last failure 48m ago" and the row that says "Check failed 10:31" name the same instant. `from`/`to` bound the DEPLOY's start.
 */
export function lastFailureMs(histories: ReadonlyArray<ReadonlyArray<(NonNullable<HistoryEntryLike> & { bakeStatus?: string | null }) | null | undefined>>, from = -Infinity, to = Infinity): number | null {
	let last: number | null = null;
	for (const hist of histories)
		for (const h of hist) {
			if (h?.bakeStatus !== 'Failed') continue;
			const start = h.timestamp ? new Date(h.timestamp).getTime() : NaN;
			if (!(start >= from && start <= to)) continue;
			const t = new Date(historyEntrySince(h) ?? '').getTime();
			if (Number.isFinite(t) && (last === null || t > last)) last = t;
		}
	return last;
}

/**
 * ⭐ THE ONE CALL EVERY SURFACE SHARES. Returns the ISO instant of the event
 * that put `card` into its current `kind` of state, or `null` when nothing
 * in the rollout can answer it (e.g. `held`/`behind` with no resolvable
 * newer release). The caller supplies `kind` — this never re-derives which
 * state a card is in (that is `nodeState`/`statusKey`/`checkFailure`'s job,
 * already computed once per card); it only answers "since when", the one
 * question every surface kept re-deriving differently.
 */
export function eventAge(card: RolloutCard, kind: EventAgeKind): string | null {
	// ⚠️ DEFENSIVE, NOT A SECOND DEFINITION. A handful of component fixtures
	// build a bare `{ timestamp, statusKey, … }` object and cast it to
	// `RolloutCard` (no `.rollout` at all — `NeedsYouCard.optin.svelte.test.ts`
	// is one) — real cards from `buildRolloutCards` always carry `.rollout`.
	// `card.timestamp` (the card's own pre-existing field, identical to
	// `rollout.status.history[0].timestamp`) is the fallback for exactly that
	// shape, never a path real app code takes.
	const head = card.rollout?.status?.history?.[0];
	switch (kind) {
		case 'failed': {
			if (card.checkFailure?.since) return card.checkFailure.since;
			return historyEntrySince(head) ?? card.timestamp ?? null;
		}
		case 'deploying':
		case 'checking':
		case 'stuck':
			return head?.timestamp ?? card.timestamp ?? null;
		case 'held':
		case 'behind': {
			if (!card.rollout) return null;
			const ms = waitingSince(card);
			return ms != null ? new Date(ms).toISOString() : null;
		}
		default:
			return null;
	}
}
