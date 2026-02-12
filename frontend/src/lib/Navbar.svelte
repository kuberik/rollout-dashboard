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
		Popover
	} from 'flowbite-svelte';
	import {
		ChevronDownOutline,
		ChevronRightOutline,
		QuestionCircleOutline,
		CheckOutline
	} from 'flowbite-svelte-icons';
	import { getRolloutStatus } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, rolloutQueryOptions } from '$lib/api/rollouts';

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
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace: namespace || '',
			name: name || '',
			options: {
				refetchInterval: 5000,
				enabled: isRolloutPage && !!namespace && !!name
			}
		})
	);

	// Query to fetch all rollouts for the dropdown
	const allRolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: 30000,
				enabled: isRolloutPage
			}
		})
	);

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

	// Get sorted list of namespaces
	const sortedNamespaces = $derived.by(() => {
		return Object.keys(rolloutsByNamespace).sort((a, b) => a.localeCompare(b));
	});

	// Get rollouts in current namespace
	const currentNamespaceRollouts = $derived.by(() => {
		if (!namespace) return [];
		return rolloutsByNamespace[namespace] || [];
	});
</script>

<nav
	class="sticky top-0 z-50 w-full border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<div class="flex w-full flex-wrap items-center justify-between px-2 py-2 sm:px-4">
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
			<a href="/" class="flex shrink-0 items-center space-x-2 sm:space-x-3 rtl:space-x-reverse">
				<div class="flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">
					<div
						class="h-full w-full [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
					>
						{@html currentTheme === 'dark' ? LogoDark : LogoLight}
					</div>
				</div>
				<span class="hidden font-montserrat text-xl font-thin text-gray-600 dark:text-gray-400 sm:inline"
					>kuberik</span
				>
				<div class="hidden h-6 w-px bg-gray-300 dark:bg-gray-600 sm:block"></div>
				<div class="flex flex-col">
					<span class="text-xl font-light dark:text-white sm:text-2xl">Rollouts</span>
				</div>
			</a>
			{#if isRolloutPage && rollout}
				<!-- Mobile: Show compact rollout name -->
				<div class="flex min-w-0 flex-1 items-center gap-2 md:hidden">
					<div class="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
					<span class="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
						{rollout.metadata?.name}
					</span>
				</div>
				<!-- Desktop: Show full breadcrumb -->
				<div class="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
					<Breadcrumb aria-label="Breadcrumb">
						<BreadcrumbItem>
							<div class="flex items-center gap-1.5">
								<div class="flex flex-col items-start">
									<span class="text-sm text-gray-900 dark:text-white">
										{rollout.metadata?.namespace}
									</span>
									<span
										class="ml-2 text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500"
									>
										namespace
									</span>
								</div>
								<div class="flex flex-col">
									<button
										id="namespace-dropdown-trigger"
										type="button"
										class="rounded-lg p-1 text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
										aria-label="Select namespace"
									>
										<ChevronDownOutline class="h-3 w-3" />
									</button>
									<Dropdown
										simple
										{activeUrl}
										placement="bottom"
										triggeredBy="#namespace-dropdown-trigger"
										class="w-64"
									>
										{#if allRolloutsQuery.isLoading}
											<DropdownItem disabled>Loading namespaces...</DropdownItem>
										{:else if sortedNamespaces.length > 0}
											{#each sortedNamespaces as ns}
												{@const rollouts = rolloutsByNamespace[ns] || []}
												{@const namespaceTriggerId = `namespace-rollout-trigger-${ns.replace(/[^a-zA-Z0-9]/g, '-')}`}
												{#if rollouts.length > 0}
													<DropdownItem
														id={namespaceTriggerId}
														role="button"
														liClass="relative"
														class="flex w-full items-center justify-between text-sm text-gray-700 dark:text-gray-200"
														onclick={(e: MouseEvent) => e.preventDefault()}
													>
														<span class="flex-1 text-left">{ns}</span>
														<ChevronRightOutline
															class="ml-2 h-4 w-4 text-gray-500 dark:text-gray-400"
														/>
													</DropdownItem>
													<Dropdown
														simple
														placement="right-start"
														triggeredBy={`#${namespaceTriggerId}`}
														class="w-64"
													>
														{#each rollouts as r}
															<DropdownItem
																href="/rollouts/{r.metadata?.namespace}/{r.metadata?.name}"
																class={r.metadata?.name === name &&
																r.metadata?.namespace === namespace
																	? 'bg-blue-50 dark:bg-blue-900'
																	: ''}
															>
																<div
																	class="flex items-center justify-between gap-2 whitespace-nowrap"
																>
																	<div class="flex flex-col leading-tight">
																		<span class="text-xs text-gray-900 dark:text-gray-100">
																			{r.metadata?.name}
																		</span>
																		{#if r.status?.title}
																			<span class="text-[11px] text-gray-500 dark:text-gray-400">
																				{r.status.title}
																			</span>
																		{/if}
																	</div>
																	{#if r.metadata?.name === name && r.metadata?.namespace === namespace}
																		<CheckOutline
																			class="h-4 w-4 text-blue-600 dark:text-blue-400"
																		/>
																	{/if}
																</div>
															</DropdownItem>
														{/each}
													</Dropdown>
												{/if}
											{/each}
										{:else}
											<DropdownItem disabled>No namespaces found</DropdownItem>
										{/if}
									</Dropdown>
								</div>
							</div>
						</BreadcrumbItem>
						<BreadcrumbItem>
							<div class="flex items-center gap-1.5">
								<div class="flex flex-col items-start">
									<span class="text-sm text-gray-900 dark:text-white">
										{rollout.metadata?.name}
									</span>
									<span
										class="ml-2 text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500"
									>
										name
									</span>
								</div>
								<div class="flex flex-col">
									<button
										id="rollout-dropdown-trigger"
										type="button"
										class="rounded-lg p-1 text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
										aria-label="Select rollout"
									>
										<ChevronDownOutline class="h-3 w-3" />
									</button>
									<Dropdown
										simple
										placement="bottom"
										triggeredBy="#rollout-dropdown-trigger"
										class="w-64"
									>
										{#if allRolloutsQuery.isLoading}
											<DropdownItem disabled>Loading rollouts...</DropdownItem>
										{:else if currentNamespaceRollouts.length > 0}
											{#each currentNamespaceRollouts as r}
												<DropdownItem
													href="/rollouts/{r.metadata?.namespace}/{r.metadata?.name}"
													class={r.metadata?.name === name && r.metadata?.namespace === namespace
														? 'bg-blue-50 dark:bg-blue-900'
														: ''}
												>
													<div class="flex items-center justify-between gap-2 whitespace-nowrap">
														<div class="flex flex-col leading-tight">
															<span class="text-xs text-gray-900 dark:text-gray-100">
																{r.metadata?.name}
															</span>
															{#if r.status?.title}
																<span class="text-[11px] text-gray-500 dark:text-gray-400">
																	{r.status.title}
																</span>
															{/if}
														</div>
														{#if r.metadata?.name === name && r.metadata?.namespace === namespace}
															<CheckOutline class="h-4 w-4 text-blue-600 dark:text-blue-400" />
														{/if}
													</div>
												</DropdownItem>
											{/each}
										{:else}
											<DropdownItem disabled>No rollouts found</DropdownItem>
										{/if}
									</Dropdown>
								</div>
							</div>
						</BreadcrumbItem>
					</Breadcrumb>
				</div>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1 sm:gap-1.5">
			{#if isRolloutPage && rollout}
				{@const status = getRolloutStatus(rollout)}
				{@const readyCondition = rollout.status?.conditions?.find((c) => c.type === 'Ready')}
				{@const errorMessage =
					status.color === 'red' && readyCondition?.message ? readyCondition.message : null}
				<Badge
					id="rollout-status-badge"
					color={status.color}
					size="small"
					class={`${errorMessage ? 'cursor-help' : ''} mr-2`}
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
			{#if import.meta.env.VITE_APP_VERSION}
				<span class="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
					{import.meta.env.VITE_APP_VERSION}
				</span>
			{/if}
			<button
				class="rounded-lg bg-gray-100 p-1.5 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 sm:p-2"
				onclick={() => theme.toggle()}
				aria-label="Toggle dark mode"
			>
				{#if currentTheme === 'dark'}
					<SunSolid class="h-4 w-4 sm:h-5 sm:w-5" />
				{:else}
					<MoonSolid class="h-4 w-4 sm:h-5 sm:w-5" />
				{/if}
			</button>
		</div>
	</div>
</nav>
