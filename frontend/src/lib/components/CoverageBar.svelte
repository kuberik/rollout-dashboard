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
	 * WHY IT IS ALLOWED TO LOOK LIKE A PROGRESS BAR. `DESIGN.md` deletes "long
	 * composition bars" on sight, and the stated reason is *"they look like
	 * progress bars but aren't"* — a header bar that composites unrelated
	 * success and failure counts invites a reading of "how far along" that the
	 * data does not support. Here that reading is the DATA: the page's first
	 * criterion is literally "how far has this build reached across the fleet".
	 * This is the one place in the product where the form and the meaning agree.
	 *
	 * COLOUR LIVES IN `revision-coverage.ts`, not here — see the `COVERAGE_FILL`
	 * block for the whole argument. In one line: CHROMATIC means the segment is
	 * about THIS build (`live` mint, `failing` red), ACHROMATIC means it is not
	 * (`ahead`, `unplaceable`), and `notYet` keeps amber because it is the one
	 * crossing where absence still wants a person. No rank ramp and no per-sha
	 * colour: the segments are BUCKETS, and both of those encodings are recorded
	 * in `DESIGN.md` as measured-failed and removed.
	 *
	 * THIS BAR IS A FIELD, NOT A MARK, and `DESIGN.md`'s "THE FIELD CEILING"
	 * is the rule that governs it: inside the object, every adverse segment must
	 * out-CHROMA every non-adverse one, and the page's alarm must stay the
	 * highest-chroma mark on the page. Total ink is not the test here, and the
	 * gray `live` that test produced is the defect that rule exists to prevent.
	 */
	import { coverageFill, type CoverageSegment } from '$lib/view-models/revision-coverage';

	let {
		segments,
		compact = false,
		label,
		class: className = ''
	}: {
		segments: CoverageSegment[];
		/** The list-row miniature. Same buckets, same colours, 8px instead of 26px. */
		compact?: boolean;
		/** Accessible name. The bar is a graphic; the words live here and in the cards. */
		label: string;
		class?: string;
	} = $props();

	const total = $derived(segments.reduce((n, s) => n + s.count, 0));
</script>

<!--
	`role="img"` with a real name, not a chart nobody can read aloud. The visible
	legend is the bucket cards on the detail page and the key under the list.
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
		<span class="cov-seg bg-gray-100 dark:bg-gray-800" style="flex-grow:1"></span>
	{:else}
		{#each segments as seg (seg.key)}
			{#if seg.count > 0}
				<span
					class="cov-seg {coverageFill(seg.key, seg.reachable)}"
					style="flex-grow:{seg.count}"
					title="{seg.count} {seg.title.toLowerCase()}"
				></span>
			{/if}
		{/each}
	{/if}
</div>

<style>
	/*
	 * HEIGHT ONLY. The flex/gap/radius/min-width geometry is `.prop-bar` in
	 * `app.css`, shared with `ExposureBar` — see the block there for why the
	 * two objects had to stop owning two versions of one shape.
	 *
	 * These rules are Svelte-scoped, which outranks a Tailwind utility, so
	 * nothing here may own colour or visibility (see the layering note in
	 * `app.css`). Only the two heights and the compact floor live here.
	 */
	.cov {
		height: 26px;
	}

	.cov--compact {
		height: 8px;
	}

	/*
	 * The compact floor is 4px, not 6px. A 160px list column at 4px still
	 * refuses to draw a 0.9px artefact, and 6px on a 160px track spends 4% of
	 * the row's whole comparison on a bucket holding one place. This is the
	 * one number the miniature does not inherit.
	 */
	.cov--compact > :global(*) {
		min-width: 4px;
	}
</style>
