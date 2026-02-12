import { queryOptions } from '@tanstack/svelte-query';
import type { QueryFunctionContext } from '@tanstack/svelte-query';
import { experimental_streamedQuery as streamedQuery } from '@tanstack/svelte-query';
import { createEventSource } from 'eventsource-client';
import LogParserWorker from '../workers/logParser.worker?worker';

// Log streaming API types and utilities
export interface LogLine {
	pod: string;
	container: string;
	type: string; // "pod" or "test"
	line: string;
	timestamp?: number;
	formattedTimestamp?: string; // Pre-formatted timestamp from backend
}

export interface PodInfo {
	name: string;
	namespace: string;
	type: string; // "pod" or "test"
}

export interface LogsStreamData {
	logs: LogLine[];
	pods: PodInfo[];
}

// Create EventSource URL for logs streaming
export function createLogsStreamUrl(
	namespace: string,
	name: string,
	filterType: string = '',
	since?: number
): string {
	const params = new URLSearchParams();
	if (filterType) {
		params.set('type', filterType);
	}
	if (since) {
		params.set('since', since.toString());
	}
	return `/api/rollouts/${namespace}/${name}/pods/logs?${params.toString()}`;
}

// Create an async iterable that yields log lines from EventSource
// Helper class to decouple event source (Push) from generator (Pull)
class PromiseQueue<T> {
	private queue: T[] = [];
	private resolvers: ((value: T) => void)[] = [];

	push(value: T) {
		if (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift()!;
			resolve(value);
		} else {
			this.queue.push(value);
		}
	}

	async next(): Promise<T> {
		if (this.queue.length > 0) {
			return this.queue.shift()!;
		}
		return new Promise<T>((resolve) => {
			this.resolvers.push(resolve);
		});
	}
}

// Create an async iterable that yields log lines from EventSource
async function* createLogsStream(
	namespace: string,
	name: string,
	filterType: string,
	since?: number,
	onPodsUpdate?: (pods: PodInfo[]) => void,
	signal?: AbortSignal
): AsyncGenerator<LogLine[], void, unknown> {
	const url = createLogsStreamUrl(namespace, name, filterType, since);

	// The BatchedQueue bridging the EventSource push and Generator pull
	const batchQueue = new PromiseQueue<LogLine[]>();

	// Mutable buffer for incoming logs
	let buffer: LogLine[] = [];
	const BATCH_SIZE = 1000;

	// Create web worker for parsing and formatting
	const worker = new LogParserWorker();
	const pendingPromises = new Map<string, {
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	}>();

	worker.onmessage = (e: MessageEvent) => {
		const { type, data, error, id } = e.data;

		if (type === 'error') {
			if (id) {
				const promise = pendingPromises.get(id);
				if (promise) {
					promise.reject(new Error(error));
					pendingPromises.delete(id);
				}
			}
			return;
		}

		if (id) {
			const promise = pendingPromises.get(id);
			if (promise) {
				promise.resolve(data);
				pendingPromises.delete(id);
			}
		}
	};

	let logCount = 0;
	let lastLogTime = Date.now();
	let shouldContinue = true;

	// Raw SSE data strings accumulated for batch parsing
	let rawLogBuffer: string[] = [];

	const eventSource = createEventSource({
		url,
		onConnect: () => {
			console.log('[Logs Stream] Connected');
		},
		onDisconnect: () => {
			console.log('[Logs Stream] Disconnected');
		}
	});

	// Flush raw log strings through the worker and push parsed results to the batch queue
	async function flushRawBuffer() {
		if (rawLogBuffer.length === 0) return;
		const rawBatch = rawLogBuffer;
		rawLogBuffer = [];
		try {
			const promiseId = `batch-${Date.now()}-${Math.random()}`;
			const parsed = await new Promise<LogLine[]>((resolve, reject) => {
				pendingPromises.set(promiseId, { resolve, reject });
				worker.postMessage({ type: 'parseLogBatch', data: rawBatch, id: promiseId });
			});
			if (parsed.length > 0) {
				buffer.push(...parsed);
			}
		} catch (e) {
			console.error('[Logs Stream] Batch parse error:', e);
		}
		// Push whatever is in the parsed buffer to the queue
		if (buffer.length > 0) {
			batchQueue.push([...buffer]);
			buffer = [];
		}
	}

	// FLUSH TIMER: PUSH-SIDE
	// This runs independently of the backend/EventSource.
	// It checks the raw buffer every 100ms and pushes a batch if waiting.
	const flushTimer = setInterval(() => {
		flushRawBuffer();
	}, 100);

	// ACTIVITY MONITOR
	const activityMonitor = setInterval(() => {
		const now = Date.now();
		if (now - lastLogTime > 60000) {
			console.warn('[Logs Stream] No logs received for 60+ seconds');
		}
	}, 10000);

	const cleanup = () => {
		if (!shouldContinue) return;
		console.log('[Logs Stream] Cleaning up event stream');
		shouldContinue = false;
		clearInterval(flushTimer);
		clearInterval(activityMonitor);
		eventSource.close();
		worker.terminate();

		// Reject any pending promises from worker to avoid hanging
		const error = new Error('Stream closed');
		for (const { reject } of pendingPromises.values()) reject(error);
		pendingPromises.clear();

		// Push empty batch to unblock generator if waiting
		batchQueue.push([]);
	};

	if (signal) {
		signal.addEventListener('abort', cleanup);
	}

	// EVENT LOOP: PUSH-SIDE
	// Reads from EventSource and accumulates raw data strings for batch processing
	(async () => {
		try {
			for await (const { data, event } of eventSource) {
				if (!shouldContinue) break;

				if (event === 'pods') {
					try {
						const promiseId = `pods-${Date.now()}-${Math.random()}`;
						const pods = await new Promise<PodInfo[]>((resolve, reject) => {
							pendingPromises.set(promiseId, { resolve, reject });
							worker.postMessage({ type: 'parsePods', data, id: promiseId });
						});
						if (onPodsUpdate) onPodsUpdate(pods);
					} catch (e) {
						console.error(e);
					}
				} else if (event === 'log') {
					logCount++;
					lastLogTime = Date.now();

					// Accumulate raw JSON string for batch parsing
					rawLogBuffer.push(data);

					// Immediate flush if raw buffer is large enough
					if (rawLogBuffer.length >= BATCH_SIZE) {
						flushRawBuffer();
					}
				}
			}
		} catch (err) {
			console.error('[Logs Stream] EventSource broken:', err);
		} finally {
			// If loop exits cleanly or errors, we signal end
			cleanup();
		}
	})();

	// GENERATOR LOOP: PULL-SIDE
	// This yields batches to the UI as they become available in the queue
	try {
		while (shouldContinue) {
			const batch = await batchQueue.next();
			if (batch.length > 0) {
				yield batch;
			} else if (!shouldContinue) {
				// Empty batch + shouldContinue=false means we are shutting down
				break;
			}
		}
	} finally {
		cleanup();
	}
}

const MAX_LOGS = 10000;

export function logsStreamQueryOptions({
	namespace,
	name,
	filterType = '',
	since,
	onPodsUpdate
}: {
	namespace: string;
	name: string;
	filterType?: 'pod' | 'test' | '';
	since?: number;
	onPodsUpdate?: (pods: PodInfo[]) => void;
}) {
	return queryOptions({
		queryKey: ['rollouts', namespace, name, 'logs', filterType, since],
		queryFn: streamedQuery({
			streamFn: async ({ signal }) => {
				return createLogsStream(namespace, name, filterType, since, onPodsUpdate, signal);
			},
			refetchMode: 'append', // Append new logs to existing ones
			reducer: (acc: LogLine[], chunk: LogLine | LogLine[]) => {
				// Handle both single logs and batches (arrays)
				const logsToAdd = Array.isArray(chunk) ? chunk : [chunk];

				// Add timestamp if missing for each log
				for (const log of logsToAdd) {
					if (!log.timestamp) {
						log.timestamp = Date.now();
					}
				}

				// Track the latest timestamp for each stream (pod:container combination)
				// This prevents adding old logs on reconnects
				const streamLatestTimestamp = new Map<string, number>();
				for (const log of acc) {
					const streamKey = `${log.pod}:${log.container}`;
					const currentLatest = streamLatestTimestamp.get(streamKey) || 0;
					const logTimestamp = log.timestamp || 0;
					if (logTimestamp > currentLatest) {
						streamLatestTimestamp.set(streamKey, logTimestamp);
					}
				}

				// Filter out logs that are older than the latest timestamp for their stream
				const filteredLogs = logsToAdd.filter((log) => {
					const streamKey = `${log.pod}:${log.container}`;
					const latestTimestamp = streamLatestTimestamp.get(streamKey);
					const logTimestamp = log.timestamp || 0;

					// If we have a latest timestamp for this stream, only include logs >= that timestamp
					// If no previous logs for this stream, include all logs
					return latestTimestamp === undefined || logTimestamp >= latestTimestamp;
				});

				if (logsToAdd.length > 0) {
					console.debug(`[Logs Reducer] Received ${logsToAdd.length} logs, kept ${filteredLogs.length} after timestamp filter`);
					if (filteredLogs.length === 0 && logsToAdd.length > 0) {
						console.debug('[Logs Reducer] All logs filtered out! Latest TS map:', Object.fromEntries(streamLatestTimestamp));
						console.debug('[Logs Reducer] Rejected log sample:', logsToAdd[0]);
					}
				}

				// Combine accumulator and filtered new logs
				// Optimization: only sort if the new batch is out of order relative to the accumulator.
				// The accumulator is already sorted. If all new logs have timestamps >= the last
				// accumulated log, we can just append (and sort only the new portion).
				const lastAccTs = acc.length > 0 ? (acc[acc.length - 1].timestamp || 0) : 0;
				const firstNewTs = filteredLogs.length > 0 ? (filteredLogs[0].timestamp || 0) : Infinity;
				const needsFullSort = filteredLogs.length > 0 && firstNewTs < lastAccTs;

				let result: LogLine[];
				if (needsFullSort) {
					// New logs are out of order -- full sort required
					result = [...acc, ...filteredLogs];
					result.sort((a, b) => {
						const tsDiff = (a.timestamp || 0) - (b.timestamp || 0);
						if (tsDiff !== 0) return tsDiff;
						return (a.pod || '').localeCompare(b.pod || '');
					});
				} else {
					// New logs are in order -- sort only the new batch then append
					if (filteredLogs.length > 1) {
						filteredLogs.sort((a, b) => {
							const tsDiff = (a.timestamp || 0) - (b.timestamp || 0);
							if (tsDiff !== 0) return tsDiff;
							return (a.pod || '').localeCompare(b.pod || '');
						});
					}
					result = [...acc, ...filteredLogs];
				}

				// Trim to MAX_LOGS, keeping the most recent (last items after sorting)
				if (result.length > MAX_LOGS) {
					result = result.slice(-MAX_LOGS);
				}

				return result;
			},
			initialValue: [] as LogLine[]
		}),
		refetchOnMount: true, // Always refetch when component mounts to restart stream
		refetchOnWindowFocus: false,
		refetchOnReconnect: false
	});
}
