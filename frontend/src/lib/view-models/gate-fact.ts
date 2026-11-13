/**
 * The Gates tab header's one fact (rollout-tabs gates2, 2026-10-25; the
 * sr-gates2 line, coordinator ruling 2026-10-11). `realGateTotal` (chain
 * predecessors already excluded) is the denominator, the same number the
 * Neighbourhood card's rollup prints, so header and card cannot disagree.
 * `null` when the rollout has no gates (the card already says "0 gates").
 *
 * ONE WORD, ONE INK (visual audit #4, 2026-11-13). A GATE holds; it never
 * "fails". A failing health check is the reason the health gate holds, and
 * the rollout under it is what failed: the header's own red state pill says
 * that, and the health tile's line says "1 failing" in the failed ink. So the
 * gate fact is always "N gates holding" in held ink. It used to print
 * "1 gate failing" (red) in the header above "1 gate holding" (orange) in
 * the card rollup for the same gate.
 */
export type GateFact = { text: string; tone: 'held' | 'neutral'; holding: number };

/** how many gates hold: the reconciled count, and a failing health gate is one of them */
export const gatesHolding = (reconciledHolding: number, failing: boolean): number => Math.max(reconciledHolding, failing ? 1 : 0);

export function gateFact(
	realGateTotal: number,
	reconciledHolding: number,
	failing: boolean
): GateFact | null {
	if (realGateTotal <= 0) return null;
	const plural = realGateTotal === 1 ? '' : 's';
	const holding = Math.min(gatesHolding(reconciledHolding, failing), realGateTotal);
	if (holding > 0) {
		return {
			text:
				holding === realGateTotal
					? `${holding} gate${plural} holding`
					: `${holding} of ${realGateTotal} gates holding`,
			tone: 'held',
			holding
		};
	}
	return { text: `${realGateTotal} gate${plural}`, tone: 'neutral', holding: 0 };
}
