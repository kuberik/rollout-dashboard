<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A Rollout without `spec.releaseSourceRef` has no releases to show. The
	 * controller says so in a condition (reason `ReleaseSourceRequired`) whose
	 * message tells the user to create a ReleaseSource; this prints it where the
	 * builds would be, as the product's one alert panel, so the page is never
	 * silently empty. Renders nothing for a Rollout that has a source.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import { releaseSourceRequiredMessage } from '$lib/releases/catalogue';
	import type { Rollout } from '$lib/../types';

	let { rollout, text, class: className = '' }: { rollout?: Rollout | null; /** the message itself, when the caller already has it */ text?: string | null; class?: string } = $props();
	const message = $derived(text ?? releaseSourceRequiredMessage(rollout));
</script>

{#if message}
	<AlertPanel severity="warning" title="No release source" {message} class={className} />
{/if}
