<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE REPO GRID (r39 kit `repoGrid()`, language §1 "even grid"): a fixed column count per width of the grid's OWN box (a container query:
	 * 1 / 2 from 520 / 3 from 920 / 4 from 1480), equal widths, a short last row left short, never stretched. Children are `RepoCard`s.
	 * `team` tightens the gap (the quieter Team grid). Reference: Home's attention band (`AttentionBand`) uses the same query idea.
	 */
	import type { Snippet } from 'svelte';
	let { team = false, class: className = '', children }: { team?: boolean; class?: string; children: Snippet } = $props();
</script>

<div class="rg-wrap {className}"><div class="rg" class:rg--team={team} data-repo-grid>{@render children()}</div></div>

<style>
	.rg-wrap { container-type: inline-size; min-width: 0; }
	.rg { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); align-items: start; }
	.rg--team { gap: 8px; }
	@container (min-width: 520px) { .rg { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@container (min-width: 920px) { .rg { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@container (min-width: 1480px) { .rg { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
