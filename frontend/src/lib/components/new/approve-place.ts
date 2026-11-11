/**
 * Placement of the Approve confirm popover (desktop, >= 640). It belongs to the button that opened it AND to that button's own card:
 * the panel never leaves the card (`card`: the trigger's nearest bordered card, see `ownCard`), and it is anchored from whichever
 * button edge is nearer the card's edge (a right-aligned button anchors the panel's right edge to the button's right edge; a
 * left-aligned one its left edge). A panel wider than the card is fitted to the card's width, but never below 280px: in a narrower card it extends past the card, clamped to main. A trigger as wide as the panel (a
 * full-width card button) gives the panel its own width. With no card (a bare row) the panel is clamped inside the main content
 * region (`bounds`, with a gutter), never over the sidebar, and starts at the trigger's left edge, flipping to its right edge when
 * that would run past main. Below `sm` the layer shows a bottom sheet and does not call this. Above/below flips near the viewport foot.
 */
export type Box = { top: number; left: number; right: number; bottom: number };
export const APPROVE_W = 320;
const GUTTER = 8;
/** a trigger at least this wide gives the panel its own width (so a full-width card button is not out-reached by the panel) */
const MIN_FIT = 260;
/** the panel is never narrower than this (the Cancel / Approve row must fit); a card narrower than this lets the panel extend past it, clamped to main */
export const MIN_W = 280;
/** the panel's height until it is measured */
export const APPROVE_H = 150;

/** the trigger's own card: nearest ancestor with a border and rounded corners that is wider than the trigger; null when it sits on a bare row */
export function ownCard(trigger: HTMLElement | null): Box | null {
	if (!trigger || typeof getComputedStyle === 'undefined') return null;
	const tw = trigger.getBoundingClientRect().width;
	for (let c = trigger.parentElement; c && c.tagName !== 'MAIN' && c.tagName !== 'BODY'; c = c.parentElement) {
		const cs = getComputedStyle(c);
		const r = c.getBoundingClientRect();
		if (cs.borderTopWidth !== '0px' && cs.borderTopLeftRadius !== '0px' && r.width > tw + 10) return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
	}
	return null;
}

export function approvePlace(anchor: Box, vw: number, vh: number, bounds?: { left: number; right: number } | null, w = APPROVE_W, card?: { left: number; right: number } | null, h = APPROVE_H) {
	const aw = anchor.right - anchor.left;
	if (aw >= MIN_FIT && aw < w) w = aw;
	if (card) w = Math.min(w, Math.max(card.right - card.left, MIN_W)); // fit the card, never below the floor
	w = Math.max(w, MIN_W);
	const main = { lo: Math.max(GUTTER, (bounds?.left ?? 0) + GUTTER), hi: Math.min(vw, bounds?.right ?? vw) - GUTTER };
	// the card, when there is one, is the container (kept inside main); a card narrower than the floor cannot hold the panel, so main does
	const fits = !!card && Math.min(card.right, main.hi) - Math.max(card.left, main.lo) >= w;
	const lo = card && fits ? Math.max(card.left, main.lo) : main.lo;
	const hiEdge = card && fits ? Math.min(card.right, main.hi) : main.hi;
	w = Math.min(w, Math.max(0, hiEdge - lo));
	const hi = hiEdge - w;
	const fromRight = card ? anchor.left - Math.max(card.left, main.lo) > Math.min(card.right, main.hi) - anchor.right : anchor.left > hi;
	const left = Math.max(lo, Math.min(fromRight ? anchor.right - w : anchor.left, hi));
	const below = anchor.bottom + GUTTER + h < vh;
	return { left, width: w, ...(below ? { top: anchor.bottom + GUTTER } : { bottom: vh - anchor.top + GUTTER }) };
}
