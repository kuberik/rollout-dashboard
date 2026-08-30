/**
 * ⭐ THE PRODUCT UPDATES IN PLACE AND NEVER SAID SO OUT LOUD.
 *
 * Audited 2026-08-30: across every page there was exactly ONE `aria-live` /
 * `role=alert` in the whole frontend (`dependencies/+page.svelte:797`). Every
 * other change — a deploy finishing, a bake going green, a health check
 * failing, a version copied to the clipboard, a change-version request
 * succeeding or failing — was announced only by pixels moving. On a dashboard
 * whose entire job is telling an operator that something changed while they
 * were watching, that is the defect, not a nicety.
 *
 * Two channels, and the choice between them is the same one the design rules
 * make about ink: `polite` for the ordinary, `assertive` ONLY for the thing
 * that would have been drawn as the alarm.
 */
let politeMessage = $state('');
let assertiveMessage = $state('');

export const liveMessages = {
	get polite() {
		return politeMessage;
	},
	get assertive() {
		return assertiveMessage;
	}
};

/**
 * Announce `message` to assistive technology. Repeating the same string is a
 * no-op for a live region, so a zero-width space is appended on repeats to
 * force it to re-fire.
 */
export function announce(message: string, mode: 'polite' | 'assertive' = 'polite') {
	if (!message) return;
	if (mode === 'assertive') {
		assertiveMessage = assertiveMessage === message ? message + '​' : message;
	} else {
		politeMessage = politeMessage === message ? message + '​' : message;
	}
}

/** Test seam — reset both channels. */
export function resetAnnouncements() {
	politeMessage = '';
	assertiveMessage = '';
}
