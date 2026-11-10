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
		if (terminating) return 'text-fg-subtle';
		if (phase === 'Running' && ready) return 'text-fg-subtle';
		if (phase === 'Running' && !ready) return 'text-progress';
		if (phase === 'Pending') return 'text-progress';
		if (phase === 'Failed') return 'text-danger';
		if (phase === 'Succeeded') return 'text-fg-subtle';
		return 'text-fg-subtle';
	}

	function getPodStatusLabel(phase: string, ready: boolean, terminating: boolean): string {
		if (terminating) return 'Terminating';
		if (phase === 'Running' && ready) return 'Ready';
		if (phase === 'Running' && !ready) return 'Not Ready';
		return phase;
	}
</script>

<div
	class="border-t border-line-subtle bg-subtle pb-1"
>
	{#if childrenQuery.isPending}
		<div class="t-meta flex items-center gap-2 px-4 py-2 text-fg-subtle">
			<StatusSpinner size="4" color="gray" /> Loading...
		</div>
	{:else if childrenQuery.isError}
		<p class="t-meta px-4 py-2 text-danger">Failed to load</p>
	{:else}
		{#each replicaSets as rs}
			<!-- ReplicaSet row -->
			<div class="flex items-center gap-2 py-2 pl-9 pr-4">
				<div class="flex h-4 w-4 shrink-0 items-center justify-center">
					{#if rs.readyReplicas === rs.desiredReplicas}
						<CheckCircleSolid class="h-3 w-3 text-success" />
					{:else}
						<StatusSpinner size="3" color="yellow" />
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1">
						<span class="t-meta truncate text-fg-muted"
							>{rs.name}</span
						>
						<span
							class="t-code-sm shrink-0 text-fg-subtle"
							>ReplicaSet</span
						>
						{#if rs.isCurrentRS}
							<span
								class="t-meta shrink-0 text-fg-subtle"
								>current</span
							>
						{/if}
					</div>
				</div>
				<span
					class="t-meta shrink-0 tabular-nums {rs.readyReplicas === rs.desiredReplicas
						? 'text-fg-muted'
						: 'text-progress'}"
				>
					{rs.readyReplicas}/{rs.desiredReplicas}
					<span class="text-fg-subtle">pods</span>
				</span>
			</div>

			<!-- Pod rows -->
			{#each rs.pods || [] as pod}
				<div class="flex items-start gap-2 py-1 pl-14 pr-4">
					<div class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
						{#if pod.terminating}
							<StatusSpinner size="3" color="gray" />
						{:else if pod.phase === 'Running' && pod.ready}
							<CheckCircleSolid class="h-3 w-3 text-success" />
						{:else if pod.phase === 'Pending' || (pod.phase === 'Running' && !pod.ready)}
							<StatusSpinner size="3" color="yellow" />
						{:else if pod.phase === 'Failed'}
							<ExclamationCircleSolid class="h-3 w-3 text-danger" />
						{:else}
							<div class="h-2 w-2 rounded-full bg-line-strong"></div>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1">
							<span class="t-meta truncate text-fg-muted">{pod.name}</span>
							<span
								class="t-code-sm shrink-0 text-fg-subtle"
								>Pod</span
							>
						</div>
						{#if pod.message}
							<span class="t-meta block break-words text-fg-subtle"
								>{pod.message}</span
							>
						{/if}
					</div>
					{#if pod.restarts}
						<span
							class="t-meta shrink-0 tabular-nums text-fg-muted" title="Container restarts"
						>
							{pod.restarts}r
						</span>
					{/if}
					{#if pod.age}
						<span class="t-meta shrink-0 tabular-nums text-fg-subtle">{pod.age}</span>
					{/if}
					<span
						class="t-label shrink-0 {getPodStatusColor(pod.phase, pod.ready, !!pod.terminating)}"
					>
						{getPodStatusLabel(pod.phase, pod.ready, !!pod.terminating)}
					</span>
				</div>
			{/each}

			{#if (rs.pods?.length ?? 0) === 0}
				<p class="t-meta pb-1 pl-14 pr-4 text-fg-subtle">No pods</p>
			{/if}
		{/each}

		{#if replicaSets.length === 0}
			<p class="t-meta px-9 py-2 text-fg-subtle">No active ReplicaSets</p>
		{/if}
	{/if}
</div>
