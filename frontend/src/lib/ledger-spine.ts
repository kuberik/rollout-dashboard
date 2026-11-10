/**
 * THE LEDGER SPINE — one line on the LIST, not a stub per row. (History,
 * round 4, 2026-10-10.)
 *
 * ROLE: the 1px `line` that runs down the History ledger's leading status
 * column from the first row's mark to the last row's mark, straight through
 * the day subheaders and any expanded panel between them (Linear's activity
 * spine; the Overview pipeline's step connector is the in-product reference).
 *
 * WHY AN ACTION: three rounds drew the line as a `::before` on every row and
 * subheader, each guessing its neighbour's padding; any row whose height
 * differed (a wrapped line 2, a chip, an expanded panel animating open) broke
 * it into stubs. Here the list measures its own first and last mark and draws
 * ONE line between them (the node's own `::before`, positioned from the three
 * custom properties this sets). It re-measures whenever the list resizes or
 * its rows change, so an expanding panel stretches the line with it.
 *
 * Contract: marks are `[data-spine-mark]` elements inside the node; the node
 * is `position: relative`. Sets `--spine-x`, `--spine-top`, `--spine-h` (px)
 * and `data-spine="on"` when there are at least two marks.
 */
export function ledgerSpine(node: HTMLElement) {
	let frame = 0;
	let last = '';

	function measure() {
		frame = 0;
		const marks = node.querySelectorAll<HTMLElement>('[data-spine-mark]');
		if (marks.length < 2) {
			if (last !== 'off') {
				node.removeAttribute('data-spine');
				node.style.setProperty('--spine-h', '0px');
				last = 'off';
			}
			return;
		}
		const base = node.getBoundingClientRect();
		const a = marks[0].getBoundingClientRect();
		const z = marks[marks.length - 1].getBoundingClientRect();
		const x = Math.round(a.left - base.left + a.width / 2 - 0.5);
		const top = Math.round(a.top - base.top + a.height / 2);
		const h = Math.max(0, Math.round(z.top - base.top + z.height / 2) - top);
		const key = `${x}/${top}/${h}`;
		if (key === last) return;
		last = key;
		node.style.setProperty('--spine-x', `${x}px`);
		node.style.setProperty('--spine-top', `${top}px`);
		node.style.setProperty('--spine-h', `${h}px`);
		node.setAttribute('data-spine', 'on');
	}
	function schedule() {
		if (!frame) frame = requestAnimationFrame(measure);
	}

	measure();
	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
	ro?.observe(node);
	const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
	mo?.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			if (frame) cancelAnimationFrame(frame);
			ro?.disconnect();
			mo?.disconnect();
		}
	};
}
