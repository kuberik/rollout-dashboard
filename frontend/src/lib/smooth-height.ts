/**
 * ⭐ A BOX WHOSE CONTENT CHANGES HEIGHT GLIDES TO ITS NEW HEIGHT INSTEAD OF
 * SNAPPING. (2026-10-08, film/site critic.)
 *
 * When live data changes what a card holds — a failing health check with its
 * alert text becoming a pending one, a promoted build's rows — the card used
 * to change height in one frame and everything below it jumped (46px on
 * rollout detail's rail the instant Retry was pressed). This Svelte action
 * sits on the box whose height changes and turns that step into a 300 ms
 * height transition (CSS, so the film's capture harness advances it):
 *
 *   1. A `ResizeObserver` on the box's content wrapper (`inner`, its only
 *      child) reports the new natural height. It fires after layout and
 *      BEFORE paint, so pinning the box to its OLD height here means the
 *      snapped frame is never painted.
 *   2. Next frame the box transitions to the new height, clipped while it
 *      moves; on `transitionend` it returns to `height: auto`.
 *
 * Not on arrival: the first `settleMs` after mount (data loading in, a
 * skeleton being replaced) and any change from or to 0 are left alone — a
 * card animating into existence on every navigation would be a new jitter,
 * not a fix. Reduced motion: never.
 */
/**
 * ⛔ NEVER ANIMATE A HEIGHT THAT CHANGED BECAUSE THE WIDTH DID. (2026-10-09,
 * critic.) On a window resize every box re-wraps; animating that made a card
 * render its new height for a frame, snap back to the old one, then grow in
 * two retargeted stages over ~470 ms, clipping its own content meanwhile.
 * A height change is animated only when it comes from DATA: not while the
 * viewport is being resized (and for 150 ms after the last resize event),
 * and not when the box's own width changed in the same observation.
 */
let resizingUntil = 0;
if (typeof window !== 'undefined') {
	window.addEventListener(
		'resize',
		() => {
			resizingUntil = performance.now() + 150;
		},
		{ passive: true }
	);
}
const resizing = () => performance.now() < resizingUntil;

export type SmoothHeightOptions = { enabled?: boolean; settleMs?: number; durationMs?: number };

const EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';

export function smoothHeight(node: HTMLElement, options: SmoothHeightOptions = {}) {
	let opts = options;
	const inner = node.firstElementChild as HTMLElement | null;
	if (!inner || typeof ResizeObserver === 'undefined') return {};
	const mountedAt = performance.now();
	// Heights come from the ResizeObserver's own box size, in the element's
	// CSS px — the unit `style.height` takes. `getBoundingClientRect()` is in
	// VISUAL px, which differ under an ancestor's CSS `zoom` (the film's
	// capture runs at `html{zoom:1.333}`): pinning a box to a visual height
	// made it ~33% too tall and the "glide" became a jump.
	let last: number | null = null;
	let lastWidth: number | null = null;
	const sizeOf = (e: ResizeObserverEntry) =>
		e.borderBoxSize?.[0]?.blockSize ?? inner.offsetHeight;
	let animating = false;
	let raf = 0;
	/**
	 * ⛔ THE SAFETY-NET TIMER WAS KEYED TO THE *FIRST* RETARGET, NOT THE
	 * LATEST ONE. (2026-10-08, promote-beat frame audit, D-P1 follow-on.)
	 * A glide that gets RETARGETED mid-flight (content keeps changing while
	 * the box is already animating — exactly what a promote does: several
	 * `Leaving` blocks and sub-rows settle within the same ~300ms window)
	 * used to leave the ORIGINAL `setTimeout` armed. CSS silently restarts
	 * the transition's own clock on every retarget, so the box kept
	 * interpolating correctly — but the stale JS timer, still counting from
	 * the FIRST start, could fire `finish()` (snap to `height: auto`) before
	 * the retargeted transition had visually finished. Measured: a smooth
	 * ease up to ~18px/frame followed by a single ~75px snap to the final
	 * height, on both the promote growth and the finish collapse. `gen` is
	 * bumped on every start AND every retarget, and a fired timer checks it
	 * is still the CURRENT cycle before touching anything — a stale timer
	 * from an outdated cycle is now a no-op instead of an early finish.
	 */
	let gen = 0;
	let safetyTimer: ReturnType<typeof setTimeout> | undefined;

	const reduced = () =>
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	const finish = () => {
		animating = false;
		gen++;
		clearTimeout(safetyTimer);
		node.style.height = '';
		node.style.overflow = '';
		node.style.transition = '';
	};
	const armSafetyNet = () => {
		clearTimeout(safetyTimer);
		const myGen = gen;
		// A safety net in case no transitionend arrives (detached, hidden tab) —
		// or in case THIS retarget turns out to be the last one and its own
		// transitionend is what should fire `finish()` instead.
		safetyTimer = setTimeout(() => {
			if (animating && myGen === gen) finish();
		}, (opts.durationMs ?? 300) + 200);
	};
	const onEnd = (e: TransitionEvent) => {
		if (e.target === node && e.propertyName === 'height') finish();
	};
	node.addEventListener('transitionend', onEnd);

	const ro = new ResizeObserver((entries) => {
		const entry = entries[entries.length - 1];
		const next = sizeOf(entry);
		const width = entry.borderBoxSize?.[0]?.inlineSize ?? inner.offsetWidth;
		const from = last;
		const fromWidth = lastWidth;
		last = next;
		lastWidth = width;
		if (from === null) return; // the observer's first, initial report
		if (resizing() || (fromWidth !== null && Math.abs(width - fromWidth) >= 1)) {
			// Layout, not data: take the new height now, and stop any glide.
			if (animating) finish();
			return;
		}
		if (animating) {
			// Content changed again mid-glide: retarget, the transition carries
			// on — and so does the deadline that watches it (see `gen`'s note).
			if (node.style.transition) {
				node.style.height = `${next}px`;
				gen++;
				armSafetyNet();
			}
			return;
		}
		if (opts.enabled === false || reduced()) return;
		if (performance.now() - mountedAt < (opts.settleMs ?? 1000)) return;
		if (from === 0 || next === 0 || Math.abs(next - from) < 2) return;
		animating = true;
		node.style.overflow = 'hidden';
		node.style.height = `${from}px`;
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(() => {
			node.style.transition = `height ${opts.durationMs ?? 300}ms ${EASE}`;
			node.style.height = `${next}px`;
		});
		gen++;
		armSafetyNet();
	});
	ro.observe(inner);

	return {
		update(next: SmoothHeightOptions = {}) {
			opts = next;
		},
		destroy() {
			ro.disconnect();
			cancelAnimationFrame(raf);
			clearTimeout(safetyTimer);
			node.removeEventListener('transitionend', onEnd);
		}
	};
}

/**
 * ⭐ A ROW NEVER GETS SHORTER WHILE THE PAGE IS OPEN. (2026-10-08.)
 *
 * For rows whose text reflows to fewer lines when a live state resolves
 * (`Holding 3.0.0 · ledger ^6.0.0 · has 5.1.0` on two lines becoming
 * `Nothing held · …` on one): the row keeps the tallest height it has had as
 * its `min-height`, so the card — and the page below it — does not shrink
 * and jump up through a live story. A remount (navigation, reload) starts
 * fresh. Pass a new `key` to start fresh without a remount.
 *
 * ⛔ ONLY ACROSS LIVE DATA, NEVER ACROSS A RESIZE. A height measured at one
 * width is meaningless at another: after a resize or a rotation the held
 * minimum would leave a row tall and half empty. When the viewport width
 * changes (debounced, 150 ms after the last resize event) the lock is
 * dropped and the row re-measures at its new natural height.
 */
export function holdHeight(node: HTMLElement, key: unknown = undefined) {
	if (typeof ResizeObserver === 'undefined') return {};
	let max = 0;
	let k = key;
	const release = () => {
		max = 0;
		node.style.minHeight = '';
	};
	let width = typeof window === 'undefined' ? 0 : window.innerWidth;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const onResize = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			if (window.innerWidth === width) return; // a height-only change (mobile URL bar) keeps the lock
			width = window.innerWidth;
			release();
		}, 150);
	};
	window.addEventListener('resize', onResize, { passive: true });
	const ro = new ResizeObserver((entries) => {
		const h = entries[entries.length - 1].borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
		if (h > max) {
			max = h;
			node.style.minHeight = `${max}px`;
		}
	});
	ro.observe(node);
	return {
		update(next: unknown) {
			if (next !== k) {
				k = next;
				release();
			}
		},
		destroy() {
			ro.disconnect();
			clearTimeout(timer);
			window.removeEventListener('resize', onResize);
		}
	};
}
