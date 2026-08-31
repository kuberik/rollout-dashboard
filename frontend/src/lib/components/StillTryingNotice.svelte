<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ A SKELETON SAYS "SOON". IT DOES NOT SAY "STILL".
	 *
	 * The failure story has three acts and the product only ever had two. A
	 * request that has already failed once and is inside the retry budget looks
	 * IDENTICAL to a request that has been in flight for 200ms — same grey
	 * blocks, same silence — so for the ~3s the retry policy spends the reader
	 * is being told "loading" while the truth is "the server said no, we are
	 * trying again". Same for a request that is simply slow: nothing on screen
	 * distinguishes "still going" from "stuck".
	 *
	 * This is NOT a third error idiom — it is one muted line above the
	 * skeleton, deliberately below the visual weight of `AlertPanel`, because
	 * nothing has failed terminally yet and a banner would be crying wolf. When
	 * the retry budget runs out the page swaps to `ErrorState`, which is the
	 * one failure object.
	 *
	 * `failureCount` comes from the query, so the "already failed once" line is
	 * a MEASUREMENT, not a guess. The slow line is the only timed thing here.
	 */
	import { RefreshOutline } from 'flowbite-svelte-icons';

	let {
		/** TanStack's `query.failureCount` — attempts that have already failed. */
		failureCount = 0,
		/** How long a request may be in flight before we admit it is slow. */
		slowAfterMs = 4000,
		class: className = 'mb-3'
	}: {
		failureCount?: number;
		slowAfterMs?: number;
		class?: string;
	} = $props();

	let slow = $state(false);
	$effect(() => {
		const t = setTimeout(() => (slow = true), slowAfterMs);
		return () => clearTimeout(t);
	});

	const shown = $derived(failureCount > 0 || slow);
</script>

{#if shown}
	<div
		aria-live="polite"
		class="{className} flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
	>
		<RefreshOutline class="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
		{#if failureCount > 0}
			<span>
				The server did not answer{failureCount > 1 ? ` (${failureCount} attempts)` : ''} — trying
				again. Nothing below has loaded yet.
			</span>
		{:else}
			<span>Still waiting for the dashboard server. Nothing below has loaded yet.</span>
		{/if}
	</div>
{/if}
