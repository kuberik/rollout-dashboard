<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Sidebar, SidebarGroup, SidebarItem } from 'flowbite-svelte';
	import { ObjectsColumnSolid, ClockArrowOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import type { Rollout } from '../../../../types';
	import { createQuery } from '@tanstack/svelte-query';

	let { children }: { children: Snippet } = $props();

	// derive params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);

	// Query for rollout data
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

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
</script>

<div class="flex h-full overflow-hidden">
	<!-- Sidebar -->
	<Sidebar
		position="static"
		{activeUrl}
		class="w-54 flex-shrink-0 border-r border-gray-200 dark:border-gray-700"
	>
		<SidebarGroup>
			<SidebarItem label="Overview" href={`/rollouts/${namespace}/${name}`}>
				{#snippet icon()}
					<ObjectsColumnSolid
						class="h-5 w-5 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
					/>
				{/snippet}
			</SidebarItem>
			<SidebarItem label="History" href={`/rollouts/${namespace}/${name}/history`}>
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
		<!-- Slot for child pages -->
		<div class="flex-1 overflow-y-auto">
			{@render children()}
		</div>
	</div>
</div>
