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

	@container (max-width: 560px) {
		:global(.bld-row) {
			grid-template-columns: 16px minmax(0, 1fr) 16px;
		}
		:global(.bld-roll) {
			grid-column: 1 / -1;
			text-align: left;
			padding-left: 28px;
		}
	}
</style>
