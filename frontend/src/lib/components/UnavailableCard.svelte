<svelte:options runes={true} />

<script lang="ts">
	import type { Component } from 'svelte';
	import Card from './Card.svelte';

	/**
	 * ⭐ THE PRODUCT'S ONE "COULD NOT BE LOADED" CARD for a region whose data failed to load.
	 *
	 * Role: a Card whose verdict reads `unavailable`, one muted sentence that says what the dashboard can no longer tell
	 * ("... couldn't be loaded, so the dashboard can't tell ..."), and a small "Try again". UNKNOWN is not NONE: a failed
	 * read never prints the empty state's "nothing here".
	 *
	 * Users: `HealthChecksCard` (health checks failed to load) and the rollout Gates tab (the fleet list failed to load).
	 * Do not draw a second copy inline.
	 *
	 * No existing component fits: `ErrorState` is a whole-page failure and prints its own rollout header on a rollout page.
	 * Proportions come from the health card it was extracted from (47px header, one px-4 py-3 row).
	 */
	let {
		icon,
		title,
		sentence,
		onRetry = null,
		isRetrying = false,
		class: className = ''
	}: {
		icon: Component<any>;
		title: string;
		sentence: string;
		onRetry?: (() => void) | null;
		isRetrying?: boolean;
		class?: string;
	} = $props();
</script>

<Card {icon} {title} verdict="unavailable" padded={false} class={className}>
	<div class="flex items-center justify-between gap-3 px-4 py-3">
		<p class="t-meta min-w-0 text-fg-subtle">{sentence}</p>
		{#if onRetry}
			<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => onRetry?.()} disabled={isRetrying}>
				{isRetrying ? 'Checking…' : 'Try again'}
			</button>
		{/if}
	</div>
</Card>
