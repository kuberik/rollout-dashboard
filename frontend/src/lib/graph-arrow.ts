/**
 * ⭐ ONE ARROWHEAD FOR EVERY DEPENDENCY GRAPH. (2026-10-09, design audit
 * `/tmp/claude/arrows-review/`.)
 *
 * The rollout Dependencies tab (`RolloutNeighbourhood`) and `/dependencies`
 * (`DependencyNetwork`, on xyflow) drew two different heads: 6–7 px heads
 * scaled by stroke width on the tab, xyflow's 14×14 `ArrowClosed` on the page,
 * and two quiet inks. This is the one spec both import:
 *
 *   - shape: xyflow's 5:8 closed head — viewBox `0 0 10 16`, `M0,0 L10,8 L0,16 z`
 *   - size: fixed CSS px (`markerUnits="userSpaceOnUse"`), so a 2 px held
 *     stroke does not grow its head: held 7.5 × 12, quiet 5.625 × 9
 *   - the head's BASE sits on the path's end (`refX = 0`) and its tip
 *     `length` px further on, in the direction the path ends in — so a
 *     renderer ends its path `length` px short of the edge it points at, and
 *     the head is a straight continuation of the line, never a chord laid
 *     back over a curve
 *   - one held stroke (2 px) and one quiet stroke (1 px), one quiet ink
 */
export const ARROW_VIEWBOX = '0 0 10 16';
export const ARROW_PATH = 'M0,0 L10,8 L0,16 z';

export type WireKind = 'held' | 'quiet';

export const ARROW = {
	held: { length: 7.5, width: 12, stroke: 2 },
	quiet: { length: 5.625, width: 9, stroke: 1 }
} as const;

/** Hex literals because an SVG marker `color` and xyflow's edge style take a
 *  literal. Held = Tailwind v4 orange-700 / orange-400 (the Chip `held` role);
 *  quiet = gray-300 / gray-600, the tab's existing quiet ink. */
export const WIRE_INK = {
	held: { light: '#ca3500', dark: '#ff8904' },
	quiet: { light: '#d1d5dc', dark: '#4a5565' }
} as const;

export function wireKind(state: 'blocked' | 'clear' | 'unknown'): WireKind {
	return state === 'blocked' ? 'held' : 'quiet';
}

/**
 * Crisp lines: a 2 px stroke centred on an integer covers two whole pixel
 * rows; a 1 px stroke needs a .5 centre. Snaps a coordinate a line runs ALONG
 * (the y of a horizontal run, the x of a vertical one).
 */
export function crisp(v: number, kind: WireKind): number {
	return ARROW[kind].stroke % 2 === 0 ? Math.round(v) : Math.floor(v) + 0.5;
}

/** Dash pattern for an unread (`unknown`) wire, and the offset that makes the
 *  path END on a dash (so the head always sits on ink, never on a gap). */
export const DASH = { on: 4, off: 3 } as const;
export function dashOffsetForLength(length: number): number {
	const period = DASH.on + DASH.off;
	// Pattern position at distance s is (s + offset) mod period; a dash is
	// [0, on). Ending exactly at the end of a dash: (L + offset) ≡ on.
	return (((DASH.on - length) % period) + period) % period;
}
