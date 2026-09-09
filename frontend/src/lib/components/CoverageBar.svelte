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
	 *
	 * ⛔ AND THE NUMERAL THAT WAS PRINTED ON THE FILL IS GONE. (2026-09-02,
	 * from the human, looking at the live page: *"why is this number on the
	 * bar?"*) It was added in the same commit as the cells, and once the cells
	 * exist it is the THIRD statement of one quantity inside 60px: the lead's
	 * `6 of 6 · PLACES RUNNING IT` at 24px, thirty pixels above; the six
	 * countable tiles it labelled; and the six named chips in `FleetSpread`
	 * below. Worse, at one bucket the group IS the whole bar, so a
	 * left-flush `6` reads as the label of the FIRST TILE rather than of the
	 * group — a numeral annotating a mark that already says it. That is the
	 * repetition defect this branch has cut everywhere else, and the ask it was
	 * serving (*"see on the bar also exactly how many are in either state"*)
	 * is answered by the cells, structurally, with no ink spent on digits.
	 *
	 * WHAT CARRIES THE COUNT NOW, at every scale and in the fallback below:
	 * the count sits DIRECTLY ABOVE THE BAR in every composition this object
	 * ships in (`RevisionLead`'s `N of M`; the list row's `Running in N of M
	 * places`), `BuildStateMark` says the salient bucket in words on the line
	 * between them (`3 places still to go`), and every place is NAMED under it
	 * — `FleetSpread`'s groups on the list, the bucket cards on the detail
	 * page. None of those is conditional, so nothing here needs a digit.
	 *
	 * IT STILL SCALES. Above `CELL_MAX` places the cells would be sub-legible
	 * hairlines, so the group falls back to one solid segment and the bar is
	 * PROPORTIONAL ONLY — which is what this object was before the cells and
	 * what its own scale note defends: *"one revision over 4 regions or 40
	 * reads as the same four buckets."* The exact figures at that size are the
	 * three carriers above, all of which are unaffected by the fallback. Each
	 * group's `min-width` is computed from the cells it holds, so
	 * proportionality is exact everywhere below it.
	 *
	 * WHY IT IS ALLOWED TO LOOK LIKE A PROGRESS BAR. `DESIGN.md` deletes "long
	 * composition bars" on sight, and the stated reason is *"they look like
	 * progress bars but aren't"* — a header bar that composites unrelated
	 * success and failure counts invites a reading of "how far along" that the
	 * data does not support. Here that reading is the DATA: the page's first
	 * criterion is literally "how far has this build reached across the fleet".
	 * This is the one place in the product where the form and the meaning agree.
	 *
	 * COLOUR LIVES IN `revision-coverage.ts`, not here — see the `WEIGHT_FILL`
	 * block (round 11, A.3) for the whole argument, including why `here` is
	 * the product's health green rather than the `newest` chip's mint, and
	 * why `unplaceable` is drawn HOLLOW rather than amber. This file owns no
	 * colour at all now that the numeral is gone; it is geometry.
	 *
	 * ⭐ ROUND 11, A.4 — HEIGHT 26 → 16px, THE OTHER SCALE UNCHANGED. `16 : 8`
	 * is exactly `2 : 1` — the same object at two scales, which is this
	 * component's founding rule. 26px was sized for a hero body (round 7.1)
	 * that no longer exists; every other geometry constant here (radius 8,
	 * cell-min 5px, gutter 2px for the default scale; 8px/4/3/1 compact) was
	 * already exactly what A.4 specifies, so this is the ONE number this
	 * round changes in this file.
	 */
	import {
		weightFill,
		type CoverageSegment,
		type CoverageCell,
		type CoverageWeight
	} from '$lib/view-models/revision-coverage';

	let {
		segments,
		compact = false,
		label,
		cells,
		class: className = ''
	}: {
		segments: CoverageSegment[];
		/** The list-row miniature. Same buckets, same cells, 8px instead of 26px. */
		compact?: boolean;
		/** Accessible name. The bar is a graphic; the words live here and in the cards. */
		label: string;
		/**
		 * ⭐ REVISIONS-PASS-6, ITEM 3 — OPTIONAL PER-CELL IDENTITY. One entry per
		 * PLACE (`coverageCells()`'s own order, env then service), so each
		 * rendered cell can carry its own `title` instead of only the group's.
		 * Omitted entirely, every cell keeps the old behaviour — no per-cell
		 * `title`, nothing else changes — so every existing segment-only call
		 * (every `.bld-row` in `BuildLists`) renders byte-identical to before
		 * this prop existed.
		 */
		cells?: CoverageCell[];
		class?: string;
	} = $props();

	const total = $derived(segments.reduce((n, s) => n + s.count, 0));

	/**
	 * ABOVE THIS MANY PLACES THE CELLS STOP BEING COUNTABLE AND BECOME TEXTURE.
	 * Measured against the two tracks the bar actually gets: 200px in a
	 * `/versions` row, and 326px for the lead panel at 390. At 32 places the
	 * miniature draws 32 × 3px + 31 × 1px = 127px of a 200px track and the full
	 * bar 32 × 5px + 31 × 2px = 222px of 326 — both still proportional. Past it
	 * the group becomes one solid segment and the bar is proportional only; the
	 * exact figures live where they always do — in the count directly above the
	 * bar, in `BuildStateMark`'s phrase, and in the named groups below it.
	 */
	const CELL_MAX = 32;
	const cellular = $derived(total > 0 && total <= CELL_MAX);

	const CELL_MIN = $derived(compact ? 3 : 5);
	const CELL_GAP = $derived(compact ? 1 : 2);

	/**
	 * ⭐ REVISIONS-PASS-6, ITEM 1 — THE DEFAULT SCALE STOPPED FLEX-GROWING TO
	 * FILL ITS ROW. Six cells at 2px gutter inside a 1216px hero read as two
	 * slabs with scratches, not six tiles — `flex-grow` filled whatever width
	 * the card gave it regardless of `total`, so a 3-place bar and a 9-place
	 * bar drew the SAME width and "how far this build reached" stopped being
	 * legible from the shape at all. `CELL_CAP` is the per-cell ceiling
	 * (≈32–40px, this round's own number, 36) that this fix uses ONLY at the
	 * default scale — the compact 8px row bar was already measured cellular
	 * at its typical ~21px/cell and stays on the untouched `flex-grow` path.
	 * `newCellular` gates both the per-cell fixed basis below and the `.cov`
	 * `width: fit-content` that lets the bar's own width shrink to its
	 * content instead of stretching — see the CSS block for the other half.
	 */
	const CELL_CAP = 36;
	const newCellular = $derived(cellular && !compact);

	/**
	 * ⭐ REVISIONS-PASS-6 FOLLOW-UP (round 11, r11c finding 7) — AN EXPLICIT
	 * PIXEL WIDTH, NOT `width: fit-content`. Measured live at 1440: a
	 * 6-place hero bar rendered 40px wide (its OWN `min-width` floor) instead
	 * of the ~226px `flex: 0 1 226px` basis set on its one segment below.
	 * `fit-content`'s intrinsic-size pass has to ask "what is this flex
	 * container's own max-content width", which here means asking a NESTED
	 * flex container (`.cov-seg`, itself `display: flex` over `.cov-cell`
	 * children) for ITS max-content contribution — and measured directly
	 * (forcing `width: max-content` in devtools reproduced the identical 40px),
	 * two levels of flex intrinsic sizing does not propagate a child's
	 * definite `flex-basis` the way a single level does. `fit-content(500px)`
	 * with an explicit argument measured 226px correctly, confirming the
	 * bug is specifically the ARGUMENT-LESS keyword's own intrinsic pass, not
	 * the flex-basis values themselves.
	 *
	 * The fix computes the total exactly, the same arithmetic `groupStyle`
	 * already runs per segment, summed with the same 2/1px inter-group gap
	 * `.cov`'s own `gap` CSS declares — and sets it as a definite `width` on
	 * the root, which sidesteps intrinsic sizing entirely: a definite
	 * container width lets the ordinary (non-intrinsic) flex layout pass
	 * grow/shrink `.cov-seg` against it correctly, which is the pass that
	 * was already working (the `226px` / `fit-content(500px)` forced tests
	 * above both measured right). `max-width: 100%` in the CSS still clamps
	 * it on a narrow card, same as before.
	 */
	const capTotalWidth = $derived.by<number | null>(() => {
		if (!newCellular) return null;
		const visible = segments.filter((s) => s.count > 0);
		if (visible.length === 0) return null;
		const segWidths = visible.map((s) => s.count * CELL_CAP + (s.count - 1) * CELL_GAP);
		const interGroupGap = (visible.length - 1) * CELL_GAP;
		return segWidths.reduce((a, b) => a + b, 0) + interGroupGap;
	});

	/** `[0..n-1]` — `{#each}` wants a real iterable, not an array-like. Named
	 *  apart from the `cells` PROP above; the two are unrelated arrays. */
	function cellRange(n: number): number[] {
		return Array.from({ length: n }, (_, i) => i);
	}

	function groupMin(count: number): number {
		if (!cellular) return compact ? 4 : 6;
		return count * CELL_MIN + (count - 1) * CELL_GAP;
	}

	/** The GROUP's own flex rule. `newCellular` groups no longer grow past
	 *  `CELL_CAP` per cell — see the comment above `CELL_CAP`; every other
	 *  case (compact, or the >32-place fallback at any scale) keeps the
	 *  original `flex-grow` fill unchanged. */
	function groupStyle(count: number): string {
		const min = groupMin(count);
		if (newCellular) {
			const preferred = count * CELL_CAP + (count - 1) * CELL_GAP;
			return `flex:0 1 ${preferred}px;min-width:${min}px`;
		}
		return `flex-grow:${count};min-width:${min}px`;
	}

	/** Per-cell identity for one weight, in the SAME relative order `cells`
	 *  arrived in (a stable filter cannot reorder what it keeps) — see
	 *  `coverageCells()`'s own doc comment for why that is exactly the
	 *  env-then-service order this bar needs within one weight's run. */
	function cellsForWeight(key: CoverageWeight): CoverageCell[] {
		return (cells ?? []).filter((c) => c.key === key);
	}
</script>

<!--
	`role="img"` with a real name, not a chart nobody can read aloud. The visible
	explanation is the bucket cards on the detail page and the groups under the
	bar on the list.
-->
<div
	class="prop-bar cov {compact ? 'cov--compact' : ''} {newCellular ? 'cov--capped' : ''} {className}"
	style={capTotalWidth !== null ? `width:${capTotalWidth}px` : undefined}
	role="img"
	aria-label={label}
	title={label}
>
	{#if total === 0}
		<!-- No slots at all. An empty TRACK, not a missing element: the row still
		     has to occupy the column so the ones beside it stay comparable.

		     ⛔ IT TAKES `weightFill('notReached')`, IT DOES NOT SPELL THE TRACK.
		     (2026-09-02, and round 11's rename.) Written out here it would be a
		     second copy of the track's value — and inherit that value's dark
		     bug silently if it ever drifted from the table again. Reading the
		     table means the fix that gave the track its dark edge lands here
		     too, and cannot be missed a second time. -->
		<span class="cov-seg" style="flex-grow:1">
			<span class="cov-cell {weightFill('notReached')}"></span>
		</span>
	{:else}
		{#each segments as seg (seg.key)}
			{#if seg.count > 0}
				{@const segCells = cellsForWeight(seg.key)}
				<span class="cov-seg" style={groupStyle(seg.count)} title="{seg.count} {seg.title.toLowerCase()}">
					{#if cellular}
						<!-- ONE CELL PER PLACE, keyed by index: the cells are identical by
						     construction unless `cells` names each one — the GROUP is still
						     the unit of MEANING (its own `title` above), the CELL is the unit
						     of counting, and now optionally of IDENTITY too. -->
						{#each cellRange(seg.count) as i (i)}
							<span
								class="cov-cell {weightFill(seg.key)}"
								style={newCellular ? `flex:0 1 ${CELL_CAP}px` : undefined}
								title={segCells[i]?.title}
							></span>
						{/each}
					{:else}
						<span class="cov-cell {weightFill(seg.key)}"></span>
					{/if}
				</span>
			{/if}
		{/each}
	{/if}
</div>

<style>
	/*
	 * The flex/min-width base is `.prop-bar` in `app.css`, shared with
	 * `ExposureBar`. ⛔ IT IS ONE CONTINUOUS BAR NOW, LIKE `ExposureBar`.
	 * (2026-09-03, from the human, third time: "Revisions pages bars are still
	 * split into 2.") The 8px gutter between groups made a 9-place bar read as
	 * two objects — a green bar and a gray bar — instead of one bar with two
	 * buckets. The gutter between groups is the same hairline as the gutter
	 * between cells, the radius and the clip are back on the whole bar, and a
	 * group is just a run of cells in one colour.
	 *
	 * These rules are Svelte-scoped, which is unlayered and therefore outranks
	 * `@layer components`. Nothing here may own colour (see the layering note in
	 * `app.css`); every fill and every ink arrives as a utility class.
	 */
	.cov {
		height: 16px;
		gap: 2px;
		border-radius: 8px;
		overflow: hidden;
	}

	.cov--compact {
		height: 8px;
		gap: 1px;
		border-radius: 4px;
	}

	/*
	 * ⭐ REVISIONS-PASS-6, ITEM 1 — LEFT-ALIGN THE RUN INSTEAD OF STRETCHING IT.
	 * `.prop-bar` (`app.css`) sets `width: 100%` for every user of this shared
	 * base, `ExposureBar` included — correct there, wrong here once cells stop
	 * flex-growing (see `CELL_CAP`'s own comment). `fit-content` makes THIS
	 * bar's own box shrink-to-fit its now-capped children: at 6 places it
	 * settles at the six cells' own preferred width (~226px of a 1216px hero,
	 * left-aligned, not stretched into 193px slabs); at 9 it is visibly wider
	 * than at 6, which is the whole point item 1 asks for. `max-width: 100%`
	 * is the other half — on a narrow card the browser's own shrink-to-fit
	 * algorithm squeezes the (now flex-shrinkable) cells down toward their
	 * `min-width` legibility floor instead of overflowing. Scoped to
	 * `newCellular` bars only (a Svelte class, applied only when this specific
	 * render needs it) — the compact row bar and the rare >32-place fallback
	 * both keep the old full-width fill untouched.
	 */
	/*
	 * ⛔ `width: fit-content` IS GONE (r11c finding 7) — see `capTotalWidth`'s
	 * own doc comment in the script above for why the argument-less keyword
	 * measured 40px instead of ~226px here. The width is now a definite
	 * inline `style`; `max-width: 100%` stays so a narrow card still clamps
	 * and lets the segments flex-shrink toward their own `min-width` floor.
	 */
	.cov--capped {
		max-width: 100%;
	}

	/*
	 * A GROUP IS ONE BUCKET'S BAR. It owns the radius the whole object used to
	 * own — `REVISION-PAGES.md` specifies 8px — and clips its cells, so the two
	 * outer corners round and the inner divisions stay square.
	 *
	 * ⛔ `container-type: inline-size` IS GONE WITH THE NUMERAL. It existed to
	 * let the digit ask whether it fitted; with no digit the group has no
	 * content that could size it, and `flex-grow` plus `min-width` is the whole
	 * geometry. `overflow: hidden` stays — it is what rounds the two outer
	 * corners of a group while its inner divisions stay square.
	 */
	.cov-seg {
		display: flex;
		gap: 2px;
		height: 100%;
	}

	.cov--compact .cov-seg {
		gap: 1px;
	}

	.cov-cell {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
	}
</style>
