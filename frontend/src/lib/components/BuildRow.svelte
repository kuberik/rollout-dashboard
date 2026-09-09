<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `.bld-row` — THE ONE ROW GRAMMAR, extracted from `/revisions` (round
	 * 11, lane 2 — `.agents-context/design/REVISIONS-2026-09-05.md`, "A.6.1").
	 * Used by all three build lists on the repository page (lane 3):
	 * "Also still running", "No longer running anywhere" and "Never
	 * deployed". A shared shell — glyph, identity, rollup, chevron — so the
	 * same four tracks line up down the whole page regardless of which list
	 * a row is in.
	 *
	 * THIS COMPONENT KNOWS NOTHING ABOUT `RevisionRow`. Every cell is a
	 * snippet the caller supplies, because the three lists disagree about
	 * what belongs in each one (a live row's mark is a `BuildStateMark`, a
	 * pending row's is a bare hourglass; a live row's identity carries env
	 * chips a pending row's does not) — the shared part is the GRID, not the
	 * content.
	 */
	import type { Snippet } from 'svelte';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';

	let {
		mark,
		identity,
		roll
	}: {
		/** The 16px glyph cell — a `BuildStateMark`, an `HourglassOutline`, or nothing. */
		mark?: Snippet;
		/** The sha link, names/labels and (on the live list) env chips. Owns its own `.tap-link`. */
		identity: Snippet;
		/** The right-hand rollup — count/bar/age, or names + age for the never-deployed rail. */
		roll: Snippet;
	} = $props();
</script>

<li class="bld-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
	<span class="bld-mark">
		{#if mark}{@render mark()}{/if}
	</span>
	{@render identity()}
	<div class="bld-roll">
		{@render roll()}
	</div>
	<span class="bld-go" aria-hidden="true">
		<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
	</span>
</li>

<style>
	/*
	 * ⭐ `.bld-row` — ONE ROW GRAMMAR for all three build lists, ported
	 * verbatim from `/revisions`' own style block so the geometry cannot
	 * drift between the extraction and its call sites.
	 */
	:global(.bld-row) {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 200px 16px;
		align-items: center;
		column-gap: 12px;
		padding: 10px 16px;
	}

	:global(.bld-mark) {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.bld-roll) {
		text-align: right;
	}

	:global(.bld-go) {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/*
	 * ⭐ REVISIONS-PASS-6, ITEM 6 — THE WHOLE ROW IS THE TAP TARGET AT EVERY
	 * WIDTH, NOT ONLY WITH A MOUSE AT >=640px. `app.css`'s coarse-pointer /
	 * narrow-width rule gives `.rev-sha` (the identity snippet's OWN
	 * `.tap-link`, shipped by every caller in `BuildLists.svelte`) its own
	 * `position: relative`, so it can host a small, self-centred touch-floor
	 * `::before` — the right call for a `.rev-sha` whose destination is NOT
	 * the row's own (that rule's own comment names the versions-picker's
	 * compare-a-different-build case). Here the sha link's destination IS
	 * this row's destination, and `.tap-zone .tap-link::after` — the overlay
	 * that is supposed to grow to cover the WHOLE `<li>` — is `position:
	 * absolute; inset: 0`, which resolves against the NEAREST positioned
	 * ancestor. Once the coarse/narrow rule makes the link itself positioned,
	 * that nearest ancestor becomes the 55×15px link, not the row, and the
	 * "whole row" overlay collapses down to the link's own box — measured
	 * live at 390 with touch emulation: only the sha registered a tap: the
	 * row centre, the roll column and the chevron did nothing. At >=640px
	 * with a mouse the coarse/narrow rule never fires, `.rev-sha` stays
	 * `static`, and the overlay correctly resolves against `.bld-row`
	 * (`.tap-zone`'s own `position: relative`) — "at 1440 the whole row is
	 * the link" was the working case the whole time.
	 *
	 * The fix reverts `position` to `static` for THIS component's own sha
	 * link, at every width, so the overlay always anchors to the row. Nothing
	 * is lost: the row's own `min-height: 44px` below already clears touch
	 * targets more generously than the individual-control floor this gives
	 * up, and the row's own tap-link is still the ONE real anchor — no
	 * second tab stop is added.
	 */
	:global(.bld-row .tap-link.rev-sha) {
		position: static;
	}

	@container (max-width: 560px) {
		:global(.bld-row) {
			grid-template-columns: 16px minmax(0, 1fr) 16px;
			min-height: 44px;
		}
		:global(.bld-roll) {
			grid-column: 1 / -1;
			text-align: left;
			padding-left: 28px;
		}

		/*
		 * ⭐ REVISIONS-PASS-6, ITEM 6 — THE CHEVRON IS NOT DRAWN BELOW 560px.
		 * `.bld-roll`'s `grid-column: 1 / -1` (above) puts it alone on its
		 * own implicit grid row; `.bld-go` — the 4th child in DOM order, with
		 * no explicit column of its own — then auto-places into the FIRST
		 * available cell of the NEXT implicit row, column 1: a stray chevron
		 * left-aligned under the age line, exactly the defect measured live
		 * (12+ instances, e.g. under "Last deployed 9d ago"). The row is
		 * already the tap target end to end (see the rule above); the
		 * chevron was never load-bearing, so the simplest correct fix is to
		 * stop drawing it here rather than fight the grid for a "right-
		 * aligned, vertically centred" position that has nowhere correct to
		 * sit once `.bld-roll` owns the full-width second band.
		 */
		:global(.bld-go) {
			display: none;
		}
	}
</style>
