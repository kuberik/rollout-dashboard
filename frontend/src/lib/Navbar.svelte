<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { MoonSolid, SunSolid } from 'flowbite-svelte-icons';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?raw';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?raw';
	import { theme } from '$lib/stores/theme';
	import type { Rollout } from '../types';
	import {
		Badge,
		Breadcrumb,
		BreadcrumbItem,
		Dropdown,
		DropdownItem,
		DropdownHeader,
		DropdownDivider,
		Popover
	} from 'flowbite-svelte';
	import { ChevronDownOutline, QuestionCircleOutline } from 'flowbite-svelte-icons';
	import { getRolloutStatus } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';

	let currentTheme = $state<'light' | 'dark'>('light');

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
	});

	// Check if we're on a rollout detail page
	const isRolloutPage = $derived(page.url.pathname.match(/^\/rollouts\/[^/]+\/[^/]+/) !== null);
	const namespace = $derived(page.params.namespace as string | undefined);
	const name = $derived(page.params.name as string | undefined);
	const activeUrl = $derived(page.url.pathname);

	// Query for rollout data when on rollout detail page
	const rolloutQuery = createQuery(() => ({
		queryKey: ['rollout', namespace, name],
		queryFn: async (): Promise<{ rollout: Rollout | null }> => {
			if (!namespace || !name) return { rollout: null };
			const res = await fetch(`/api/rollouts/${namespace}/${name}`);
			if (!res.ok) {
				if (res.status === 404) {
					return { rollout: null };
				}
				throw new Error('Failed to load rollout');
			}
			return await res.json();
		},
		refetchInterval: 5000,
		enabled: isRolloutPage && !!namespace && !!name
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
		staleTime: 30000,
		enabled: isRolloutPage
	}));

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
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

<nav
	class="sticky top-0 z-50 w-full border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<div class="flex w-full flex-wrap items-center justify-between px-4 py-2">
		<div class="flex min-w-0 flex-1 items-center gap-4">
			<a href="/" class="flex shrink-0 items-center space-x-3 rtl:space-x-reverse">
				<div class="flex h-8 w-8 items-center justify-center">
					<div
						class="h-full w-full [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
					>
						{@html currentTheme === 'dark' ? LogoDark : LogoLight}
					</div>
				</div>
				<span class="font-montserrat text-xl font-thin text-gray-600 dark:text-gray-400"
					>kuberik</span
				>
				<div class="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
				<div class="flex flex-col">
					<span class="text-2xl font-light dark:text-white">Rollouts</span>
				</div>
			</a>
			{#if isRolloutPage && rollout}
				<div class="flex min-w-0 flex-1">
					<Breadcrumb aria-label="Breadcrumb">
						<BreadcrumbItem>{rollout.metadata?.namespace}</BreadcrumbItem>
						<BreadcrumbItem>
							<button
								id="rollout-dropdown-trigger"
								type="button"
								class="inline-flex flex-col items-start gap-0.5 rounded-lg px-2 py-1 text-left text-sm font-medium text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
							>
								<span class="inline-flex items-center">
									{rollout.status?.title || rollout.metadata?.name}
									<ChevronDownOutline class="ms-1.5 h-3 w-3" />
								</span>
								{#if rollout.status?.description}
									<span class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">
										{rollout.status.description}
									</span>
								{/if}
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
												<div class="flex w-full flex-col gap-1">
													<div class="flex items-center justify-between">
														<span>{r.status?.title || r.metadata?.name}</span>
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
													{#if r.status?.title && r.metadata?.name}
														<p class="text-xs text-gray-500 dark:text-gray-400">
															{r.metadata.namespace}/{r.metadata.name}
														</p>
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
				</div>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if isRolloutPage && rollout}
				{@const status = getRolloutStatus(rollout)}
				{@const readyCondition = rollout.status?.conditions?.find((c) => c.type === 'Ready')}
				{@const errorMessage =
					status.color === 'red' && readyCondition?.message ? readyCondition.message : null}
				<Badge
					id="rollout-status-badge"
					color={status.color}
					size="small"
					class={errorMessage ? 'cursor-help' : ''}
				>
					{status.text}
					{#if errorMessage}
						<QuestionCircleOutline class="ml-1 h-3 w-3" />
					{/if}
				</Badge>
				{#if errorMessage}
					<Popover triggeredBy="#rollout-status-badge" class="max-w-sm text-sm" trigger="hover">
						<div class="p-3">
							<p class="text-sm text-gray-700 dark:text-gray-300">{errorMessage}</p>
						</div>
					</Popover>
				{/if}
			{/if}
			<button
				class="rounded-lg bg-gray-100 p-2 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
				onclick={() => theme.toggle()}
				aria-label="Toggle dark mode"
			>
				{#if currentTheme === 'dark'}
					<SunSolid class="h-5 w-5" />
				{:else}
					<MoonSolid class="h-5 w-5" />
				{/if}
			</button>
		</div>
	</div>
</nav>
