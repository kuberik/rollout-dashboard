/**
 * WRAP-AWARE DETAILS ROW — the trigger shrinks to its avatar the moment the
 * row's details wrap. (History round 16, AD round 12, item 2.)
 *
 * ROLE: line 2 of a History row is a `.dot-list` (outcome · act · trigger ·
 * note). When it all fits on one line the trigger prints "avatar + name".
 * When it does not (a long act, a note, a narrow phone) the name is the one
 * fact that can be dropped losslessly — `Avatar` carries the full name as
 * `title` and `aria-label` — so the row sets `.wrap-compact` and the name
 * (`.trigger-name`) is hidden.
 *
 * It measures with the name SHOWN, always: each pass removes the class,
 * reads the children's tops synchronously, and sets the class again if they
 * differ. Evaluating the full state each time makes the result a pure
 * function of the row's width and content, so hiding the name (which may
 * un-wrap the line) can never flip it back and forth.
 */

/** True when any child sits lower than the first one (the row wrapped). */
export function topsWrap(tops: number[], tolerance = 3): boolean {
	if (tops.length < 2) return false;
	return tops.some((t) => t > tops[0] + tolerance);
}

export function wrapCompact(node: HTMLElement) {
	function fit() {
		node.classList.remove('wrap-compact');
		const tops = [...node.children]
			.filter((c) => (c as HTMLElement).offsetParent !== null || c.getClientRects().length > 0)
			.map((c) => c.getBoundingClientRect().top);
		if (topsWrap(tops)) node.classList.add('wrap-compact');
	}
	fit();
	const ro = new ResizeObserver(fit);
	ro.observe(node);
	const mo = new MutationObserver(fit);
	mo.observe(node, { childList: true, subtree: true });
	return {
		destroy() {
			ro.disconnect();
			mo.disconnect();
		}
	};
}
