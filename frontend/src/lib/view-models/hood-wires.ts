/**
 * THE NEIGHBOURHOOD'S WIRES, AS PURE GEOMETRY. `RolloutNeighbourhood`
 * measures the boxes the CSS grid placed and hands their rects (and each
 * box's PORT, the y of its title row) here; everything that decides where a
 * line runs and where its tip lands is in this file, so it is unit-tested.
 * The drawing spec (stroke, ink, corner, chevron) is `$lib/graph-wire`.
 *
 * The rules (2026-11-12, owner: "gates arrows and their lines could be more
 * elegant to fit the style of the rest"):
 *
 * 1. PORTS, NOT CENTRES. A wire leaves and enters a box at its title row, so
 *    a box that grows a second line keeps its port, and a wire into the
 *    focus meets it at the focus's own title row. Every wire on the canvas
 *    meets its boxes at the same height relative to their tops.
 * 2. ONE PORT PER SIDE OF THE FOCUS. Wires into the focus converge on one
 *    trunk and one terminal (GitHub Actions' and Railway's fan-in), instead
 *    of a fan of separate heads spread down its edge: no wire crosses
 *    another, and a held wire, painted last, is the one you see on the
 *    shared run, all the way from its source to the focus.
 * 3. ORTHOGONAL WITH 8 PX CORNERS. Horizontal out, one vertical trunk run at
 *    the gutter's middle, horizontal in: wires meet edges at right angles,
 *    and turn with the tiles' own radius (true quarter circles). A rise
 *    shorter than two corners is one soft S instead of a squeezed kink.
 * 4. THE TIP LANDS ON THE OUTER EDGE OF WHAT IS PAINTED: a link box's
 *    border (`left`), the focus box's 2 px ring (`left − 2`, `top − 2`
 *    narrow); a downstream wire STARTS outside the ring (`right + 2`,
 *    `bottom + 2`). The chevron's apex is the tip.
 * 5. NOTHING MOVES WITH STATE. One stroke width for every state, so every
 *    coordinate is the same whatever the state; state picks the ink and the
 *    paint order only.
 */
import { CORNER, arc, crisp1, elbow, svgPath, chevron, wireTone, type WireTone } from '$lib/graph-wire';

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type WireState = 'blocked' | 'clear' | 'unknown';
/** `port`: the absolute y of the box's title row (defaults to its centre). */
export type WireIn = { key: string; state: WireState; rect: Rect; port?: number };
export type Focus = Rect & { port?: number };
export type Wire = {
	key: string;
	state: WireState;
	d: string;
	/** The chevron at the tip, its apex on `tip`. */
	head: string;
	tip: [number, number];
};

/** The focus box's ring, outside its border (`ring-2`). */
export const FOCUS_RING = 2;
/** Spine x in the narrow layout: 12 px in, so it meets the focus on the flat of its top edge, past the 8 px corner (AD r1 #2). */
export const SPINE_X = 12;
export { CORNER };

const portOf = (r: Rect & { port?: number }) => r.port ?? r.top + r.height / 2;

function wire(key: string, state: WireState, d: string, tip: [number, number], dir: 'right' | 'down'): Wire {
	return { key, state, d, head: chevron(tip[0], tip[1], dir), tip };
}

/** Upstream wires into the focus's left port, along one trunk in the gutter. */
function upstreamInto(focus: Focus, up: WireIn[]): Wire[] {
	if (!up.length) return [];
	const tipX = focus.left - FOCUS_RING;
	const ty = crisp1(portOf(focus));
	const srcRight = Math.max(...up.map((w) => w.rect.right));
	const tx = crisp1((srcRight + tipX) / 2);
	return up.map((w) => {
		const y1 = crisp1(portOf({ ...w.rect, port: w.port }));
		return wire(w.key, w.state, elbow(w.rect.right, y1, tipX, ty, tx), [tipX, ty], 'right');
	});
}

/** Wide layout: three columns, wires left → right through the two gutters. */
export function wideWires(focus: Focus, up: WireIn[], down: WireIn[]): Wire[] {
	const out = upstreamInto(focus, up);
	if (down.length) {
		const x1 = focus.right + FOCUS_RING;
		const y1 = crisp1(portOf(focus));
		const dstLeft = Math.min(...down.map((w) => w.rect.left));
		const tx = crisp1((x1 + dstLeft) / 2);
		for (const w of down) {
			const tipX = w.rect.left;
			const y2 = crisp1(portOf({ ...w.rect, port: w.port }));
			out.push(wire(w.key, w.state, elbow(x1, y1, tipX, y2, tx), [tipX, y2], 'right'));
		}
	}
	return paintOrder(out);
}

/** The compact layout's spine: x offset inside the focus box's left edge, and the downstream column's indent that clears it. */
export const COMPACT_SPINE_INSET = 12;

/** A wire down a spine at `sx` from `startY`, turning right into a box at `y`, tip at `tipX`. */
function spineRight(sx: number, startY: number, y: number, tipX: number): string {
	const r = Math.min(CORNER, tipX - sx, Math.max(0, y - startY));
	return svgPath('M', sx, startY, 'V', y - r, ...arc(r, sx + r, y, false), 'H', tipX);
}

/**
 * Compact layout (a two-column graph between the stacked list and the full three columns): upstream wires run left → right into the
 * focus exactly as wide; the downstream column sits UNDER the focus in the right column, so its wires drop from below the focus's ring
 * down a spine `COMPACT_SPINE_INSET` px inside the focus's left edge and turn right into each box's port (the narrow layout's shape).
 */
export function compactWires(focus: Focus, up: WireIn[], down: WireIn[]): Wire[] {
	const out = upstreamInto(focus, up);
	const sx = crisp1(focus.left + COMPACT_SPINE_INSET);
	const start = focus.bottom + FOCUS_RING;
	for (const w of down) {
		const y = crisp1(portOf({ ...w.rect, port: w.port }));
		out.push(wire(w.key, w.state, spineRight(sx, start, y, w.rect.left), [w.rect.left, y], 'right'));
	}
	return paintOrder(out);
}

/**
 * Narrow layout: the layers stack, and a spine at `SPINE_X` carries every
 * wire. Upstream: box's left edge at its port → spine → down to the focus's
 * ring (chevron pointing down). Downstream: from below the ring → spine →
 * right into the box's port.
 */
export function narrowWires(focus: Focus, up: WireIn[], down: WireIn[]): Wire[] {
	const out: Wire[] = [];
	const sx = crisp1(SPINE_X);
	const tipY = focus.top - FOCUS_RING;
	for (const w of up) {
		const y = crisp1(portOf({ ...w.rect, port: w.port }));
		const r = Math.min(CORNER, w.rect.left - sx, Math.max(0, tipY - y));
		const d = svgPath('M', w.rect.left, y, 'H', sx + r, ...arc(r, sx, y + r, false), 'V', tipY);
		out.push(wire(w.key, w.state, d, [sx, tipY], 'down'));
	}
	const start = focus.bottom + FOCUS_RING;
	for (const w of down) {
		const y = crisp1(portOf({ ...w.rect, port: w.port }));
		out.push(wire(w.key, w.state, spineRight(sx, start, y, w.rect.left), [w.rect.left, y], 'right'));
	}
	return paintOrder(out);
}

/** Held wires paint last, so on a shared run the held one is the one you see. */
function paintOrder(ws: Wire[]): Wire[] {
	const order = { clear: 0, unknown: 1, blocked: 2 } as const;
	return [...ws].sort((a, b) => order[a.state] - order[b.state]);
}

/**
 * ONE chevron per tip: wires that meet at one port share its head, drawn
 * once (a stack of identical heads darkens its anti-aliased fringe), in the
 * held ink when any wire arriving there holds.
 */
export function headsOf(ws: Wire[]): { key: string; d: string; tone: WireTone }[] {
	const byTip = new Map<string, { key: string; d: string; tone: WireTone }>();
	for (const w of ws) {
		const k = `${w.tip[0]},${w.tip[1]}`;
		const tone = wireTone(w.state);
		const cur = byTip.get(k);
		if (!cur) byTip.set(k, { key: k, d: w.head, tone });
		else if (tone === 'held') cur.tone = 'held';
	}
	return [...byTip.values()].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'held' ? 1 : -1));
}

/** The tone each wire is drawn in (re-exported for the renderer). */
export { wireTone };

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
