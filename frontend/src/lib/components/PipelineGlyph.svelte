<svelte:options runes={true} />

<script lang="ts">
	import type { PipelineSummary, StageState } from '$lib/pipeline';

	let { summary }: { summary: PipelineSummary } = $props();

	function dotClass(s: StageState): string {
		switch (s) {
			case 'done': return 'bg-green-500';
			case 'active': return 'bg-yellow-400';
			case 'fail': return 'bg-red-500';
			case 'cancelled': return 'bg-gray-400 dark:bg-gray-500';
			default: return 'bg-gray-300 dark:bg-gray-600';
		}
	}

	// Active-bake cells animate so the eye catches an in-flight bake. Flowbite's
	// `Spinner` pulse animation is too heavy for a 2-dot strip; a Tailwind
	// `animate-pulse` on the bake dot does the job lightly.
	function pulseClass(s: StageState): string {
		return s === 'active' ? 'animate-pulse' : '';
	}

	const isMultiTrack = $derived(summary.tracks.length > 1);
</script>

<!-- Layout: each KruiseRollout is its own short row of step dots; a single
     trailing bake cell sits to the right, vertically centered across the
     tracks. Multi-track rollouts (e.g. hello-multi-app) stack instead of
     concatenating onto one confusing line. -->
<span class="inline-flex items-center gap-1.5" aria-label="Pipeline">
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

	<!-- Bake cell — separated by a wider gap so it visually reads as the
	     final, kuberik-level stage rather than another KruiseRollout step. -->
	<span class="h-px w-2 bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
	<span
		class="block h-2 w-2 rounded-full {dotClass(summary.bake)} {pulseClass(summary.bake)}"
		title="Bake"
	></span>
</span>
