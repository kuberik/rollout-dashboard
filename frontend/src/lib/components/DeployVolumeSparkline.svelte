<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../../types';
	import { now } from '$lib/stores/time';

	let {
		rollouts,
		days = 7
	}: {
		rollouts: Rollout[];
		days?: number;
	} = $props();

	const buckets = $derived.by(() => {
		const day = 24 * 60 * 60 * 1000;
		const out: number[] = Array(days).fill(0);
		const d = new Date($now);
		d.setHours(0, 0, 0, 0);
		const todayStart = d.getTime();
		for (const r of rollouts) {
			for (const h of r.status?.history ?? []) {
				if (!h.timestamp) continue;
				const ts = new Date(h.timestamp).getTime();
				const daysAgo = Math.floor((todayStart - ts) / day);
				const idx = days - 1 - daysAgo;
				if (idx >= 0 && idx < days) out[idx]++;
			}
		}
		return out;
	});
	const max = $derived(Math.max(1, ...buckets));
	const total = $derived(buckets.reduce((s, n) => s + n, 0));

	function label(i: number): string {
		const ago = days - 1 - i;
		if (ago === 0) return 'today';
		if (ago === 1) return 'yesterday';
		return `${ago}d ago`;
	}
</script>

{#if total > 0}
	<span
		class="flex h-4 w-14 items-end gap-px"
		aria-label={`Deploys per day, last ${days} days`}
		title={`${total} deploys over last ${days} days`}
	>
		{#each buckets as count, i}
			<span
				class="flex-1 rounded-sm {count > 0
					? 'bg-blue-300 dark:bg-blue-500/70'
					: 'bg-gray-200 dark:bg-gray-700'}"
				style="height: {count === 0 ? '8%' : Math.max(15, (count / max) * 100)}%"
				title={`${count} deploy${count === 1 ? '' : 's'} ${label(i)}`}
			></span>
		{/each}
	</span>
{/if}
