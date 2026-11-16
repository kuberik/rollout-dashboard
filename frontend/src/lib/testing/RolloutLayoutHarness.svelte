<svelte:options runes={true} />

<script lang="ts">
	/** TEST-ONLY HARNESS: the rollout route layout with an empty page body (a snippet can only be authored in a .svelte file). */
	import { provideShellChrome } from '$lib/shell-chrome.svelte';
	import Layout from '../../routes/rollouts/[cluster]/[namespace]/[name]/+layout.svelte';
	provideShellChrome();
</script>

<Layout>
	{#snippet children()}{/snippet}
</Layout>
