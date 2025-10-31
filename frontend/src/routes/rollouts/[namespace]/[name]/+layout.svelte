<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import type { Rollout } from '../../../../types';
	import { Sidebar, SidebarGroup, SidebarItem, Badge } from 'flowbite-svelte';
	import { ObjectsColumnSolid, ClockArrowOutline } from 'flowbite-svelte-icons';
	import { getRolloutStatus, getDisplayVersion, hasUnblockFailedAnnotation } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// derive params (runes)
	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	// TanStack Query v6 - use thunk for reactivity, no stores
	const rolloutQuery = createQuery(() => ({
		queryKey: ['rollout', namespace, name],
		queryFn: async (): Promise<{ rollout: Rollout | null }> => {
			const res = await fetch(`/api/rollouts/${namespace}/${name}`);
			if (!res.ok) {
				if (res.status === 404) {
					return { rollout: null };
				}
				throw new Error('Failed to load rollout');
			}
			return await res.json();
		},
		refetchInterval: 5000
	}));

	// maintain existing local vars used by the template
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);
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
			{@render children()}
		</div>
	</div>
</div>
