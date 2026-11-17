<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE MARK OF A CHECK'S STATE: a red exclamation for failing, the yellow spinner for pending, the green clock-arrow for recovered, the
	 * green check for passing. The Health checks card's row leads with it, and the failure banner's Details lead each check with the same
	 * mark, so "2 failing, 1 pending" matches rows on either. Ink = state only.
	 */
	import { CheckCircleSolid, ExclamationCircleSolid, ClockArrowOutline } from 'flowbite-svelte-icons';
	import StatusSpinner from './StatusSpinner.svelte';
	import type { CheckVerdict } from '$lib/view-models/health-failures';

	let { verdict, class: className = '' }: { verdict: CheckVerdict; class?: string } = $props();
</script>

{#if verdict === 'failing'}
	<ExclamationCircleSolid class="text-danger h-4 w-4 flex-shrink-0 {className}" data-check-mark="failing" />
{:else if verdict === 'pending'}
	<StatusSpinner size="4" color="yellow" class={className} />
{:else if verdict === 'recovered'}
	<ClockArrowOutline class="text-success h-4 w-4 flex-shrink-0 {className}" data-check-mark="recovered" />
{:else}
	<CheckCircleSolid class="text-success h-4 w-4 flex-shrink-0 {className}" data-check-mark="passing" />
{/if}
