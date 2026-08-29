<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../../types';
	import { now } from '$lib/stores/time';

	let {
		rollouts,
		days = 7,
		hours,
		buckets
	}: {
		rollouts: Rollout[];
		days?: number;
		hours?: number;
		buckets?: number;
	} = $props();

	// When `hours` is set, bucket over the last N hours (rolling window ending
	// now). Otherwise, bucket by day over the last N days. `buckets` lets
	// callers override the bar count — fewer buckets = wider bars for visual
	// density on small per-row sparklines.
	const isHourly = $derived(hours !== undefined && hours > 0);
	const bucketCount = $derived(buckets ?? (isHourly ? (hours as number) : days));

	const bucketValues = $derived.by(() => {
		const out: number[] = Array(bucketCount).fill(0);
		const nowMs = $now.getTime();
		if (isHourly) {
			const totalMs = (hours as number) * 60 * 60 * 1000;
			const start = nowMs - totalMs;
			const bucketWidth = totalMs / bucketCount;
			for (const r of rollouts) {
				for (const h of r.status?.history ?? []) {
					if (!h.timestamp) continue;
					const ts = new Date(h.timestamp).getTime();
					if (ts < start || ts > nowMs) continue;
					const idx = Math.min(bucketCount - 1, Math.floor((ts - start) / bucketWidth));
					out[idx]++;
				}
			}
		} else {
			const day = 24 * 60 * 60 * 1000;
			const d = new Date($now);
			d.setHours(0, 0, 0, 0);
			const todayStart = d.getTime();
			for (const r of rollouts) {
				for (const h of r.status?.history ?? []) {
					if (!h.timestamp) continue;
					const ts = new Date(h.timestamp).getTime();
					const daysAgo = Math.floor((todayStart - ts) / day);
					const idx = bucketCount - 1 - daysAgo;
					if (idx >= 0 && idx < bucketCount) out[idx]++;
				}
			}
		}
		return out;
	});
	const max = $derived(Math.max(1, ...bucketValues));
	const total = $derived(bucketValues.reduce((s, n) => s + n, 0));

	function label(i: number): string {
		if (isHourly) {
			const ago = (hours as number) - 1 - i;
			if (ago === 0) return 'this hour';
			if (ago === 1) return '1h ago';
			return `${ago}h ago`;
		}
		const ago = bucketCount - 1 - i;
		if (ago === 0) return 'today';
		if (ago === 1) return 'yesterday';
		return `${ago}d ago`;
	}
</script>

{#if total > 0}
	<span
		class="flex h-4 w-16 items-end gap-px"
		aria-label={isHourly ? `Deploys per hour, last ${hours} hours` : `Deploys per day, last ${bucketCount} days`}
		title={isHourly ? `${total} deploys over last ${hours}h` : `${total} deploys over last ${bucketCount} days`}
	>
		{#each bucketValues as count, i}
			<!-- Square, and the ONE green. `rounded-sm` is off the 2-value radius
			     budget and rounding a 3px-wide bar turns it into a blob anyway;
			     `emerald-400` was a second green in a product allowed exactly
			     one, and a lighter one than the status glyph it sits beside. -->
			<span
				class="flex-1 {count > 0
					? 'bg-green-700 dark:bg-green-400'
					: 'bg-gray-200 dark:bg-gray-700'}"
				style="height: {count === 0 ? '20%' : Math.max(30, (count / max) * 100)}%"
				title={`${count} deploy${count === 1 ? '' : 's'} ${label(i)}`}
			></span>
		{/each}
	</span>
{/if}
