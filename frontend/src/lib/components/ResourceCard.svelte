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

<div class="border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-8 w-8 items-center justify-center">
				{#if getStatusIcon(resource.status).isSpinner}
					<Spinner size="6" color="yellow" />
				{:else}
					<svelte:component
						this={getStatusIcon(resource.status).icon}
						class="h-5 w-5 {getStatusIcon(resource.status).color}"
					/>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-sm font-medium text-gray-900 dark:text-white">
					{#if resource.namespace}
						<span class="text-gray-500 dark:text-gray-400">{resource.namespace} / </span>
					{/if}
					{resource.name}
				</h3>
				{#if shouldShowRich}
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{resource.groupVersionKind?.split('/').pop() || resourceType}
					</p>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if shouldShowRich && resource.lastModified}
				<div class="text-xs text-gray-500 dark:text-gray-400">
					{formatTimeAgo(resource.lastModified, $now)}
				</div>
			{/if}
			<Badge color={getStatusColor(resource.status)} size="small">
				{resource.status}
			</Badge>
		</div>
	</div>

	{#if shouldShowRich}
		<div class="ml-11 mt-2">
			{#if resource.message}
				<p class="mb-1 text-xs text-gray-600 dark:text-gray-400">
					{resource.message}
				</p>
			{/if}
			{#if resource.lastErrorTime && resource.status === 'Unhealthy'}
				<div class="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
					<ExclamationCircleSolid class="h-3 w-3" />
					<span>Error {formatTimeAgo(resource.lastErrorTime, $now)}</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
