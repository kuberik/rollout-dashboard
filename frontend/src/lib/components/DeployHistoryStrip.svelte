<svelte:options runes={true} />

<script lang="ts">
	import { getStatusCircleClass, tickToBakeStatus, type HistoryTick } from '$lib/bake-status';

	let { ticks }: { ticks: HistoryTick[] } = $props();
</script>

<div class="flex items-center gap-0.5">
	{#each ticks as tick, i (i)}
		<span
			class="h-2.5 w-2.5 shrink-0 rounded-sm {getStatusCircleClass(tickToBakeStatus(tick))}"
			title={tick}
		></span>
	{/each}
</div>
