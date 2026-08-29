<svelte:options runes={true} />

<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { goto } from '$app/navigation';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import {
		getDisplayVersion,
		formatTimeAgo,
		formatStatusTime,
		categorizeFailure, formatDate } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import type { Rollout } from '../../types';
	import { now } from '$lib/stores/time';

	interface Props {
		data: {
			rollout: Rollout | null;
			envName: string;
			envLabel: string;
			theme: { label: string; environmentName?: string } | null;
			href: string | null;
			stuck: StuckReason | null;
			showHandles: { source: boolean; target: boolean };
			orientation: 'LR' | 'TB';
		};
	}

	let { data }: Props = $props();

	const r = $derived(data.rollout);
	const latest = $derived(r?.status?.history?.[0]);
	const status = $derived(latest?.bakeStatus || 'None');
	const isRunning = $derived(status === 'InProgress' || status === 'Deploying');
	const themeStyle = $derived(data.theme ? getEnvironmentThemeStyle(data.theme as never) : undefined);

	const sourcePos = $derived(data.orientation === 'LR' ? Position.Right : Position.Bottom);
	const targetPos = $derived(data.orientation === 'LR' ? Position.Left : Position.Top);

	function onClick() {
		if (data.href) goto(data.href);
	}
</script>

<button
	type="button"
	onclick={onClick}
	disabled={!data.href}
	class="environment-theme-scope group relative flex w-56 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white text-left shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-white dark:border-gray-700/80 dark:bg-gray-800 dark:hover:bg-gray-700/40 dark:disabled:hover:bg-gray-800"
	style={themeStyle}
>
	{#if data.showHandles.target}
		<Handle type="target" position={targetPos} class="!h-1.5 !w-1.5 !border-none !bg-gray-400 dark:!bg-gray-500" />
	{/if}
	{#if data.showHandles.source}
		<Handle type="source" position={sourcePos} class="!h-1.5 !w-1.5 !border-none !bg-gray-400 dark:!bg-gray-500" />
	{/if}

	<!-- Themed env band header -->
	<div class="flex items-center justify-between gap-2 px-4 py-2 {data.theme ? 'environment-theme-band' : 'bg-gray-100 dark:bg-gray-700/60'}">
		<span class="truncate text-xs font-bold uppercase tracking-wider {data.theme ? 'environment-theme-text text-gray-700 dark:text-gray-200' : 'text-gray-700 dark:text-gray-300'}" title={data.envName}>{data.envLabel}</span>
		{#if r?.spec?.wantedVersion}<PinBadge version={r.spec.wantedVersion} />{/if}
	</div>

	<div class="flex flex-1 flex-col gap-3 p-4">
		{#if latest}
			<div class="flex items-center gap-3">
				<span class="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
					{#if isRunning}
						<span class="absolute inline-flex h-full w-full animate-ping rounded-full {getStatusPingClass(status)}"></span>
					{/if}
					<BakeStatusIcon bakeStatus={status} size="medium" />
				</span>
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate font-mono text-sm font-bold text-gray-900 dark:text-white" title={getDisplayVersion(latest.version)}>
						{getDisplayVersion(latest.version)}
					</span>
					{#if latest.timestamp}
						<span class="truncate font-mono text-[10px] {isRunning ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'}" title={formatDate(latest.timestamp)}>
							{formatStatusTime(status, latest.timestamp, $now)}
						</span>
					{/if}
				</div>
			</div>

			{#if status === 'Failed'}
				{@const cat = categorizeFailure(latest.bakeStatusMessage)}
				<div class="truncate text-[11px] text-gray-500 dark:text-gray-400" title={latest.bakeStatusMessage ?? ''}>
					<span class="font-medium text-gray-700 dark:text-gray-300">{cat ?? 'failed'}</span> failed
				</div>
			{:else if data.stuck}
				<StuckBadge reason={data.stuck} />
			{/if}

			{#if r?.metadata?.namespace}
				<div class="mt-auto truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">
					{r.metadata.namespace}
				</div>
			{/if}
		{:else}
			<div class="flex items-center gap-3 text-gray-400 dark:text-gray-500">
				<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
					<span class="h-3 w-3 rounded-full border border-dashed border-gray-300 dark:border-gray-600"></span>
				</span>
				<span class="font-mono text-xs">awaiting first deploy</span>
			</div>
		{/if}
	</div>
</button>
