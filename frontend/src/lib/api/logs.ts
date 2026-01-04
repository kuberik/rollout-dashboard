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
	const logPromises = new Map<string, {
		resolve: (value: LogLine) => void;
		reject: (error: Error) => void;
	}>();
	const podPromises = new Map<string, {
		resolve: (value: PodInfo[]) => void;
		reject: (error: Error) => void;
	}>();

	worker.onmessage = (e: MessageEvent) => {
		const { type, data, error, id } = e.data;

		if (type === 'error') {
			if (id) {
				const promise = logPromises.get(id) || podPromises.get(id);
				if (promise) {
					promise.reject(new Error(error));
					logPromises.delete(id);
					podPromises.delete(id);
				}
			}
			return;
		}

		if (id) {
			if (type === 'log') {
				const promise = logPromises.get(id);
				if (promise) {
					promise.resolve(data as LogLine);
					logPromises.delete(id);
				}
			} else if (type === 'pods') {
				const promise = podPromises.get(id);
				if (promise) {
					promise.resolve(data as PodInfo[]);
					podPromises.delete(id);
				}
			}
		}
	};

	let logCount = 0;
	let lastLogTime = Date.now();
	let shouldContinue = true;

	const eventSource = createEventSource({
		url,
		onConnect: () => {
			console.log('[Logs Stream] Connected');
		},
		onDisconnect: () => {
			console.log('[Logs Stream] Disconnected');
		}
	});

	// FLUSH TIMER: PUSH-SIDE
	// This runs independently of the backend/EventSource.
	// It checks the buffer every 100ms and pushes a batch if waiting.
	const flushTimer = setInterval(() => {
		if (buffer.length > 0) {
			console.debug(`[Logs Stream] Flushing batch of ${buffer.length} logs (Timer)`);
			batchQueue.push([...buffer]);
			buffer = [];
		}
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
		for (const { reject } of logPromises.values()) reject(error);
		for (const { reject } of podPromises.values()) reject(error);
		logPromises.clear();
		podPromises.clear();

		// Push empty batch to unblock generator if waiting
		batchQueue.push([]);
	};

	if (signal) {
		signal.addEventListener('abort', cleanup);
	}

	// EVENT LOOP: PUSH-SIDE
	// Reads from EventSource and pushes into reusable buffer
	(async () => {
		try {
			for await (const { data, event } of eventSource) {
				if (!shouldContinue) break;

				if (event === 'pods') {
					try {
						const promiseId = `pods-${Date.now()}-${Math.random()}`;
						const pods = await new Promise<PodInfo[]>((resolve, reject) => {
							podPromises.set(promiseId, { resolve, reject });
							worker.postMessage({ type: 'parsePods', data, id: promiseId });
						});
						if (onPodsUpdate) onPodsUpdate(pods);
					} catch (e) {
						console.error(e);
					}
				} else if (event === 'log') {
					try {
						logCount++;
						lastLogTime = Date.now();

						const promiseId = `log-${Date.now()}-${Math.random()}`;
						const logLine = await new Promise<LogLine>((resolve, reject) => {
							logPromises.set(promiseId, { resolve, reject });
							worker.postMessage({ type: 'parseLog', data, id: promiseId });
						});

						buffer.push(logLine);

						// Immediate flush if buffer is full
						if (buffer.length >= BATCH_SIZE) {
							console.debug(`[Logs Stream] Flushing full batch of ${buffer.length} logs`);
							batchQueue.push([...buffer]);
							buffer = [];
						}
					} catch (e) {
						console.error(e);
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
				let result = [...acc, ...filteredLogs];

				// Sort by timestamp (with pod name as secondary key for stability)
				// This ensures logs from different pods are always in chronological order
				// Since we're batching (reducer called less frequently), sorting is acceptable
				result.sort((a, b) => {
					const tsDiff = (a.timestamp || 0) - (b.timestamp || 0);
					if (tsDiff !== 0) return tsDiff;
					return (a.pod || '').localeCompare(b.pod || '');
				});

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
