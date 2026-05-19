<svelte:options runes={true} />

<script lang="ts">
	import { CodeBranchSolid } from 'flowbite-svelte-icons';

	let {
		versions,
		size = 'sm'
	}: {
		versions?: string[];
		size?: 'xs' | 'sm';
	} = $props();

	const iconSize = $derived(size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3');
	const titleText = $derived(
		versions && versions.length > 0
			? `Drift — live versions: ${versions.join(', ')}`
			: 'Drift — different versions across environments'
	);
</script>

<span
	class="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200 dark:bg-orange-900/40 dark:text-orange-200 dark:ring-orange-700/60"
	title={titleText}
>
	<CodeBranchSolid class="{iconSize} -ml-0.5" />
	<span>drift</span>
</span>
