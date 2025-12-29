<svelte:options runes={true} />

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
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
	import VirtualList from '@humanspeak/svelte-virtual-list';
	import iwanthue from 'iwanthue';
	import { createQuery } from '@tanstack/svelte-query';
	import type { LogLine, PodInfo } from '$lib/api/logs';
	import { logsStreamQueryOptions } from '$lib/api/logs';

	interface Props {
		namespace: string;
		name: string;
		filterType?: 'pod' | 'test' | '';
	}

	const { namespace, name, filterType = '' }: Props = $props();

	let selectedPod = $state<string | null>(null);
	let pods = $state<PodInfo[]>([]);
	let searchQuery = $state('');

	// Track known pods for color generation
	let knownPodNames = $state<Set<string>>(new Set());

	// Pod colors using iwanthue
	let podColors = $state<Map<string, string>>(new Map());

	// Auto-scroll state
	let autoScroll = $state(true);
	let virtualListRef: any = $state(null);
	let isUserScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

	// Filter state - using Sets for multi-select
	let selectedPods = $state<Set<string>>(new Set());
	let selectedContainers = $state<Set<string>>(new Set());
	let selectedLogLevels = $state<Set<'error' | 'warn' | 'info' | 'debug'>>(new Set());

	// Dropdown trigger IDs
	const podsDropdownId = 'pods-filter-dropdown';
	const containersDropdownId = 'containers-filter-dropdown';
	const logLevelsDropdownId = 'log-levels-filter-dropdown';

	// Handle pods updates from the stream
	function handlePodsUpdate(newPods: PodInfo[]) {
		const newPodNames = new Set(newPods.map((p) => p.name));
		const hasNewPods = Array.from(newPodNames).some((name) => !knownPodNames.has(name));

		if (hasNewPods) {
			knownPodNames = newPodNames;
		}

		pods = newPods;
		knownPodNames = newPodNames;
	}

	// Create streaming query
	const logsQuery = createQuery(() =>
		logsStreamQueryOptions({
			namespace,
			name,
			filterType,
			onPodsUpdate: handlePodsUpdate
		})
	);

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

	function getPodColor(podName: string): string {
		if (!podColors.has(podName)) {
			// Generate colors for all known pods at once for consistency
			const allPods = Array.from(knownPodNames);

			// iwanthue requires at least 2 colors, so handle edge cases
			if (allPods.length === 0) {
				return '#ffffff';
			} else if (allPods.length === 1) {
				// For a single pod, use a default color
				podColors.set(podName, '#3b82f6'); // blue
				return '#3b82f6';
			}

			const palette = iwanthue(allPods.length, {
				seed: 42, // Fixed seed for consistent colors
				colorSpace: 'default'
			});
			allPods.forEach((pod, idx) => {
				if (!podColors.has(pod)) {
					podColors.set(pod, palette[idx]);
				}
			});
		}
		return podColors.get(podName) || '#ffffff';
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
		const podMap = new Map<string, PodInfo>();
		pods.forEach((pod) => {
			if (!podMap.has(pod.name)) {
				podMap.set(pod.name, pod);
			}
		});
		return Array.from(podMap.values());
	});

	// Highlight search matches in log lines
	function highlightSearch(text: string, query: string): string {
		if (!query.trim()) return text;
		const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return text.replace(regex, '<mark class="bg-yellow-300 dark:bg-yellow-600">$1</mark>');
	}

	// Flatten for virtual list - formatted timestamp comes from web worker
	const allLogLines = $derived.by(() => {
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

	// Scroll to bottom
	function scrollToBottom() {
		if (!virtualListRef || allLogLines.length === 0) return;

		// Scroll to the last item using VirtualList's scroll API
		const lastIndex = allLogLines.length - 1;
		isAutoScrolling = true;
		virtualListRef.scroll({ index: lastIndex, smoothScroll: false, align: 'bottom' });
		// Reset flag after a short delay
		setTimeout(() => {
			isAutoScrolling = false;
		}, 100);
	}

	// Track if we're currently auto-scrolling to avoid detecting it as user scrolling
	let isAutoScrolling = $state(false);

	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = $state(0);
	let previousLastTimestamp = $state<number | null>(null);
	$effect(() => {
		// Track allLogLines to detect changes
		const logs = allLogLines;
		const currentCount = logs.length;
		const lastLog = logs[currentCount - 1];
		const lastTimestamp = lastLog?.timestamp || null;

		// Check if logs changed (count increased OR last timestamp changed)
		const logsChanged = currentCount > previousLogCount || lastTimestamp !== previousLastTimestamp;

		if (autoScroll && logsChanged && !isUserScrolling && !isAutoScrolling) {
			// Use requestAnimationFrame to ensure DOM is updated
			requestAnimationFrame(() => {
				scrollToBottom();
			});
		}

		previousLogCount = currentCount;
		previousLastTimestamp = lastTimestamp;
	});

	// Listen for scroll events on the VirtualList viewport to detect user scrolling
	onMount(() => {
		if (!virtualListRef) return;

		// Find the viewport element created by VirtualList
		const findViewport = () => {
			// VirtualList creates a viewport element, we need to find it
			// It's typically the scrollable container
			const container = virtualListRef as any;
			if (container?.$el) {
				const viewport =
					container.$el.querySelector('[class*="viewport"]') || container.$el.firstElementChild;
				return viewport;
			}
			return null;
		};

		// Wait for VirtualList to render
		const setupScrollListener = () => {
			const viewport = findViewport();
			if (viewport && viewport instanceof HTMLElement) {
				const handleScroll = () => {
					if (isAutoScrolling) return; // Ignore our own scrolls

					// Check if user is near the bottom (within 50px)
					const isNearBottom =
						viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 50;

					// If user scrolled away from bottom, disable auto-scroll
					if (!isNearBottom && autoScroll) {
						autoScroll = false;
					}

					// Mark that user is scrolling
					isUserScrolling = true;
					if (scrollTimeout) {
						clearTimeout(scrollTimeout);
					}
					scrollTimeout = setTimeout(() => {
						isUserScrolling = false;
					}, 150);
				};

				viewport.addEventListener('scroll', handleScroll);
				return () => {
					viewport.removeEventListener('scroll', handleScroll);
				};
			}
			return null;
		};

		// Try immediately, then retry after a short delay
		let cleanup = setupScrollListener();
		if (!cleanup) {
			setTimeout(() => {
				cleanup = setupScrollListener();
			}, 100);
		}

		return () => {
			if (cleanup) cleanup();
		};
	});

	// Cleanup on destroy
	onDestroy(() => {
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
	});
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<!-- Header with controls -->
	<div class="mb-4 flex flex-shrink-0 flex-col gap-3 border-b pb-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-white">Logs</h3>
				{#if isLoading}
					<Spinner size="4" color="blue" />
				{/if}
				{#if error}
					<Badge color="red" class="text-xs">Error loading logs</Badge>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<!-- Auto-scroll toggle -->
				<div class="flex items-center gap-2">
					<Toggle bind:checked={autoScroll} />
					<span class="text-sm text-gray-700 dark:text-gray-300">Follow logs</span>
				</div>
				<!-- Pod filter dropdown -->
				<div class="relative">
					<Button size="sm" color="light" id={podsDropdownId} class="min-w-[120px]">
						Pods
						{#if selectedPods.size > 0}
							<Badge color="blue" class="ml-2">{selectedPods.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-2 h-4 w-4" />
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
						<Button size="sm" color="light" id={containersDropdownId} class="min-w-[120px]">
							Containers
							{#if selectedContainers.size > 0}
								<Badge color="blue" class="ml-2">{selectedContainers.size}</Badge>
							{/if}
							<ChevronDownOutline class="ml-2 h-4 w-4" />
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
					<Button size="sm" color="light" id={logLevelsDropdownId} class="min-w-[120px]">
						Log Levels
						{#if selectedLogLevels.size > 0}
							<Badge color="blue" class="ml-2">{selectedLogLevels.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-2 h-4 w-4" />
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
				<p>No logs available</p>
			</div>
		</div>
	{:else}
		<div
			class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-gray-900 dark:bg-gray-950"
		>
			<VirtualList
				items={allLogLines}
				viewportClass="h-full w-full overflow-y-auto"
				containerClass="h-full w-full"
				bind:this={virtualListRef}
			>
				{#snippet renderItem(logItem: {
					line: string;
					pod: string;
					container: string;
					type: string;
					timestamp: number;
					formattedTimestamp: string;
					index: number;
				})}
					{@const podColor = getPodColor(logItem.pod)}
					{@const logLevel = getLogLevel(logItem.line)}
					{@const levelColor = getLogLevelColor(logLevel)}
					<div
						class="flex items-start border-b border-gray-800 px-4 py-1.5 font-mono text-sm hover:bg-gray-800/50"
					>
						<span class="shrink-0 text-gray-500">{logItem.formattedTimestamp}</span>
						<span class="mx-2 shrink-0 font-semibold" style="color: {podColor}">{logItem.pod}</span>
						<span class="mx-2 shrink-0 text-green-400">{logItem.container}</span>
						<span class="min-w-0 flex-1 whitespace-pre-wrap break-words {levelColor}">
							{@html highlightSearch(logItem.line, searchQuery)}
						</span>
					</div>
				{/snippet}
			</VirtualList>
		</div>
	{/if}

	<!-- Footer with stats -->
	{#if filteredLogs.length > 0 || logs.length > 0}
		<div
			class="mt-2 flex flex-shrink-0 items-center justify-between text-xs text-gray-500 dark:text-gray-400"
		>
			<div>
				<span>
					{#if searchQuery || selectedPods.size > 0 || selectedContainers.size > 0 || selectedLogLevels.size > 0}
						{filteredLogs.length} of {logs.length} log lines
					{:else}
						{filteredLogs.length} log lines
					{/if}
				</span>
				{#if selectedPods.size > 0}
					<span class="ml-2">{selectedPods.size} {selectedPods.size === 1 ? 'pod' : 'pods'}</span>
				{:else if uniquePods.length > 0}
					<span class="ml-2"
						>from {uniquePods.length} {uniquePods.length === 1 ? 'pod' : 'pods'}</span
					>
				{/if}
				{#if selectedContainers.size > 0}
					<span class="ml-2"
						>{selectedContainers.size}
						{selectedContainers.size === 1 ? 'container' : 'containers'}</span
					>
				{/if}
				{#if selectedLogLevels.size > 0}
					<span class="ml-2"
						>{selectedLogLevels.size} {selectedLogLevels.size === 1 ? 'level' : 'levels'}</span
					>
				{/if}
				{#if searchQuery}
					<span class="ml-2 text-blue-500">matching "{searchQuery}"</span>
				{/if}
			</div>
			<div>
				<span class="text-green-500">Streaming live logs</span>
			</div>
		</div>
	{/if}
</div>
