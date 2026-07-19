<svelte:options runes={true} />

<script lang="ts">
	import { getStatusCircleClass } from '$lib/bake-status';

	type Tick = 'ok' | 'fail' | 'active' | 'none';

	let { ticks }: { ticks: Tick[] } = $props();

	// Reuse the bake-status color helper by mapping each tick outcome to
	// the bakeStatus value that produces the color we want, so history
	// ticks always match the rest of the app's status coloring rather
	// than inventing a parallel palette.
	const tickBakeStatus: Record<Tick, string | undefined> = {
		ok: 'Succeeded',
		fail: 'Failed',
		active: 'Deploying',
		none: undefined
	};
</script>

<div class="flex items-center gap-0.5">
	{#each ticks as tick, i (i)}
		<span
			class="h-2.5 w-2.5 shrink-0 rounded-sm {getStatusCircleClass(tickBakeStatus[tick])}"
			title={tick}
		></span>
	{/each}
</div>
