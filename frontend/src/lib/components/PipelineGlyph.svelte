<svelte:options runes={true} />

<script lang="ts">
	import type { PipelineSummary, StageState } from '$lib/pipeline';

	let { summary }: { summary: PipelineSummary } = $props();

	function dotClass(s: StageState): string {
		switch (s) {
			case 'done': return 'bg-green-500';
			case 'active': return 'bg-yellow-400 animate-pulse';
			case 'fail': return 'bg-red-500';
			case 'cancelled': return 'bg-gray-400 dark:bg-gray-500';
			default: return 'bg-gray-300 dark:bg-gray-600';
		}
	}

	const isMultiTrack = $derived(summary.tracks.length > 1);
</script>

<!-- Layout: each KruiseRollout is its own row of step dots. Multi-track
     rollouts stack so steps don't read across tracks. No detached bake
     cell — the row's main status circle (BakeStatusIcon) already conveys
     the kuberik-level bake state. -->
<span class="inline-flex items-center" aria-label="Pipeline">
	{#if isMultiTrack}
		<span class="inline-flex flex-col gap-0.5">
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
	{:else}
		<span class="inline-flex items-center">
			{#each summary.tracks[0]?.stages ?? [] as s, i}
				{#if i > 0}
					<span class="h-px w-2 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
				{/if}
				<span class="block h-2 w-2 rounded-full {dotClass(s)}"></span>
			{/each}
		</span>
	{/if}
</span>
