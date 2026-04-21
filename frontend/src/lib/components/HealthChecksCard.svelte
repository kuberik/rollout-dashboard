<svelte:options runes={true} />

<script lang="ts">
	import type { HealthCheck } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid } from 'flowbite-svelte-icons';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';

	let { healthChecks }: { healthChecks: HealthCheck[] } = $props();

	let expandedMessages = $state<Set<string>>(new Set());

	function toggleMessage(key: string) {
		const next = new Set(expandedMessages);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedMessages = next;
	}

	const failedChecks = $derived(
		healthChecks.filter((hc) => hc.status?.status === 'Failed' || hc.status?.status === 'Unhealthy')
	);
	const pendingChecks = $derived(
		healthChecks.filter(
			(hc) => !hc.status?.status || hc.status?.status === 'Pending' || hc.status?.status === 'Unknown'
		)
	);
	const healthyChecks = $derived(
		healthChecks.filter((hc) => hc.status?.status === 'Healthy')
	);
	const problemChecks = $derived([...failedChecks, ...pendingChecks]);
</script>

{#if healthChecks.length > 0}
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
		<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
			<div class="flex items-center gap-2">
				{#if failedChecks.length > 0}
					<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
				{:else if pendingChecks.length > 0}
					<ClockSolid class="h-4 w-4 text-yellow-500 dark:text-yellow-400" />
				{:else}
					<CheckCircleSolid class="h-4 w-4 text-green-500 dark:text-green-400" />
				{/if}
				<span class="text-sm font-semibold text-gray-900 dark:text-white">Health Checks</span>
			</div>
			{#if failedChecks.length > 0}
				<span class="text-xs font-semibold text-red-600 dark:text-red-400">{failedChecks.length} failing{pendingChecks.length > 0 ? ` · ${pendingChecks.length} pending` : ''} · {healthyChecks.length} passing</span>
			{:else if pendingChecks.length > 0}
				<span class="text-xs text-yellow-600 dark:text-yellow-400">{pendingChecks.length} pending · {healthyChecks.length} passing</span>
			{:else}
				<span class="text-xs text-green-600 dark:text-green-400">{healthChecks.length}/{healthChecks.length} healthy</span>
			{/if}
		</div>
		{#if problemChecks.length > 0}
			{#each failedChecks as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
				<div class="border-b border-red-100 bg-red-50 px-4 py-3 last:border-b-0 dark:border-red-900/30 dark:bg-red-950/15">
					<div class="flex items-start gap-3">
						<ExclamationCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400" />
						<div class="min-w-0 flex-1">
							<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
								<span class="text-sm font-semibold text-gray-900 dark:text-white">
									{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
								</span>
								<div class="flex shrink-0 items-center gap-2 text-xs">
									{#if hc.status?.lastChangeTime}
										<span class="text-gray-400 dark:text-gray-500">{formatTimeAgo(hc.status.lastChangeTime, $now)}</span>
									{/if}
									<span class="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
										{hc.status?.status || 'Unknown'}
									</span>
								</div>
							</div>
							{#if hc.status?.message}
								{@const key = 'f-' + hc.metadata?.name + '/' + hc.metadata?.namespace}
								{@const expanded = expandedMessages.has(key)}
								<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400" class:line-clamp-3={!expanded}>{hc.status.message}</p>
								{#if hc.status.message.length > 200}
									<button onclick={() => toggleMessage(key)} class="mt-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
										{expanded ? 'Show less' : 'Show more'}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			{/each}
			{#each pendingChecks as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
				<div class="border-b border-yellow-100 bg-yellow-50 px-4 py-2.5 last:border-b-0 dark:border-yellow-900/30 dark:bg-yellow-950/10">
					<div class="flex items-start gap-3">
						<StatusSpinner size="4" color="yellow" class="mt-0.5" />
						<div class="min-w-0 flex-1">
							<span class="text-sm text-gray-700 dark:text-gray-300">
								{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
							</span>
							{#if hc.status?.message}
								{@const key = 'p-' + hc.metadata?.name + '/' + hc.metadata?.namespace}
								{@const expanded = expandedMessages.has(key)}
								<p class="mt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400" class:line-clamp-3={!expanded}>{hc.status.message}</p>
								{#if hc.status.message.length > 200}
									<button onclick={() => toggleMessage(key)} class="mt-1 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
										{expanded ? 'Show less' : 'Show more'}
									</button>
								{/if}
							{/if}
						</div>
						<span class="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300">
							{hc.status?.status || 'Pending'}
						</span>
					</div>
				</div>
			{/each}
			{#if healthyChecks.length > 0}
				<div class="flex flex-wrap gap-1.5 border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
					{#each healthyChecks as hc}
						<span class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
							<CheckCircleSolid class="h-2.5 w-2.5" />
							{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
						</span>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
