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
	/** `spec.releasesImagePolicy` is no longer read; when a Rollout still sets it, say so and where it goes now. */
	const legacyPolicy = $derived.by(() => {
		const raw = (rollout?.spec as { releasesImagePolicy?: string | { name?: string } } | undefined)?.releasesImagePolicy;
		const name = typeof raw === 'string' ? raw.split('/').pop() : raw?.name;
		return name || null;
	});
</script>

{#snippet code(text: string)}
	{#each text.split(/(spec\.[A-Za-z]+(?:\.[A-Za-z]+)*|oci\.imagePolicyRef)/) as part, i (i)}
		{#if i % 2 === 1}<code class="t-code">{part}</code>{:else}{part}{/if}
	{/each}
{/snippet}

{#snippet body()}
	{@render code(message ?? '')}{#if legacyPolicy}&#32;<code class="t-code">spec.releasesImagePolicy</code> is set but is ignored: set <code class="t-code">oci.imagePolicyRef</code> on the ReleaseSource to read from that ImagePolicy ({legacyPolicy}).{/if}
{/snippet}

{#if message}
	<AlertPanel severity="warning" title="No release source" messageBody={body} class={className} />
{/if}
