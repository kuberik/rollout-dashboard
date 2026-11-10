<!--
	LogHistogram: the Logs console's picture.

	ROLE. It answers the Logs tab's one question (SPEC §7): "Is this build
	erroring right now, and where do I look?" It is a fixed time window that
	ENDS AT NOW, so the right edge always means the present and an empty
	stretch there means "nothing logged lately", not "the chart ran out".
	Errors sit on the baseline in danger-solid, so a rising error share is
	red growing from the floor; warnings above them, info on top in the
	quietest neutral. It is operable: click a bar or drag across bars to filter the
	stream to that window (Clear sits in the right gutter, outside the plot);
	hover a bar for its time, line count and per-level counts. It draws
	whatever the console's pod / source / level filters let through, so with
	Error selected only error volume shows. It ignores search on purpose, and
	it never disappears: a window with nothing in it is a 1px baseline plus a
	sentence saying so.

	WHY A NEW COMPONENT. Nothing in the product draws a volume-over-time
	series. History's tenure strip is the nearest relative, but it draws
	SPANS (one segment per build), not COUNTS per bucket, and it has no
	brush. This was a block inside LogsViewer twice and both versions failed
	review (right-packed bars over the loaded range, labels on top of the
	bars, a ring for the selection), so it owns its own math and tests now.

	REFERENCES. Vercel's and Railway's log-volume charts (CRAFT-STUDY D5 /
	D6): thin bars across the full width, an empty bucket drawn as a gap,
	the window stated in words. Proportions are the console's own: a 40px
	strip (32px on a phone) under the 48px toolbar, `px-4` like the rows,
	labels in fixed gutters in `t-ui-sm` / `t-meta` (the card-rollup roles),
	the tooltip in the Columns menu's overlay shape (r8, `bg-overlay`,
	`--k-shadow-overlay`), the selection in `bg-selected` (the product's
	neutral selection fill, not blue: blue means deploying).
-->
<script lang="ts" module>
	export type HistogramLevel = 'error' | 'warn' | 'info' | 'debug' | null;

	export interface HistogramEntry {
		timestamp: number;
		level: HistogramLevel;
	}

	export interface HistogramBucket {
		start: number;
		end: number;
		total: number;
		errors: number;
		warnings: number;
	}

	export interface HistogramWindow {
		windowMs: number;
		bucketMs: number;
	}

	const MIN = 60_000;
	/** The windows a reader can be shown, smallest first. */
	export const HISTOGRAM_WINDOWS_MS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 120, 180, 360, 720, 1440].map(
		(m) => m * MIN
	);
	/** Bucket widths, smallest first: round numbers a reader can say aloud. */
	export const HISTOGRAM_BUCKETS_MS = [
		1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600
	].map((s) => s * 1000);
	/** Never fewer bars than this: below it the strip stops reading as a
	 *  series and becomes a row of blocks. */
	export const HISTOGRAM_MIN_BARS = 30;

	/**
	 * Picks the window and the bucket width.
	 *
	 * The WINDOW is the smallest one that holds everything loaded (the oldest
	 * line's age), so the loaded history spreads across the strip instead of
	 * huddling at one end of a fixed hour.
	 *
	 * The BUCKET is the smallest round width that keeps every bar at least
	 * `minSlotPx` wide at the plot's real width (15 min: 90 bars of 10s at
	 * 1440, 180 of 5s at 1920, 60 of 15s on a phone) AND, when the stream is
	 * sparse, holds about 1.5 lines on average: one line per bar draws a flat
	 * row of identical stubs, which says nothing. The density rule never
	 * takes the strip under `HISTOGRAM_MIN_BARS`. With no measured width
	 * (SSR, jsdom) it aims for 90 bars.
	 */
	export function chooseHistogramWindow(
		oldestAgeMs: number,
		plotWidthPx: number,
		minSlotPx = 8,
		loadedLines = 0
	): HistogramWindow {
		const age = Math.max(0, oldestAgeMs);
		const windowMs =
			HISTOGRAM_WINDOWS_MS.find((w) => w >= age) ??
			HISTOGRAM_WINDOWS_MS[HISTOGRAM_WINDOWS_MS.length - 1];
		const maxBars =
			plotWidthPx > 0 ? Math.max(12, Math.min(180, Math.floor(plotWidthPx / minSlotPx))) : 90;
		const fits = HISTOGRAM_BUCKETS_MS.filter((b) => windowMs / b <= maxBars);
		if (fits.length === 0) {
			return { windowMs, bucketMs: HISTOGRAM_BUCKETS_MS[HISTOGRAM_BUCKETS_MS.length - 1] };
		}
		const minBucketMs = loadedLines > 0 ? (1.5 * Math.max(age, 1000)) / loadedLines : 0;
		let bucketMs = fits.find((b) => b >= minBucketMs) ?? fits[fits.length - 1];
		if (windowMs / bucketMs < HISTOGRAM_MIN_BARS) {
			const finer = fits.filter((b) => windowMs / b >= HISTOGRAM_MIN_BARS);
			if (finer.length > 0) bucketMs = finer[finer.length - 1];
		}
		return { windowMs, bucketMs };
	}

	/** The window's right edge: `now` rounded UP to a bucket boundary, so the
	 *  bars step one slot every bucket instead of sliding every frame. */
	/**
	 * LOGOPEN r8 (coordinator, binding): the axis starts at the BUILD's
	 * start, or at now - 15 min when the build is younger. The window is
	 * that span exactly (not rounded up to a preset), and the bar is the
	 * finest preset bucket that keeps the bar count within the plot.
	 */
	export const HISTOGRAM_MIN_SPAN_MS = 15 * MIN;
	export function chooseBuildWindow(
		buildStart: number,
		now: number,
		plotWidthPx: number,
		minSlotPx = 8
	): HistogramWindow {
		const windowMs = Math.max(HISTOGRAM_MIN_SPAN_MS, now - buildStart);
		const maxBars =
			plotWidthPx > 0 ? Math.max(12, Math.min(180, Math.floor(plotWidthPx / minSlotPx))) : 90;
		const bucketMs =
			HISTOGRAM_BUCKETS_MS.find((b) => windowMs / b <= maxBars) ??
			HISTOGRAM_BUCKETS_MS[HISTOGRAM_BUCKETS_MS.length - 1];
		return { windowMs: Math.ceil(windowMs / bucketMs) * bucketMs, bucketMs };
	}

	export function histogramWindowEnd(now: number, bucketMs: number): number {
		return Math.ceil(now / bucketMs) * bucketMs;
	}

	/**
	 * Counts entries into `windowMs / bucketMs` buckets ending at `end`.
	 * An entry older than the window is not drawn; one stamped past `end`
	 * (clock skew between the pod and the browser) lands in the last bucket
	 * rather than vanishing. Every bucket exists even when it is empty; an
	 * empty bucket is a gap on the baseline, not a missing column.
	 */
	export function computeHistogramBuckets(
		entries: readonly HistogramEntry[],
		end: number,
		windowMs: number,
		bucketMs: number
	): HistogramBucket[] {
		const count = Math.max(1, Math.round(windowMs / bucketMs));
		const start = end - count * bucketMs;
		const buckets: HistogramBucket[] = Array.from({ length: count }, (_, i) => ({
			start: start + i * bucketMs,
			end: start + (i + 1) * bucketMs,
			total: 0,
			errors: 0,
			warnings: 0
		}));
		for (const e of entries) {
			if (e.timestamp < start) continue;
			const idx = Math.min(count - 1, Math.floor((e.timestamp - start) / bucketMs));
			const b = buckets[idx];
			b.total++;
			if (e.level === 'error') b.errors++;
			else if (e.level === 'warn') b.warnings++;
		}
		return buckets;
	}

	/** "15 min", "1 h", "24 h". */
	export function formatHistogramWindow(ms: number): string {
		const m = Math.round(ms / MIN);
		return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
	}

	/** "10s", "1m", "5m", "1h". */
	export function formatHistogramBucket(ms: number): string {
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		if (s < 3600) return `${Math.round(s / 60)}m`;
		return `${Math.round(s / 3600)}h`;
	}

	/** The phone gutter's range: "12:22–23" within an hour, "12:22" within a
	 *  minute, so it fits 68px without truncating. */
	export function shortRange(a: string, b: string): string {
		if (a === b) return a;
		const [ah, am] = a.split(':');
		const [bh, bm] = b.split(':');
		return ah === bh && am !== undefined && bm !== undefined ? `${ah}:${am}–${bm}` : `${a}–${b}`;
	}

	function plural(n: number, word: string): string {
		return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CloseOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import { formatClockTime } from '$lib/display-time';

	interface Props {
		/** What the console's pod / source / level filters let through. */
		entries: readonly HistogramEntry[];
		/** The oldest line in the source buffer, UNFILTERED: the window is
		 *  chosen from what is loaded, so it does not jump when a filter
		 *  changes. `null` when nothing has arrived. */
		oldest: number | null;
		/** The newest line in the source buffer, UNFILTERED. The window ends
		 *  at max(now, newest): when a capture pins the page clock behind the
		 *  pods' clock, the newest lines are not pushed out as "the future". */
		newest?: number | null;
		/** How many lines the source buffer holds, UNFILTERED (sets the bar
		 *  width for a sparse stream; see `chooseHistogramWindow`). */
		loaded?: number;
		/** The page clock, ms. */
		now: number;
		/** The committed time-window filter, or `null`. */
		selection: { start: number; end: number } | null;
		/** What the bars are counting when a level filter is on ("errors",
		 *  "errors and warnings"); `null` when every level shows. */
		levelNote?: string | null;
		/** The build's start (ms). When set, the axis starts there (or at
		 *  now - 15 min for a younger build): see `chooseBuildWindow`. */
		since?: number | null;
		/** Extra controls for the right gutter, beside Clear (the phone's
		 *  "Show all lines"). */
		actions?: Snippet;
		/** Makes the lead number a toggle ("Show errors", SPEC §7). */
		onlead?: () => void;
		leadPressed?: boolean;
		onselect: (range: { start: number; end: number }) => void;
		onclear: () => void;
	}

	let {
		entries,
		oldest,
		newest = null,
		loaded = 0,
		now,
		selection,
		levelNote = null,
		since = null,
		actions,
		onlead,
		leadPressed = false,
		onselect,
		onclear
	}: Props = $props();

	let plotWidth = $state(0);
	let plotEl: HTMLDivElement | undefined = $state();

	// A phone gets thinner bars (4px slots) so it still shows a real shape.
	const minSlot = $derived(plotWidth > 0 && plotWidth < 480 ? 4 : 8);
	const clock = $derived(newest !== null && newest > now ? newest : now);
	const win = $derived(
		since !== null
			? chooseBuildWindow(since, clock, plotWidth, minSlot)
			: chooseHistogramWindow(oldest === null ? 0 : clock - oldest, plotWidth, minSlot, loaded)
	);
	// `end` is a number, so this derived only fires downstream when the
	// window actually steps, not on every tick of the 100ms page clock.
	const end = $derived(histogramWindowEnd(clock, win.bucketMs));
	const buckets = $derived(computeHistogramBuckets(entries, end, win.windowMs, win.bucketMs));
	const max = $derived(buckets.reduce((m, b) => Math.max(m, b.total), 0));
	const inWindow = $derived(buckets.reduce((s, b) => s + b.total, 0));
	const windowLabel = $derived(formatHistogramWindow(win.windowMs));
	const bucketLabel = $derived(formatHistogramBucket(win.bucketMs));
	const noun = $derived(levelNote ?? 'lines');
	/** The lead number (r8, item 2.iii): errors on the axis, and when the
	 *  axis starts. */
	const errorsInWindow = $derived(buckets.reduce((s, b) => s + b.errors, 0));
	const axisStart = $derived(buckets.length > 0 ? buckets[0].start : end - win.windowMs);

	// ── Selection: indices while dragging, the committed range otherwise.
	let dragStart = $state<number | null>(null);
	let dragEnd = $state<number | null>(null);
	let hoverIndex = $state<number | null>(null);
	let keyAnchor = $state<number | null>(null);

	const band = $derived.by((): { lo: number; hi: number } | null => {
		if (dragStart !== null && dragEnd !== null) {
			return { lo: Math.min(dragStart, dragEnd), hi: Math.max(dragStart, dragEnd) };
		}
		if (!selection || buckets.length === 0) return null;
		const first = buckets[0].start;
		const n = buckets.length;
		const lo = Math.max(0, Math.floor((selection.start - first) / win.bucketMs));
		const hi = Math.min(n - 1, Math.ceil((selection.end - first) / win.bucketMs) - 1);
		if (hi < 0 || lo > n - 1 || hi < lo) return null;
		return { lo, hi };
	});

	const readout = $derived.by((): { range: string; short: string } | null => {
		let start: number;
		let stop: number;
		if (dragStart !== null && dragEnd !== null && band) {
			start = buckets[band.lo].start;
			stop = buckets[band.hi].end;
		} else if (selection) {
			start = selection.start;
			stop = selection.end;
		} else {
			return null;
		}
		return {
			range: `${formatClockTime(start, { seconds: true })}–${formatClockTime(stop, { seconds: true })}`,
			short: shortRange(formatClockTime(start), formatClockTime(stop))
		};
	});

	function indexAt(clientX: number, clientY: number): number | null {
		const n = buckets.length;
		if (n === 0) return null;
		const rect = plotEl?.getBoundingClientRect();
		if (rect && rect.width > 0) {
			const f = (clientX - rect.left) / rect.width;
			return Math.max(0, Math.min(n - 1, Math.floor(f * n)));
		}
		// No layout (jsdom): resolve the slot under the pointer instead.
		if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
			return null;
		}
		const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
		const slot = el?.closest('[data-histogram-bar]') as HTMLElement | null;
		const idx = slot ? Number(slot.dataset.histogramBar) : NaN;
		return Number.isNaN(idx) ? null : idx;
	}

	function commit(lo: number, hi: number) {
		const a = buckets[Math.min(lo, hi)];
		const b = buckets[Math.max(lo, hi)];
		if (a && b) onselect({ start: a.start, end: b.end });
	}

	function onDocMove(e: PointerEvent) {
		const idx = indexAt(e.clientX, e.clientY);
		if (idx !== null) dragEnd = idx;
	}

	function onDocUp() {
		document.removeEventListener('pointermove', onDocMove);
		if (dragStart !== null) commit(dragStart, dragEnd ?? dragStart);
		dragStart = null;
		dragEnd = null;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button > 0) return; // secondary buttons only; jsdom leaves `button` undefined
		const target = (e.target as HTMLElement | null)?.closest('[data-histogram-bar]') as
			| HTMLElement
			| null;
		const fromTarget = target ? Number(target.dataset.histogramBar) : NaN;
		const idx = Number.isNaN(fromTarget) ? indexAt(e.clientX, e.clientY) : fromTarget;
		if (idx === null) return;
		e.preventDefault();
		dragStart = idx;
		dragEnd = idx;
		hoverIndex = null;
		document.addEventListener('pointermove', onDocMove);
		document.addEventListener('pointerup', onDocUp, { once: true });
	}

	function onPointerMove(e: PointerEvent) {
		if (dragStart !== null || e.pointerType !== 'mouse') return;
		hoverIndex = indexAt(e.clientX, e.clientY);
	}

	function onKeydown(e: KeyboardEvent) {
		const n = buckets.length;
		if (n === 0) return;
		const cur = hoverIndex ?? n - 1;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const next = Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
			if (e.shiftKey) {
				if (keyAnchor === null) keyAnchor = cur;
				commit(keyAnchor, next);
			} else {
				keyAnchor = null;
			}
			hoverIndex = next;
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			keyAnchor = null;
			commit(cur, cur);
		} else if (e.key === 'Escape' && selection) {
			e.preventDefault();
			keyAnchor = null;
			onclear();
		}
	}

	const tip = $derived.by(() => {
		if (hoverIndex === null || dragStart !== null) return null;
		const b = buckets[hoverIndex];
		if (!b) return null;
		const n = buckets.length;
		const slot = plotWidth / n;
		const half = 88; // the tooltip is w-44
		const center = (hoverIndex + 0.5) * slot;
		const left = plotWidth > 0 ? Math.max(half, Math.min(plotWidth - half, center)) : 0;
		return {
			b,
			left,
			info: b.total - b.errors - b.warnings,
			range: `${formatClockTime(b.start, { seconds: true })} – ${formatClockTime(b.end, { seconds: true })}`
		};
	});

	const valueText = $derived.by(() => {
		const b = hoverIndex !== null ? buckets[hoverIndex] : null;
		if (!b) return `Last ${windowLabel}, ${plural(inWindow, 'line')}`;
		return `${formatClockTime(b.start, { seconds: true })}, ${plural(b.total, 'line')}, ${plural(b.errors, 'error')}`;
	});
</script>

<!-- Heights (LOGOPEN r8, item 2.iv): 32 phone, 48 sm+, 64 at >= 1800px.
     `h-16!`: Tailwind sorts the arbitrary `min-[1800px]` variant ahead of
     `sm:`, so without the important flag `sm:h-12` wins at 1920 (measured). -->
<div
	class="relative z-[15] flex h-8 shrink-0 items-stretch gap-2 sm:gap-3 border-b border-line bg-surface px-3 select-none sm:h-12 sm:px-4 min-[1800px]:h-16!"
	data-log-histogram
>
	<!-- LEFT GUTTER: the window in words, or the selection's range. The bars
	     never enter it. -->
	<div class="flex w-24 shrink-0 flex-col justify-center sm:w-32">
		{#if readout}
			<span class="t-ui-sm truncate text-fg tabular-nums">
				<span class="hidden sm:inline">{readout.range}</span><span class="sm:hidden"
					>{readout.short}</span
				>
			</span>
			<!-- No count here (LOGOPEN round 7): the console's footer says
			     "19 errors in this window" once; the readout names the window. -->
		{:else}
			<!-- ⭐ THE LEAD NUMBER (LOGOPEN r8, item 2.iii): the answer to "is
			     this build erroring?" in the Overview's 20px role, danger ink
			     only when there is something to answer; when the axis starts
			     underneath it. On the phone (32px) the same two facts at the
			     rollup scale. -->
			{#if onlead}
				<!-- The answer is also the action: one click shows the errors
				     (SPEC §7, "Show errors… one click from the histogram"). -->
				<button
					type="button"
					class="truncate text-left text-danger hover:underline max-sm:-mt-2.5 max-sm:-mb-1 max-sm:pt-2.5 max-sm:pb-1"
					aria-pressed={leadPressed}
					aria-label="{errorsInWindow.toLocaleString()} {errorsInWindow === 1 ? 'error' : 'errors'}"
					title={leadPressed ? 'Show all lines' : 'Show only errors'}
					onclick={onlead}
					data-histogram-lead
				>
				<!-- D3 (r10): while the Error filter is on, the phone lead is the
				     filled danger chip, the same Chip the header's FAILED uses: a
				     pressed toggle that reads as a state. Off: plain text. -->
				{#if leadPressed}
					<span class="inline-flex sm:hidden"
						><Chip
							role="failing"
							label="{errorsInWindow.toLocaleString()} {errorsInWindow === 1 ? 'error' : 'errors'}"
							wide
						/></span
					>
				{:else}
					<span class="lead-phone sm:hidden"
						><span class={errorsInWindow > 0 ? 'text-danger' : 'text-fg-muted'}
							>{errorsInWindow.toLocaleString()}</span
						> <span class="text-fg-muted">{errorsInWindow === 1 ? 'error' : 'errors'}</span></span
					>
				{/if}<span class="t-code-lg hidden leading-6 sm:inline">{errorsInWindow.toLocaleString()}</span
				><span class="t-ui-sm hidden sm:ml-1 sm:inline">{errorsInWindow === 1 ? 'error' : 'errors'}</span>
				</button>
			{:else}
				<span class="truncate {errorsInWindow > 0 ? 'text-danger' : 'text-fg-muted'}" data-histogram-lead>
				<span class="lead-phone sm:hidden"
					><span class={errorsInWindow > 0 ? 'text-danger' : 'text-fg-muted'}
						>{errorsInWindow.toLocaleString()}</span
					> <span class="text-fg-muted">{errorsInWindow === 1 ? 'error' : 'errors'}</span></span
				><span class="t-code-lg hidden leading-6 sm:inline">{errorsInWindow.toLocaleString()}</span
				><span class="t-ui-sm hidden sm:ml-1 sm:inline">{errorsInWindow === 1 ? 'error' : 'errors'}</span>
				</span>
			{/if}
			<!-- One line on the phone's 32px strip: the count only. -->
			<span class="t-meta hidden truncate text-fg-subtle tabular-nums sm:block">since {formatClockTime(axisStart)}</span>
		{/if}
	</div>

	<!-- THE PLOT. One slot per bucket across the full width (CSS grid, 1fr
	     each), the selection band behind the bars, a 1px baseline under
	     them. -->
	<div
		bind:this={plotEl}
		bind:clientWidth={plotWidth}
		class="relative min-w-0 flex-1 cursor-crosshair touch-none py-1 outline-none focus-visible:ring-2 focus-visible:ring-active-solid sm:py-1.5"
		role="slider"
		tabindex="0"
		aria-label="Log volume, last {windowLabel} in {bucketLabel} bars. Click or drag to filter the stream to a time window."
		aria-valuemin={0}
		aria-valuemax={Math.max(0, buckets.length - 1)}
		aria-valuenow={hoverIndex ?? Math.max(0, buckets.length - 1)}
		aria-valuetext={valueText}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerleave={() => (hoverIndex = null)}
		onkeydown={onKeydown}
		onblur={() => (hoverIndex = null)}
	>
		<div class="relative h-[calc(100%-5px)]">
			{#if band}
				<div
					class="pointer-events-none absolute inset-y-0 border-x border-line-strong bg-selected"
					style="left: {(band.lo / buckets.length) * 100}%; width: {((band.hi - band.lo + 1) /
						buckets.length) *
						100}%"
					data-histogram-band
				></div>
			{/if}
			<div
				class="relative grid h-full gap-x-px sm:gap-x-[2px]"
				style="grid-template-columns: repeat({buckets.length}, minmax(0, 1fr))"
			>
				{#each buckets as b, i (i)}
					{@const h = max > 0 && b.total > 0 ? Math.max(8, (b.total / max) * 100) : 0}
					{@const dim = band !== null && (i < band.lo || i > band.hi)}
					<div
						class="relative flex h-full flex-col justify-end pb-px {hoverIndex === i
							? 'bg-hover'
							: ''}"
						data-histogram-bar={i}
						data-total={b.total}
						data-errors={b.errors}
					>
						{#if h > 0}
							<!-- ⭐ ONE NEUTRAL FILL, TOTAL VOLUME (LOGOPEN r8, item 2.ii,
							     binding: "never stacked or two-tone"; the owner rejected
							     segmented bars twice). Errors are the tick row under the
							     axis, not a segment of the bar. Outside a selection the
							     bar dims. -->
							<div
								class="w-full bg-fg-disabled {dim ? 'opacity-40' : ''}"
								style="height: {h}%"
								data-segment="total"
							></div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line-strong"></div>
			<!-- THE ERROR TICK ROW (r8, item 2.ii): one 3px danger tick under
			     each bucket that holds an error, 2px below the axis. A tick,
			     not a bar: presence over time, the count is in the lead and
			     the tooltip. -->
			<div
				class="pointer-events-none absolute inset-x-0 -bottom-[5px] grid h-[3px] gap-x-px sm:gap-x-[2px]"
				style="grid-template-columns: repeat({buckets.length}, minmax(0, 1fr))"
				aria-hidden="true"
			>
				{#each buckets as b, i (i)}
					<span class={b.errors > 0 ? 'bg-danger-solid' : ''} data-error-tick={b.errors > 0 ? i : undefined}
					></span>
				{/each}
			</div>
			{#if inWindow === 0}
				<p
					class="t-meta pointer-events-none absolute inset-x-0 bottom-1 truncate text-center text-fg-subtle"
				>
					No {noun} {since !== null ? `since ${formatClockTime(axisStart)}` : `in the last ${windowLabel}`}
				</p>
			{/if}
		</div>

		{#if tip}
			<div
				class="pointer-events-none absolute top-full z-30 mt-1 w-44 -translate-x-1/2 rounded-lg border border-line bg-overlay p-2"
				style="left: {tip.left}px; box-shadow: var(--k-shadow-overlay)"
				role="tooltip"
				data-histogram-tooltip
			>
				<p class="t-meta text-fg-subtle tabular-nums">{tip.range}</p>
				<p class="t-ui-sm mt-0.5 text-fg">{plural(tip.b.total, 'line')}</p>
				<dl class="t-meta mt-1.5 space-y-0.5">
					<div class="flex items-center gap-1.5">
						<span class="status-dot bg-danger-solid" aria-hidden="true"></span>
						<dt class="flex-1 text-fg-muted">Error</dt>
						<dd class="tabular-nums {tip.b.errors > 0 ? 'text-danger' : 'text-fg-subtle'}">
							{tip.b.errors}
						</dd>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="status-dot bg-fg-subtle" aria-hidden="true"></span>
						<dt class="flex-1 text-fg-muted">Warning</dt>
						<dd class="tabular-nums {tip.b.warnings > 0 ? 'text-fg' : 'text-fg-subtle'}">
							{tip.b.warnings}
						</dd>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="status-dot bg-fg-disabled/50" aria-hidden="true"></span>
						<dt class="flex-1 text-fg-muted">Info &amp; debug</dt>
						<dd class="tabular-nums {tip.info > 0 ? 'text-fg' : 'text-fg-subtle'}">{tip.info}</dd>
					</div>
				</dl>
			</div>
		{/if}
	</div>

	<!-- RIGHT GUTTER: "now" (the plot's right edge), or Clear once a window
	     is selected. Fixed width, so the plot never resizes under the
	     pointer. -->
	<div class="flex shrink-0 items-center justify-end gap-1 {actions ? '' : 'w-8'} sm:w-[72px]">
		{#if actions}{@render actions()}{/if}
		{#if selection}
			<button
				type="button"
				class="btn btn-secondary btn-xs px-1.5 sm:px-2.5"
				aria-label="Clear time window"
				onclick={onclear}
			>
				<CloseOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
				<span class="sr-only sm:not-sr-only">Clear</span>
			</button>
		{:else if !actions}
			<span class="t-meta self-end pb-0.5 text-fg-subtle sm:pb-1">Now</span>
		{/if}
	</div>
</div>

<style>
	/* LOGOPEN r9, item 1: the phone's lead number, 16px mono at 600 with
	   the number in danger ink. No t-* role is 16px mono (t-code is 14,
	   t-code-lg 20/500), so it is scoped here, the History page's
	   `.build-id` precedent. */
	.lead-phone {
		font-family: var(--font-mono);
		font-size: 16px;
		line-height: 20px;
		font-weight: 600;
	}
</style>
