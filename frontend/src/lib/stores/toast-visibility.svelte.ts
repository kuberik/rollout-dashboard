/**
 * ⭐ A TOAST OVER A HIDDEN HEADER SITS OVER CONTENT, NOT CHROME. (qa9 B2)
 *
 * On a phone the floating `Toast` docks inside the fixed app bar (see its
 * doc comment) — but the app bar auto-hides on scroll
 * (`ScrollDirectionTracker` / `.header-group[data-hidden]`). Once it is
 * hidden, that same dock position lands on top of whatever page content
 * scrolled up to fill the gap, not over empty chrome.
 *
 * This counter is the fix: a floating toast increments it on mount and
 * decrements it on unmount (see `Toast.svelte`'s `$effect`), and the root
 * layout keeps the header visible — regardless of what
 * `ScrollDirectionTracker` itself says — for as long as the count is above
 * zero. Normal auto-hide resumes the instant the last toast leaves. A
 * counter rather than a boolean so two overlapping toasts (one dismissing
 * while another arrives) don't let the first toast's unmount reveal the
 * header while the second is still showing.
 *
 * `hide()` floors at zero: a toast that force-unmounts without ever having
 * shown (e.g. `floating` flips before the mount effect ran) must never make
 * the count negative, which would otherwise require more `hide()` calls
 * than `show()` calls to recover.
 */
let showing = $state(0);

export const toastVisibility = {
	get count() {
		return showing;
	}
};

export function showToast(): void {
	showing += 1;
}

export function hideToast(): void {
	showing = Math.max(0, showing - 1);
}

/** Test seam — forget every outstanding toast. */
export function resetToastVisibility(): void {
	showing = 0;
}
