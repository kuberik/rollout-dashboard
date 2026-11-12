/**
 * THE NEIGHBOURHOOD'S WIRES, AS PURE GEOMETRY. (2026-10-09, design audit
 * `/tmp/claude/arrows-review/`.) `RolloutNeighbourhood` measures the boxes the
 * CSS grid placed and hands their rects here; everything that decides where a
 * line runs and where its head lands is in this file, so it is unit-tested.
 *
 * The rules (each one a finding of the audit):
 *
 * 1. THE HEAD COMES AFTER THE PATH. The path ends `ARROW.length` px short of
 *    the edge, ending in a straight run in the head's direction; the marker
 *    (`refX = 0`) puts its base there and its tip on the edge. A head laid
 *    over the last few px of a curve sat 4–6 px off-axis, up to 33° sideways.
 * 2. THE TIP LANDS ON THE OUTER EDGE OF WHAT IS PAINTED: a link box's border
 *    (`left`), the focus box's 2 px ring (`left − 2`, `top − 2` narrow); a
 *    downstream wire STARTS outside the ring (`right + 2`, `bottom + 2`).
 * 3. Fan-in at the focus: slots ≥ head width + 4 px apart, rounded ONCE.
 * 4. Two ends < 4 px apart vertically are one line, not a 1.5 px wobble.
 * 5. Crisp: held 2 px on integer centres, quiet 1 px on .5 centres, on the
 *    coordinate a line runs along.
 */
import { ARROW, crisp, wireKind, type WireKind } from '$lib/graph-arrow';

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type WireState = 'blocked' | 'clear' | 'unknown';
export type WireIn = { key: string; state: WireState; rect: Rect };
export type Wire = { key: string; state: WireState; d: string; tip: [number, number] };

/** The focus box's ring, outside its border (`ring-2`). */
export const FOCUS_RING = 2;
/** Spine x in the narrow layout, and the radius of its corner. */
export const SPINE_X = 4;
export const CORNER = 6;
/** Minimum gap between heads, on top of the head's own width. */
export const SLOT_GAP = 4;
/** Vertical ends closer than this are drawn as one straight line. */
export const SNAP = 4;

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const path = (...parts: (string | number)[]) =>
	parts.map((p) => (typeof p === 'number' ? fmt(p) : p)).join(' ');

/** The pitch two adjacent heads need at the focus, for the widest head present. */
export function slotPitch(kinds: WireKind[]): number {
	const w = Math.max(...kinds.map((k) => ARROW[k].width), ARROW.quiet.width);
	return w + SLOT_GAP;
}

/**
 * Slot y positions down a side of the focus box: evenly spread over the box
 * (inset by `pad`) when that leaves at least `pitch` between them, else
 * `pitch` apart centred on the box. Rounded once here; callers then only
 * apply `crisp`, never a second rounding.
 */
export function slots(n: number, top: number, height: number, pitch: number, pad = 14): number[] {
	if (n <= 0) return [];
	const inner = Math.max(0, height - 2 * Math.min(pad, height / 4));
	const even = inner / (n + 1);
	const step = Math.max(even, pitch);
	const mid = top + height / 2;
	return Array.from({ length: n }, (_, i) => Math.round(mid + (i - (n - 1) / 2) * step));
}

/** Min focus-box height that fits `n` slots at `pitch` with `pad` inset. */
export function focusMinHeight(n: number, pitch: number, pad = 14): number {
	return n <= 1 ? 0 : Math.ceil((n + 1) * pitch + 2 * pad);
}

/** A horizontal wire from (x1,y1) to a head whose TIP is at (tipX, y2). */
function horizontal(x1: number, y1: number, tipX: number, y2: number, kind: WireKind, dir: 1 | -1): string {
	const len = ARROW[kind].length;
	const end = tipX - dir * len;
	const a = crisp(y1, kind);
	let b = crisp(y2, kind);
	if (Math.abs(b - a) < SNAP) b = a;
	if (b === a) return path('M', x1, a, 'H', end);
	// The curve starts and ends horizontal (control points on the two y's), and
	// its last stretch is a short straight run so the head continues a line.
	const run = Math.min(6, Math.abs(end - x1) / 4);
	const cEnd = end - dir * run;
	const dx = Math.max(8, Math.abs(cEnd - x1) / 2) * dir;
	return path('M', x1, a, 'C', x1 + dx, a, cEnd - dx, b, cEnd, b, 'H', end);
}

/** Wide layout: three columns, wires left → right through the two gutters. */
export function wideWires(focus: Rect, up: WireIn[], down: WireIn[]): Wire[] {
	const out: Wire[] = [];
	const upSlots = slots(up.length, focus.top, focus.height, slotPitch(up.map((w) => wireKind(w.state))));
	up.forEach((w, i) => {
		const kind = wireKind(w.state);
		const y1 = w.rect.top + w.rect.height / 2;
		const tipX = focus.left - FOCUS_RING;
		const d = horizontal(w.rect.right, y1, tipX, upSlots[i], kind, 1);
		out.push({ key: w.key, state: w.state, d, tip: [tipX, crispEnd(y1, upSlots[i], kind)] });
	});
	const downSlots = slots(down.length, focus.top, focus.height, slotPitch(down.map((w) => wireKind(w.state))));
	down.forEach((w, i) => {
		const kind = wireKind(w.state);
		const y2 = w.rect.top + w.rect.height / 2;
		const tipX = w.rect.left;
		const d = horizontal(focus.right + FOCUS_RING, downSlots[i], tipX, y2, kind, 1);
		out.push({ key: w.key, state: w.state, d, tip: [tipX, crispEnd(downSlots[i], y2, kind)] });
	});
	return paintOrder(out);
}

/** The compact layout's spine: x offset inside the focus box's left edge, and the downstream column's indent that clears it. */
export const COMPACT_SPINE_INSET = 8;

/**
 * Compact layout (a two-column graph between the stacked list and the full three columns): upstream wires run left → right into the
 * focus exactly as wide; the downstream column sits UNDER the focus in the right column, so its wires drop from below the focus's ring
 * down a spine `COMPACT_SPINE_INSET` px inside the focus's left edge and turn right into each box (the narrow layout's downstream shape).
 */
export function compactWires(focus: Rect, up: WireIn[], down: WireIn[]): Wire[] {
	const out = wideWires(focus, up, []);
	for (const w of down) {
		const kind = wireKind(w.state);
		const sx = crisp(focus.left + COMPACT_SPINE_INSET, kind);
		const cy = crisp(w.rect.top + w.rect.height / 2, kind);
		const start = focus.bottom + FOCUS_RING;
		const tipX = w.rect.left;
		const end = tipX - ARROW[kind].length;
		const d = path('M', sx, start, 'V', cy - CORNER, 'Q', sx, cy, sx + CORNER, cy, 'H', end);
		out.push({ key: w.key, state: w.state, d, tip: [tipX, cy] });
	}
	return paintOrder(out);
}

function crispEnd(y1: number, y2: number, kind: WireKind): number {
	const a = crisp(y1, kind);
	const b = crisp(y2, kind);
	return Math.abs(b - a) < SNAP ? a : b;
}

/**
 * Narrow layout: the layers stack, and a spine at `SPINE_X` carries every
 * wire. Upstream: box's left edge → spine → down to the focus's ring (head
 * pointing down). Downstream: from below the ring → spine → right into the
 * box (head pointing right).
 */
export function narrowWires(focus: Rect, up: WireIn[], down: WireIn[]): Wire[] {
	const out: Wire[] = [];
	for (const w of up) {
		const kind = wireKind(w.state);
		const sx = crisp(SPINE_X, kind);
		const cy = crisp(w.rect.top + w.rect.height / 2, kind);
		const tipY = focus.top - FOCUS_RING;
		const end = tipY - ARROW[kind].length;
		const d = path('M', w.rect.left, cy, 'H', sx + CORNER, 'Q', sx, cy, sx, cy + CORNER, 'V', end);
		out.push({ key: w.key, state: w.state, d, tip: [sx, tipY] });
	}
	for (const w of down) {
		const kind = wireKind(w.state);
		const sx = crisp(SPINE_X, kind);
		const cy = crisp(w.rect.top + w.rect.height / 2, kind);
		const start = focus.bottom + FOCUS_RING;
		const tipX = w.rect.left;
		const end = tipX - ARROW[kind].length;
		const d = path('M', sx, start, 'V', cy - CORNER, 'Q', sx, cy, sx + CORNER, cy, 'H', end);
		out.push({ key: w.key, state: w.state, d, tip: [tipX, cy] });
	}
	return paintOrder(out);
}

/** Held wires paint last, so on a shared spine the held one is the one you see. */
function paintOrder(ws: Wire[]): Wire[] {
	const order = { clear: 0, unknown: 1, blocked: 2 } as const;
	return [...ws].sort((a, b) => order[a.state] - order[b.state]);
}

/** ONE order for the Gated by column at every width: a holding link first, then the rest in their own order. The card that holds the rollout is the one the reader must see, so it is never the one a fold slices. */
export function holdingFirst<T extends { state: WireState }>(links: readonly T[]): T[] {
	return [...links.filter((l) => l.state === 'blocked'), ...links.filter((l) => l.state !== 'blocked')];
}

/** Steep fan: the largest vertical rise a wide wire has to make, against the
 *  gutter it has to make it in. Above 2× the gutter, the S-curve is too steep. */
export function maxRise(focus: Rect, up: WireIn[], down: WireIn[]): number {
	const mid = focus.top + focus.height / 2;
	const rises = [...up, ...down].map((w) => Math.abs(w.rect.top + w.rect.height / 2 - mid));
	return rises.length ? Math.max(...rises) : 0;
}
