<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE REPO ENVIRONMENT CELLS (r39): a repo's apps' tiers (plus a leading "merged" cell), the changes as beads inside the cell they
	 * reached. A repo's cells hold CHANGES, not rollouts, so this is not PromotionLane, but it draws nothing itself: it maps `RepoCell`s to
	 * `EnvRow` cells, the one environment row every page uses. Size L (a repo card) or M (the Changes Attention card's own row).
	 */
	import EnvRow, { type EnvCell } from '$lib/components/EnvRow.svelte';
	import type { RepoCell } from '$lib/view-models/repo-card';

	let { cells, size = 'L', class: className = '' }: { cells: RepoCell[]; size?: 'L' | 'M'; class?: string } = $props();
	const envCells = $derived<EnvCell[]>(cells.map((c) => ({ key: c.tier, label: c.label, beads: c.beads })));
</script>

<EnvRow cells={envCells} {size} class={className} />
