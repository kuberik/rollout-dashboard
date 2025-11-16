<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import type { Rollout } from '../../../../types';
	import {
		Sidebar,
		SidebarGroup,
		SidebarItem,
		Badge,
		Breadcrumb,
		BreadcrumbItem,
		Dropdown,
		DropdownItem,
		DropdownHeader,
		DropdownDivider
	} from 'flowbite-svelte';
	import { ObjectsColumnSolid, ClockArrowOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import { getRolloutStatus, getDisplayVersion, hasUnblockFailedAnnotation } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// derive params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);

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

	// Query to fetch all rollouts for the dropdown
	const allRolloutsQuery = createQuery(() => ({
		queryKey: ['rollouts', 'all'],
		queryFn: async (): Promise<{ rollouts: { items: Rollout[] } }> => {
			const res = await fetch('/api/rollouts');
			if (!res.ok) {
				throw new Error('Failed to fetch rollouts');
			}
			return await res.json();
		},
		staleTime: 30000 // Cache for 30 seconds
	}));

	// maintain existing local vars used by the template
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);

	// Get all rollouts for dropdown
	const allRollouts = $derived(allRolloutsQuery.data?.rollouts?.items || []);

	// Group rollouts by namespace
	const rolloutsByNamespace = $derived.by(() => {
		const grouped: Record<string, Rollout[]> = {};
		allRollouts.forEach((r) => {
			const ns = r.metadata?.namespace || 'default';
			if (!grouped[ns]) {
				grouped[ns] = [];
			}
			grouped[ns].push(r);
		});
		return grouped;
	});
</script>

<div class="flex h-full overflow-hidden">
	<!-- Sidebar -->
	<Sidebar position="static" {activeUrl} class="w-54 flex-shrink-0">
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
		<!-- Header -->
		{#if rollout}
			<!-- Header -->
			<div
				class="flex-shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
			>
				<!-- Breadcrumbs with Badges -->
				<div class="flex items-center justify-between">
					<Breadcrumb aria-label="Breadcrumb">
						<BreadcrumbItem href="/">Rollouts</BreadcrumbItem>
						<BreadcrumbItem>{rollout.metadata?.namespace}</BreadcrumbItem>
						<BreadcrumbItem>
							<button
								id="rollout-dropdown-trigger"
								type="button"
								class="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
							>
								{rollout.metadata?.name}
								<ChevronDownOutline class="ms-2.5 h-2.5 w-2.5" />
							</button>
							<Dropdown
								simple
								{activeUrl}
								placement="bottom-start"
								triggeredBy="#rollout-dropdown-trigger"
								class="w-64"
							>
								{#if allRolloutsQuery.isLoading}
									<DropdownItem disabled>Loading rollouts...</DropdownItem>
								{:else if allRollouts.length > 0}
									{@const sortedNamespaces = Object.entries(rolloutsByNamespace).sort(([a], [b]) =>
										a.localeCompare(b)
									)}
									{#each sortedNamespaces as [ns, rollouts], i (ns)}
										<DropdownHeader class="text-xs font-semibold uppercase">
											{ns}
										</DropdownHeader>
										{#each rollouts as r}
											<DropdownItem
												href="/rollouts/{r.metadata?.namespace}/{r.metadata?.name}"
												class={r.metadata?.name === name && r.metadata?.namespace === namespace
													? 'bg-blue-50 dark:bg-blue-900'
													: ''}
											>
												<div class="flex w-full items-center justify-between">
													<span>{r.metadata?.name}</span>
													{#if r.metadata?.name === name && r.metadata?.namespace === namespace}
														<svg
															class="h-4 w-4 text-blue-600 dark:text-blue-400"
															fill="currentColor"
															viewBox="0 0 20 20"
														>
															<path
																fill-rule="evenodd"
																d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
																clip-rule="evenodd"
															/>
														</svg>
													{/if}
												</div>
											</DropdownItem>
										{/each}
										{#if i < sortedNamespaces.length - 1}
											<DropdownDivider />
										{/if}
									{/each}
								{:else}
									<DropdownItem disabled>No rollouts found</DropdownItem>
								{/if}
							</Dropdown>
						</BreadcrumbItem>
					</Breadcrumb>
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
		{/if}

		<!-- Slot for child pages -->
		<div class="flex-1 overflow-y-auto">
			{@render children()}
		</div>
	</div>
</div>
