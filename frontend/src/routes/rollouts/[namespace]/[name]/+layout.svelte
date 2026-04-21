<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Tooltip, SidebarGroup, SidebarItem } from 'flowbite-svelte';
	import {
		ObjectsColumnSolid,
		ClockArrowOutline,
		LayersSolid,
		TerminalOutline,
		AngleLeftOutline,
		AngleRightOutline
	} from 'flowbite-svelte-icons';
	import { onMount, type Snippet } from 'svelte';
	import type { Rollout } from '../../../../types';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	let { children }: { children: Snippet } = $props();

	const SIDEBAR_KEY = 'sidebar-collapsed';
	let sidebarCollapsed = $state(false);
	let sidebarMounted = $state(false);

	onMount(() => {
		sidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';
		sidebarMounted = true;
	});

	$effect(() => {
		if (!sidebarMounted) return;
		localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
	});

	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);

	// Query for rollout data (to know if Environments tab should show)
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

	const hasEnvironment = $derived(
		environment?.status?.environmentInfos && environment.status.environmentInfos.length > 0
	);

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

	const isActive = (href: string) => {
		if (href === `/rollouts/${namespace}/${name}`) return activeUrl === href;
		return activeUrl.startsWith(href);
	};

	const activeClass =
		'flex items-center rounded-lg px-2 py-2 text-sm font-medium bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400';
	const nonActiveClass =
		'flex items-center rounded-lg px-2 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white';
</script>

<SvelteFlowProvider>
	<div class="flex h-full flex-col overflow-hidden md:flex-row">
		<!-- Desktop Sidebar (hidden on mobile) -->
		{#if sidebarMounted}
		<aside
			class="hidden flex-shrink-0 border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 md:flex md:flex-col {sidebarCollapsed
				? 'w-12'
				: 'w-48'} transition-[width] duration-200"
		>
			<!-- Nav items -->
			<nav class="flex flex-1 flex-col p-2">
				<SidebarGroup class="space-y-1">
					{#each navItems.filter((item) => item.show) as item}
						{@const active = isActive(item.href)}
						<SidebarItem
							id="nav-{item.label.toLowerCase()}"
							href={item.href}
							label={item.label}
							{active}
							{activeClass}
							{nonActiveClass}
							spanClass={sidebarCollapsed ? 'hidden' : 'ms-3'}
							aClass={sidebarCollapsed ? 'justify-center' : ''}
						>
							{#snippet icon()}
								<item.icon class="h-5 w-5 flex-shrink-0" />
							{/snippet}
						</SidebarItem>
						{#if sidebarCollapsed}
							<Tooltip triggeredBy="#nav-{item.label.toLowerCase()}" placement="right">
								{item.label}
							</Tooltip>
						{/if}
					{/each}
				</SidebarGroup>
			</nav>

			<!-- Collapse toggle at bottom -->
			<div class="border-t border-gray-200 p-2 dark:border-gray-700">
				<button
					class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300
						{sidebarCollapsed ? 'justify-center' : ''}"
					onclick={() => {
						sidebarCollapsed = !sidebarCollapsed;
					}}
					title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{#if sidebarCollapsed}
						<AngleRightOutline class="h-4 w-4" />
					{:else}
						<AngleLeftOutline class="h-4 w-4" />
						<span>Collapse</span>
					{/if}
				</button>
			</div>
		</aside>
		{/if}

		<!-- Content -->
		<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
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
