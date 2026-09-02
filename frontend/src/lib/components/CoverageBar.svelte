<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE COVERAGE BAR — one object, two scales.
	 *
	 * `fleet-explore.js` concept 07, verbatim: *"Take one build and ask: how far
	 * has it reached across the fleet? A single coverage bar segments every
	 * environment into live / ahead / behind — the release wavefront in one
	 * glance."* Plus its scale note, which is the reason the design holds:
	 * *"The bar is proportional and the groups are lists — one revision over 4
	 * regions or 40 reads as the same four buckets."*
	 *
	 * IT IS THE SAME COMPONENT ON `/versions` AND ON `/versions/<rev>`, at two
	 * sizes, because the list's whole reason to exist is ranking revisions
	 * against each other and a comparison only reads down a column when the
	 * thing being compared is one object at one scale. The counts cannot do that
	 * job: on the live cluster row 1 reads `14 of 15` and row 5 reads `1 of 9`,
	 * because a revision's denominator is the slot set of the services that
	 * carry IT. Different denominators are not comparable as numbers; the same
	 * proportional bar is comparable as a shape.
	 *
	 * ── THE HUMAN'S CORRECTION, AND WHAT IT MEASURED ────────────────────────
	 *
	 * *"i think this bar would be better if it was split into bars — so that we
	 * see on the bar also exactly how many are in either state."*
	 *
	 * That was a real defect and it is measurable. On every one of the 36
	 * revisions this cluster carries, `revisionCoverage()` returns EXACTLY ONE
	 * non-empty bucket — so the "segmented" bar rendered as a single 1216px slab
	 * of one colour, with `6 of 6` stated above it, `6` again on the group under
	 * it and `6 places` a third time on the bucket card. The quantity was
	 * written three times in words and the graphic carried none of it. A field
	 * that never divides is not a segmented bar; it is a rectangle.
	 *
	 * So the bar draws the DENOMINATOR, not only the partition:
	 *
	 *   · ONE CELL PER PLACE. Six places is six tiles with a 2px gutter,
	 *     whatever the buckets do. The count is legible off the shape itself,
	 *     and a one-bucket build — which is 36 of 36 revisions here — reads as a
	 *     deliberate measure instead of a slab.
	 *   · ONE GROUP PER BUCKET, 8px apart and separately rounded. That is the
	 *     split: distinct bars, not one bar with joins.
	 *   · THE COUNT PRINTED IN THE GROUP at full size, 12px/600, so the exact
	 *     figure is ON the bar and not only beside it. The duplicate that used
	 *     to carry it — `FleetSpread`'s group rollup — is gone with it.
	 *
	 * IT STILL SCALES. Above `CELL_MAX` places the cells would be sub-legible
	 * hairlines, so the group falls back to one solid segment and the printed
	 * numeral becomes the exact reading — the same requirement served the only
	 * way left at that size. Each group's `min-width` is computed from the cells
	 * it holds, so proportionality is exact everywhere below the fallback.
	 *
	 * WHY IT IS ALLOWED TO LOOK LIKE A PROGRESS BAR. `DESIGN.md` deletes "long
	 * composition bars" on sight, and the stated reason is *"they look like
	 * progress bars but aren't"* — a header bar that composites unrelated
	 * success and failure counts invites a reading of "how far along" that the
	 * data does not support. Here that reading is the DATA: the page's first
	 * criterion is literally "how far has this build reached across the fleet".
	 * This is the one place in the product where the form and the meaning agree.
	 *
	 * COLOUR LIVES IN `revision-coverage.ts`, not here — see the `COVERAGE_FILL`
	 * block for the whole argument, including why `live` is now the product's
	 * health green rather than the `newest` chip's mint, and why `notYet` is
	 * drawn HOLLOW rather than amber. The one thing this file owns is the ink of
	 * the numeral that sits ON each fill, which is a property of this bar and of
	 * nothing else.
	 */
	import {
		coverageFill,
		type CoverageKey,
		type CoverageSegment
	} from '$lib/view-models/revision-coverage';

	let {
		segments,
		compact = false,
		label,
		class: className = ''
	}: {
		segments: CoverageSegment[];
		/** The list-row miniature. Same buckets, same cells, 8px instead of 26px. */
		compact?: boolean;
		/** Accessible name. The bar is a graphic; the words live here and in the cards. */
		label: string;
		class?: string;
	} = $props();

	const total = $derived(segments.reduce((n, s) => n + s.count, 0));

	/**
	 * ABOVE THIS MANY PLACES THE CELLS STOP BEING COUNTABLE AND BECOME TEXTURE.
	 * Measured against the two tracks the bar actually gets: 200px in a
	 * `/versions` row, and 326px for the lead panel at 390. At 32 places the
	 * miniature draws 32 × 3px + 31 × 1px = 127px of a 200px track and the full
	 * bar 32 × 5px + 31 × 2px = 222px of 326 — both still proportional. Past it
	 * the group becomes one solid segment and the printed numeral carries the
	 * count alone.
	 */
	const CELL_MAX = 32;
	const cellular = $derived(total > 0 && total <= CELL_MAX);

	const CELL_MIN = $derived(compact ? 3 : 5);
	const CELL_GAP = $derived(compact ? 1 : 2);

	/** `[0..n-1]` — `{#each}` wants a real iterable, not an array-like. */
	function cells(n: number): number[] {
		return Array.from({ length: n }, (_, i) => i);
	}

	function groupMin(count: number): number {
		if (!cellular) return compact ? 4 : 6;
		return count * CELL_MIN + (count - 1) * CELL_GAP;
	}

	/**
	 * THE NUMERAL'S INK, DERIVED FROM THE FILL IT SITS ON AND FROM NOTHING ELSE.
	 * Two of the five fills are dark in light mode and light in dark mode, so
	 * the ink has to flip with them or the digit is 1.9:1 on `green-400`.
	 * `notYet` is hollow, so its digit sits on the page ground and takes the
	 * ordinary muted ink.
	 */
	const NUM_INK: Record<CoverageKey, string> = {
		live: 'text-white dark:text-green-950',
		failing: 'text-white dark:text-red-950',
		ahead: 'text-gray-700 dark:text-white',
		notYet: 'text-gray-600 dark:text-gray-300',
		unplaceable: 'text-gray-600 dark:text-gray-300'
	};
</script>

<!--
	`role="img"` with a real name, not a chart nobody can read aloud. The visible
	explanation is the bucket cards on the detail page and the groups under the
	bar on the list.
-->
<div
	class="prop-bar cov {compact ? 'cov--compact' : ''} {className}"
	role="img"
	aria-label={label}
	title={label}
>
	{#if total === 0}
		<!-- No slots at all. An empty TRACK, not a missing element: the row still
		     has to occupy the column so the ones beside it stay comparable. -->
		<span class="cov-seg" style="flex-grow:1">
			<span class="cov-cell bg-gray-100 dark:bg-gray-800"></span>
		</span>
	{:else}
		{#each segments as seg (seg.key)}
			{#if seg.count > 0}
				<span
					class="cov-seg"
					style="flex-grow:{seg.count};min-width:{groupMin(seg.count)}px"
					title="{seg.count} {seg.title.toLowerCase()}"
				>
					{#if cellular}
						<!-- ONE CELL PER PLACE, keyed by index: the cells are identical by
						     construction. The GROUP is the unit of meaning; the CELL is the
						     unit of counting. -->
						{#each cells(seg.count) as i (i)}
							<span class="cov-cell {coverageFill(seg.key)}"></span>
						{/each}
					{:else}
						<span class="cov-cell {coverageFill(seg.key)}"></span>
					{/if}

					{#if !compact}
						<!-- THE EXACT FIGURE, ON THE BAR. Hidden by a container query
						     rather than by a guess: a segment narrower than 30px cannot
						     hold two digits and a gutter, and the container query is the
						     only test that knows the segment's real width. -->
						<span class="cov-num {NUM_INK[seg.key]}" aria-hidden="true">{seg.count}</span>
					{/if}
				</span>
			{/if}
		{/each}
	{/if}
</div>

<style>
	/*
	 * The flex/min-width base is `.prop-bar` in `app.css`, shared with
	 * `ExposureBar`. What this file overrides is the part that is NOT shared:
	 * `ExposureBar` is one continuous bar with hairline joins, this one is a SET
	 * of separate bars — so the container's radius and clipping move down onto
	 * the groups, and the gutter between groups goes 1px → 8px.
	 *
	 * These rules are Svelte-scoped, which is unlayered and therefore outranks
	 * `@layer components`. Nothing here may own colour (see the layering note in
	 * `app.css`); every fill and every ink arrives as a utility class.
	 */
	.cov {
		height: 26px;
		gap: 8px;
		border-radius: 0;
		overflow: visible;
	}

	.cov--compact {
		height: 8px;
		gap: 4px;
	}

	/*
	 * A GROUP IS ONE BUCKET'S BAR. It owns the radius the whole object used to
	 * own — `REVISION-PAGES.md` specifies 8px — and clips its cells, so the two
	 * outer corners round and the inner divisions stay square.
	 *
	 * `container-type: inline-size` is what lets the numeral know whether it
	 * fits. It also makes the group's width independent of its contents, which
	 * is required here: a `max-content`-sized flex item would stop being
	 * proportional the moment a digit was wider than the segment's share.
	 */
	.cov-seg {
		position: relative;
		display: flex;
		gap: 2px;
		height: 100%;
		border-radius: 8px;
		overflow: hidden;
		container-type: inline-size;
	}

	.cov--compact .cov-seg {
		gap: 1px;
		border-radius: 4px;
	}

	.cov-cell {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
	}

	/*
	 * THE COUNT, ON THE BAR. Left-aligned rather than centred: on a 900px
	 * segment a centred digit floats in the middle of nothing, while flush left
	 * it reads as the label OF that segment, the way a stacked bar's data label
	 * does. `tabular-nums` so a column of bars on `/versions` keeps its digits
	 * on one x.
	 */
	.cov-num {
		position: absolute;
		left: 6px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 12px;
		line-height: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		display: none;
	}

	@container (min-width: 30px) {
		.cov-num {
			display: block;
		}
	}
</style>
