<svelte:options runes={true} />

<script lang="ts">
	import BuildRow from './BuildRow.svelte';

	let { noMark = false }: { noMark?: boolean } = $props();
</script>

<ul>
	{#if noMark}
		<BuildRow>
			{#snippet identity()}
				<span>IDENTITY</span>
			{/snippet}
			{#snippet roll()}
				<span>ROLL</span>
			{/snippet}
		</BuildRow>
	{:else}
		<BuildRow>
			{#snippet mark()}
				<span>MARK</span>
			{/snippet}
			{#snippet identity()}
				<span>IDENTITY</span>
			{/snippet}
			{#snippet roll()}
				<span>ROLL</span>
			{/snippet}
		</BuildRow>
	{/if}
</ul>
