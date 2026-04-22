<svelte:options runes={true} />

<script lang="ts">
	import { ExclamationCircleSolid, InfoCircleSolid, CalendarWeekSolid } from 'flowbite-svelte-icons';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';

	let { events }: { events: any[] } = $props();

	let showAllEvents = $state(false);
	const visibleEvents = $derived(showAllEvents ? events : events.slice(0, 5));
</script>

<div class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
	<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h5 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
			<CalendarWeekSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
			Recent Events
		</h5>
		{#if events.length > 0}
			<span class="text-xs text-gray-400 dark:text-gray-500">{events.length} event{events.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>
	{#if events.length === 0}
		<p class="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">No recent events</p>
	{:else}
		<div class="divide-y divide-gray-100 dark:divide-gray-700">
			{#each visibleEvents as event}
				<div class="flex items-start gap-3 px-4 py-2.5">
					{#if event.type === 'Warning'}
						<ExclamationCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500 dark:text-yellow-400" />
					{:else}
						<InfoCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400 dark:text-blue-400" />
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span class="text-xs font-semibold text-gray-700 dark:text-gray-300">{event.reason}</span>
							<span class="text-xs text-gray-500 dark:text-gray-400">{event.involvedObject?.kind}/{event.involvedObject?.name}</span>
							<span class="ml-auto text-xs text-gray-400 dark:text-gray-500">{formatTimeAgo(event.lastTimestamp, $now)}</span>
						</div>
						<p class="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{event.message}</p>
					</div>
				</div>
			{/each}
		</div>
		{#if events.length > 5}
			<button
				onclick={() => { showAllEvents = !showAllEvents; }}
				class="w-full border-t border-gray-100 px-4 py-2 text-xs text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-700/50"
			>
				{showAllEvents ? 'Show fewer' : `Show all ${events.length} events`}
			</button>
		{/if}
	{/if}
</div>
