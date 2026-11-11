<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A Rollout without `spec.releaseSourceRef` has no releases to show. The
	 * controller says so in a condition (reason `ReleaseSourceRequired`) whose
	 * message tells the user to create a ReleaseSource. This prints one short lead
	 * line (chosen by that reason, see `noticeLead`) where the builds would be, as
	 * the product's one alert panel, with the controller's message verbatim in the
	 * footnote disclosure, so the page is never silently empty. Renders nothing for a Rollout that has a source.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import { releaseSourceRequiredMessage } from '$lib/releases/catalogue';
	import { noticeLead } from '$lib/releases/notice-copy';
	import type { Rollout } from '$lib/../types';

	let {
		rollout,
		text,
		app = false,
		class: className = ''
	}: {
		rollout?: Rollout | null;
		/** the message itself, when the caller already has it */ text?: string | null;
		/** on an app page the notice speaks about the app's rollout, not "This Rollout" */ app?: boolean;
		class?: string;
	} = $props();
	const gap = ' ';
	/** the controller's own message: printed in the footnote as it was written, never rewritten */
	const controllerMessage = $derived(text ?? releaseSourceRequiredMessage(rollout));
	const lead = $derived(noticeLead('ReleaseSourceRequired', app));
	/** `spec.releasesImagePolicy` is no longer read; when a Rollout still sets it, say so and where it goes now. */
	const legacyPolicy = $derived.by(() => {
		const raw = (rollout?.spec as { releasesImagePolicy?: string | { name?: string } } | undefined)
			?.releasesImagePolicy;
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
	{lead}
{/snippet}

{#snippet more()}
	{@render code(controllerMessage ?? '')}{#if legacyPolicy}{gap}{@render code(
			noticeLead('ReleasesImagePolicyIgnored', app)
		)} Set <code class="t-code">oci.imagePolicyRef</code> on the ReleaseSource to read from that
		ImagePolicy ({legacyPolicy}).{/if}
{/snippet}

{#if controllerMessage}
	<AlertPanel
		severity="warning"
		title="No release source"
		messageBody={body}
		footnoteBody={more}
		footnoteLabel="What to set instead"
		class={className}
	/>
{/if}
