<svelte:options runes={true} />

<script lang="ts">
	let {
		versions
	}: {
		versions: Array<{ version: string; color: string; isNew?: boolean }>;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-3">
	{#each versions as v, i (i)}
		<span class="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
			<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{v.color}"></span>
			<span>{v.version}</span>
			{#if v.isNew}
				<span
					class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
				>
					new
				</span>
			{/if}
		</span>
	{/each}
</div>
