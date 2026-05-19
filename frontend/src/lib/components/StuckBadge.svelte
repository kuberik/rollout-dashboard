<svelte:options runes={true} />

<script lang="ts">
	import { ExclamationCircleSolid } from 'flowbite-svelte-icons';
	import type { StuckReason } from '$lib/utils';
	import { formatTimeAgoCompact } from '$lib/utils';

	let {
		reason,
		size = 'sm'
	}: {
		reason: StuckReason;
		size?: 'xs' | 'sm';
	} = $props();

	const iconSize = $derived(size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3');

	const titleText = $derived.by(() => {
		if (reason.kind === 'baking') return `Stuck — baking for ${formatTimeAgoCompact(new Date(Date.now() - reason.durationMs).toISOString())}`;
		if (reason.kind === 'deploying') return `Stuck — deploying for ${formatTimeAgoCompact(new Date(Date.now() - reason.durationMs).toISOString())}`;
		const peerAgo = formatTimeAgoCompact(new Date(Date.now() - reason.peerAdvancedMs).toISOString());
		const by = reason.behindBy != null ? `${reason.behindBy} version${reason.behindBy === 1 ? '' : 's'} ` : '';
		return `Stuck — ${by}behind ${reason.peerEnv} (advanced ${peerAgo} ago)`;
	});
</script>

<span
	class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/60"
	title={titleText}
>
	<ExclamationCircleSolid class="{iconSize} -ml-0.5" />
	<span>stuck</span>
</span>
