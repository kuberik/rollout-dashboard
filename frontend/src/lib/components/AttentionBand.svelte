<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ATTENTION BAND (r39 kit `attentionBand()`): an EVEN grid of AttentionCards, equal widths, a short last row left short.
	 * Columns are the page's CARD TRACKS (`.tracks` in styles/language.css, visual audit #13): the band steps by its own width
	 * exactly as the card grid under it does, so their right edges line up and a band with fewer cards than columns keeps the
	 * tile width, left-aligned, instead of stretching (no 744px cards at 2560). `tracks` 'tiles' (default: the Environment
	 * page's Held / Ready grid; Home and Rollouts use the same step) | 'repo' (the Changes page's RepoGrid). No card spans a
	 * row (owner 2026-11-08). Renders nothing for no cards: the band is never an empty hero. Children are the cards.
	 */
	import type { Snippet } from 'svelte';
	let { count, tracks = 'tiles', class: className = '', children }: { count: number; tracks?: 'tiles' | 'repo'; class?: string; children: Snippet } = $props();
</script>

{#if count > 0}
	<div class="att-wrap {className}"><div class="att tracks" class:tracks--repo={tracks === 'repo'} data-attention-band data-count={count}>{@render children()}</div></div>
{/if}

<style>
	.att-wrap { container-type: inline-size; min-width: 0; }
	.att { align-items: start; }
</style>
