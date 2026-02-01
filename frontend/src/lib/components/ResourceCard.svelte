<script lang="ts">
	import { Card, Badge, Spinner } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		DatabaseSolid
	} from 'flowbite-svelte-icons';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';

	export let resource: any;
	export let showRich = false;
	export let resourceType: string = 'resource';

	// Determine if we should show rich information
	$: shouldShowRich =
		showRich ||
		resource.status === 'Pending' ||
		resource.status === 'Failed' ||
		resource.status === 'Error' ||
		resource.status === 'Unhealthy' ||
		resource.status === 'InProgress';

	function getStatusIcon(status: string) {
		switch (status) {
			case 'Healthy':
			case 'Current':
			case 'Ready':
			case 'Succeeded':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'Unhealthy':
			case 'Failed':
			case 'Error':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'Pending':
			case 'InProgress':
				return { icon: Spinner, color: 'text-yellow-600 dark:text-yellow-400', isSpinner: true };
			default:
				return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'Healthy':
			case 'Current':
			case 'Ready':
			case 'Succeeded':
				return 'green';
			case 'Unhealthy':
			case 'Failed':
			case 'Error':
				return 'red';
			case 'Pending':
			case 'InProgress':
				return 'yellow';
			default:
				return 'gray';
		}
	}
</script>

<div class="border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-700 sm:py-4">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
			<div class="flex h-6 w-6 flex-shrink-0 items-center justify-center sm:h-8 sm:w-8">
				{#if getStatusIcon(resource.status).isSpinner}
					<Spinner size="5" color="yellow" />
				{:else}
					<svelte:component
						this={getStatusIcon(resource.status).icon}
						class="h-4 w-4 sm:h-5 sm:w-5 {getStatusIcon(resource.status).color}"
					/>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-xs font-medium text-gray-900 dark:text-white sm:text-sm">
					{#if resource.namespace}
						<span class="text-gray-500 dark:text-gray-400">{resource.namespace} / </span>
					{/if}
					{resource.name}
				</h3>
				{#if shouldShowRich}
					<p class="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">
						{resource.groupVersionKind?.split('/').pop() || resourceType}
					</p>
				{/if}
			</div>
		</div>
		<div class="ml-8 flex flex-wrap items-center gap-1.5 sm:ml-0 sm:gap-2">
			{#if shouldShowRich && resource.lastModified}
				<div class="text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs">
					{formatTimeAgo(resource.lastModified, $now)}
				</div>
			{/if}
			<Badge color={getStatusColor(resource.status)} size="small" class="whitespace-nowrap text-[10px] sm:text-xs">
				{resource.status}
			</Badge>
		</div>
	</div>

	{#if shouldShowRich}
		<div class="ml-8 mt-1.5 sm:ml-11 sm:mt-2">
			{#if resource.message}
				<p class="mb-1 text-[10px] text-gray-600 dark:text-gray-400 sm:text-xs">
					{resource.message}
				</p>
			{/if}
			{#if resource.lastErrorTime && resource.status === 'Unhealthy'}
				<div class="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 sm:text-xs">
					<ExclamationCircleSolid class="h-3 w-3" />
					<span>Error {formatTimeAgo(resource.lastErrorTime, $now)}</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
