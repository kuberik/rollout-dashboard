<svelte:options runes={true} />

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button, Spinner, Badge } from 'flowbite-svelte';
	import { RefreshOutline, ClipboardCleanSolid } from 'flowbite-svelte-icons';
	import VirtualList from '@humanspeak/svelte-virtual-list';
	import LogParserWorker from '$lib/workers/logParser.worker?worker';

	interface LogLine {
		pod: string;
		container: string;
		type: string; // "pod" or "test"
		line: string;
	}

	interface PodInfo {
		name: string;
		namespace: string;
		type: string; // "pod" or "test"
	}

	interface Props {
		namespace: string;
		name: string;
		filterType?: 'pod' | 'test' | '';
	}

	const { namespace, name, filterType = '' }: Props = $props();

	let selectedPod = $state<string | null>(null);
	let pods = $state<PodInfo[]>([]);
	let logs = $state<LogLine[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let eventSource: EventSource | null = null;
	let logParserWorker: Worker | null = null;

	// Batch log updates to reduce reactive updates
	let logBuffer: LogLine[] = [];
	let batchTimer: ReturnType<typeof setInterval> | null = null;

	function copyToClipboard() {
		const text = filteredLogs.map((log) => log.line).join('\n');
		navigator.clipboard.writeText(text).then(() => {
			// Could show a toast here
		});
	}

	function flushLogBuffer() {
		if (logBuffer.length > 0) {
			// Batch update: add all buffered logs at once
			logs = [...logs, ...logBuffer];
			logBuffer = [];
		}
	}

	function startStreaming() {
		if (eventSource) {
			eventSource.close();
		}

		// Clear any existing batch timer
		if (batchTimer) {
			clearInterval(batchTimer);
			batchTimer = null;
		}

		// Start batch timer to flush logs every second
		batchTimer = setInterval(() => {
			flushLogBuffer();
		}, 1000);

		// Create or reuse web worker for JSON parsing
		if (!logParserWorker) {
			logParserWorker = new LogParserWorker();

			// Handle messages from worker
			logParserWorker.onmessage = (e: MessageEvent) => {
				const { type, data, error: workerError } = e.data;

				if (type === 'log') {
					// Add to buffer instead of directly to logs
					logBuffer.push(data as LogLine);
				} else if (type === 'pods') {
					pods = data as PodInfo[];
				} else if (type === 'error') {
					console.error('Worker parsing error:', workerError);
				}
			};

			logParserWorker.onerror = (err) => {
				console.error('Worker error:', err);
			};
		}

		isLoading = true;
		error = null;

		const params = new URLSearchParams();
		if (filterType) {
			params.set('type', filterType);
		}

		const url = `/api/rollouts/${namespace}/${name}/pods/logs?${params.toString()}`;
		eventSource = new EventSource(url);

		eventSource.onopen = () => {
			isLoading = false;
		};

		eventSource.addEventListener('pods', (e) => {
			// Offload JSON parsing to worker
			if (logParserWorker) {
				logParserWorker.postMessage({ type: 'parsePods', data: e.data });
			}
		});

		eventSource.addEventListener('log', (e) => {
			// Offload JSON parsing to worker
			if (logParserWorker) {
				logParserWorker.postMessage({ type: 'parseLog', data: e.data });
			}
		});

		eventSource.addEventListener('error', (e: Event) => {
			const errorData = (e as MessageEvent).data;
			if (errorData) {
				try {
					const errorObj = JSON.parse(errorData);
					error = errorObj.error || errorData;
				} catch {
					error = errorData;
				}
			} else {
				error = 'Connection error';
			}
			isLoading = false;
		});

		eventSource.onerror = () => {
			if (eventSource?.readyState === EventSource.CLOSED) {
				isLoading = false;
			}
		};
	}

	onMount(() => {
		startStreaming();
	});

	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
		if (batchTimer) {
			clearInterval(batchTimer);
			batchTimer = null;
		}
		// Flush any remaining logs before destroying
		flushLogBuffer();
		if (logParserWorker) {
			logParserWorker.terminate();
			logParserWorker = null;
		}
	});

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
			index: number;
		}> = [];
		filteredLogs.forEach((log, index) => {
			result.push({
				line: log.line,
				pod: log.pod,
				container: log.container,
				type: log.type,
				index
			});
		});
		return result;
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
				<Button class="mt-4" onclick={() => startStreaming()}>Retry</Button>
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
			<div class="h-full w-full">
				<VirtualList items={allLogLines}>
					{#snippet renderItem(item, index)}
						{@const logItem = item as (typeof allLogLines)[0]}
						<div
							class="px-4 py-1 font-mono text-sm text-gray-100 hover:bg-gray-800"
							style="height:20px"
						>
							<span class="text-gray-500">{index + 1}</span>
							<span class="mx-2 text-blue-400">{logItem.pod}</span>
							<span class="mx-2 text-green-400">{logItem.container}</span>
							<span class="text-gray-300">{logItem.line}</span>
						</div>
					{/snippet}
				</VirtualList>
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
