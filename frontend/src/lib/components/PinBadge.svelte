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

	const iconSize = $derived(size === 'xs' ? 'h-3 w-3' : 'h-3 w-3');
</script>

<span
	class="chip t-label shrink-0 gap-1 border-line text-fg-muted"
	title={`Pinned to ${version}`}
>
	<LockSolid class="{iconSize} -ml-0.5" />
	<span>pinned</span>
</span>
