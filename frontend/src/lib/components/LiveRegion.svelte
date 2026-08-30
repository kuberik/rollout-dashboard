<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The product's single pair of live regions, mounted once in the root
	 * layout. Visually nothing: `sr-only` in both themes at both widths.
	 * See `$lib/stores/announce.svelte.ts` for why this exists.
	 */
	import { liveMessages } from '$lib/stores/announce.svelte';
</script>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessages.polite}</div>
<div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
	{liveMessages.assertive}
</div>
