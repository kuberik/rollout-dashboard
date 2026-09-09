<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE SEARCH FIELD — extracted from `/revisions` (round 11, lane 2)
	 * so the repository page (`/revisions/[...slug]`, lane 3) reuses this
	 * exact box instead of copying its markup a second time. Same look, same
	 * behaviour, at either scope: the fleet-wide index or one repository.
	 *
	 * ⭐ CRAFT REVIEW (d) — THE FOCUS RING. The old markup carried its own
	 * `focus:border-blue-400 focus:ring-1 focus:ring-blue-400` — a 1px
	 * same-hue box-shadow that reads as a border TINT, not a ring. That is a
	 * second focus treatment; the product already has one, `app.css`'s
	 * unlayered `:focus-visible { outline: 2px solid var(--focus-ring-color);
	 * outline-offset: 2px }`, the same ring every `.nav-link` and every plain
	 * `<a>` already draws. This input no longer overrides it — no `focus:*`
	 * utility at all — so tabbing here draws the SAME ring tabbing to the
	 * clear button or the search-icon-adjacent link below does.
	 */
	import { SearchOutline, CloseOutline } from 'flowbite-svelte-icons';

	let {
		value = $bindable(''),
		placeholder = 'Find a build or service',
		ariaLabel = 'Find a build by sha or a service by name',
		class: className = ''
	}: {
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		class?: string;
	} = $props();
</script>

<div class="relative mt-1 w-full sm:max-w-sm {className}">
	<SearchOutline
		class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
	/>
	<input
		type="text"
		bind:value
		{placeholder}
		aria-label={ariaLabel}
		class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-gray-900 placeholder-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
		onkeydown={(e) => {
			if (e.key === 'Escape') value = '';
		}}
	/>
	{#if value}
		<button
			type="button"
			aria-label="Clear the search"
			onclick={() => (value = '')}
			class="hit-32 absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
		>
			<CloseOutline class="h-4 w-4" aria-hidden="true" />
		</button>
	{/if}
</div>
