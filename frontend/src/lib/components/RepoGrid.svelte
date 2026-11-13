<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE REPO GRID (r39 kit `repoGrid()`, language §1 "even grid"): a fixed column count per width of the grid's OWN box (a container query:
	 * 1 / 2 from 520 / 3 from 920 / 4 from 1480), equal widths, a short last row left short, never stretched. Children are `RepoCard`s.
	 * `team` tightens the gap (the quieter Team grid). The step is `.tracks--repo` (styles/language.css), shared with the Changes Attention band.
	 */
	import type { Snippet } from 'svelte';
	let { team = false, class: className = '', children }: { team?: boolean; class?: string; children: Snippet } = $props();
</script>

<div class="rg-wrap {className}"><div class="rg tracks tracks--repo" class:rg--team={team} data-repo-grid>{@render children()}</div></div>

<style>
	/* the columns are the shared CARD TRACKS (`.tracks.tracks--repo`, styles/language.css): the Changes Attention band uses the same step */
	.rg-wrap { container-type: inline-size; min-width: 0; }
	.rg { align-items: start; }
	.rg--team { gap: 8px; }
</style>
