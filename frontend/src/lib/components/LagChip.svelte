<svelte:options runes={true} />

<script lang="ts">
	import { Badge } from 'flowbite-svelte';

	let { behindBy }: { behindBy: number } = $props();
</script>

{#if behindBy > 0}
	<Badge color="yellow">{behindBy} behind</Badge>
{/if}
