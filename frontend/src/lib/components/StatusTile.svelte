<svelte:options runes={true} />

<script lang="ts">
	let {
		n,
		label,
		tone = 'default',
		href,
		onclick
	}: {
		n: number;
		label: string;
		tone?: 'default' | 'fail';
		href?: string;
		onclick?: () => void;
	} = $props();

	const toneClass = $derived(
		tone === 'fail' ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'
	);

	const tileClass = $derived(
		`flex flex-col items-center gap-1 rounded-lg border bg-white px-4 py-3 text-center transition-colors hover:border-gray-300 dark:bg-gray-800 dark:hover:border-gray-600 ${toneClass}`
	);
</script>

{#if href}
	<a {href} class={tileClass}>
		<span class="font-montserrat text-3xl font-semibold text-gray-900 dark:text-gray-100">{n}</span>
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
			>{label}</span
		>
	</a>
{:else}
	<button type="button" {onclick} class={tileClass}>
		<span class="font-montserrat text-3xl font-semibold text-gray-900 dark:text-gray-100">{n}</span>
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
			>{label}</span
		>
	</button>
{/if}
