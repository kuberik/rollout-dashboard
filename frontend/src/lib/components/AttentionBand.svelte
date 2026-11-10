<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ATTENTION BAND (r39 kit `attentionBand()`): an EVEN grid of AttentionCards, equal widths, a short last row left short.
	 * Columns by the band's own width (the band is the page's main column; a container query on the wrapper): `cols` 2 (default) | 3 | 4; the 4-up drops to 2 below
	 * 1100px of main (a 4-up card needs ~270px), the 3-up below 1001px, everything is one column below 640px. `lead` true, or
	 * 'auto' with an odd count in a 2-col band, makes the first card span the row (Home's three asks). Renders nothing for no
	 * cards: the band is never an empty hero. Children are the cards (pass `lead` to the first one yourself).
	 */
	import type { Snippet } from 'svelte';
	import { bandSpec } from '$lib/view-models/attention';
	let { count, cols = 2, lead = 'auto', class: className = '', children }: { count: number; cols?: 2 | 3 | 4; lead?: boolean | 'auto'; class?: string; children: Snippet } = $props();
	const span = $derived(false); // owner 2026-11-08: no card spans a row; a short row stays short
	void bandSpec;
</script>

{#if count > 0}
	<div class="att-wrap {className}"><div class="att att-c{cols}" class:att-lead={span} data-attention-band data-count={count}>{@render children()}</div></div>
{/if}

<style>
	.att-wrap { container-type: inline-size; min-width: 0; }
	.att { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; min-width: 0; }
	.att-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.att-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	/* wide: three even columns whatever the count (a lone pair stays two thirds wide, never two 800px cards) */
	@container (min-width: 1300px) { .att, .att-c2 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	.att-lead > :global(:first-child) { grid-column: 1 / -1; }
	/* a page wraps each card in a `display: contents` truth-attribute element: the card is then the grid item */
	.att-lead > :global(.contents:first-child > :first-child) { grid-column: 1 / -1; }
	@container (max-width: 1001px) { .att-c3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@container (max-width: 1100px) { .att-c4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 639px) { .att, .att-c3, .att-c4 { grid-template-columns: minmax(0, 1fr); } }
</style>
