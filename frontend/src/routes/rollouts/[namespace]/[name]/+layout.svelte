<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import {
		ObjectsColumnSolid,
		ClockArrowOutline,
		LayersSolid,
		TerminalOutline
	} from 'flowbite-svelte-icons';
	import { type Snippet } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	let { children }: { children: Snippet } = $props();

	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);

	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			options: {
				refetchInterval: 5000
			}
		})
	);

	const environment = $derived(rolloutQuery.data?.environment);

	const hasEnvironment = $derived(
		environment?.status?.environmentInfos && environment.status.environmentInfos.length > 0
	);

	const tabs = $derived([
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
</script>

<SvelteFlowProvider>
	<div class="flex h-full flex-col overflow-hidden">
		<!-- Horizontal tabs: replaces the rollout sub-sidebar so the page
		     no longer has two stacked sidebars. -->
		<nav
			class="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
			aria-label="Rollout sections"
		>
			<div class="no-scrollbar flex items-stretch gap-0 overflow-x-auto px-2 sm:px-4">
				{#each tabs.filter((t) => t.show) as t (t.href)}
					{@const active = isActive(t.href)}
					<a
						href={t.href}
						aria-current={active ? 'page' : undefined}
						class="group inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors
							{active
								? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
								: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
					>
						<t.icon class="h-4 w-4 shrink-0" />
						<span>{t.label}</span>
					</a>
				{/each}
			</div>
		</nav>

		<!-- Content -->
		<div class="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
			{@render children()}
		</div>
	</div>
</SvelteFlowProvider>
