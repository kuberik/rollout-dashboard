<svelte:options runes={true} />

<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { Badge } from 'flowbite-svelte';
	import { ArrowUpRightFromSquareOutline } from 'flowbite-svelte-icons';
	import { getBakeStatusIcon } from '$lib/bake-status';

	interface Props {
		data: {
			environment: string;
			currentVersion: string;
			bakeStatus?: string;
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
		const diff = data.currentEnvironmentVersionIndex - data.versionIndex;
		return diff;
	});

	// Compute status info for the badge
	const statusInfo = $derived(getBakeStatusIcon(data.bakeStatus));
	const StatusIcon = $derived(statusInfo.icon);

	// Construct environments URL from base environmentUrl
	const environmentsUrl = $derived.by(() => {
		if (!data.environmentInfo?.environmentUrl) return null;
		// Append /environments to the base rollout URL
		return `${data.environmentInfo.environmentUrl}/environments`;
	});
</script>

<div
	class="relative"
	style={data.isCurrentEnvironment
		? '--env-bg-color-light: rgb(219, 234, 254); --env-bg-color-dark: rgb(30, 58, 138);'
		: '--env-bg-color-light: rgb(243, 244, 246); --env-bg-color-dark: rgb(31, 41, 55);'}
>
	<div
		class="node-border w-[320px] rounded-lg border-2 bg-white text-gray-900 shadow-lg transition-all dark:bg-gray-900 dark:text-white"
		class:ring-2={data.isCurrentEnvironment}
		class:ring-blue-400={data.isCurrentEnvironment}
		class:dark:ring-blue-600={data.isCurrentEnvironment}
	>
		<Handle type="target" position={Position.Top} />

		<!-- Status indicator bar at top -->
		<div
			class="h-1 rounded-t-md"
			class:bg-green-500={data.bakeStatus === 'Succeeded'}
			class:bg-red-500={data.bakeStatus === 'Failed'}
			class:bg-yellow-500={data.bakeStatus === 'InProgress'}
			class:bg-gray-400={!data.bakeStatus ||
				data.bakeStatus === 'None' ||
				data.bakeStatus === 'Cancelled'}
		></div>

		<div class="p-3">
			<!-- Header: Environment name and Open link -->
			<div class="mb-2.5 flex items-center justify-between">
				<h3
					class="text-xs font-medium uppercase tracking-wide"
					class:text-blue-600={data.isCurrentEnvironment}
					class:dark:text-blue-400={data.isCurrentEnvironment}
					class:text-gray-500={!data.isCurrentEnvironment}
					class:dark:text-gray-400={!data.isCurrentEnvironment}
				>
					{data.environment}
				</h3>
				{#if !data.isCurrentEnvironment && environmentsUrl}
					<a
						href={environmentsUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1 text-[10px] text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
						title="Open environment in new window"
					>
						<ArrowUpRightFromSquareOutline class="h-3 w-3" />
					</a>
				{/if}
			</div>

			<!-- Version display with status icon -->
			<div class="flex items-start gap-2">
				<!-- Status icon -->
				<div class="mt-0.5 flex-shrink-0">
					<StatusIcon class="h-4 w-4 {statusInfo.color}" />
				</div>

				<!-- Version and difference -->
				<div class="min-w-0 flex-1">
					<div class="flex items-baseline gap-2">
						<span
							class="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100"
							title={data.currentVersion}
						>
							{data.currentVersion}
						</span>
						{#if versionDifference !== null && versionDifference !== 0}
							<Badge
								color={versionDifference < 0 ? 'green' : 'yellow'}
								size="small"
								class="flex-shrink-0 whitespace-nowrap text-[10px] font-medium"
							>
								{versionDifference < 0
									? `+${Math.abs(versionDifference)}`
									: `-${versionDifference}`}
							</Badge>
						{/if}
					</div>
				</div>
			</div>
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
