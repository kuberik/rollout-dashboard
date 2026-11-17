/**
 * The hide timer of a toast. Every call (re)starts the countdown, so a newer toast is never cut short by the timer of an older one
 * (a failure at 0s and a success at 2s: the success stays its full `ms`).
 *
 * An ERROR toast does not time out: when the operator has already closed the dialog, it is the only sign the request failed, so it waits
 * to be dismissed (and a later toast of any tone replaces it). One rule for every host.
 */
export function toastHideTimer(hide: () => void, ms = 3000): (tone?: string) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (tone) => {
		clearTimeout(timer);
		if (tone === 'danger' || tone === 'error') return;
		timer = setTimeout(hide, ms);
	};
}
