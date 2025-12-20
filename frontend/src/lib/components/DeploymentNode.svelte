<svelte:options runes={true} />

<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { Badge } from 'flowbite-svelte';
	import {
		ArrowUpRightFromSquareOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid
	} from 'flowbite-svelte-icons';

	interface Props {
		data: {
			environment: string;
			currentVersion: string;
			deploymentStatus: string;
			environmentInfo?: {
				environment: string;
				deploymentUrl?: string;
				environmentUrl?: string;
				dependencies?: string[];
			};
			isCurrentEnvironment?: boolean;
			versionIndex?: number;
			currentEnvironmentVersionIndex?: number;
		};
	}

	let { data }: Props = $props();

	// Calculate version difference
	const versionDifference = $derived.by(() => {
		if (
			data.isCurrentEnvironment ||
			data.versionIndex === undefined ||
			data.currentEnvironmentVersionIndex === undefined
		) {
			return null;
		}
		// versionIndex is lower for newer versions (newest = 0)
		// So if envVersionIdx < currentEnvIdx, the environment is ahead
		// If envVersionIdx > currentEnvIdx, the environment is behind
		const diff = data.versionIndex - data.currentEnvironmentVersionIndex;
		return diff;
	});

	const statusColor = (status: string) => {
		switch (status?.toLowerCase()) {
			case 'success':
				return 'green';
			case 'failure':
				return 'red';
			case 'in_progress':
			case 'pending':
				return 'yellow';
			case 'inactive':
				return 'gray';
			default:
				return 'gray';
		}
	};

	const getStatusIcon = (status: string) => {
		switch (status?.toLowerCase()) {
			case 'success':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'failure':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'in_progress':
			case 'pending':
				return { icon: ClockSolid, color: 'text-yellow-600 dark:text-yellow-400' };
			default:
				return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		}
	};

	// Compute status info for the badge
	const statusInfo = $derived(getStatusIcon(data.deploymentStatus));
	const StatusIcon = $derived(statusInfo.icon);
</script>

<div
	class="relative"
	style={data.isCurrentEnvironment
		? '--env-bg-color-light: rgb(219, 234, 254); --env-bg-color-dark: rgb(30, 58, 138);'
		: '--env-bg-color-light: rgb(243, 244, 246); --env-bg-color-dark: rgb(31, 41, 55);'}
>
	<div
		class="node-border w-[400px] rounded-xl border-2 bg-white p-4 text-gray-900 shadow-xl transition-all dark:bg-gray-900 dark:text-white"
	>
		<Handle type="target" position={Position.Top} />

		<!-- Environment name inside box at the top -->
		<div
			class="mb-3 flex items-center justify-between border-b border-gray-200 pb-2 dark:border-gray-700"
		>
			<h3
				class="text-sm font-semibold"
				class:text-blue-700={data.isCurrentEnvironment}
				class:dark:text-blue-300={data.isCurrentEnvironment}
				class:text-gray-700={!data.isCurrentEnvironment}
				class:dark:text-gray-300={!data.isCurrentEnvironment}
			>
				{data.environment}
			</h3>
			{#if !data.isCurrentEnvironment && data.environmentInfo?.environmentUrl}
				<a
					href={data.environmentInfo.environmentUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
					title="Open environment in new window"
				>
					<span>Open</span>
					<ArrowUpRightFromSquareOutline class="h-3.5 w-3.5" />
				</a>
			{/if}
		</div>

		<!-- Badge-only compact style -->
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<Badge
				color="gray"
				size="small"
				class="flex items-center gap-1.5 bg-gray-100 font-mono dark:bg-gray-800"
			>
				<StatusIcon class="h-3 w-3 flex-shrink-0 {statusInfo.color}" />
				<span class="break-all text-gray-900 dark:text-gray-100" title={data.currentVersion}
					>{data.currentVersion}</span
				>
			</Badge>
			{#if versionDifference !== null && versionDifference !== 0}
				<Badge
					color={versionDifference < 0 ? 'green' : 'yellow'}
					size="small"
					class="font-semibold"
				>
					{versionDifference < 0
						? `${Math.abs(versionDifference)} ahead`
						: `${versionDifference} behind`}
				</Badge>
			{/if}
		</div>

		<Handle type="source" position={Position.Bottom} />
	</div>
</div>

<style>
	.node-border {
		border-color: var(--env-bg-color-light) !important;
	}

	:global(.dark) .node-border {
		border-color: var(--env-bg-color-dark) !important;
	}
</style>
