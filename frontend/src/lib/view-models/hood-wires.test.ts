import { describe, expect, it } from 'vitest';
import { ARROW, crisp, dashOffsetForLength, DASH } from '$lib/graph-arrow';
import {
	FOCUS_RING,
	SLOT_GAP,
	focusMinHeight,
	maxRise,
	holdingFirst,
	narrowWires,
	SPINE_X,
	slotPitch,
	slots,
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

/** The last point of an SVG path (`… H x` or `… V y` or `… C … x y`). */
function endOf(d: string): [number, number] {
	const tok = d.split(' ');
	let x = 0;
	let y = 0;
	for (let i = 0; i < tok.length; i++) {
		const t = tok[i];
		if (t === 'M') [x, y] = [+tok[++i], +tok[++i]];
		else if (t === 'H') x = +tok[++i];
		else if (t === 'V') y = +tok[++i];
		else if (t === 'C') {
			i += 4;
			[x, y] = [+tok[++i], +tok[++i]];
		} else if (t === 'Q') {
			i += 2;
			[x, y] = [+tok[++i], +tok[++i]];
		}
	}
	return [x, y];
}

const focus = rect(400, 100, 300, 90);
const up = (n: number, held = 0): WireIn[] =>
	Array.from({ length: n }, (_, i) => ({
		key: `u${i}`,
		state: i < held ? 'blocked' : 'clear',
		rect: rect(0, 40 + i * 70, 320, 60)
	}));
const down = (n: number): WireIn[] =>
	Array.from({ length: n }, (_, i) => ({ key: `d${i}`, state: 'clear', rect: rect(780, 40 + i * 70, 320, 60) }));

describe('the head comes after the path, and its tip lands on the painted edge', () => {
	it('upstream: path ends one head-length short of the focus ring; tip on the ring', () => {
		for (const w of wideWires(focus, up(3, 1), [])) {
			const kind = w.state === 'blocked' ? 'held' : 'quiet';
			const [ex] = endOf(w.d);
			expect(w.tip[0]).toBe(focus.left - FOCUS_RING);
			expect(ex).toBeCloseTo(w.tip[0] - ARROW[kind].length, 5);
			// The final command is a horizontal run: the head continues a line.
			expect(w.d).toMatch(/ H [\d.]+$/);
		}
	});

	it('downstream: starts outside the ring, tip on the box border', () => {
		for (const w of wideWires(focus, [], down(2))) {
			expect(w.d.startsWith(`M ${focus.right + FOCUS_RING} `)).toBe(true);
			const [ex] = endOf(w.d);
			expect(w.tip[0]).toBe(780);
			expect(ex).toBeCloseTo(780 - ARROW.quiet.length, 5);
		}
	});

	it('narrow: the upstream head points down onto the ring; downstream right onto the box', () => {
		const f = rect(32, 300, 330, 90);
		const ws = narrowWires(
			f,
			[{ key: 'u', state: 'blocked', rect: rect(32, 100, 330, 60) }],
			[{ key: 'd', state: 'clear', rect: rect(32, 450, 330, 60) }]
		);
		const u = ws.find((w) => w.key === 'u')!;
		const d = ws.find((w) => w.key === 'd')!;
		expect(endOf(u.d)[1]).toBe(f.top - FOCUS_RING - ARROW.held.length);
		expect(u.tip[1]).toBe(f.top - FOCUS_RING);
		expect(d.d.startsWith(`M ${crisp(SPINE_X, 'quiet')} ${f.bottom + FOCUS_RING}`)).toBe(true);
		expect(endOf(d.d)[0]).toBeCloseTo(32 - ARROW.quiet.length, 5);
	});
});

describe('crisp lines', () => {
	it('held 2 px on integer centres, quiet 1 px on .5 centres', () => {
		expect(crisp(100.3, 'held')).toBe(100);
		expect(crisp(100.3, 'quiet')).toBe(100.5);
		const ws = wideWires(focus, up(2, 1), []);
		const held = ws.find((w) => w.state === 'blocked')!;
		const quiet = ws.find((w) => w.state === 'clear')!;
		expect(Number.isInteger(endOf(held.d)[1])).toBe(true);
		expect(endOf(quiet.d)[1] % 1).toBe(0.5);
	});
});

describe('one straight line when the ends nearly agree', () => {
	it('snaps |dy| < 4 to a single y (no 1.5 px wobble)', () => {
		const f = rect(400, 100, 300, 60);
		const w = wideWires(f, [{ key: 'a', state: 'blocked', rect: rect(0, 101, 320, 60) }], [])[0];
		expect(w.d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+$/);
	});
});

describe('fan-in spacing at the focus', () => {
	it('slots are at least head width + gap apart, and integers', () => {
		const pitch = slotPitch(['held', 'quiet']);
		expect(pitch).toBe(ARROW.held.width + SLOT_GAP);
		const ys = slots(5, 100, 90, pitch);
		for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(pitch - 1);
		for (const y of ys) expect(Number.isInteger(y)).toBe(true);
	});

	it('5 upstreams: the focus grows to fit their heads', () => {
		const pitch = slotPitch(['held', 'quiet', 'quiet', 'quiet', 'quiet']);
		const min = focusMinHeight(5, pitch);
		const ys = slots(5, 0, min, pitch);
		expect(ys[0]).toBeGreaterThanOrEqual(0);
		expect(ys[4]).toBeLessThanOrEqual(min);
		// …and with 4+ upstream wires every tip is its own slot.
		const ws = wideWires(rect(400, 0, 300, min), up(5, 1), []);
		const tipsY = ws.map((w) => w.tip[1]).sort((a, b) => a - b);
		for (let i = 1; i < tipsY.length; i++) expect(tipsY[i] - tipsY[i - 1]).toBeGreaterThanOrEqual(pitch - 1);
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
		expect(holdingFirst([{ key: 'x', state: 'clear' as const }, { key: 'y', state: 'blocked' as const }, { key: 'z', state: 'blocked' as const }]).map((l) => l.key)).toEqual(['y', 'z', 'x']);
	});

	it('maxRise is the largest box-centre distance from the focus middle', () => {
		expect(maxRise(rect(400, 100, 300, 100), up(1), [])).toBe(Math.abs(70 - 150));
	});
});

describe('dashed wires end on a dash', () => {
	it('offset puts the path end at the end of a dash', () => {
		for (const L of [10, 13.3, 70, 101.25]) {
			const off = dashOffsetForLength(L);
			const pos = (((L + off) % (DASH.on + DASH.off)) + DASH.on + DASH.off) % (DASH.on + DASH.off);
			expect(pos).toBeCloseTo(DASH.on, 6);
		}
	});
});
