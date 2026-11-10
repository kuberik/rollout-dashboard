/**
 * The Gates tab header's one fact (rollout-tabs gates2, 2026-10-25; the
 * sr-gates2 line, coordinator ruling 2026-10-11). Worst-first: a failing check
 * outranks a hold, which outranks a calm read. `realGateTotal` (chain
 * predecessors already excluded) is the denominator, the same number the
 * Neighbourhood card's rollup prints, so header and card cannot disagree.
 * `null` when the rollout has no gates (the card already says "0 gates").
 */
export type GateFact = { text: string; tone: 'danger' | 'held' | 'neutral' };

export function gateFact(
	realGateTotal: number,
	reconciledHolding: number,
	failing: boolean
): GateFact | null {
	if (realGateTotal <= 0) return null;
	const plural = realGateTotal === 1 ? '' : 's';
	if (failing) {
		return {
			text: realGateTotal === 1 ? '1 gate failing' : `1 of ${realGateTotal} gates failing`,
			tone: 'danger'
		};
	}
	if (reconciledHolding > 0) {
		return {
			text:
				reconciledHolding === realGateTotal
					? `${reconciledHolding} gate${plural} holding`
					: `${reconciledHolding} of ${realGateTotal} gates holding`,
			tone: 'held'
		};
	}
	return { text: `${realGateTotal} gate${plural}`, tone: 'neutral' };
}
