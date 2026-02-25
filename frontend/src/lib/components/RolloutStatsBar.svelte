<svelte:options runes={true} />

<script lang="ts">
	import type { RolloutStats } from '$lib/rollout-filters';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ArrowUpOutline,
		DatabaseSolid
	} from 'flowbite-svelte-icons';

	interface Props {
		stats: RolloutStats;
		filteredCount: number;
		isFiltered: boolean;
	}

	let { stats, filteredCount, isFiltered }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
	<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
		<DatabaseSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
		<div>
			<div class="text-lg font-semibold text-gray-900 dark:text-white">{stats.total}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">Total</div>
		</div>
	</div>
	<div class="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/20">
		<CheckCircleSolid class="h-4 w-4 text-green-600 dark:text-green-400" />
		<div>
			<div class="text-lg font-semibold text-green-700 dark:text-green-400">{stats.healthy}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">Healthy</div>
		</div>
	</div>
	<div class="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/20">
		<ExclamationCircleSolid class="h-4 w-4 text-red-600 dark:text-red-400" />
		<div>
			<div class="text-lg font-semibold text-red-700 dark:text-red-400">{stats.failing}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">Failing</div>
		</div>
	</div>
	<div class="flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 dark:bg-orange-900/20">
		<ArrowUpOutline class="h-4 w-4 text-orange-600 dark:text-orange-400" />
		<div>
			<div class="text-lg font-semibold text-orange-700 dark:text-orange-400">
				{stats.upgrades}
			</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">Upgrades</div>
		</div>
	</div>
</div>
{#if isFiltered}
	<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
		Showing {filteredCount} of {stats.total} rollouts
	</p>
{/if}
