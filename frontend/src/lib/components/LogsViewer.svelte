<svelte:options runes={true} />

<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import {
		Button,
		Spinner,
		Badge,
		Toggle,
		Dropdown,
		DropdownItem,
		Checkbox
	} from 'flowbite-svelte';
	import { CloseOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import { createVirtualizer, notUndefined } from '@tanstack/svelte-virtual';
	import iwanthue from 'iwanthue';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import type { LogLine, PodInfo } from '$lib/api/logs';
	import { logsStreamQueryOptions } from '$lib/api/logs';

	interface Props {
		namespace: string;
		name: string;
		filterType?: 'pod' | 'test' | '';
	}

	const { namespace, name, filterType = '' }: Props = $props();

	let selectedPod = $state<string | null>(null);
	let searchQuery = $state('');

	// Auto-scroll state
	let autoScroll = $state(true);
	let virtualListEl = $state<HTMLElement | null>(null);
	let isUserScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
	let isAutoScrolling = $state(false);

	// Filter state - using Sets for multi-select
	let selectedPods = $state<Set<string>>(new Set());
	let selectedContainers = $state<Set<string>>(new Set());
	let selectedLogLevels = $state<Set<'error' | 'warn' | 'info' | 'debug'>>(new Set());

	// Column visibility state
	type LogColumn = 'timestamp' | 'pod' | 'container' | 'message';
	let visibleColumns = $state<Set<LogColumn>>(
		new Set(['timestamp', 'pod', 'container', 'message'])
	);
	const allColumns: { value: LogColumn; label: string }[] = [
		{ value: 'timestamp', label: 'Timestamp' },
		{ value: 'pod', label: 'Pod' },
		{ value: 'container', label: 'Container' },
		{ value: 'message', label: 'Message' }
	];
	const hiddenColumnCount = $derived(allColumns.length - visibleColumns.size);

	// Dropdown trigger IDs
	const podsDropdownId = 'pods-filter-dropdown';
	const containersDropdownId = 'containers-filter-dropdown';
	const logLevelsDropdownId = 'log-levels-filter-dropdown';
	const columnsDropdownId = 'columns-dropdown';

	let discoveredPods = $state<PodInfo[]>([]);
	const discoveredPodNames = new Set<string>();

	function addDiscoveredPod(pod: PodInfo) {
		if (!discoveredPodNames.has(pod.name)) {
			discoveredPodNames.add(pod.name);
			discoveredPods.push(pod);
		}
	}

	// Handle pods updates from the stream
	function handlePodsUpdate(newPods: PodInfo[]) {
		newPods.forEach(addDiscoveredPod);
	}

	// Dynamic discovery from logs
	$effect(() => {
		logs.forEach((log) => {
			if (!discoveredPodNames.has(log.pod)) {
				addDiscoveredPod({
					name: log.pod,
					namespace,
					type: log.type || (log.pod.includes('test') ? 'test' : 'pod')
				});
			}
		});
	});

	// Get query client for resetting query state
	const queryClient = useQueryClient();

	// Create streaming query
	const logsQueryOptions = $derived(
		logsStreamQueryOptions({
			namespace,
			name,
			filterType,
			onPodsUpdate: handlePodsUpdate
		})
	);
	const logsQuery = createQuery(() => logsQueryOptions);

	// Reset logs state when component mounts (navigating to logs page)
	onMount(() => {
		// Simply reset the query data to empty array for a clean slate
		queryClient.setQueryData(logsQueryOptions.queryKey, []);
	});

	// Derived state from query
	const logs = $derived(logsQuery.data || []);
	const isLoading = $derived(logsQuery.isPending || logsQuery.isFetching);
	const error = $derived(
		logsQuery.isError ? (logsQuery.error as Error)?.message || 'Unknown error' : null
	);

	// Detect log level from log line
	function getLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' | null {
		const upperLine = line.toUpperCase();
		if (
			upperLine.includes('ERROR') ||
			upperLine.includes('FATAL') ||
			upperLine.includes('CRITICAL')
		) {
			return 'error';
		}
		if (upperLine.includes('WARN') || upperLine.includes('WARNING')) {
			return 'warn';
		}
		if (upperLine.includes('DEBUG') || upperLine.includes('TRACE')) {
			return 'debug';
		}
		if (upperLine.includes('INFO')) {
			return 'info';
		}
		return null;
	}

	function getLogLevelColor(level: 'error' | 'warn' | 'info' | 'debug' | null): string {
		switch (level) {
			case 'error':
				return 'text-red-400';
			case 'warn':
				return 'text-yellow-400';
			case 'info':
				return 'text-blue-400';
			case 'debug':
				return 'text-gray-400';
			default:
				return 'text-gray-300';
		}
	}

	// Track podcast and their assigned colors
	const podColors = new Map<string, string>();

	// Generate a large stable palette once
	const palette = iwanthue(50, {
		seed: 'kuberik-rollout-dashboard-v1',
		colorSpace: 'sensible'
	});

	function getPodColor(podName: string): string {
		if (!podColors.has(podName)) {
			// Use the index in discoveredPods to assign a color
			const index = discoveredPods.findIndex((p) => p.name === podName);
			if (index !== -1) {
				podColors.set(podName, palette[index % palette.length]);
			} else {
				// Fallback if not yet discovered (rare)
				return 'var(--gray-500)';
			}
		}
		return podColors.get(podName)!;
	}

	// Get unique containers for filtering
	const uniqueContainers = $derived.by(() => {
		const containerSet = new Set<string>();
		logs.forEach((log) => {
			containerSet.add(log.container);
		});
		return Array.from(containerSet).sort();
	});

	// Filter logs by selected pods, containers, log levels, and search query
	const filteredLogs = $derived.by(() => {
		let result = logs;

		// Filter by pods (multi-select)
		if (selectedPods.size > 0) {
			result = result.filter((log) => selectedPods.has(log.pod));
		}

		// Filter by containers (multi-select)
		if (selectedContainers.size > 0) {
			result = result.filter((log) => selectedContainers.has(log.container));
		}

		// Filter by log levels (multi-select)
		if (selectedLogLevels.size > 0) {
			result = result.filter((log) => {
				const level = getLogLevel(log.line);
				return level !== null && selectedLogLevels.has(level);
			});
		}

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(log) =>
					log.line.toLowerCase().includes(query) ||
					log.pod.toLowerCase().includes(query) ||
					log.container.toLowerCase().includes(query)
			);
		}

		return result;
	});

	// Group pods by name for filtering
	const uniquePods = $derived.by(() => {
		let result = discoveredPods;

		// Filter based on the requested tab type
		if (filterType) {
			result = result.filter((p) => {
				if (p.type === filterType) return true;
				// Fallback heuristics
				if (filterType === 'pod' && !p.type) return true;
				if (filterType === 'test' && (p.name.includes('test') || p.type === 'test')) return true;
				return false;
			});
		}

		return [...result].sort((a, b) => a.name.localeCompare(b.name));
	});

	// Highlight search matches in log lines
	function highlightSearch(text: string, query: string): string {
		if (!query.trim()) return text;
		const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return text.replace(regex, '<mark class="bg-yellow-300 dark:bg-yellow-600">$1</mark>');
	}

	// Flatten for virtual list - formatted timestamp comes from web worker
	const allLogLines = $derived.by(() => {
		// Optimization: Avoid re-mapping if unnecessary, but standard map is usually fast enough for 2k-10k items
		return filteredLogs.map((log, index) => ({
			line: log.line,
			pod: log.pod,
			container: log.container,
			type: log.type,
			timestamp: log.timestamp || Date.now(),
			formattedTimestamp: log.formattedTimestamp || '', // Always provided by worker
			index
		}));
	});

	// Fixed row height: with no text wrapping, every row is the same height
	// py-1 (8px) + line-height ~20px + border 1px = ~29px. Use 30 as a safe constant.
	const ROW_HEIGHT = 30;

	// Track scroll position for restoration
	let savedScrollTop = $state(0);

	// Setup Virtualizer - only recreates when scroll element changes
	// NOT when count changes - this preserves cache and scroll position
	let virtualizer = $derived(
		createVirtualizer<HTMLElement, HTMLDivElement>({
			count: 0, // Initial count, updated via effect
			getScrollElement: virtualListEl ? () => virtualListEl : () => null,
			estimateSize: () => ROW_HEIGHT,
			overscan: 40
		})
	);

	// Update count separately to avoid recreating virtualizer
	$effect(() => {
		const count = allLogLines.length;
		const currentScrollTop = virtualListEl?.scrollTop ?? 0;

		// Save scroll position before update
		if (!autoScroll && currentScrollTop > 0) {
			savedScrollTop = currentScrollTop;
		}

		// Update virtualizer count
		$virtualizer.setOptions({ count });

		// Restore scroll position after update (only when not auto-scrolling)
		if (!autoScroll && savedScrollTop > 0 && virtualListEl) {
			tick().then(() => {
				if (virtualListEl && !autoScroll) {
					virtualListEl.scrollTop = savedScrollTop;
				}
			});
		}
	});

	// Use $state + $effect for virtualItems to properly track store value changes
	import type { VirtualItem } from '@tanstack/svelte-virtual';
	let virtualItems = $state<VirtualItem[]>([]);

	$effect(() => {
		// 1. Sync Data: Track count explicitly
		const count = allLogLines.length;
		const _ = virtualListEl; // Track element

		// Guarded update to options to prevent loops, but ensure sync
		if (
			untrack(() => $virtualizer.options.count) !== count ||
			untrack(() => $virtualizer.options.getScrollElement)() !== virtualListEl
		) {
			untrack(() => $virtualizer).setOptions({
				count,
				getScrollElement: () => virtualListEl
			});
		}

		// 2. Sync View: Subscribe to virtualizer updates (scroll/resize)
		// This runs when $virtualizer emits OR when above dependencies change
		virtualItems = $virtualizer.getVirtualItems();
	});

	// Calculate before/after padding for natural document flow scrolling
	let virtualListBefore = $derived(
		virtualItems.length > 0
			? notUndefined(virtualItems[0]).start - ($virtualizer.options.scrollMargin ?? 0)
			: 0
	);
	let virtualListAfter = $derived(
		virtualItems.length > 0
			? $virtualizer.getTotalSize() - notUndefined(virtualItems[virtualItems.length - 1]).end
			: 0
	);

	// Scroll to bottom
	function scrollToBottom() {
		if (!virtualListEl || allLogLines.length === 0) return;

		isAutoScrolling = true;
		// Use virtualizer's scroll method
		$virtualizer.scrollToIndex(allLogLines.length - 1, { align: 'end' });

		setTimeout(() => {
			isAutoScrolling = false;
		}, 100);
	}

	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = $state(0);
	let previousLastTimestamp = $state<number | null>(null);

	// Handle auto-scroll
	$effect(() => {
		const currentCount = allLogLines.length;
		const lastLog = allLogLines[currentCount - 1];
		const lastTimestamp = lastLog?.timestamp || null;

		const logsChanged = currentCount > previousLogCount || lastTimestamp !== previousLastTimestamp;

		if (autoScroll && logsChanged && !isUserScrolling && !isAutoScrolling) {
			// Use tick to ensure DOM updates first
			tick().then(() => {
				scrollToBottom();
			});
		}

		previousLogCount = currentCount;
		previousLastTimestamp = lastTimestamp;
	});

	// Handle Scroll Events for Auto-scroll toggle
	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;
		if (!target || isAutoScrolling) return;

		const { scrollTop, scrollHeight, clientHeight } = target;
		const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

		// If user scrolled away from bottom, disable auto-scroll
		if (!isNearBottom && autoScroll) {
			autoScroll = false;
		}

		// If user scrolls back to bottom, re-enable auto-scroll
		if (isNearBottom && !autoScroll) {
			autoScroll = true;
		}

		// Mark that user is scrolling
		isUserScrolling = true;
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
		scrollTimeout = setTimeout(() => {
			isUserScrolling = false;
		}, 150);
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
	});
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<!-- Header with controls -->
	<div class="mb-3 flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 pb-3 dark:border-gray-700 sm:mb-4 sm:gap-3">
		<!-- Status indicators -->
		<div class="flex items-center gap-2">
			{#if isLoading}
				<Spinner size="4" color="blue" />
				<span class="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
			{/if}
			{#if error}
				<Badge color="red" class="text-xs">Error loading logs</Badge>
			{/if}
		</div>
		<!-- Controls row -->
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<!-- Auto-scroll toggle -->
			<div class="flex items-center gap-2">
				<Toggle bind:checked={autoScroll} />
				<span class="text-xs text-gray-700 dark:text-gray-300 sm:text-sm">Follow</span>
			</div>
			<!-- Filter dropdowns -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Pod filter dropdown -->
				<div class="relative">
					<Button size="xs" color="light" id={podsDropdownId} class="text-xs">
						Pods
						{#if selectedPods.size > 0}
							<Badge color="blue" class="ml-1 text-xs">{selectedPods.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${podsDropdownId}`}
						class="max-h-96 w-64 overflow-y-auto"
					>
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (selectedPods.size === uniquePods.length) {
									selectedPods.clear();
								} else {
									uniquePods.forEach((pod) => selectedPods.add(pod.name));
								}
								selectedPods = new Set(selectedPods);
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={selectedPods.size === uniquePods.length && uniquePods.length > 0}
								/>
								<span>Select All</span>
							</label>
						</DropdownItem>
						{#each uniquePods as pod}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedPods.has(pod.name)) {
										selectedPods.delete(pod.name);
									} else {
										selectedPods.add(pod.name);
									}
									selectedPods = new Set(selectedPods);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={selectedPods.has(pod.name)} />
									<span>{pod.name}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
				<!-- Container filter dropdown -->
				{#if uniqueContainers.length > 0}
					<div class="relative">
						<Button size="xs" color="light" id={containersDropdownId} class="text-xs">
							<span class="hidden sm:inline">Containers</span>
							<span class="sm:hidden">Cont.</span>
							{#if selectedContainers.size > 0}
								<Badge color="blue" class="ml-1 text-xs">{selectedContainers.size}</Badge>
							{/if}
							<ChevronDownOutline class="ml-1 h-3 w-3" />
						</Button>
						<Dropdown
							simple
							placement="bottom-start"
							triggeredBy={`#${containersDropdownId}`}
							class="max-h-96 w-48 overflow-y-auto"
						>
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedContainers.size === uniqueContainers.length) {
										selectedContainers.clear();
									} else {
										uniqueContainers.forEach((container) => selectedContainers.add(container));
									}
									selectedContainers = new Set(selectedContainers);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox
										checked={selectedContainers.size === uniqueContainers.length &&
											uniqueContainers.length > 0}
									/>
									<span>Select All</span>
								</label>
							</DropdownItem>
							{#each uniqueContainers as container}
								<DropdownItem
									onclick={(e) => {
										e.preventDefault();
										if (selectedContainers.has(container)) {
											selectedContainers.delete(container);
										} else {
											selectedContainers.add(container);
										}
										selectedContainers = new Set(selectedContainers);
									}}
								>
									<label class="flex cursor-pointer items-center gap-2">
										<Checkbox checked={selectedContainers.has(container)} />
										<span>{container}</span>
									</label>
								</DropdownItem>
							{/each}
						</Dropdown>
					</div>
				{/if}
				<!-- Log level filter dropdown -->
				<div class="relative">
					<Button size="xs" color="light" id={logLevelsDropdownId} class="text-xs">
						<span class="hidden sm:inline">Log Levels</span>
						<span class="sm:hidden">Level</span>
						{#if selectedLogLevels.size > 0}
							<Badge color="blue" class="ml-1 text-xs">{selectedLogLevels.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${logLevelsDropdownId}`}
						class="w-48"
					>
						{@const logLevels: Array<{ value: 'error' | 'warn' | 'info' | 'debug'; label: string }> = [
							{ value: 'error', label: 'Error' },
							{ value: 'warn', label: 'Warning' },
							{ value: 'info', label: 'Info' },
							{ value: 'debug', label: 'Debug' }
						]}
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (selectedLogLevels.size === logLevels.length) {
									selectedLogLevels.clear();
								} else {
									logLevels.forEach((level) => selectedLogLevels.add(level.value));
								}
								selectedLogLevels = new Set(selectedLogLevels);
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={selectedLogLevels.size === logLevels.length && logLevels.length > 0}
								/>
								<span>Select All</span>
							</label>
						</DropdownItem>
						{#each logLevels as level}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedLogLevels.has(level.value)) {
										selectedLogLevels.delete(level.value);
									} else {
										selectedLogLevels.add(level.value);
									}
									selectedLogLevels = new Set(selectedLogLevels);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={selectedLogLevels.has(level.value)} />
									<span>{level.label}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
				<!-- Columns visibility dropdown -->
				<div class="relative">
					<Button size="xs" color="light" id={columnsDropdownId} class="text-xs">
						<span class="hidden sm:inline">Columns</span>
						<span class="sm:hidden">Cols</span>
						{#if hiddenColumnCount > 0}
							<Badge color="blue" class="ml-1 text-xs">{hiddenColumnCount}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${columnsDropdownId}`}
						class="w-48"
					>
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (visibleColumns.size === allColumns.length) {
									// Keep at least message visible
									visibleColumns = new Set(['message']);
								} else {
									visibleColumns = new Set(allColumns.map((c) => c.value));
								}
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={visibleColumns.size === allColumns.length}
								/>
								<span>Show All</span>
							</label>
						</DropdownItem>
						{#each allColumns as col}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (visibleColumns.has(col.value)) {
										// Don't allow hiding all columns
										if (visibleColumns.size > 1) {
											visibleColumns.delete(col.value);
										}
									} else {
										visibleColumns.add(col.value);
									}
									visibleColumns = new Set(visibleColumns);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={visibleColumns.has(col.value)} />
									<span>{col.label}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
			</div>
		</div>
		<!-- Search bar -->
		<div class="flex items-center gap-2">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search logs..."
				class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
			/>
			{#if searchQuery}
				<Button size="xs" color="light" onclick={() => (searchQuery = '')}>
					<CloseOutline class="h-3 w-3" />
				</Button>
			{/if}
		</div>
	</div>

	<!-- Logs display -->
	{#if isLoading && logs.length === 0}
		<div class="flex flex-1 items-center justify-center">
			<Spinner size="6" color="blue" />
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center">
				<p class="text-red-600 dark:text-red-400">Failed to load logs</p>
				<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">{error}</p>
				<Button class="mt-4" onclick={() => logsQuery.refetch()}>Retry</Button>
			</div>
		</div>
	{:else if allLogLines.length === 0}
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center text-gray-500 dark:text-gray-400">
				<p>No logs available (Total: {logs.length}, Filtered: {filteredLogs.length})</p>
			</div>
		</div>
	{:else}
		<div
			class="relative min-h-0 flex-1 rounded-lg border bg-gray-900 dark:bg-gray-950"
		>
			<div
				bind:this={virtualListEl}
				onscroll={handleScroll}
				class="absolute inset-0 overflow-auto"
			>
				<div class="min-w-full" style="width: max-content;">
					{#if virtualListBefore > 0}
						<div style="height: {virtualListBefore}px;"></div>
					{/if}

					{#each virtualItems as row, idx (row.index)}
						{@const logItem = allLogLines[row.index]}
						{@const podColor = getPodColor(logItem.pod)}
						{@const logLevel = getLogLevel(logItem.line)}
						{@const levelColor = getLogLevelColor(logLevel)}
						<div
							class="flex items-baseline whitespace-nowrap border-b border-gray-800 px-2 py-1 font-mono text-xs hover:bg-gray-800/50 sm:px-4 sm:text-sm"
							data-index={row.index}
						>
						{#if visibleColumns.has('timestamp')}
							<span class="shrink-0 text-gray-500">{logItem.formattedTimestamp}</span>
						{/if}
						{#if visibleColumns.has('pod')}
							<span class="mx-1 shrink-0 font-semibold sm:mx-2" style="color: {podColor}"
								>{logItem.pod}</span
							>
						{/if}
						{#if visibleColumns.has('container')}
							<span class="mx-1 shrink-0 text-green-400 sm:mx-2">{logItem.container}</span>
						{/if}
						{#if visibleColumns.has('message')}
							<span class="{levelColor}">
								{@html highlightSearch(logItem.line, searchQuery)}
							</span>
						{/if}
						</div>
					{/each}

					{#if virtualListAfter > 0}
						<div style="height: {virtualListAfter}px;"></div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Footer with stats -->
	{#if filteredLogs.length > 0 || logs.length > 0}
		<div
			class="mt-2 flex flex-shrink-0 items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs"
		>
			<div class="flex flex-wrap items-center gap-x-1 gap-y-0.5">
				<span>
					{#if searchQuery || selectedPods.size > 0 || selectedContainers.size > 0 || selectedLogLevels.size > 0}
						{filteredLogs.length}/{logs.length}
					{:else}
						{filteredLogs.length} lines
					{/if}
				</span>
				{#if selectedPods.size > 0}
					<span class="hidden sm:inline">• {selectedPods.size} {selectedPods.size === 1 ? 'pod' : 'pods'}</span>
				{:else if uniquePods.length > 0}
					<span class="hidden sm:inline">• {uniquePods.length} {uniquePods.length === 1 ? 'pod' : 'pods'}</span>
				{/if}
				{#if searchQuery}
					<span class="text-blue-500">"{searchQuery}"</span>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<span class="hidden text-green-500 sm:inline">Streaming</span>
				<span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
			</div>
		</div>
	{/if}
</div>
