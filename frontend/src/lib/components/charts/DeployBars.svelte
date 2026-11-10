<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPLOY BARS — the one deploy-over-time chart. (design-rollout ruling
	 * 2026-10-09; Home v2's deploy series and /activity's volume chart are
	 * both this component with their own data.)
	 *
	 * ROLE: "how often did we ship, and where did it go wrong", on a time
	 * axis with a present tense. CRAFT-STUDY P3: the previous window sits
	 * behind as ghost bars (incident.io's contrast device), failures and
	 * rollbacks drop a labelled dotted marker through the plot (PlanetScale's
	 * `#1369`: "what changed here"), the right edge is `Now`.
	 *
	 * WHY NOTHING EXISTING FITS: `DeployVolumeSparkline` is a 64px glyph with
	 * no axis; `DeploymentTimeline` (History) is one rollout's swimlane.
	 *
	 * Rules (binding): every bar is ONE neutral fill — the owner rejected
	 * two-tone bars, so what failed is a marker, never a red segment; the
	 * ghost is the same neutral at ~40%; failed markers in danger ink, rolled
	 * back in held ink, releases neutral; nothing glows. Range selection is
	 * the caller's (it renders the toggles where its page needs them).
	 * Proportions: 160px plot (112 on a phone), `t-meta`-sized axis text, the
	 * overlay surface for the tooltip, `line-strong` outline for a selection.
	 */
	import {
		axisTicks,
		gridlineValues,
		placeMarkerLabels,
		pillLeft,
		scaleCeiling,
		averageCount,
		markerText,
		previousText,
		fitSpan,
		snapToBucket,
		type DeployBucket,
		type DeployMarker
	} from '$lib/view-models/deploy-bars';
	import { formatClockTime } from '$lib/display-time';
	import './chart-marks.css';

	let {
		buckets: allBuckets,
		previous: allPrevious = null,
		markers = [],
		startMs = undefined,
		endMs = undefined,
		height = undefined,
		selected = null,
		onBucketClick = undefined,
		bucketLabel = undefined,
		previousLabel = 'the period before',
		fitToData = false,
		emphasisLabel = undefined,
		observedFromMs = null,
		ariaLabel,
		class: className = ''
	}: {
		buckets: DeployBucket[];
		/** Nothing was observed before this instant: the average line is taken over the buckets from here on (QA #21). */
		observedFromMs?: number | null;
		/** The previous window on the same grid (index-aligned). null draws nothing. */
		previous?: DeployBucket[] | null;
		markers?: DeployMarker[];
		/** Axis bounds; default to the buckets' own. */
		startMs?: number;
		endMs?: number;
		/** Plot height. Default 160 from 640px of container, 112 below. */
		height?: number;
		selected?: { startMs: number; endMs: number } | null;
		onBucketClick?: (b: DeployBucket) => void;
		/** The tooltip's first line for a bucket; default `HH:MM–HH:MM`. */
		bucketLabel?: (b: DeployBucket) => string;
		/** How the previous window is named in the tooltip: "the week before". */
		previousLabel?: string;
		/** Draw from just before the first data instead of the whole window. */
		fitToData?: boolean;
		/** The tooltip line for an emphasised bucket ("Reached production"). */
		emphasisLabel?: string;
		ariaLabel: string;
		class?: string;
	} = $props();

	let width = $state(0);
	const W = $derived(Math.max(240, width));
	const narrow = $derived(width > 0 && width < 640);
	const PLOT_H = $derived(height ?? (narrow ? 112 : 160));
	const PAD_T = $derived(narrow ? 30 : 52); // room for two rows of marker pills
	const AXIS_H = 22;
	const PAD_L = 30;
	const PAD_R = 8;
	const plotW = $derived(W - PAD_L - PAD_R);
	const from = $derived(fitToData ? fitSpan(allBuckets.map((b, i) => b.count + (allPrevious?.[i]?.count ?? 0))) : 0);
	const buckets = $derived(from ? allBuckets.slice(from) : allBuckets);
	const previous = $derived(allPrevious ? (from ? allPrevious.slice(from) : allPrevious) : null);
	const s0 = $derived(from ? buckets[0].startMs : (startMs ?? buckets[0]?.startMs ?? 0));
	const s1 = $derived(endMs ?? buckets.at(-1)?.endMs ?? 1);

	const scale = $derived(scaleCeiling([...buckets.map((b) => b.count), ...(previous ?? []).map((b) => b.count)]));
	const grid = $derived(gridlineValues(scale.ceiling));
	const top = $derived(grid.at(-1) || 1);
	const y = (v: number) => PAD_T + PLOT_H - (v / top) * PLOT_H;
	const xMs = (ms: number) => PAD_L + ((ms - s0) / (s1 - s0 || 1)) * plotW;
	const slot = $derived(plotW / Math.max(1, buckets.length));
	/** A marker's x: the centre of its bar's bucket (so the line runs through the bar). */
	const xMark = (ms: number) => {
		const i = snapToBucket(ms, buckets);
		return i == null ? xMs(ms) : PAD_L + slot * i + slot / 2;
	};
	const yc = (v: number) => y(Math.min(v, top));
	const avg = $derived(averageCount(buckets, observedFromMs));
	const barW = $derived(Math.max(2, Math.min(20, slot * 0.6)));

	const ticks = $derived(axisTicks(s0, s1, narrow ? 3 : buckets.length > 20 ? 6 : 4));
	const pillW = (m: DeployMarker) => markerText(m).length * (m.font === 'sans' || m.tone !== 'release' ? 6.2 : 6.8) + 14;
	const rows = $derived(
		placeMarkerLabels(markers, xMark, pillW, { rows: narrow ? 1 : 2, minGap: 8, minX: PAD_L - 4, maxX: W - PAD_R })
	);

	let hover = $state<number | null>(null);
	// Keyboard: the bucket group is ONE tab stop (roving tabindex, starting on
	// the newest bucket with deploys); arrows move, Home/End jump, the
	// tooltip follows focus, Enter/Space selects when the caller listens.
	let focusIdx = $state<number | null>(null);
	const lastNonEmpty = $derived(Math.max(0, buckets.findLastIndex((b) => b.count > 0)));
	let hitEl = $state<HTMLDivElement | null>(null);
	function keyNav(e: KeyboardEvent, i: number) {
		const n = buckets.length;
		const to =
			e.key === 'ArrowRight' ? Math.min(n - 1, i + 1)
			: e.key === 'ArrowLeft' ? Math.max(0, i - 1)
			: e.key === 'Home' ? 0
			: e.key === 'End' ? n - 1
			: null;
		if (to == null) return;
		e.preventDefault();
		focusIdx = to;
		(hitEl?.children[to] as HTMLElement | undefined)?.focus();
	}
	const hb = $derived(hover != null ? buckets[hover] : null);
	function label(b: DeployBucket): string {
		if (bucketLabel) return bucketLabel(b);
		const day = b.endMs - b.startMs >= 86_400_000;
		if (day) return new Date(b.startMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
		return `${formatClockTime(b.startMs)}–${formatClockTime(b.endMs)}`;
	}
	function markersIn(b: DeployBucket) {
		return markers.filter((m) => m.tsMs >= b.startMs && m.tsMs < b.endMs);
	}
	const isSel = (b: DeployBucket) => !!selected && selected.startMs === b.startMs && selected.endMs === b.endMs;
</script>

<div class="db relative w-full {className}" bind:clientWidth={width}>
	{#if width > 0}
		<svg width={W} height={PAD_T + PLOT_H + AXIS_H} viewBox="0 0 {W} {PAD_T + PLOT_H + AXIS_H}" class="block overflow-visible" role="img" aria-label={ariaLabel}>
			{#each grid as g (g)}
				<line x1={PAD_L} x2={W - PAD_R} y1={y(g)} y2={y(g)} class={g === 0 ? 'db-base' : 'db-grid'} />
				{#if g === 0 || g === top || (!narrow && grid.length <= 6)}
					<text x={PAD_L - 6} y={y(g) + 3.5} text-anchor="end" class="db-text">{g}</text>
				{/if}
			{/each}

			{#each buckets as b, i (b.startMs)}
				{@const cx = PAD_L + slot * i + slot / 2}
				{@const p = previous?.[i]?.count ?? 0}
				<!-- The previous window BEHIND its bar, same x and width: a lighter
				     bar with a firm top edge, visible wherever last period was higher. -->
				{#if p > 0}
					<rect x={cx - barW / 2} width={barW} y={yc(p)} height={y(0) - yc(p)} rx="2" class="db-ghost" />
					<line x1={cx - barW / 2} x2={cx + barW / 2} y1={yc(p)} y2={yc(p)} class="db-ghost-top" />
				{/if}
				{#if b.count > 0}
					{@const over = b.count > top}
					<rect
						x={cx - barW / 2}
						width={barW}
						y={yc(b.count)}
						height={y(0) - yc(b.count)}
						rx="2"
						class="db-bar"
						class:db-bar-em={b.emphasis}
						class:db-bar-hover={hover === i}
					/>
					{#if over}
						<!-- Clipped by the auto range: a break mark and the true value. -->
						<path d="M{cx - barW / 2 - 1},{y(top) + 5} l{barW + 2},-3 M{cx - barW / 2 - 1},{y(top) + 9} l{barW + 2},-3" class="db-break" />
						<!-- Above the on-series mark when the bar carries one (it sits at the bar's top). -->
						{@const marked = markers.some((m) => m.tone !== 'release' && m.tsMs >= b.startMs && m.tsMs < b.endMs)}
						<text x={cx} y={y(top) - (marked ? 13 : 4)} text-anchor="middle" class="db-text db-over">{b.count}</text>
					{/if}
					{#if markers.some((m) => m.tone !== 'release' && m.tsMs >= b.startMs && m.tsMs < b.endMs)}
						{@const bad = markers.find((m) => m.tone !== 'release' && m.tsMs >= b.startMs && m.tsMs < b.endMs)!}
						{@const badTone = bad.resolved ? 'resolved' : bad.tone}
						<!-- What went wrong sits ON the series: a mark at the bar's top in
						     the marker's ink (a mark, not a segment: bars stay one fill). -->
						<circle cx={cx} cy={yc(b.count) - 4} r="3.5" class="db-onseries db-on-{badTone}" />
					{/if}
				{/if}
				{#if isSel(b)}
					<rect x={PAD_L + slot * i + 1} width={slot - 2} y={PAD_T - 4} height={PLOT_H + 4} rx="3" class="db-sel" />
				{/if}
			{/each}

			{#if avg > 0 && avg < top}
				<!-- The average line, with its value in a pill (incident.io D3). -->
				<line x1={PAD_L} x2={W - PAD_R} y1={y(avg)} y2={y(avg)} class="db-avg" />
				{@const at = `avg ${avg >= 10 ? Math.round(avg) : avg.toFixed(1)}`}
				<!-- Quiet: a dotted line and an unfilled 11px label above it. -->
				<!-- At the LEFT end of its line: the newest (rightmost) bars are the
				     tallest on a busy week and would cover a right-hand label. -->
				<text x={PAD_L + 4} y={y(avg) - 4} text-anchor="start" class="db-avg-text">{at}</text>
			{/if}

			{#each markers as m (m.key)}
				{@const mx = xMark(m.tsMs)}
				{@const row = rows.get(m.key)}
				<g class="db-marker db-m-{m.resolved ? 'resolved' : m.tone}">
					<line x1={mx} x2={mx} y1={row != null ? 22 + row * 22 : PAD_T - 6} y2={y(0)} class="db-mline" />
					{#if row != null}
						{@const pw = pillW(m)}
						{@const px = pillLeft(mx, pw, PAD_L - 4, W - PAD_R)}
						<rect x={px} y={4 + row * 22} width={pw} height="18" rx="4" class="db-pill" />
						<text x={px + pw / 2} y={16.5 + row * 22} text-anchor="middle" class="db-ptext" class:db-ptext-sans={m.font === 'sans' || m.tone !== 'release'}>{markerText(m)}</text>
					{/if}
				</g>
			{/each}

			<line x1={W - PAD_R} x2={W - PAD_R} y1={PAD_T - 6} y2={y(0) + 4} class="db-now" />
			{#each ticks as t, i (t.ms)}
				<text x={xMs(t.ms)} y={PAD_T + PLOT_H + 16} text-anchor={i === 0 ? 'start' : 'middle'} class="db-text">{t.label}</text>
			{/each}
			<text x={W - PAD_R} y={PAD_T + PLOT_H + 16} text-anchor="end" class="db-text db-now-text">Now</text>
		</svg>

		<!-- Hit targets: one focusable column per bucket, above the svg. -->
		<!-- Full-pitch hit columns (a tap anywhere in a bucket's column takes it,
		     however thin its bar), one tab stop for the group. -->
		<div class="absolute flex" style="left: {PAD_L}px; top: {PAD_T - 4}px; width: {plotW}px; height: {PLOT_H + 4}px" role="group" aria-label="{ariaLabel}. Use the arrow keys to read each bucket." bind:this={hitEl}>
			{#each buckets as b, i (b.startMs)}
				{@const ms = markersIn(b)}
				<button
					type="button"
					class="db-hit h-full min-w-0 flex-1"
					aria-label="{label(b)}: {b.count} deploy{b.count === 1 ? '' : 's'}{ms.length ? `, ${ms.length} marked` : ''}"
					aria-pressed={onBucketClick ? isSel(b) : undefined}
					tabindex={i === (focusIdx ?? lastNonEmpty) ? 0 : -1}
					onkeydown={(e) => keyNav(e, i)}
					onmouseenter={() => (hover = i)}
					onmouseleave={() => (hover = hover === i ? null : hover)}
					onfocus={() => {
						hover = i;
						focusIdx = i;
					}}
					onblur={() => (hover = hover === i ? null : hover)}
					onclick={() => onBucketClick?.(b)}
				></button>
			{/each}
		</div>

		<!-- Marker links ABOVE the bucket hit layer: a marker with an `href` is one
		     link — its line (a wide invisible hit stroke), its pill and its label —
		     with an accessible name and its own focus ring. -->
		{#if markers.some((m) => m.href)}
			<svg width={W} height={PAD_T + PLOT_H} class="db-links pointer-events-none absolute top-0 left-0 overflow-visible" aria-hidden="false">
				{#each markers.filter((m) => m.href) as m (m.key)}
					{@const mx = xMark(m.tsMs)}
					{@const row = rows.get(m.key)}
					{@const pw = pillW(m)}
					{@const px = pillLeft(mx, pw, PAD_L - 4, W - PAD_R)}
					<a href={m.href} class="db-link db-m-{m.resolved ? 'resolved' : m.tone}" aria-label="Open {m.title ?? markerText(m)}">
						<line x1={mx} x2={mx} y1={row != null ? 22 + row * 22 : PAD_T - 6} y2={y(0)} class="db-link-hit" />
						{#if row != null}
							<rect x={px - 2} y={2 + row * 22} width={pw + 4} height="22" rx="5" class="db-link-pill" />
						{/if}
					</a>
				{/each}
			</svg>
		{/if}

		{#if hb && hover != null}
			{@const ms = markersIn(hb)}
			{@const tx = PAD_L + slot * hover + slot / 2}
			<div
				class="db-tip pointer-events-none absolute z-10 rounded-md bg-overlay px-2.5 py-1.5"
				style="left: {Math.min(Math.max(tx, 70), W - 70)}px; top: {Math.max(0, y(hb.count) - 44)}px"
				role="status"
			>
				<div class="t-meta whitespace-nowrap text-fg-subtle">{label(hb)}</div>
				<div class="t-ui-sm whitespace-nowrap text-fg">
					<span class="tabular-nums">{hb.count}</span> deploy{hb.count === 1 ? '' : 's'}{#if previous?.[hover]}<span class="text-fg-subtle"
							>{' · '}{previousText(previous[hover].count, previousLabel)}</span
						>{/if}
				</div>
				{#if hb.emphasis && emphasisLabel}<div class="t-meta whitespace-nowrap text-fg-muted">{emphasisLabel}</div>{/if}
				{#each ms.slice(0, 3) as m (m.key)}
					<div class="t-meta whitespace-nowrap {m.tone === 'failed' ? 'text-danger' : m.tone === 'rolledBack' ? 'text-fg' : 'text-fg-muted'}">
						{m.title ?? markerText(m)}
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<div style="height: {PAD_T + (height ?? 160) + AXIS_H}px" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.db-text {
		font-family: var(--font-sans);
		font-size: 11px;
		fill: var(--k-fg-subtle);
		font-variant-numeric: tabular-nums;
	}
	.db-now-text {
		fill: var(--k-fg-muted);
		font-weight: 500;
	}
	.db-grid {
		stroke: var(--k-line-subtle);
	}
	.db-base {
		stroke: var(--k-line);
	}
	.db-bar {
		fill: color-mix(in oklab, var(--k-fg-subtle) 55%, transparent);
		transition: fill 120ms var(--ease-out, ease-out);
	}
	.db-bar-em {
		fill: var(--k-fg-muted);
	}
	.db-bar-hover {
		fill: var(--k-fg-muted);
	}
	/* The previous window: an outline of the same bar (a different TREATMENT,
	   not a second hue), so it can never be mistaken for this week's. */
	.db-ghost {
		fill: color-mix(in oklab, var(--k-fg-subtle) 22%, transparent);
	}
	.db-ghost-top {
		stroke: var(--k-fg-subtle);
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.db-break {
		stroke: var(--k-surface);
		stroke-width: 2;
		fill: none;
	}
	.db-over {
		fill: var(--k-fg-muted);
		font-weight: 500;
	}
	.db-avg {
		stroke: var(--k-fg-subtle);
		stroke-dasharray: 2 3;
	}
	.db-avg-text {
		paint-order: stroke;
		stroke: var(--k-surface);
		stroke-width: 3px;
		stroke-linejoin: round;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		fill: var(--k-fg-subtle);
		font-variant-numeric: tabular-nums;
	}
	.db-onseries {
		stroke: var(--k-surface);
		stroke-width: 1.5;
	}
	.db-on-failed {
		fill: var(--k-danger-solid);
	}
	.db-on-resolved {
		fill: var(--k-fg-subtle);
	}
	.db-on-rolledBack {
		fill: var(--k-fg);
	}
	.db-sel {
		fill: none;
		stroke: var(--k-line-strong);
	}
	.db-link {
		pointer-events: auto;
		cursor: pointer;
		outline: none;
	}
	.db-link-hit {
		stroke: transparent;
		stroke-width: 12;
	}
	.db-link-pill {
		fill: transparent;
		stroke: transparent;
		stroke-width: 2;
	}
	.db-link:hover .db-link-pill {
		stroke: var(--k-line-strong);
	}
	.db-link:focus-visible .db-link-pill,
	.db-link:focus-visible .db-link-hit {
		stroke: var(--k-focus);
	}
	.db-link:focus-visible .db-link-hit {
		stroke-width: 2;
	}
	.db-hit {
		background: transparent;
		border-radius: 3px;
		cursor: default;
	}
	.db-hit:focus-visible {
		outline: 2px solid var(--k-focus);
		outline-offset: -2px;
	}
	.db-tip {
		transform: translateX(-50%);
		box-shadow: var(--k-shadow-overlay);
	}
</style>
