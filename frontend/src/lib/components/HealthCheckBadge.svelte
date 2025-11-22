<script lang="ts">
	import { Badge, Popover } from 'flowbite-svelte';
	import {
		ExclamationCircleSolid,
		DatabaseSolid,
		QuestionCircleOutline
	} from 'flowbite-svelte-icons';
	import type { HealthCheck } from '../../types';

	interface FailedHealthCheck {
		name: string;
		namespace?: string;
		message?: string;
	}

	interface Props {
		failedHealthCheck: FailedHealthCheck;
		fullHealthCheck?: HealthCheck;
		index: number;
		prefix?: string;
	}

	const { failedHealthCheck, fullHealthCheck, index, prefix = 'failed-hc' }: Props = $props();

	const triggerId = $derived(`${prefix}-${index}-${failedHealthCheck.name}`);

	// Use full health check data when available, fall back to failed entry
	const displayName = $derived(
		fullHealthCheck?.metadata?.annotations?.['kuberik.com/display-name'] ||
			fullHealthCheck?.metadata?.name ||
			failedHealthCheck.name
	);
	const namespace = $derived(fullHealthCheck?.metadata?.namespace || failedHealthCheck.namespace);
	const healthCheckClass = $derived(fullHealthCheck?.spec?.class);
	const failureMessage = $derived(failedHealthCheck.message);
</script>

<Badge id={triggerId} color="red" size="small" class="cursor-help">
	{displayName}
	<QuestionCircleOutline class="ml-1 h-3 w-3" />
</Badge>
<Popover triggeredBy={`#${triggerId}`} class="max-w-sm">
	<div class="p-4">
		<div class="mb-3">
			<div class="mb-2 flex items-center gap-2">
				<ExclamationCircleSolid class="h-4 w-4 text-red-600 dark:text-red-400" />
				<h4 class="text-sm font-semibold text-gray-900 dark:text-white">
					{displayName}
				</h4>
			</div>
			{#if namespace}
				<div class="mb-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<DatabaseSolid class="h-3 w-3" />
					<span>Namespace: {namespace}</span>
				</div>
			{/if}
			{#if healthCheckClass}
				<div class="mb-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<span>Class: {healthCheckClass.charAt(0).toUpperCase() + healthCheckClass.slice(1)}</span>
				</div>
			{/if}
		</div>
		{#if failureMessage}
			<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
				<p class="text-xs leading-relaxed text-red-700 dark:text-red-300">
					{failureMessage}
				</p>
			</div>
		{/if}
	</div>
</Popover>
