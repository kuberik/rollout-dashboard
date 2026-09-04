<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * ⭐ THE PRIMITIVE OTHER LANES IMPORT. Keep the API small.
	 *
	 * Renders the SAME container/border/radius/header geometry as
	 * `Card.svelte` — `rounded-lg` (8px), a 1px neutral border, a 47px
	 * header (16px icon square, a title bar, an optional right-aligned
	 * rollup bar) — so the flip from skeleton to loaded page moves nothing.
	 * See `../../CLAUDE.md`'s "Loading states" section (audit findings 1, 5,
	 * 6, 7, 8, 9, 10, 13 in `.agents-context/LOAD-STATE-AUDIT-2026-09-04.md`
	 * are all "the skeleton and the page are two different compositions" —
	 * this component is the fix: author every loading branch FROM it rather
	 * than from a bare `animate-pulse` div of a guessed height).
	 *
	 * `CARD_HEADER_HEIGHT` is exported so a geometry test — or a caller
	 * doing its own arithmetic (stacking N cards, say) — can read the SAME
	 * number `Card.svelte`'s own `min-h-[47px]` is measured from, rather
	 * than a second hand-typed `47` that could silently drift from it.
	 */
	export const CARD_HEADER_HEIGHT = 47;
</script>

<script lang="ts">
	let {
		/**
		 * Tailwind width class for the title bar. Required in practice —
		 * every real `Card` header has a title (`icon` is "optional in the
		 * type and mandatory in practice" there too; this mirrors it).
		 */
		titleWidth = 'w-24',
		/**
		 * Tailwind width class for the right-aligned rollup bar. `null`
		 * (the default) renders NO rollup slot at all — match this to
		 * whether the real card will end up with a `verdict`/`rollup`, so
		 * the slot does not appear or disappear once data arrives. A card
		 * whose rollup is merely unknown YET still reserves the slot by
		 * passing a width; only a card with no rollup at all passes `null`.
		 */
		rollupWidth = null,
		/**
		 * Body rows, each `rowHeight` px tall, laid out with the same 8px
		 * (`gap-2`) row spacing a real list uses. Ignored when `bodyHeight`
		 * is set.
		 */
		rows = 3,
		rowHeight = 20,
		/**
		 * A single fixed-height body block instead of N rows — for a card
		 * whose real body is one shape (a chart, a graph, a pipeline strip)
		 * rather than a list of rows.
		 */
		bodyHeight = null,
		/**
		 * Matches `Card`'s own `padded` prop — `false` when the real body is
		 * a `<ul>` of rows that own their own padding, so the skeleton's
		 * rows sit flush exactly where the real ones will.
		 */
		padded = true,
		class: className = ''
	}: {
		titleWidth?: string;
		rollupWidth?: string | null;
		rows?: number;
		rowHeight?: number;
		bodyHeight?: number | null;
		padded?: boolean;
		class?: string;
	} = $props();

	const rowIndexes = $derived(Array.from({ length: Math.max(0, rows) }, (_, i) => i));
</script>

<section
	class="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 {className}"
	aria-hidden="true"
	data-skel-card
>
	<header
		class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
		data-skel-header
	>
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="skel-block h-4 w-4 shrink-0"></span>
			<span class="skel-block h-3.5 {titleWidth}"></span>
		</div>
		{#if rollupWidth}
			<span class="skel-block h-3 shrink-0 {rollupWidth}" data-skel-rollup></span>
		{/if}
	</header>
	<div class="grow {padded ? 'p-4' : ''}">
		{#if bodyHeight != null}
			<span
				class="skel-block block"
				style="height: {bodyHeight}px"
				data-skel-body
			></span>
		{:else}
			<div class="flex flex-col gap-2">
				{#each rowIndexes as i (i)}
					<span
						class="skel-block block"
						style="height: {rowHeight}px"
						data-skel-row
					></span>
				{/each}
			</div>
		{/if}
	</div>
</section>
