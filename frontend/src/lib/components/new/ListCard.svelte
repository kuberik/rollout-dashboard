<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE LIST CARD (r39 kit `listCard()` / `.lc`), extracted from Rollouts so /rollouts and /envs/<name> draw ONE flat bordered card of rows.
	 * ROLE: a section's rows (StrandRow, active 48px or quiet 40px) inside one 8px-radius card on the page surface, under a SectionHeader. Groups
	 * inside it (`.lc-g` with a `.lc-gh` head: word · count · right-hand rollup) are separated by a hairline; the card is the container the rows
	 * size against (2 columns of rows from 1700px of card, 3 from 3200). Reference: Rollouts' "All rollouts" card, where it was signed.
	 */
	import type { Snippet } from 'svelte';
	let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="lc {className}">{@render children()}</div>

<style>
	.lc { border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); min-width: 0; overflow: hidden; container-type: inline-size; }
	.lc :global(.lc-gh) { display: flex; align-items: baseline; gap: 8px; padding: 16px 16px 8px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--k-fg-muted); }
	.lc :global(.lc-gt) { white-space: nowrap; }
	.lc :global(.lc-gn) { font-weight: 400; color: var(--k-fg-subtle); font-variant-numeric: tabular-nums; }
	.lc :global(.lc-gr) { margin-left: auto; font-weight: 500; color: var(--k-fg-subtle); }
	.lc :global(.lc-g + .lc-g) { border-top: 1px solid var(--k-line-subtle); margin-top: 8px; }
	.lc :global(.lc-rows) { display: grid; grid-template-columns: minmax(0, 1fr); list-style: none; margin: 0; padding: 0; }
	@container (min-width: 1700px) {
		.lc :global(.lc-rows) { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; }
		.lc :global(.lc-rows > .lr:nth-child(2) .lr-in) { border-top: 0; }
	}
	@container (min-width: 3200px) {
		.lc :global(.lc-rows) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.lc :global(.lc-rows > .lr:nth-child(3) .lr-in) { border-top: 0; }
	}
	@container (max-width: 600px) { .lc :global(.lc-gh) { padding: 12px 12px 4px; } }
</style>
