<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ PERF-2026-09-04 — A DEPLOYMENT'S PODS, PUSH NOT POLL.
	 *
	 * `ResourcesCard.svelte` used to run its own `setInterval(refresh, 5000)`
	 * per expanded deployment, with a hand-rolled `Record<key, {replicaSets,
	 * loading, error}>` cache built from a raw `fetch` — outside TanStack Query
	 * entirely, so it ignored the SSE change stream (`$lib/api/events`) and
	 * never slowed down even while the stream was healthy and idle. This
	 * component is the same lookup as a real query instead, so it gets the
	 * same push-not-poll treatment (`applyChangeEvents`' `Deployment`/
	 * `ReplicaSet` handling) and the same stream-aware cadence every other
	 * rollout-scoped query already has.
	 *
	 * ⭐ "ENABLED ONLY WHILE EXPANDED" FALLS OUT OF MOUNT/UNMOUNT, NOT A FLAG.
	 * `ResourcesCard.svelte` only renders this component inside
	 * `{#if isExpanded}` — so no fetch happens before the reader asks to see
	 * pods, and none continues (no interval, nothing) once they collapse the
	 * row. TanStack's own cache (keyed by `deploymentChildrenQueryKey`)
	 * outlives the unmount for `gcTime`, so re-expanding the same deployment
	 * within its `staleTime` repaints instantly with no loading flash — the
	 * cache this replaces never gave that for free.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { deploymentChildrenQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import StatusSpinner from './StatusSpinner.svelte';
	import { CheckCircleSolid, ExclamationCircleSolid } from 'flowbite-svelte-icons';

	let {
		namespace,
		name,
		cluster
	}: {
		namespace: string;
		name: string;
		// Spoke URL when this rollout lives on a remote cluster — see
		// `ResourcesCard.svelte`'s identical prop.
		cluster?: string;
	} = $props();

	const childrenQuery = createQuery(() =>
		deploymentChildrenQueryOptions({
			namespace,
			name,
			cluster,
			options: {
				staleTime: staleTimeWhenHealthy(2_000, 120_000, cluster),
				refetchInterval: pollWhenHealthy(5_000, 300_000, cluster)
			}
		})
	);

	const replicaSets = $derived(
		(childrenQuery.data?.replicaSets ?? []).filter((rs) => rs.desiredReplicas > 0)
	);

	function getPodStatusColor(phase: string, ready: boolean, terminating: boolean): string {
		if (terminating) return 'text-orange-500 dark:text-orange-400';
		if (phase === 'Running' && ready) return 'text-green-700 dark:text-green-400';
		if (phase === 'Running' && !ready) return 'text-yellow-700 dark:text-yellow-400';
		if (phase === 'Pending') return 'text-yellow-700 dark:text-yellow-400';
		if (phase === 'Failed') return 'text-red-600 dark:text-red-400';
		if (phase === 'Succeeded') return 'text-green-700 dark:text-green-400';
		return 'text-gray-500 dark:text-gray-400';
	}

	function getPodStatusLabel(phase: string, ready: boolean, terminating: boolean): string {
		if (terminating) return 'Terminating';
		if (phase === 'Running' && ready) return 'Ready';
		if (phase === 'Running' && !ready) return 'Not Ready';
		return phase;
	}
</script>

<div
	class="border-t border-gray-100 bg-gray-50/50 pb-1 dark:border-gray-700/50 dark:bg-gray-800/50"
>
	{#if childrenQuery.isPending}
		<div class="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
			<StatusSpinner size="4" color="gray" /> Loading...
		</div>
	{:else if childrenQuery.isError}
		<p class="px-4 py-2 text-xs text-red-600 dark:text-red-400">Failed to load</p>
	{:else}
		{#each replicaSets as rs}
			<!-- ReplicaSet row -->
			<div class="flex items-center gap-2 py-1.5 pl-9 pr-4">
				<div class="flex h-4 w-4 shrink-0 items-center justify-center">
					{#if rs.readyReplicas === rs.desiredReplicas}
						<CheckCircleSolid class="h-3 w-3 text-green-700 dark:text-green-400" />
					{:else}
						<StatusSpinner size="3" color="yellow" />
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1">
						<span class="truncate text-[11px] font-medium text-gray-700 dark:text-gray-300"
							>{rs.name}</span
						>
						<span
							class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300"
							>ReplicaSet</span
						>
						{#if rs.isCurrentRS}
							<span
								class="shrink-0 rounded bg-blue-100 px-1 py-0.5 t-micro text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
								>current</span
							>
						{/if}
					</div>
				</div>
				<span
					class="shrink-0 text-[11px] {rs.readyReplicas === rs.desiredReplicas
						? 'text-green-700 dark:text-green-400'
						: 'text-yellow-700 dark:text-yellow-400'}"
				>
					{rs.readyReplicas}/{rs.desiredReplicas}
					<span class="t-micro text-gray-500 dark:text-gray-400">pods</span>
				</span>
			</div>

			<!-- Pod rows -->
			{#each rs.pods || [] as pod}
				<div class="flex items-start gap-2 py-1 pl-14 pr-4">
					<div class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
						{#if pod.terminating}
							<StatusSpinner size="3" color="orange" />
						{:else if pod.phase === 'Running' && pod.ready}
							<CheckCircleSolid class="h-3 w-3 text-green-700 dark:text-green-400" />
						{:else if pod.phase === 'Pending' || (pod.phase === 'Running' && !pod.ready)}
							<StatusSpinner size="3" color="yellow" />
						{:else if pod.phase === 'Failed'}
							<ExclamationCircleSolid class="h-3 w-3 text-red-500 dark:text-red-400" />
						{:else}
							<div class="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1">
							<span class="truncate text-[11px] text-gray-600 dark:text-gray-400">{pod.name}</span>
							<span
								class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300"
								>Pod</span
							>
						</div>
						{#if pod.message}
							<span class="block break-words t-micro text-gray-500 dark:text-gray-400"
								>{pod.message}</span
							>
						{/if}
					</div>
					{#if pod.restarts}
						<span
							class="shrink-0 rounded bg-orange-100 px-1 py-0.5 t-micro text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
						>
							{pod.restarts}r
						</span>
					{/if}
					{#if pod.age}
						<span class="shrink-0 t-micro text-gray-500 dark:text-gray-400">{pod.age}</span>
					{/if}
					<span
						class="t-label shrink-0 {getPodStatusColor(pod.phase, pod.ready, !!pod.terminating)}"
					>
						{getPodStatusLabel(pod.phase, pod.ready, !!pod.terminating)}
					</span>
				</div>
			{/each}

			{#if (rs.pods?.length ?? 0) === 0}
				<p class="pb-1 pl-14 pr-4 t-micro text-gray-500 dark:text-gray-400">No pods</p>
			{/if}
		{/each}

		{#if replicaSets.length === 0}
			<p class="px-9 py-2 text-xs text-gray-500 dark:text-gray-400">No active ReplicaSets</p>
		{/if}
	{/if}
</div>
