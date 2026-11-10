/**
 * Placement of the Approve confirm popover (desktop, >= 640). Right edge to the trigger's right edge, then clamped INSIDE the
 * main content region (`bounds`), not the viewport: a trigger near main's left edge (an Attention card, a /rollouts row) used to
 * push a right-aligned 320px panel left over the sidebar. If main is narrower than the panel plus gutters, the start edge wins.
 */
export type Box = { top: number; left: number; right: number; bottom: number };
export const APPROVE_W = 320;
const GUTTER = 8;

export function approvePlace(anchor: Box, vw: number, vh: number, bounds?: { left: number; right: number } | null, w = APPROVE_W) {
	const lo = Math.max(GUTTER, (bounds?.left ?? 0) + GUTTER);
	const hi = Math.min(vw, bounds?.right ?? vw) - GUTTER - w;
	const left = Math.max(lo, Math.min(anchor.right - w, hi));
	const below = anchor.bottom + GUTTER + 150 < vh;
	return { left, width: w, ...(below ? { top: anchor.bottom + GUTTER } : { bottom: vh - anchor.top + GUTTER }) };
}
