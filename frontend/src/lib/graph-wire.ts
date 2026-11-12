/**
 * ⭐ ONE CONNECTOR FOR A GATE OR PIPELINE GRAPH. (2026-11-12, owner: "i feel
 * like gates arrows and their lines could be more elegant to fit the style of
 * the rest".)
 *
 * ROLE: the line between two tiles on a graph canvas, and the mark that says
 * which way it points. It replaces `$lib/graph-arrow`'s spec for the Gates
 * tab (`RolloutNeighbourhood`); `/dependencies` (xyflow) still draws its own
 * edges with `graph-arrow` and can move over unchanged later, and so can the
 * App page's Progress graph (`Stages.svelte`): nothing in here knows about
 * gates. WHY A NEW SPEC: the old one drew a 2 px held stroke with a 7.5 × 12
 * solid head and a 1 px quiet stroke with a 5.6 × 9 head, on free S-curves
 * between tile centres — the heaviest marks on a canvas whose every other
 * line is a 1 px hairline. Proportions borrow from the product itself:
 *
 *   - STROKE: 1 px, the hairline every card border is. One width for every
 *     state, so a wire never shifts half a pixel when its state changes.
 *   - INK: `wire` (one step past `line-strong`, a tile's hover border, so a
 *     hairline still reads on the dotted canvas; equal to it in dark) for
 *     every wire that only says "this feeds that"; `held-solid` (the pause
 *     mark's own ring)
 *     for a wire that carries a hold. Colour is state, never decoration.
 *     Theme tokens, not hex: the SVG follows the theme like the tiles do.
 *   - SHAPE: orthogonal runs joined by quarter-circle corners of `CORNER`
 *     = 8 px, the radius every tile on the canvas has. Wires leave and enter
 *     horizontally, so a wire meets a tile's edge at a right angle like a
 *     border would, and parallel wires never cross: they share a trunk.
 *   - PORTS: a wire leaves and enters at a tile's TITLE ROW (`data-hood-port`),
 *     not its centre — a tile that grows a second line keeps its port, so
 *     every wire on the canvas meets its tiles at the same height.
 *   - TERMINAL: a 1 px open chevron (`CHEVRON`), 4 px deep and 7 px tall,
 *     with its apex on the edge it points at. It reads as direction and
 *     weighs no more than the line; wires that meet at one port share one.
 */
export type WireTone = 'held' | 'quiet';

export const WIRE_STROKE = 1;
/** Corner radius of every turn: the tiles' own `rounded-md`. */
export const CORNER = 8;
/** Half the length of the soft S a rise shorter than two corners takes. */
export const SOFT = 12;
/** Vertical ends closer than this are drawn as one straight line. */
export const SNAP = 4;
/** The open chevron at a wire's tip: depth along the wire, half its height. */
export const CHEVRON = { depth: 4, half: 3.5 } as const;
/** Unread (`unknown`) wires: short dashes, so the line still reads as one. */
export const WIRE_DASH = { on: 3, off: 3 } as const;

/** Tailwind `stroke-*` classes for each tone (theme tokens from `language.css`). */
export const WIRE_TONE_CLASS: Record<WireTone, string> = {
	held: 'stroke-held-solid',
	quiet: 'stroke-wire'
};

export function wireTone(state: 'blocked' | 'clear' | 'unknown'): WireTone {
	return state === 'blocked' ? 'held' : 'quiet';
}

/** A 1 px line is crisp on a .5 centre: snap the coordinate a run lies ALONG. */
export function crisp1(v: number): number {
	return Math.floor(v) + 0.5;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
export const svgPath = (...parts: (string | number)[]) =>
	parts.map((p) => (typeof p === 'number' ? fmt(p) : p)).join(' ');

/**
 * The chevron whose apex is at (x, y), pointing along `dir`: `'right'` for a
 * wire arriving from the left, `'down'` for one arriving from above.
 */
export function chevron(x: number, y: number, dir: 'right' | 'down'): string {
	const { depth: d, half: h } = CHEVRON;
	return dir === 'right'
		? svgPath('M', x - d, y - h, 'L', x, y, 'L', x - d, y + h)
		: svgPath('M', x - h, y - d, 'L', x, y, 'L', x + h, y - d);
}

/**
 * A quarter-circle corner of radius `r` ending at (x, y). `cw`: the turn is
 * clockwise on screen (east → south, north → east, …).
 */
export function arc(r: number, x: number, y: number, cw: boolean): (string | number)[] {
	return ['A', r, r, 0, 0, cw ? 1 : 0, x, y];
}

/**
 * A horizontal wire from (x1, y1) to (x2, y2), x1 < x2, that changes height
 * once, on the trunk at `tx`:
 *   - ends < `SNAP` px apart: one straight line at the END's height;
 *   - a rise shorter than two corners: one soft S (horizontal tangents at
 *     both ends, `2 × SOFT` px long) centred on the trunk, never two
 *     squeezed corners, which read as a kink;
 *   - otherwise: along y1 to the trunk, an 8 px quarter circle, down or up
 *     the trunk, another, along y2 to the end.
 */
export function elbow(x1: number, y1: number, x2: number, y2: number, tx: number): string {
	const dy = y2 - y1;
	// Ends < SNAP px apart are one straight line at the END's height: a 3 px jog is a wobble, not a route.
	if (Math.abs(dy) < SNAP) return svgPath('M', x1, y2, 'H', x2);
	const room = Math.min(tx - x1, x2 - tx);
	if (Math.abs(dy) < 2 * CORNER) {
		const l = Math.min(SOFT, room);
		return svgPath('M', x1, y1, 'H', tx - l, 'C', tx, y1, tx, y2, tx + l, y2, 'H', x2);
	}
	const down = dy > 0;
	const s = down ? 1 : -1;
	const r = Math.min(CORNER, room);
	return svgPath(
		'M', x1, y1,
		'H', tx - r,
		...arc(r, tx, y1 + s * r, down),
		'V', y2 - s * r,
		...arc(r, tx + r, y2, !down),
		'H', x2
	);
}

/** The dash offset that makes a dashed wire of `length` END on a dash, so its chevron meets ink, never a gap. */
export function wireDashOffset(length: number): number {
	const period = WIRE_DASH.on + WIRE_DASH.off;
	return (((WIRE_DASH.on - length) % period) + period) % period;
}
