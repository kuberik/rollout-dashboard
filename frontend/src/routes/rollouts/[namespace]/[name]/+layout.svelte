<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import type { Rollout } from '../../../../types';
	import { Sidebar, SidebarGroup, SidebarItem, Badge } from 'flowbite-svelte';
	import { ObjectsColumnSolid, ClockArrowOutline } from 'flowbite-svelte-icons';
	import { getRolloutStatus, getDisplayVersion, hasUnblockFailedAnnotation } from '$lib/utils';
	import { invalidateAll } from '$app/navigation';

	export let data;
	$: rollout = data.rollout;
	$: loading = data.loading;
	$: error = data.error;
	let autoRefreshIntervalId: number | null = null;
	import { browser } from '$app/environment';

	onMount(() => {
		if (!browser) return;

		// Refresh layout data every 30s
		autoRefreshIntervalId = setInterval(() => {
			console.log('refreshing layout', data);
			invalidateAll(); // or just invalidateAll()
		}, 5000);
	});

	onDestroy(() => {
		if (autoRefreshIntervalId !== null) {
			clearInterval(autoRefreshIntervalId);
		}
	});
</script>

<div class="flex h-full overflow-hidden">
	<!-- Sidebar -->
	<Sidebar position="static" activeUrl={$page.url.pathname} class="w-54 flex-shrink-0">
		<SidebarGroup>
			<SidebarItem
				label="Overview"
				href={`/rollouts/${$page.params.namespace}/${$page.params.name}`}
			>
				{#snippet icon()}
					<ObjectsColumnSolid
						class="h-5 w-5 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
					/>
				{/snippet}
			</SidebarItem>
			<SidebarItem
				label="History"
				href={`/rollouts/${$page.params.namespace}/${$page.params.name}/history`}
			>
				{#snippet icon()}
					<ClockArrowOutline
						class="h-5 w-5 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
					/>
				{/snippet}
			</SidebarItem>
		</SidebarGroup>
	</Sidebar>

	<!-- Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<!-- Header -->
		{#if rollout}
			<!-- Header -->
			<div
				class="flex-shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-4">
						<h2 class="text-2xl font-bold text-gray-900 dark:text-white">
							<span class="text-gray-500 dark:text-gray-400">{rollout.metadata?.namespace} / </span>
							{rollout.metadata?.name}
						</h2>
						<div class="flex items-center gap-2">
							<Badge color={getRolloutStatus(rollout).color}>
								{getRolloutStatus(rollout).text}
							</Badge>
							<Badge color="blue">
								{#if rollout?.status?.history?.[0]}
									{getDisplayVersion(rollout.status.history[0].version)}
								{:else}
									Unknown
								{/if}
							</Badge>
							{#if rollout.spec?.wantedVersion}
								<Badge>Pinned</Badge>
							{/if}
							{#if hasUnblockFailedAnnotation(rollout)}
								<Badge color="green">Resumed</Badge>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Slot for child pages -->
		<div class="flex-1 overflow-y-auto">
			<slot {rollout} {loading} {error} />
		</div>
	</div>
</div>
