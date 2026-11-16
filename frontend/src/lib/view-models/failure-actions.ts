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
	return { primary: rollback, secondary: [...(retry ? [retry] : []), ...rest] };
}

/** the label order of the same rule, for surfaces that list actions as words (the palette) */
export const failureActionOrder = (recovered: boolean): readonly ('retry' | 'rollback')[] => (recovered ? ['retry', 'rollback'] : ['rollback', 'retry']);

/**
 * The palette's one action for a failed rollout row (also what ↵ does): a recovered failure leads with Retry, which lives on the
 * rollout's Overview (`sub: undefined`); a failure still failing leads with its logs. On the Overview already, Retry would be a
 * no-op link, so the row falls back to the logs.
 */
export function failedRowAction(recovered: boolean, onOverview: boolean): { label: string; sub: 'logs' | undefined } {
	return recovered && !onOverview ? { label: 'Retry', sub: undefined } : { label: 'Open logs', sub: 'logs' };
}
