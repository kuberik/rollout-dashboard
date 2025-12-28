<svelte:options runes={true} />

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button, Spinner, Badge, Toggle } from 'flowbite-svelte';
	import { ClipboardCleanSolid } from 'flowbite-svelte-icons';
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

	// Track known pods for color generation
	let knownPodNames = $state<Set<string>>(new Set());

	// Pod colors using iwanthue
	let podColors = $state<Map<string, string>>(new Map());

	// Auto-scroll state
	let autoScroll = $state(true);
	let virtualListContainer: HTMLElement | null = $state(null);
	let isUserScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

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

	function copyToClipboard() {
		const text = filteredLogs.map((log) => log.line).join('\n');
		navigator.clipboard.writeText(text).then(() => {
			// Could show a toast here
		});
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

	// Filter logs by selected pod
	const filteredLogs = $derived.by(() => {
		if (selectedPod === null) return logs;
		return logs.filter((log) => log.pod === selectedPod);
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

	// Flatten for virtual list
	const allLogLines = $derived.by(() => {
		const result: Array<{
			line: string;
			pod: string;
			container: string;
			type: string;
			timestamp: number;
			index: number;
		}> = [];
		filteredLogs.forEach((log, index) => {
			result.push({
				line: log.line,
				pod: log.pod,
				container: log.container,
				type: log.type,
				timestamp: log.timestamp || Date.now(),
				index
			});
		});
		return result;
	});

	// Format timestamp for display
	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3
		});
	}

	// Scroll to bottom
	function scrollToBottom() {
		if (virtualListContainer) {
			virtualListContainer.scrollTop = virtualListContainer.scrollHeight;
		}
	}

	// Handle scroll events to detect user scrolling
	function handleScroll() {
		if (!virtualListContainer) return;

		// Check if user is near the bottom (within 50px)
		const isNearBottom =
			virtualListContainer.scrollHeight -
				virtualListContainer.scrollTop -
				virtualListContainer.clientHeight <
			50;

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
	}

	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = $state(0);
	$effect(() => {
		const currentCount = allLogLines.length;
		if (autoScroll && currentCount > previousLogCount && !isUserScrolling) {
			// Use requestAnimationFrame to ensure DOM is updated
			requestAnimationFrame(() => {
				scrollToBottom();
			});
		}
		previousLogCount = currentCount;
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
	<div class="mb-4 flex flex-shrink-0 items-center justify-between border-b pb-3">
		<div class="flex items-center gap-3">
			<h3 class="text-lg font-semibold text-gray-900 dark:text-white">Logs</h3>
			{#if isLoading}
				<Spinner size="4" color="blue" />
			{/if}
			{#if error}
				<Badge color="red" class="text-xs">Error loading logs</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<!-- Auto-scroll toggle -->
			<div class="flex items-center gap-2">
				<Toggle bind:checked={autoScroll} />
				<span class="text-sm text-gray-700 dark:text-gray-300">Follow logs</span>
			</div>
			<!-- Pod filter dropdown -->
			<select
				bind:value={selectedPod}
				class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-500"
			>
				<option value={null}>All Pods ({pods.length})</option>
				{#each uniquePods as pod}
					<option value={pod.name}>{pod.name}</option>
				{/each}
			</select>
			<Button size="xs" color="light" onclick={copyToClipboard}>
				<ClipboardCleanSolid class="mr-2 h-3 w-3" />
				Copy
			</Button>
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
			<div
				class="h-full w-full overflow-y-auto"
				bind:this={virtualListContainer}
				onscroll={handleScroll}
			>
				<div class="font-mono text-sm text-gray-100">
					{#each allLogLines as logItem (logItem.index)}
						{@const podColor = getPodColor(logItem.pod)}
						<div class="flex items-start px-4 py-1 hover:bg-gray-800">
							<span class="shrink-0 text-gray-500">{formatTimestamp(logItem.timestamp)}</span>
							<span class="mx-2 shrink-0 font-semibold" style="color: {podColor}"
								>{logItem.pod}</span
							>
							<span class="mx-2 shrink-0 text-green-400">{logItem.container}</span>
							<span class="min-w-0 whitespace-pre-wrap break-words text-gray-300"
								>{logItem.line}</span
							>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Footer with stats -->
	{#if filteredLogs.length > 0}
		<div
			class="mt-2 flex flex-shrink-0 items-center justify-between text-xs text-gray-500 dark:text-gray-400"
		>
			<div>
				<span>{filteredLogs.length} log lines</span>
				{#if selectedPod}
					<span class="ml-2">from {selectedPod}</span>
				{:else if uniquePods.length > 0}
					<span class="ml-2"
						>from {uniquePods.length} {uniquePods.length === 1 ? 'pod' : 'pods'}</span
					>
				{/if}
			</div>
			<div>
				<span class="text-green-500">Streaming live logs</span>
			</div>
		</div>
	{/if}
</div>
