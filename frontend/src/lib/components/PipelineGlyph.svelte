<svelte:options runes={true} />

<script lang="ts">
	import type { PipelineSummary, StageState } from '$lib/pipeline';

	let { summary }: { summary: PipelineSummary } = $props();

	function dotClass(s: StageState): string {
		switch (s) {
			case 'done': return 'bg-green-700 dark:bg-green-400';
			case 'active': return 'bg-yellow-400 animate-pulse';
			case 'fail': return 'bg-red-500';
			case 'cancelled': return 'bg-gray-400 dark:bg-gray-500';
			default: return 'bg-gray-300 dark:bg-gray-600';
		}
	}

	const isMultiTrack = $derived(summary.tracks.length > 1);
</script>

<!-- Layout:
     - Single-track pipeline: row of step dots + connector + bake cell.
       For no-KR rollouts the track has one "deploy" cell, so the glyph
       renders as deploy + bake — mirrors the detail page's Started + Bake.
     - Multi-track real pipeline: stacked tracks + Y-converged bake cell. -->
<span class="inline-flex items-center" aria-label="Pipeline">
	{#if isMultiTrack}
		<!-- Tracks right-align so the Y-connector lands on each track's
		     last step regardless of how many steps each track has. -->
		<span class="inline-flex flex-col items-end gap-0.5">
			{#each summary.tracks as track (track.name)}
				<span class="inline-flex items-center" title={track.name}>
					{#each track.stages as s, i}
						{#if i > 0}
							<span class="h-px w-1.5 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
						{/if}
						<span class="block h-1.5 w-1.5 rounded-full {dotClass(s)}"></span>
					{/each}
				</span>
			{/each}
		</span>
		<!-- Y-connector: two short lines from each track's right edge
		     converge to the single bake dot vertically centered between
		     the tracks. SVG height matches the stacked-tracks total
		     height (2 rows of h-1.5 + gap-0.5 = ~14px). -->
		{@const trackCount = summary.tracks.length}
		{@const blockH = trackCount * 6 + (trackCount - 1) * 2}
		<svg width="10" height={blockH} viewBox="0 0 10 {blockH}" class="shrink-0 text-gray-300 dark:text-gray-600" aria-hidden="true">
			{#each summary.tracks as _, ti}
				{@const trackCenter = ti * 8 + 3}
				{@const bakeCenter = blockH / 2}
				<path
					d="M 0 {trackCenter} Q 5 {trackCenter}, 5 {bakeCenter} T 10 {bakeCenter}"
					fill="none"
					stroke="currentColor"
					stroke-width="1"
				/>
			{/each}
		</svg>
		<span class="block h-1.5 w-1.5 rounded-full {dotClass(summary.bake)}" title="Bake"></span>
	{:else}
		<span class="inline-flex items-center">
			{#each summary.tracks[0]?.stages ?? [] as s, i}
				{#if i > 0}
					<span class="h-px w-2 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
				{/if}
				<span class="block h-2 w-2 rounded-full {dotClass(s)}"></span>
			{/each}
			<span class="h-px w-2 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
			<span class="block h-2 w-2 rounded-full {dotClass(summary.bake)}" title="Bake"></span>
		</span>
	{/if}
</span>
