/**
 * Pure range/cluster math for `DeploymentTimeline.svelte`, split out so it is
 * unit-testable without mounting the chart. See that component's own header
 * comments for the design reasoning ("A CLUSTER OF MARKS ON A TIME AXIS IS
 * ONE MARK THAT SAYS HOW MANY", `lib/CLAUDE.md`) — this file is the math
 * underneath that behaviour, not a new decision.
 *
 * 2026-09-04: extracted while fixing two dead controls on `/activity` — a
 * pointer-down on the chart never started a brush-zoom drag (it landed on a
 * `<rect>` row background, and the handler bailed on *any* `<rect>`, not just
 * a mark's own hit target), and a merged "N" bubble had `pointer-events:
 * none` with no click handling of its own, so a tap on it fell through to
 * whichever member's hit rect happened to be underneath — or, missing all of
 * them, to nothing. `brushRange` and `clusterActivation` are the two pieces
 * of arithmetic those fixes needed, pulled out so the range math has a test
 * independent of pointer simulation.
 */

export type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
export type TimeRange = PresetRange | { start: number; end: number };

export function isPreset(tr: TimeRange): tr is PresetRange {
	return typeof tr === 'string';
}

/**
 * Screen-x → epoch-ms, inverse of the chart's own `tsToX`. Pulled out so the
 * brush-drag math (`brushRange`, below) is testable without a mounted SVG.
 */
export function xToMs(x: number, labelW: number, plotW: number, startMs: number, endMs: number): number {
	const ratio = (x - labelW) / plotW;
	return startMs + ratio * (endMs - startMs);
}

/**
 * A finished drag (pointer down at `aX`, up at `bX`) → the range it selects,
 * or `null` if the drag was a click-sized jitter, not a deliberate zoom.
 * `minPx` matches the chart's own `b - a < 6` guard — a pointer that barely
 * moved is a click, not a brush.
 */
export function brushRange(
	aX: number,
	bX: number,
	labelW: number,
	plotW: number,
	startMs: number,
	endMs: number,
	minPx = 6
): { start: number; end: number } | null {
	const lo = Math.min(aX, bX);
	const hi = Math.max(aX, bX);
	if (hi - lo < minPx) return null;
	return {
		start: xToMs(lo, labelW, plotW, startMs, endMs),
		end: xToMs(hi, labelW, plotW, startMs, endMs)
	};
}

/** Failed outranks in-flight outranks settled — a merged mark may never hide
    the worst thing inside it. */
export function worstStatus(list: (string | undefined)[]): string | undefined {
	const rank = (s?: string) => (s === 'Failed' ? 3 : s === 'InProgress' ? 2 : s === 'Deploying' ? 1 : 0);
	return list.reduce((worst, s) => (rank(s) > rank(worst) ? s : worst), undefined as string | undefined);
}

export type MarkCluster = { cx: number; count: number; status?: string };

/**
 * Groups positions whose on-screen x falls within `minSep` of a neighbour
 * into runs. Returns, per input position, which cluster (if any) it landed
 * in (`of`), the drawn cluster summaries (`list`), and — new in this pass —
 * the actual member positions per cluster (`runs`), in the same order as
 * `list`, so a caller can compute the run's own time span (`clusterActivation`,
 * below) instead of only its pixel centroid.
 */
export function clusterRuns(
	xs: number[],
	order: number[],
	minSep: number,
	statusAt: (pos: number) => string | undefined
): { of: number[]; list: MarkCluster[]; runs: number[][] } {
	const of: number[] = new Array(xs.length).fill(-1);
	const list: MarkCluster[] = [];
	const runs: number[][] = [];
	if (order.length < 2) return { of, list, runs };
	let run: number[] = [];
	const flush = () => {
		if (run.length > 1) {
			const idx = list.length;
			for (const p of run) of[p] = idx;
			list.push({
				cx: run.reduce((sum, p) => sum + xs[p], 0) / run.length,
				count: run.length,
				status: worstStatus(run.map(statusAt))
			});
			runs.push(run.slice());
		}
		run = [];
	};
	for (const pos of order) {
		const prev = run[run.length - 1];
		if (prev === undefined || Math.abs(xs[pos] - xs[prev]) < minSep) run.push(pos);
		else {
			flush();
			run.push(pos);
		}
	}
	flush();
	return { of, list, runs };
}

export type HitBox = { left: number; right: number };

/** Independent left/right hit reach per mark — see the long comment above
    this function's call site in `DeploymentTimeline.svelte` for why a
    `<circle>`'s one radius can't express this. */
export function hitBoxes(xs: number[], fan: boolean, rNormal: number, maxReach = 16): HitBox[] {
	const n = xs.length;
	if (fan || n < 2) return xs.map(() => ({ left: maxReach, right: maxReach }));
	const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
	const boxes: HitBox[] = xs.map(() => ({ left: maxReach, right: maxReach }));
	for (let k = 0; k < order.length; k++) {
		const i = order[k];
		const leftGap = k > 0 ? xs[i] - xs[order[k - 1]] : Infinity;
		const rightGap = k < order.length - 1 ? xs[order[k + 1]] - xs[i] : Infinity;
		boxes[i] = {
			left: Math.max(rNormal, Math.min(maxReach, leftGap / 2)),
			right: Math.max(rNormal, Math.min(maxReach, rightGap / 2))
		};
	}
	return boxes;
}

/** Colliding marks fanned vertically inside their own lane — `x` untouched. */
export function spreadOverlaps(
	xs: number[],
	order: number[],
	minSep: number,
	maxOffset: number
): number[] {
	const dys = new Array(xs.length).fill(0);
	if (order.length < 2 || maxOffset <= 1) return dys;
	let cluster: number[] = [];
	const flush = () => {
		const n = cluster.length;
		if (n > 1) {
			const step = Math.min(minSep, (2 * maxOffset) / (n - 1));
			for (let k = 0; k < n; k++) dys[cluster[k]] = (k - (n - 1) / 2) * step;
		}
		cluster = [];
	};
	for (const pos of order) {
		const prev = cluster[cluster.length - 1];
		if (prev === undefined || Math.abs(xs[pos] - xs[prev]) < minSep) cluster.push(pos);
		else {
			flush();
			cluster.push(pos);
		}
	}
	flush();
	return dys;
}

/**
 * ⭐ WHAT ACTIVATING A MERGED BUBBLE DOES. (2026-09-04)
 *
 * Zooming the window to the cluster's own span [earliest, latest] — padded,
 * so the marks land inside the plot rather than pinned to its edges — always
 * separates the members: for any span > 0, the two extreme points end up
 * `plotW / (1 + 2·padFraction)` px apart post-zoom, independent of the span's
 * absolute size, which is comfortably past `MIN_SEP` for any plot worth
 * drawing. So the only real "can't zoom to this" case is a span at or under
 * `minSpanMs` — several deploys close enough in time that a window this
 * narrow would show almost no axis, just marks pinned to the edges. There
 * the activation instead names the newest member, exactly what clicking that
 * single mark would already do — "select the newest and let the caller
 * scroll/expand it", not a dead end.
 */
export const MIN_CLUSTER_ZOOM_SPAN_MS = 60_000;
export const CLUSTER_ZOOM_PAD_FRACTION = 0.2;
export const CLUSTER_ZOOM_PAD_FLOOR_MS = 30_000;

export type ClusterActivation =
	| { kind: 'zoom'; start: number; end: number }
	| { kind: 'select'; origIdx: number };

export function clusterActivation(
	members: { ms: number; origIdx: number }[],
	minSpanMs = MIN_CLUSTER_ZOOM_SPAN_MS,
	padFraction = CLUSTER_ZOOM_PAD_FRACTION,
	padFloorMs = CLUSTER_ZOOM_PAD_FLOOR_MS
): ClusterActivation {
	if (members.length === 0) throw new Error('clusterActivation: empty cluster');
	let lo = Infinity;
	let hi = -Infinity;
	let newest = members[0];
	for (const m of members) {
		if (m.ms < lo) lo = m.ms;
		if (m.ms > hi) hi = m.ms;
		if (m.ms > newest.ms) newest = m;
	}
	const span = hi - lo;
	if (span < minSpanMs) return { kind: 'select', origIdx: newest.origIdx };
	const pad = Math.max(span * padFraction, padFloorMs);
	return { kind: 'zoom', start: lo - pad, end: hi + pad };
}
