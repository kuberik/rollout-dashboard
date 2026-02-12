<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Sidebar, SidebarGroup, SidebarItem } from 'flowbite-svelte';
	import {
		ObjectsColumnSolid,
		ClockArrowOutline,
		LayersSolid,
		TerminalOutline
	} from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import type { Rollout } from '../../../../types';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	let { children }: { children: Snippet } = $props();

	// derive params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);

	// Query for rollout data
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			options: {
				refetchInterval: 5000
			}
		})
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const environment = $derived(rolloutQuery.data?.environment);

	// Check if rollout has environment specified
	const hasEnvironment = $derived(
		environment?.status?.environmentInfos && environment.status.environmentInfos.length > 0
	);

	// Navigation items for reuse
	const navItems = $derived([
		{
			label: 'Overview',
			href: `/rollouts/${namespace}/${name}`,
			icon: ObjectsColumnSolid,
			show: true
		},
		{
			label: 'History',
			href: `/rollouts/${namespace}/${name}/history`,
			icon: ClockArrowOutline,
			show: true
		},
		{
			label: 'Environments',
			href: `/rollouts/${namespace}/${name}/environments`,
			icon: LayersSolid,
			show: hasEnvironment
		},
		{
			label: 'Logs',
			href: `/rollouts/${namespace}/${name}/logs`,
			icon: TerminalOutline,
			show: true
		}
	]);

	// Check if a nav item is active
	const isActive = (href: string) => {
		// Exact match for Overview, prefix match for others
		if (href === `/rollouts/${namespace}/${name}`) {
			return activeUrl === href;
		}
		return activeUrl.startsWith(href);
	};
</script>

<SvelteFlowProvider>
	<div class="flex h-full flex-col overflow-hidden md:flex-row">
		<!-- Desktop Sidebar (hidden on mobile) -->
		<Sidebar
			position="static"
			{activeUrl}
			class="hidden w-54 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 md:block"
		>
			<SidebarGroup>
				{#each navItems.filter((item) => item.show) as item}
					<SidebarItem label={item.label} href={item.href}>
						{#snippet icon()}
							<item.icon
								class="h-5 w-5 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
							/>
						{/snippet}
					</SidebarItem>
				{/each}
			</SidebarGroup>
		</Sidebar>

		<!-- Content -->
		<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
			<!-- Slot for child pages -->
			<div class="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
				{@render children()}
			</div>
		</div>

		<!-- Mobile Bottom Navigation (hidden on desktop) -->
		<nav
			class="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 md:hidden"
		>
			<div class="flex h-16 items-center justify-around">
				{#each navItems.filter((item) => item.show) as item}
					<a
						href={item.href}
						class="flex flex-1 flex-col items-center justify-center gap-1 py-2 {isActive(item.href)
							? 'text-primary-600 dark:text-primary-400'
							: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
					>
						<item.icon class="h-5 w-5" />
						<span class="text-xs">{item.label}</span>
					</a>
				{/each}
			</div>
		</nav>
	</div>
</SvelteFlowProvider>
