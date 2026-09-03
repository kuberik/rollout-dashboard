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
	class="chip t-chip shrink-0 gap-1 border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"
	title={`Pinned to ${version}`}
>
	<LockSolid class="{iconSize} -ml-0.5" />
	<span>pinned</span>
</span>
