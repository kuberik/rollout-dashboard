<svelte:options runes={true} />

<script lang="ts">
	/** TEST-ONLY HARNESS: the root layout with an empty page body (a snippet can only be authored in a .svelte file). */
	import Layout from '../../routes/+layout.svelte';
</script>

<Layout>
	{#snippet children()}{/snippet}
</Layout>
