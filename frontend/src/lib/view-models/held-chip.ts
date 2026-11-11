import { stateWord } from '$lib/components/new/state-words';
import { HELD_BY_PIN } from './pin-hold';

/**
 * THE LEAD OF A HELD RELEASE CANDIDATE'S CHIP (rollout detail). A candidate that only an approval refuses reads the product's one approval word,
 * "Waiting for approval", as every row, banner and rail does, never "Held by a rule" (an approval is the one rule that has a person to ask).
 * Any other mix of gates keeps the count: "Held by a rule" / "Held by 3 rules". Pure; the page only renders it.
 */
export const heldChipPhrase = (gates: readonly { clears: string }[]): string => (gates.length === 1 ? 'by a rule' : `by ${gates.length} rules`);
export function heldChipLead(gates: readonly { clears: string }[], pinned = false): string {
	if (pinned) return HELD_BY_PIN;
	if (gates.length > 0 && gates.every((g) => g.clears === 'person')) return stateWord('approval')!;
	return `Held ${heldChipPhrase(gates)}`;
}
