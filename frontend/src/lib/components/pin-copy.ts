/**
 * ⭐ P9 — ONE VERB FOR THE UNPIN ACTION, EVERYWHERE. (2026-09-03, operator walk)
 *
 * > *"Four labels for one action: `Release the hold` (app pages) → dialog
 * > `Remove the pin on … in DEV?` → confirm `Clear Pin` → rollout page
 * > `Clear pin`."*
 *
 * `Clear pin` — sentence case — is the surviving spelling; rollout detail
 * already had it right. This module is the single place that spells it, so
 * a trigger, a dialog title and a confirm button can share the words
 * instead of retyping them and drifting again.
 *
 * The vocabulary rule this pins down is recorded in `lib/CLAUDE.md`: one
 * verb per action, across trigger, title and confirm.
 *
 * ⚠️ `ClearPinModal.svelte` is the only file in this module's own lane
 * (the "navigation" lane owns it). `Release the hold` still reads that way
 * on `/apps`, `/apps/[name]` and `NextStep.svelte` — those files belong to
 * other lanes and need to adopt `CLEAR_PIN_LABEL` themselves.
 */

/** The one control label for clearing a pin — a trigger, never a sentence. */
export const CLEAR_PIN_LABEL = 'Clear pin';

/** The dialog title: names the rollout AND the environment it acts on. */
export function clearPinDialogTitle(rolloutName: string, envLabel: string): string {
	return `Clear the pin on ${rolloutName} in ${envLabel}?`;
}
