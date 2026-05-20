<svelte:options runes={true} />

<script lang="ts">
	import { LockSolid } from 'flowbite-svelte-icons';

	let {
		version,
		size = 'sm'
	}: {
		version: string;
		size?: 'xs' | 'sm';
	} = $props();

	const iconSize = $derived(size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3');
</script>

<span
	class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/60"
	title={`Pinned to ${version}`}
>
	<LockSolid class="{iconSize} -ml-0.5" />
	<span>pinned</span>
</span>
