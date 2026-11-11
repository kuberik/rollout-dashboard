/**
 * Placement of the Approve confirm popover (desktop, >= 640). It belongs to the button that opened it: left edge to the trigger's left
 * edge (the popover hangs under its own button, not across the neighbouring card), flipping to the right edge only when the start-aligned
 * panel would run past the main region. A trigger as wide as the panel (a full-width card button) gives the panel its own width, so the
 * panel does not poke out of the card. Always clamped INSIDE the main content region (`bounds`), not the viewport: a trigger near main's
 * left edge used to push the panel left over the sidebar. If main is narrower than the panel plus gutters, the start edge wins.
 */
export type Box = { top: number; left: number; right: number; bottom: number };
export const APPROVE_W = 320;
const GUTTER = 8;
/** a trigger at least this wide gives the panel its own width (so a full-width card button is not out-reached by the panel) */
const MIN_FIT = 260;

export function approvePlace(anchor: Box, vw: number, vh: number, bounds?: { left: number; right: number } | null, w = APPROVE_W) {
	const aw = anchor.right - anchor.left;
	if (aw >= MIN_FIT && aw < w) w = aw;
	const lo = Math.max(GUTTER, (bounds?.left ?? 0) + GUTTER);
	const hi = Math.min(vw, bounds?.right ?? vw) - GUTTER - w;
	const left = Math.max(lo, Math.min(anchor.left <= hi ? anchor.left : anchor.right - w, hi));
	const below = anchor.bottom + GUTTER + 150 < vh;
	return { left, width: w, ...(below ? { top: anchor.bottom + GUTTER } : { bottom: vh - anchor.top + GUTTER }) };
}
