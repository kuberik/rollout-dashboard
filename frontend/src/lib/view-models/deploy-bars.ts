/**
 * DEPLOY BARS — the pure half of the one deploy-over-time chart
 * (`components/charts/DeployBars.svelte`). Bucketing, nice ticks, human-time
 * axis labels and marker-label placement live here so every number the chart
 * draws is testable without a browser. (design-rollout ruling 2026-10-09: one
 * chart primitive for Home, /activity and anything else that draws deploys
 * on a time axis.)
 *
 * Bars are a COUNT, single fill (the owner rejected two-tone bars). What went
 * wrong is said by MARKERS — a failed or rolled-back deploy is a labelled
 * dotted line through the plot (PlanetScale's `#1369`) — never by a red
 * segment stacked into a bar.
 */

export type DeployBucket = {
	startMs: number;
	endMs: number;
	count: number;
	/** Draw this bar in the darker depth (still ONE fill): the caller's "this
	 *  bucket matters" — Home marks buckets holding a production release. */
	emphasis?: boolean;
};

export type DeployMarkerTone = 'release' | 'failed' | 'rolledBack';

export type DeployMarker = {
	key: string;
	tsMs: number;
	/** Short: the SUBJECT — an app (sans) or a sha/version (mono). Put the
	 *  other id in `title` (the tooltip and the accessible name). */
	label: string;
	tone: DeployMarkerTone;
	/** A failure or rollback that is no longer the rollout's current state:
	 *  history stays true, but it is drawn in neutral ink with "resolved"
	 *  (coordinator ruling, 2026-10-10: red only while unresolved). */
	resolved?: boolean;
	/** Failed/rolledBack: where it happened ("dev") and when ("01:37"), for the label. */
	where?: string;
	when?: string;
	/** A name is set in the sans, an id (sha, version) in the mono (DESIGN-LANGUAGE principle 3). Default mono. */
	font?: 'mono' | 'sans';
	href?: string;
	title?: string;
};

/**
 * `[startMs, endMs]` cut into `count` equal buckets, oldest first; always a
 * full set (a quiet window draws a flat baseline, not nothing).
 */
export function bucketize(timestampsMs: readonly number[], startMs: number, endMs: number, count: number): DeployBucket[] {
	const n = Math.max(1, Math.floor(count));
	const size = (endMs - startMs) / n;
	const out: DeployBucket[] = Array.from({ length: n }, (_, i) => ({
		startMs: startMs + i * size,
		endMs: startMs + (i + 1) * size,
		count: 0
	}));
	if (!(size > 0)) return out;
	for (const t of timestampsMs) {
		if (!Number.isFinite(t) || t < startMs || t > endMs) continue;
		out[Math.min(n - 1, Math.floor((t - startMs) / size))].count++;
	}
	return out;
}

/** `1|2|2.5|5|10 × 10^n`, smallest at or above `rough`. */
function niceStep(rough: number): number {
	const mag = 10 ** Math.floor(Math.log10(rough));
	const norm = rough / mag;
	return ([1, 2, 2.5, 5, 10].find((f) => f >= norm) ?? 10) * mag;
}

/**
 * Round gridline values (0/25/50/75/100), integers only (counts), the last
 * being the scale's ceiling — bars are plotted against it, never against the
 * raw max, so a bar never floats under the top line it earned.
 */
export function gridlineValues(max: number, target = 4): number[] {
	if (!(max > 0)) return [0, 1];
	const step = Math.max(1, Math.round(niceStep(max / target)));
	const top = Math.ceil(max / step) * step;
	const out: number[] = [];
	for (let v = 0; v <= top; v += step) out.push(v);
	return out;
}

/** Axis labels in human time: `18h ago`, `3d ago`, … `Now` is drawn separately. */
export function axisTicks(startMs: number, endMs: number, count: number): { ms: number; label: string }[] {
	const span = endMs - startMs;
	const n = Math.max(1, Math.floor(count));
	const hours = span <= 2 * 86_400_000;
	const out: { ms: number; label: string }[] = [];
	for (let i = 0; i < n; i++) {
		const ms = startMs + (span * i) / n;
		const ago = endMs - ms;
		out.push({
			ms,
			label: hours
				? ago < 3_600_000
					? `${Math.round(ago / 60_000)}m ago`
					: `${Math.round(ago / 3_600_000)}h ago`
				: `${Math.round(ago / 86_400_000)}d ago`
		});
	}
	return out;
}

/**
 * Which marker labels to draw, and on which row, so no two pills collide.
 * Markers are placed left to right; a label goes on the first of `rows`
 * rows whose last label ends `minGap` px before it starts, else it is
 * dropped (the dotted line still draws, its label lives in the tooltip).
 * Failed outranks rolled back outranks release when two compete.
 */
/** Where a marker's pill is drawn: centred on its line, clamped inside the plot. */
export function pillLeft(x: number, w: number, minX: number, maxX: number): number {
	return Math.min(Math.max(minX, x - w / 2), maxX - w);
}

export function placeMarkerLabels(
	markers: readonly DeployMarker[],
	xOf: (ms: number) => number,
	widthOf: (m: DeployMarker) => number,
	opts: { rows?: number; minGap?: number; minX?: number; maxX?: number } = {}
): Map<string, number> {
	const rows = opts.rows ?? 1;
	const gap = opts.minGap ?? 8;
	const rank: Record<DeployMarkerTone, number> = { failed: 0, rolledBack: 1, release: 2 };
	const ordered = [...markers].sort((a, b) => rank[a.tone] - rank[b.tone] || b.tsMs - a.tsMs);
	const taken: { l: number; r: number; row: number }[] = [];
	const out = new Map<string, number>();
	for (const m of ordered) {
		const w = widthOf(m);
		// Clamp exactly as the pill is drawn, so the collision test sees the real box.
		const l = Math.min(Math.max(opts.minX ?? -Infinity, xOf(m.tsMs) - w / 2), (opts.maxX ?? Infinity) - w);
		const r = l + w;
		for (let row = 0; row < rows; row++) {
			if (taken.some((t) => t.row === row && l < t.r + gap && r > t.l - gap)) continue;
			taken.push({ l, r, row });
			out.set(m.key, row);
			break;
		}
	}
	return out;
}

/**
 * The y-scale ceiling for a series, robust to one outlier ("auto range").
 * A single 60-deploy hour must not squash a week of 3s into 1–4px bars: when
 * the max is more than 4× the 90th percentile of the non-zero buckets, the
 * scale tops out at a nice value just above that percentile and taller bars
 * are drawn clipped with a break mark and their value. Otherwise the max.
 */
export function scaleCeiling(counts: readonly number[]): { ceiling: number; clipped: boolean } {
	const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
	const max = nz.at(-1) ?? 0;
	if (nz.length < 5) return { ceiling: max, clipped: false };
	const p90 = nz[Math.floor((nz.length - 1) * 0.9)];
	if (max <= p90 * 4) return { ceiling: max, clipped: false };
	return { ceiling: Math.max(p90 * 1.6, 2), clipped: true };
}

/** The mean count per bucket (over all buckets, quiet ones included). */
export function averageCount(buckets: readonly DeployBucket[], observedFromMs?: number | null): number {
	// QA #21: buckets that ended before anything was observed are not "quiet", they are unobserved — a young cluster's average is over
	// the time it has existed, not over the whole nominal window.
	const seen = observedFromMs == null ? buckets : buckets.filter((b) => b.endMs > observedFromMs);
	return seen.length ? seen.reduce((n, b) => n + b.count, 0) / seen.length : 0;
}

/** A marker's pill text: the tone's verb, then the caller's label (a sha, or an app). */
export function markerText(m: DeployMarker): string {
	if (m.tone === 'release') return m.label;
	// Written once, subject first, in the sans: "hello-world failed in dev · 01:37".
	const verb = m.tone === 'failed' ? 'failed' : 'rolled back';
	const where = m.where ? ` in ${m.where}` : '';
	const when = m.when ? ` · ${m.when}` : '';
	return `${m.label} ${verb}${where}${when}${m.resolved ? ' · resolved' : ''}`;
}

/**
 * The buckets worth drawing: from just before the first one that holds data
 * to the end ("range to the data's span, not the window"). Keeps at least
 * `min` buckets, so an hour of data in a 30-day window is not a 91%-empty plot.
 */
export function fitSpan(counts: readonly number[], min = 8): number {
	const first = counts.findIndex((c) => c > 0);
	if (first < 0) return 0;
	return Math.max(0, Math.min(first - 1, counts.length - min));
}

/** A marker snapped to the centre of the bucket it falls in (null outside the buckets). */
export function snapToBucket(tsMs: number, buckets: readonly DeployBucket[]): number | null {
	const i = buckets.findIndex((b) => tsMs >= b.startMs && tsMs < b.endMs);
	if (i >= 0) return i;
	const last = buckets.length - 1;
	return last >= 0 && tsMs === buckets[last].endMs ? last : null;
}

/** The tooltip's previous-window line, in words: "none the week before", "12 the day before". */
export function previousText(n: number, period: string): string {
	return n === 0 ? `none ${period}` : `${n} ${period}`;
}
