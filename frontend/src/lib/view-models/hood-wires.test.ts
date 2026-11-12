import { describe, expect, it } from 'vitest';
import { CHEVRON, CORNER, SNAP, WIRE_DASH, chevron, elbow, wireDashOffset, wireTone } from '$lib/graph-wire';
import {
	FOCUS_RING,
	maxRise,
	holdingFirst,
	narrowWires,
	compactWires,
	COMPACT_SPINE_INSET,
	SPINE_X,
	wideWires,
	type Rect,
	type WireIn
} from './hood-wires';

const rect = (left: number, top: number, width: number, height: number): Rect => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height
});

/** Every point an SVG path visits (`M`, `H`, `V`, `L`, and the END of each `Q`/`C`). */
function points(d: string): [number, number][] {
	const tok = d.split(' ');
	const out: [number, number][] = [];
	let x = 0;
	let y = 0;
	for (let i = 0; i < tok.length; i++) {
		const t = tok[i];
		if (t === 'M' || t === 'L') [x, y] = [+tok[++i], +tok[++i]];
		else if (t === 'H') x = +tok[++i];
		else if (t === 'V') y = +tok[++i];
		else if (t === 'C') {
			i += 4;
			[x, y] = [+tok[++i], +tok[++i]];
		} else if (t === 'Q') {
			i += 2;
			[x, y] = [+tok[++i], +tok[++i]];
		} else continue;
		out.push([x, y]);
	}
	return out;
}
const startOf = (d: string) => points(d)[0];
const endOf = (d: string) => points(d).at(-1)!;

const focus = { ...rect(400, 100, 300, 90), port: 126 };
/** Upstream boxes 60px tall with their title row 26px below their top; box `i` holds when `i < held`. */
const up = (n: number, held = 0): WireIn[] =>
	Array.from({ length: n }, (_, i) => ({
		key: `u${i}`,
		state: i < held ? 'blocked' : 'clear',
		rect: rect(0, 40 + i * 70, 320, 60),
		port: 40 + i * 70 + 26
	}));
const down = (n: number): WireIn[] =>
	Array.from({ length: n }, (_, i) => ({
		key: `d${i}`,
		state: 'clear',
		rect: rect(780, 40 + i * 70, 320, 60),
		port: 40 + i * 70 + 26
	}));

describe('ports: wires leave and enter at a box’s title row, the tip on the painted edge', () => {
	it('upstream: leaves each box’s right edge at its port; every wire ends on the focus ring at the focus port', () => {
		const ws = wideWires(focus, up(3), []);
		for (const w of ws) {
			const i = +w.key.slice(1);
			const y = 40 + i * 70 + 26.5;
			// u1's port is 3.5px from the focus port: it snaps to one straight line at the focus port's height.
			expect(startOf(w.d)).toEqual([320, Math.abs(y - 126.5) < SNAP ? 126.5 : y]);
			expect(endOf(w.d)).toEqual([focus.left - FOCUS_RING, 126.5]);
			expect(w.tip).toEqual([focus.left - FOCUS_RING, 126.5]);
		}
	});

	it('a box that grows a second line keeps its port (the port, not the centre, is read)', () => {
		const tall: WireIn = { key: 't', state: 'clear', rect: rect(0, 40, 320, 120), port: 66 };
		const short: WireIn = { key: 's', state: 'clear', rect: rect(0, 40, 320, 60), port: 66 };
		expect(wideWires(focus, [tall], [])[0].d).toBe(wideWires(focus, [short], [])[0].d);
	});

	it('no port measured: falls back to the box centre', () => {
		const w = wideWires(focus, [{ key: 'c', state: 'clear', rect: rect(0, 40, 320, 60) }], [])[0];
		expect(startOf(w.d)[1]).toBe(70.5);
	});

	it('downstream: starts outside the ring at the focus port, tip on the box border at its port', () => {
		const [w] = wideWires(focus, [], down(1));
		expect(startOf(w.d)).toEqual([focus.right + FOCUS_RING, 126.5]);
		expect(w.tip).toEqual([780, 66.5]);
		expect(endOf(w.d)).toEqual(w.tip);
	});

	it('narrow: upstream runs down the spine onto the focus ring; downstream turns right into each box at its port', () => {
		const f = { ...rect(16, 300, 300, 90), port: 326 };
		const u: WireIn = { key: 'u', state: 'clear', rect: rect(16, 40, 300, 60), port: 66 };
		const d: WireIn = { key: 'd', state: 'clear', rect: rect(16, 420, 300, 60), port: 446 };
		const ws = narrowWires(f, [u], [d]);
		const wu = ws.find((w) => w.key === 'u')!;
		const wd = ws.find((w) => w.key === 'd')!;
		expect(startOf(wu.d)).toEqual([16, 66.5]);
		expect(wu.tip).toEqual([SPINE_X + 0.5, 300 - FOCUS_RING]);
		expect(endOf(wu.d)).toEqual(wu.tip);
		expect(startOf(wd.d)).toEqual([SPINE_X + 0.5, 390 + FOCUS_RING]);
		expect(wd.tip).toEqual([16, 446.5]);
	});
});

describe('one fan-in: wires into the focus share a trunk, so none crosses another', () => {
	it('every upstream wire turns at the same trunk x, half way across the gutter', () => {
		const ws = wideWires(focus, up(4), []).filter((w) => points(w.d).length > 2);
		const trunks = new Set(ws.map((w) => points(w.d)[2][0]));
		expect(trunks.size).toBe(1);
		expect([...trunks][0]).toBe(Math.floor((320 + focus.left - FOCUS_RING) / 2) + 0.5);
	});

	it('corners are the tiles’ own 8 px radius when the rise allows', () => {
		const w = wideWires(focus, up(4), []).find((x) => x.key === 'u3')!;
		const [, a, b] = points(w.d);
		expect(b[0] - a[0]).toBe(CORNER);
		expect(Math.abs(a[1] - b[1])).toBe(CORNER);
	});

	it('held paints last, so on the shared run it is the one you see', () => {
		const ws = wideWires(focus, [...up(3, 0), { ...up(1, 1)[0], key: 'h' }], []);
		expect(ws.at(-1)!.key).toBe('h');
	});
});

describe('crisp, and state never moves a wire', () => {
	it('every horizontal run lies on a .5 centre (a 1 px hairline)', () => {
		for (const w of [...wideWires(focus, up(3, 1), down(2)), ...narrowWires(focus, up(2, 1), down(1))]) {
			const pts = points(w.d);
			for (let i = 1; i < pts.length; i++) if (pts[i - 1][1] === pts[i][1]) expect(pts[i][1] % 1).toBe(0.5);
		}
	});

	it('the same boxes held or clear draw the identical geometry', () => {
		const clear = wideWires(focus, up(3, 0), down(1));
		const held = wideWires(focus, up(3, 3), down(1));
		const byKey = (ws: typeof clear) => Object.fromEntries(ws.map((w) => [w.key, w.d]));
		expect(byKey(held)).toEqual(byKey(clear));
		expect(wireTone('blocked')).toBe('held');
		expect(wireTone('unknown')).toBe('quiet');
		expect(wireTone('clear')).toBe('quiet');
	});
});

describe('one straight line when the ends nearly agree', () => {
	it(`|dy| < ${SNAP} is one H run at the end’s height (no jog)`, () => {
		expect(elbow(320, 130.5, 398, 127.5, 359.5)).toBe('M 320 127.5 H 398');
		expect(elbow(320, 130.5, 398, 126.5, 359.5)).toMatch(/Q/);
	});
});

describe('the chevron', () => {
	it('apex on the tip, open, depth and half-height from the spec', () => {
		const { depth: d, half: h } = CHEVRON;
		expect(chevron(100, 50, 'right')).toBe(`M ${100 - d} ${50 - h} L 100 50 L ${100 - d} ${50 + h}`);
		expect(chevron(100, 50, 'down')).toBe(`M ${100 - h} ${50 - d} L 100 50 L ${100 + h} ${50 - d}`);
		for (const w of wideWires(focus, up(2), down(1))) expect(points(w.head)[1]).toEqual(w.tip);
	});
});

describe('upstream order and steepness', () => {
	it('a holding link is first at every width, the rest keep their order', () => {
		const order = holdingFirst([
			{ key: 'a', state: 'blocked' as const },
			{ key: 'b', state: 'clear' as const },
			{ key: 'c', state: 'unknown' as const }
		]);
		expect(order.map((l) => l.key)).toEqual(['a', 'b', 'c']);
		expect(
			holdingFirst([
				{ key: 'x', state: 'clear' as const },
				{ key: 'y', state: 'blocked' as const },
				{ key: 'z', state: 'blocked' as const }
			]).map((l) => l.key)
		).toEqual(['y', 'z', 'x']);
	});

	it('maxRise is the largest box-centre distance from the focus middle', () => {
		expect(maxRise(rect(400, 100, 300, 100), up(1), [])).toBe(Math.abs(70 - 150));
	});
});

describe('dashed wires end on a dash', () => {
	it('offset puts the path end at the end of a dash', () => {
		const period = WIRE_DASH.on + WIRE_DASH.off;
		for (const L of [0, 1, 7, 50, 123.4]) {
			const pos = (((L + wireDashOffset(L)) % period) + period) % period;
			expect(pos).toBeCloseTo(WIRE_DASH.on, 6);
		}
	});
});

describe('compact layout (two columns, downstream under the focus)', () => {
	it('upstream wires are the wide ones; a downstream wire drops from under the focus and turns right into its box at its port', () => {
		const d: WireIn = { key: 'd', state: 'clear', rect: rect(420, 260, 280, 60), port: 286 };
		const ws = compactWires(focus, up(2), [d]);
		for (const w of wideWires(focus, up(2), [])) expect(ws.find((x) => x.key === w.key)!.d).toBe(w.d);
		const wd = ws.find((x) => x.key === 'd')!;
		expect(startOf(wd.d)).toEqual([focus.left + COMPACT_SPINE_INSET + 0.5, focus.bottom + FOCUS_RING]);
		expect(wd.tip).toEqual([420, 286.5]);
		expect(endOf(wd.d)).toEqual(wd.tip);
	});
});
