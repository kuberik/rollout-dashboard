/**
 * The hide timer of a toast. Every call (re)starts the countdown, so a newer toast is never cut short by the timer of an older one
 * (a failure at 0s and a success at 2s: the success stays its full `ms`).
 */
export function toastHideTimer(hide: () => void, ms = 3000): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		clearTimeout(timer);
		timer = setTimeout(hide, ms);
	};
}
