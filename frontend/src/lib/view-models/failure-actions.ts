/**
 * The one recommended action of a failed place, decided once for every surface that offers it.
 *
 * A failure whose checks are all OK again ("recovered") is most likely a flake, so the reasonable next step is to retry the
 * deploy; Roll back stays one step away. A failure still failing now keeps Roll back first. Surfaces that cannot retry in
 * place send "Retry" to the rollout, where the retry (and its confirmation) lives.
 *
 * Role: the order of the actions, nothing else (labels, icons and hrefs belong to the surface). No existing helper chose
 * between the two, which is why every surface had drawn its own order.
 */

export interface FailureActs<A> {
	primary?: A;
	secondary: A[];
}

/**
 * Recovered: Retry is primary, Roll back the first secondary. Failing now: Roll back is primary, Retry the first secondary.
 * `rest` (Open rollout and the like) follows in the given order. An action the surface does not offer is skipped, and the
 * other takes the primary slot only when the recommended one is missing on a recovered failure.
 */
export function failureActs<A>(recovered: boolean, o: { retry?: A | null; rollback?: A | null; rest?: readonly A[] }): FailureActs<A> {
	const retry = o.retry ?? undefined;
	const rollback = o.rollback ?? undefined;
	const rest = [...(o.rest ?? [])];
	if (recovered) {
		return { primary: retry ?? rollback, secondary: [...(retry && rollback ? [rollback] : []), ...rest] };
	}
	/* the fixed pair order is Roll back, then Retry: a banner row prints its secondaries before its primary, so Retry sits `after` it */
	return { primary: rollback, secondary: [...(retry ? [{ ...retry, after: true }] : []), ...rest] };
}

export type CardActKey = 'approve' | 'rollback' | 'retry' | 'open';
export interface CardAct {
	key: CardActKey;
	/** the card's one blue button; at most one per card */
	primary: boolean;
}

/**
 * The actions of a list card (AttentionCard on Home, /rollouts, /envs/<name>, /changes), in print order, decided once per state:
 *   failing now   Roll back (primary, blue) · Open rollout
 *   recovered     Roll back · Retry, both secondary: a recovered failure is the quietest card, the one blue button of a grid
 *                 belongs to the most urgent (Approve, or Roll back on a failing card)
 *   approval      Approve (primary) · Open
 * The pair is always Roll back, then Retry, as on the banners. An action the surface does not offer is skipped.
 */
export function cardActs(o: { state: 'failed' | 'approval'; recovered: boolean; rollback: boolean; retry: boolean; open: boolean; approve: boolean }): CardAct[] {
	const out: CardAct[] = [];
	if (o.state === 'approval') {
		if (o.approve) out.push({ key: 'approve', primary: true });
	} else if (o.recovered) {
		if (o.rollback) out.push({ key: 'rollback', primary: false });
		if (o.retry) out.push({ key: 'retry', primary: false });
	} else if (o.rollback) out.push({ key: 'rollback', primary: true });
	if (o.open) out.push({ key: 'open', primary: false });
	return out;
}

/** the label order of the pair on every surface, whichever is the primary: Roll back, then Retry */
export const failureActionOrder = (_recovered: boolean): readonly ('retry' | 'rollback')[] => ['rollback', 'retry'];

/**
 * The palette's one action for a failed rollout row (also what ↵ does), the same primary the cards carry: a failure still failing
 * leads with Roll back (the rollout opens its Roll back dialog, `query`), a recovered one with Retry, which lives on the rollout's
 * Overview (`sub: undefined`) with its typed confirm. On the Overview already, Retry would be a no-op link, so the row falls back to
 * the logs. "Open logs" stays on the row as its secondary (`FAILED_ROW_SECONDARY`).
 */
export function failedRowAction(recovered: boolean, onOverview: boolean): { label: string; sub: 'logs' | undefined; query?: string } {
	if (!recovered) return { label: 'Roll back', sub: undefined, query: 'action=rollback' };
	return !onOverview ? { label: 'Retry', sub: undefined } : { label: 'Open logs', sub: 'logs' };
}
export const FAILED_ROW_SECONDARY = { label: 'Open logs', sub: 'logs' as const };

/**
 * The rank of an Attention item, the order every Attention list and its rollup read: a failure live now (0), a wait for approval (1),
 * a recovered failure (2). A person is waiting on an approval, a recovered failure is optional work.
 */
export const attentionRank = (state: 'failed' | 'approval', recovered: boolean): number => (state === 'failed' ? (recovered ? 2 : 0) : 1);
