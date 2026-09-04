import { describe, expect, it } from 'vitest';
import {
	brushRange,
	clusterActivation,
	clusterRuns,
	hitBoxes,
	spreadOverlaps,
	worstStatus,
	xToMs,
	CLUSTER_ZOOM_PAD_FLOOR_MS,
	MIN_CLUSTER_ZOOM_SPAN_MS
} from './deployment-timeline-logic';

describe('xToMs / brushRange — drag → window', () => {
	const labelW = 100;
	const plotW = 900;
	const startMs = 0;
	const endMs = 900_000; // 900s window, 1px = 1s for easy arithmetic

	it('maps the plot edges back to the window bounds', () => {
		expect(xToMs(labelW, labelW, plotW, startMs, endMs)).toBe(startMs);
		expect(xToMs(labelW + plotW, labelW, plotW, startMs, endMs)).toBe(endMs);
	});

	it('a real drag (down then up further right) returns the swept range', () => {
		const r = brushRange(labelW + 100, labelW + 400, labelW, plotW, startMs, endMs);
		expect(r).toEqual({ start: 100_000, end: 400_000 });
	});

	it('order does not matter — dragging right-to-left gives the same range', () => {
		const forward = brushRange(labelW + 100, labelW + 400, labelW, plotW, startMs, endMs);
		const backward = brushRange(labelW + 400, labelW + 100, labelW, plotW, startMs, endMs);
		expect(backward).toEqual(forward);
	});

	it('a click-sized jitter (under minPx) is not a zoom', () => {
		expect(brushRange(labelW + 100, labelW + 103, labelW, plotW, startMs, endMs)).toBeNull();
	});

	it('exactly at the minPx threshold still counts as a drag', () => {
		expect(brushRange(labelW + 100, labelW + 106, labelW, plotW, startMs, endMs, 6)).not.toBeNull();
	});
});

describe('worstStatus', () => {
	it('Failed beats everything', () => {
		expect(worstStatus(['Succeeded', 'Failed', 'InProgress'])).toBe('Failed');
	});
	it('InProgress beats Deploying and settled', () => {
		expect(worstStatus(['Deploying', 'InProgress', undefined])).toBe('InProgress');
	});
	it('all settled → the last settled value wins arbitrarily but never worse', () => {
		expect(['Succeeded', undefined, 'Cancelled']).toContain(worstStatus(['Succeeded', undefined, 'Cancelled']));
	});
});

describe('clusterRuns — grouping and the new `runs` output', () => {
	it('groups points within minSep and reports their positions in `runs`', () => {
		const xs = [10, 14, 16, 200]; // first three within 12px of each other (a chain), last far away
		const order = [0, 1, 2, 3];
		const { of, list, runs } = clusterRuns(xs, order, 12, () => undefined);
		expect(list).toHaveLength(1);
		expect(list[0].count).toBe(3);
		expect(runs).toEqual([[0, 1, 2]]);
		expect(of).toEqual([0, 0, 0, -1]);
	});

	it('a single point, or well-separated points, produce no clusters', () => {
		expect(clusterRuns([5], [0], 12, () => undefined).list).toHaveLength(0);
		expect(clusterRuns([0, 100, 200], [0, 1, 2], 12, () => undefined).list).toHaveLength(0);
	});

	it('a merged cluster carries the worst status among its members', () => {
		const xs = [0, 3, 6];
		const order = [0, 1, 2];
		const statuses = ['Succeeded', 'Failed', 'InProgress'];
		const { list } = clusterRuns(xs, order, 12, (pos) => statuses[pos]);
		expect(list[0].status).toBe('Failed');
	});
});

describe('hitBoxes', () => {
	it('an isolated mark gets the full reach both sides', () => {
		expect(hitBoxes([0, 1000], false, 5)).toEqual([
			{ left: 16, right: 16 },
			{ left: 16, right: 16 }
		]);
	});

	it('two close marks split the gap between them, floored at rNormal', () => {
		const boxes = hitBoxes([0, 4], false, 5);
		// half-gap is 2, floored up to rNormal (5) so the target stays alive
		expect(boxes[0].right).toBe(5);
		expect(boxes[1].left).toBe(5);
	});

	it('fanOverlaps=true always returns the full reach — y already separated them', () => {
		expect(hitBoxes([0, 1], true, 5)).toEqual([
			{ left: 16, right: 16 },
			{ left: 16, right: 16 }
		]);
	});
});

describe('spreadOverlaps', () => {
	it('a lone point or well-separated points are not offset', () => {
		expect(spreadOverlaps([0], [0], 12, 20)).toEqual([0]);
		expect(spreadOverlaps([0, 100], [0, 1], 12, 20)).toEqual([0, 0]);
	});

	it('a collided pair is offset symmetrically about zero', () => {
		const dys = spreadOverlaps([0, 3], [0, 1], 12, 20);
		expect(dys[0]).toBeCloseTo(-dys[1]);
		expect(Math.abs(dys[0])).toBeGreaterThan(0);
	});
});

describe('clusterActivation — bubble → span', () => {
	it('a cluster spanning more than the minimum zooms to its own padded span', () => {
		const lo = 1_000_000;
		const hi = lo + 5 * 60_000; // 5 minutes apart — well over the 1-minute floor
		const members = [
			{ ms: lo, origIdx: 0 },
			{ ms: hi, origIdx: 1 }
		];
		const action = clusterActivation(members);
		expect(action.kind).toBe('zoom');
		if (action.kind !== 'zoom') throw new Error('unreachable');
		const span = hi - lo;
		const pad = Math.max(span * 0.2, CLUSTER_ZOOM_PAD_FLOOR_MS);
		expect(action.start).toBe(lo - pad);
		expect(action.end).toBe(hi + pad);
	});

	it('a cluster tighter than the minimum span selects the newest member instead', () => {
		const members = [
			{ ms: 1000, origIdx: 5 },
			{ ms: 1000 + MIN_CLUSTER_ZOOM_SPAN_MS - 1, origIdx: 7 },
			{ ms: 1000 + 500, origIdx: 6 }
		];
		const action = clusterActivation(members);
		expect(action).toEqual({ kind: 'select', origIdx: 7 });
	});

	it('members landing at the exact same timestamp always select the newest (by insertion order for ties)', () => {
		const members = [
			{ ms: 5000, origIdx: 1 },
			{ ms: 5000, origIdx: 2 }
		];
		const action = clusterActivation(members);
		expect(action).toEqual({ kind: 'select', origIdx: 1 });
	});

	it('zooming always separates the extremes well past a 12px MIN_SEP on a realistic plot', () => {
		// Simulate: after zooming to the returned [start, end], where would the
		// two extreme members land on a 900px plot?
		const lo = 2_000_000;
		const hi = lo + 90_000; // 90s apart — just over the 60s floor
		const action = clusterActivation([
			{ ms: lo, origIdx: 0 },
			{ ms: hi, origIdx: 1 }
		]);
		expect(action.kind).toBe('zoom');
		if (action.kind !== 'zoom') throw new Error('unreachable');
		const plotW = 900;
		const labelW = 100;
		const xLo = labelW + ((lo - action.start) / (action.end - action.start)) * plotW;
		const xHi = labelW + ((hi - action.start) / (action.end - action.start)) * plotW;
		expect(xHi - xLo).toBeGreaterThan(12);
	});

	it('throws on an empty cluster rather than silently picking nothing', () => {
		expect(() => clusterActivation([])).toThrow();
	});
});
