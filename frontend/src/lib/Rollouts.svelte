<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../types';
	import type {
		BakeStatusFilter,
		ReadinessFilter,
		SortField,
		SortDirection,
		ViewMode
	} from '$lib/rollout-filters';
	import { Badge, Spinner, Alert, Card, Button, ButtonGroup, Dropdown, DropdownItem, Checkbox } from 'flowbite-svelte';
	import { formatTimeAgo, getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import RolloutStatsBar from '$lib/components/RolloutStatsBar.svelte';
	import {
		ClockSolid,
		SearchOutline,
		FilterSolid,
		AdjustmentsHorizontalOutline,
		ListOutline,
		GridPlusOutline,
		ChevronDownOutline,
		CloseCircleSolid,
		CheckOutline
	} from 'flowbite-svelte-icons';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getBakeStatusColor } from '$lib/bake-status';
	import {
		filterRollouts,
		sortRollouts,
		groupByNamespace as groupByNs,
		computeStats,
		getUniqueNamespaces,
		loadPreferences,
		savePreferences
	} from '$lib/rollout-filters';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: { staleTime: 30000 }
		})
	);

	const rollouts = $derived<Rollout[]>(rolloutsQuery.data?.rollouts?.items || []);
	const loading = $derived(rolloutsQuery.isLoading);
	const error = $derived(
		rolloutsQuery.isError
			? (rolloutsQuery.error as Error).message || 'Unknown error occurred'
			: null
	);

	// Load persisted preferences
	const savedPrefs = loadPreferences();

	// Filter state
	let searchQuery = $state(savedPrefs.filters?.searchQuery ?? '');
	let selectedNamespaces = $state<string[]>(savedPrefs.filters?.namespaces ?? []);
	let selectedBakeStatuses = $state<BakeStatusFilter[]>(savedPrefs.filters?.bakeStatuses ?? []);
	let selectedReadiness = $state<ReadinessFilter[]>(savedPrefs.filters?.readiness ?? []);
	let hasUpgradesOnly = $state(savedPrefs.filters?.hasUpgradesOnly ?? false);

	// Sort state
	let sortField = $state<SortField>(savedPrefs.sort?.field ?? 'lastDeployed');
	let sortDirection = $state<SortDirection>(savedPrefs.sort?.direction ?? 'desc');
	let groupByNamespace = $state(savedPrefs.sort?.groupByNamespace ?? true);

	// View mode
	let viewMode = $state<ViewMode>(savedPrefs.viewMode ?? 'list');

	// UI state
	let showFilters = $state(false);

	// Stats from unfiltered data
	const stats = $derived(computeStats(rollouts));

	// Available filter options
	const availableNamespaces = $derived(getUniqueNamespaces(rollouts));

	// Filter state object
	const currentFilters = $derived({
		searchQuery,
		namespaces: selectedNamespaces,
		bakeStatuses: selectedBakeStatuses,
		readiness: selectedReadiness,
		hasUpgradesOnly
	});

	// Check if any filters are active
	const isFiltered = $derived(
		searchQuery !== '' ||
			selectedNamespaces.length > 0 ||
			selectedBakeStatuses.length > 0 ||
			selectedReadiness.length > 0 ||
			hasUpgradesOnly
	);

	// Active filter count for badge
	const activeFilterCount = $derived(
		(selectedNamespaces.length > 0 ? 1 : 0) +
			(selectedBakeStatuses.length > 0 ? 1 : 0) +
			(selectedReadiness.length > 0 ? 1 : 0) +
			(hasUpgradesOnly ? 1 : 0)
	);

	// Pipeline: filter -> sort
	const filteredRollouts = $derived(filterRollouts(rollouts, currentFilters));
	const sortedRollouts = $derived(
		sortRollouts(filteredRollouts, {
			field: sortField,
			direction: sortDirection,
			groupByNamespace
		})
	);

	// Group or flat list
	const displayData = $derived.by(() => {
		if (groupByNamespace) {
			return groupByNs(sortedRollouts);
		}
		return { '': sortedRollouts };
	});

	// Persist preferences
	$effect(() => {
		savePreferences({
			filters: currentFilters,
			sort: { field: sortField, direction: sortDirection, groupByNamespace },
			viewMode
		});
	});

	// Sort label for display
	const sortLabel = $derived.by(() => {
		switch (sortField) {
			case 'lastDeployed':
				return sortDirection === 'desc' ? 'Newest first' : 'Oldest first';
			case 'name':
				return sortDirection === 'asc' ? 'Name A-Z' : 'Name Z-A';
			case 'upgradeCount':
				return 'Most upgrades';
			default:
				return 'Sort';
		}
	});

	function isSortActive(field: SortField, dir: SortDirection): boolean {
		return sortField === field && sortDirection === dir;
	}

	function setSort(field: SortField, dir: SortDirection) {
		sortField = field;
		sortDirection = dir;
	}

	function toggleNamespace(ns: string) {
		if (selectedNamespaces.includes(ns)) {
			selectedNamespaces = selectedNamespaces.filter((n) => n !== ns);
		} else {
			selectedNamespaces = [...selectedNamespaces, ns];
		}
	}

	function toggleBakeStatus(status: BakeStatusFilter) {
		if (selectedBakeStatuses.includes(status)) {
			selectedBakeStatuses = selectedBakeStatuses.filter((s) => s !== status);
		} else {
			selectedBakeStatuses = [...selectedBakeStatuses, status];
		}
	}

	function toggleReadiness(r: ReadinessFilter) {
		if (selectedReadiness.includes(r)) {
			selectedReadiness = selectedReadiness.filter((x) => x !== r);
		} else {
			selectedReadiness = [...selectedReadiness, r];
		}
	}

	function clearAllFilters() {
		searchQuery = '';
		selectedNamespaces = [];
		selectedBakeStatuses = [];
		selectedReadiness = [];
		hasUpgradesOnly = false;
	}

	function getCardBorderClass(deployment: Rollout): string {
		const bakeStatus = deployment.status?.history?.[0]?.bakeStatus;
		const color = getBakeStatusColor(bakeStatus);
		const borderMap: Record<string, string> = {
			green: 'border-l-green-500 dark:border-l-green-400',
			red: 'border-l-red-500 dark:border-l-red-400',
			yellow: 'border-l-yellow-500 dark:border-l-yellow-400',
			blue: 'border-l-blue-500 dark:border-l-blue-400',
			gray: 'border-l-gray-300 dark:border-l-gray-600'
		};
		return borderMap[color] || borderMap.gray;
	}

	function getGridCardBorderClass(deployment: Rollout): string {
		const bakeStatus = deployment.status?.history?.[0]?.bakeStatus;
		const color = getBakeStatusColor(bakeStatus);
		const borderMap: Record<string, string> = {
			green: 'border-t-green-500 dark:border-t-green-400',
			red: 'border-t-red-500 dark:border-t-red-400',
			yellow: 'border-t-yellow-500 dark:border-t-yellow-400',
			blue: 'border-t-blue-500 dark:border-t-blue-400',
			gray: 'border-t-gray-300 dark:border-t-gray-600'
		};
		return borderMap[color] || borderMap.gray;
	}

	const bakeStatusOptions: BakeStatusFilter[] = [
		'Succeeded',
		'Failed',
		'InProgress',
		'Deploying',
		'None'
	];
	const readinessOptions: ReadinessFilter[] = ['Ready', 'Error', 'Unknown'];
</script>

<div class="flex w-full justify-center px-3 py-6 dark:bg-gray-900 sm:px-4 sm:py-8">
	{#if loading}
		<div class="mx-auto flex h-16 w-16 items-center justify-center">
			<Spinner size="8" />
		</div>
	{:else if error}
		<Alert color="red" class="mb-4">
			{error}
		</Alert>
	{:else if rollouts.length === 0}
		<Alert color="yellow" class="mb-4">No rollouts found</Alert>
	{:else}
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
			<!-- Stats Bar -->
			<RolloutStatsBar {stats} filteredCount={filteredRollouts.length} {isFiltered} />

			<!-- Search + Controls Row -->
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<!-- Search Input -->
				<div class="relative flex-1">
					<SearchOutline
						class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
					/>
					<input
						type="search"
						placeholder="Search rollouts..."
						bind:value={searchQuery}
						class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-8 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
					/>
					{#if searchQuery}
						<button
							class="absolute right-3 top-1/2 -translate-y-1/2"
							onclick={() => (searchQuery = '')}
						>
							<CloseCircleSolid
								class="h-4 w-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
							/>
						</button>
					{/if}
				</div>

				<!-- Controls -->
				<div class="flex items-center gap-2">
					<!-- Filter Toggle -->
					<Button
						size="sm"
						color="alternative"
						onclick={() => (showFilters = !showFilters)}
					>
						<FilterSolid class="mr-1 h-3.5 w-3.5" />
						Filters
						{#if activeFilterCount > 0}
							<span
								class="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white"
							>
								{activeFilterCount}
							</span>
						{/if}
					</Button>

					<!-- Sort Dropdown -->
					<Button size="sm" color="alternative" id="sort-btn">
						<AdjustmentsHorizontalOutline class="mr-1 h-3.5 w-3.5" />
						{sortLabel}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown triggeredBy="#sort-btn" class="w-52 p-1">
						<DropdownItem
							onclick={() => setSort('lastDeployed', 'desc')}
							class="flex items-center justify-between"
						>
							Newest first
							{#if isSortActive('lastDeployed', 'desc')}
								<CheckOutline class="h-4 w-4 text-blue-600" />
							{/if}
						</DropdownItem>
						<DropdownItem
							onclick={() => setSort('lastDeployed', 'asc')}
							class="flex items-center justify-between"
						>
							Oldest first
							{#if isSortActive('lastDeployed', 'asc')}
								<CheckOutline class="h-4 w-4 text-blue-600" />
							{/if}
						</DropdownItem>
						<DropdownItem
							onclick={() => setSort('name', 'asc')}
							class="flex items-center justify-between"
						>
							Name A-Z
							{#if isSortActive('name', 'asc')}
								<CheckOutline class="h-4 w-4 text-blue-600" />
							{/if}
						</DropdownItem>
						<DropdownItem
							onclick={() => setSort('name', 'desc')}
							class="flex items-center justify-between"
						>
							Name Z-A
							{#if isSortActive('name', 'desc')}
								<CheckOutline class="h-4 w-4 text-blue-600" />
							{/if}
						</DropdownItem>
						<DropdownItem
							onclick={() => setSort('upgradeCount', 'desc')}
							class="flex items-center justify-between"
						>
							Most upgrades
							{#if isSortActive('upgradeCount', 'desc')}
								<CheckOutline class="h-4 w-4 text-blue-600" />
							{/if}
						</DropdownItem>
						<hr class="my-1 border-gray-200 dark:border-gray-600" />
						<DropdownItem class="flex items-center gap-2">
							<Checkbox
								checked={groupByNamespace}
								onchange={() => (groupByNamespace = !groupByNamespace)}
							>
								Group by namespace
							</Checkbox>
						</DropdownItem>
					</Dropdown>

					<!-- View Toggle -->
					<ButtonGroup size="sm">
						<Button
							color={viewMode === 'list' ? 'primary' : 'alternative'}
							onclick={() => (viewMode = 'list')}
							class="px-2.5"
						>
							<ListOutline class="h-4 w-4" />
						</Button>
						<Button
							color={viewMode === 'grid' ? 'primary' : 'alternative'}
							onclick={() => (viewMode = 'grid')}
							class="px-2.5"
						>
							<GridPlusOutline class="h-4 w-4" />
						</Button>
					</ButtonGroup>
				</div>
			</div>

			<!-- Filter Panel (collapsible) -->
			{#if showFilters}
				<div
					class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="flex flex-wrap gap-6">
						<!-- Namespace Filter -->
						{#if availableNamespaces.length > 1}
							<div class="flex flex-col gap-1.5">
								<span
									class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
									>Namespace</span
								>
								<div class="flex flex-wrap gap-1.5">
									{#each availableNamespaces as ns}
										<button
											class="rounded-full border px-2.5 py-1 text-xs transition-colors {selectedNamespaces.includes(
												ns
											)
												? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-300'
												: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
											onclick={() => toggleNamespace(ns)}
										>
											{ns}
										</button>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Bake Status Filter -->
						<div class="flex flex-col gap-1.5">
							<span
								class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
								>Bake Status</span
							>
							<div class="flex flex-wrap gap-1.5">
								{#each bakeStatusOptions as status}
									<button
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {selectedBakeStatuses.includes(
											status
										)
											? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-300'
											: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
										onclick={() => toggleBakeStatus(status)}
									>
										{status}
									</button>
								{/each}
							</div>
						</div>

						<!-- Readiness Filter -->
						<div class="flex flex-col gap-1.5">
							<span
								class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
								>Readiness</span
							>
							<div class="flex flex-wrap gap-1.5">
								{#each readinessOptions as r}
									<button
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {selectedReadiness.includes(
											r
										)
											? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-300'
											: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
										onclick={() => toggleReadiness(r)}
									>
										{r}
									</button>
								{/each}
							</div>
						</div>

						<!-- Has Upgrades Toggle -->
						<div class="flex flex-col gap-1.5">
							<span
								class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
								>Upgrades</span
							>
							<button
								class="rounded-full border px-2.5 py-1 text-xs transition-colors {hasUpgradesOnly
									? 'border-orange-500 bg-orange-100 text-orange-700 dark:border-orange-400 dark:bg-orange-900/40 dark:text-orange-300'
									: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								onclick={() => (hasUpgradesOnly = !hasUpgradesOnly)}
							>
								Has upgrades
							</button>
						</div>
					</div>

					{#if isFiltered}
						<div class="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
							<button
								class="text-xs text-blue-600 hover:underline dark:text-blue-400"
								onclick={clearAllFilters}
							>
								Clear all filters
							</button>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Rollout List -->
			{#if filteredRollouts.length === 0}
				<!-- Empty state when filters match nothing -->
				<div class="flex flex-col items-center justify-center py-12 text-center">
					<SearchOutline class="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
					<h3 class="text-lg font-medium text-gray-900 dark:text-white">
						No matching rollouts
					</h3>
					<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
						Try adjusting your search or filters.
					</p>
					<Button size="sm" color="alternative" class="mt-4" onclick={clearAllFilters}>
						Clear all filters
					</Button>
				</div>
			{:else}
				{#each Object.entries(displayData) as [namespace, namespaceRollouts]}
					<div class="w-full">
						<!-- Namespace Header -->
						{#if groupByNamespace && namespace}
							<div class="mb-3 flex items-center gap-2">
								<h2 class="text-xl font-bold text-gray-900 dark:text-white">
									{namespace}
								</h2>
								<Badge color="gray" class="text-xs">{namespaceRollouts.length}</Badge>
							</div>
						{/if}

						<!-- List View -->
						{#if viewMode === 'list'}
							<div class="flex flex-col gap-3">
								{#each namespaceRollouts as deployment}
									{@const upgradeCount =
										deployment.status?.releaseCandidates?.length || 0}
									{@const hasUpgrades = upgradeCount > 0}
									{@const isLatest =
										!hasUpgrades &&
										deployment.status?.availableReleases &&
										deployment.status.availableReleases.length > 0}
									{@const latestEntry = deployment.status?.history?.[0]}
									{@const versionLabel = latestEntry?.version
										? getDisplayVersion(latestEntry.version)
										: null}
									{@const bakeStatus = latestEntry?.bakeStatus}
									{@const showStatusBadges =
										hasUpgrades || isLatest || Boolean(versionLabel)}
									{@const borderClass = getCardBorderClass(deployment)}
									<a
										href="/rollouts/{deployment.metadata?.namespace}/{deployment.metadata
											?.name}"
										class="block w-full"
									>
										<Card
											class="w-full max-w-full border-l-4 p-4 sm:p-4 md:p-5 {borderClass}"
										>
											<div class="flex flex-col gap-2">
												<div
													class="flex flex-wrap items-start justify-between gap-3"
												>
													<div class="flex flex-1 items-center gap-3">
														<div
															class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
														>
															<BakeStatusIcon
																{bakeStatus}
																size="medium"
															/>
														</div>
														<div class="min-w-0 flex-1">
															<div
																class="flex flex-wrap items-center gap-2"
															>
																<h3
																	class="text-lg font-semibold text-gray-900 dark:text-white"
																>
																	{deployment.metadata?.name}
																</h3>
																{#if !groupByNamespace && deployment.metadata?.namespace}
																	<Badge
																		color="gray"
																		class="text-[10px]"
																	>
																		{deployment.metadata
																			.namespace}
																	</Badge>
																{/if}
															</div>
															{#if deployment.status?.title}
																<p
																	class="text-sm text-gray-500 dark:text-gray-400"
																>
																	{deployment.status.title}
																</p>
															{/if}
														</div>
													</div>
													<div
														class="flex flex-wrap items-center justify-end gap-2"
													>
														<Badge
															color="gray"
															border
															class="flex items-center gap-1"
														>
															<ClockSolid class="h-3 w-3" />
															{deployment.status?.history?.length
																? formatTimeAgo(
																		deployment.status
																			?.history[0].timestamp,
																		$now
																	)
																: 'Never'}
														</Badge>
													</div>
												</div>
												{#if showStatusBadges}
													<div class="flex flex-wrap items-center gap-2">
														{#if hasUpgrades}
															<Badge color="orange" size="small">
																{upgradeCount} upgrade{upgradeCount >
																1
																	? 's'
																	: ''}
															</Badge>
														{:else if isLatest}
															<Badge color="blue" size="small"
																>Latest</Badge
															>
														{/if}
														{#if versionLabel}
															<Badge color="blue" size="small">
																{versionLabel}
															</Badge>
														{/if}
													</div>
												{/if}
												{#if deployment.status?.description}
													<p
														class="text-sm text-gray-600 dark:text-gray-400"
													>
														{deployment.status.description}
													</p>
												{/if}
											</div>
										</Card>
									</a>
								{/each}
							</div>

							<!-- Grid View -->
						{:else}
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{#each namespaceRollouts as deployment}
									{@const upgradeCount =
										deployment.status?.releaseCandidates?.length || 0}
									{@const hasUpgrades = upgradeCount > 0}
									{@const latestEntry = deployment.status?.history?.[0]}
									{@const versionLabel = latestEntry?.version
										? getDisplayVersion(latestEntry.version)
										: null}
									{@const bakeStatus = latestEntry?.bakeStatus}
									{@const borderClass = getGridCardBorderClass(deployment)}
									<a
										href="/rollouts/{deployment.metadata?.namespace}/{deployment.metadata
											?.name}"
										class="block"
									>
										<Card
											class="h-full border-t-4 p-3 {borderClass}"
										>
											<div class="flex flex-col gap-2">
												<div class="flex items-center gap-2.5">
													<div
														class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
													>
														<BakeStatusIcon
															{bakeStatus}
															size="small"
														/>
													</div>
													<div class="min-w-0 flex-1">
														<h3
															class="truncate text-sm font-semibold text-gray-900 dark:text-white"
														>
															{deployment.metadata?.name}
														</h3>
														{#if !groupByNamespace && deployment.metadata?.namespace}
															<span
																class="text-[10px] text-gray-400 dark:text-gray-500"
															>
																{deployment.metadata.namespace}
															</span>
														{/if}
													</div>
												</div>
												<div
													class="flex flex-wrap items-center justify-between gap-1"
												>
													<div class="flex flex-wrap gap-1">
														{#if versionLabel}
															<Badge
																color="blue"
																class="text-[10px]"
															>
																{versionLabel}
															</Badge>
														{/if}
														{#if hasUpgrades}
															<Badge
																color="orange"
																class="text-[10px]"
															>
																{upgradeCount} upgrade{upgradeCount >
																1
																	? 's'
																	: ''}
															</Badge>
														{/if}
													</div>
													<span
														class="text-[10px] text-gray-400 dark:text-gray-500"
													>
														{deployment.status?.history?.length
															? formatTimeAgo(
																	deployment.status?.history[0]
																		.timestamp,
																	$now
																)
															: 'Never'}
													</span>
												</div>
											</div>
										</Card>
									</a>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
