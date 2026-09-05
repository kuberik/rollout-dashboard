/**
 * ⭐ THE MOBILE HEADER'S SHOW/HIDE DECISION, ISOLATED FROM THE DOM.
 * (2026-09-05, from the human: *"On mobile the [rollout] tabs are fixed to
 * the top so we don't see them when scrolling down — that's fine to give the
 * user more space, but they need to show again as soon as the user starts
 * scrolling up. It's common UX behaviour."*)
 *
 * This is pure state fed by scrollY samples — no `window`, no
 * `ResizeObserver`, no listeners — so the decision can be unit-tested with
 * synthetic scroll sequences instead of a real browser. The root layout owns
 * the only `scroll` listener and calls `update()`; `app.css`'s
 * `.header-group` owns the actual transform, gated to below `sm`, so this
 * class has no opinion about breakpoints either.
 *
 * The rule, in one pass:
 *  - At or above the top by less than `threshold` px, ALWAYS shown — a
 *    header must never hide while the reader is still near the top of the
 *    page.
 *  - Past the threshold, any DOWNWARD movement hides it.
 *  - ANY upward movement — a single pixel is enough — reveals it, no matter
 *    how far down the page still is. That asymmetry (slow to hide, instant
 *    to reveal) is the "common UX behaviour" being matched.
 *  - No movement (`delta === 0`) leaves the current state alone.
 */
export class ScrollDirectionTracker {
	hidden = $state(false);
	#lastY = 0;
	readonly threshold: number;

	constructor(threshold = 24) {
		this.threshold = threshold;
	}

	/** Feed the current scrollY (or any monotonic scroll-offset source). */
	update(y: number): void {
		const delta = y - this.#lastY;
		this.#lastY = y;

		if (y <= this.threshold) {
			this.hidden = false;
			return;
		}
		if (delta > 0) {
			this.hidden = true;
		} else if (delta < 0) {
			this.hidden = false;
		}
	}

	/**
	 * A real navigation always lands with the header shown (see the root
	 * layout's `afterNavigate`), and `#lastY` must not carry over — the new
	 * page's first `update()` call would otherwise read as a huge upward or
	 * downward jump from wherever the last page left off.
	 *
	 * ⚠️ MEASURED: pass the ACTUAL current scroll offset, not the default 0,
	 * whenever one is available. Chrome restores the previous scroll offset
	 * on a plain reload of a page already in session history — landing at,
	 * say, y=570 with `#lastY` hardcoded to 0 made the very next real
	 * upward scroll (570 → 560) compute as delta `560 - 0 = +560`, a false
	 * DOWNWARD reading that hid the header while the reader was scrolling
	 * it INTO view. Seeding `#lastY` from the true offset up front — 0 on a
	 * fresh load, 570 on a restored one — makes that first delta honest.
	 */
	reset(y = 0): void {
		this.hidden = false;
		this.#lastY = y;
	}
}
