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
async function* createLogsStream(
	namespace: string,
	name: string,
	filterType: string,
	since?: number,
	onPodsUpdate?: (pods: PodInfo[]) => void
): AsyncGenerator<LogLine, void, unknown> {
	const url = createLogsStreamUrl(namespace, name, filterType, since);

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
		const { type, data, error } = e.data;
		if (type === 'error') {
			// Reject all pending promises
			for (const { reject } of logPromises.values()) {
				reject(new Error(error));
			}
			for (const { reject } of podPromises.values()) {
				reject(new Error(error));
			}
			logPromises.clear();
			podPromises.clear();
			return;
		}
		if (type === 'log') {
			// Find and resolve the first pending log promise
			for (const [key, { resolve }] of logPromises.entries()) {
				resolve(data as LogLine);
				logPromises.delete(key);
				break;
			}
		} else if (type === 'pods') {
			// Find and resolve the first pending pods promise
			for (const [key, { resolve }] of podPromises.entries()) {
				resolve(data as PodInfo[]);
				podPromises.delete(key);
				break;
			}
		}
	};

	let logCount = 0;
	let lastLogTime = Date.now();
	let lastActivityCheck = Date.now();

	// Batch log lines to reduce UI updates
	const logBatch: LogLine[] = [];
	const BATCH_SIZE = 1000; // Yield batches of 50 logs
	const BATCH_TIMEOUT = 100; // Or every 100ms, whichever comes first
	let lastBatchFlush = Date.now();

	const eventSource = createEventSource({
		url,
		onConnect: () => {
			lastActivityCheck = Date.now();
		},
		onDisconnect: () => {
			// Connection closed
		}
	});

	// Monitor for inactivity
	const activityMonitor = setInterval(() => {
		const now = Date.now();
		const timeSinceLastLog = now - lastLogTime;
		const timeSinceLastActivity = now - lastActivityCheck;

		// If no activity for 60 seconds, log warning
		if (timeSinceLastLog > 60000) {
			console.warn('[Logs Stream] No logs received for 60+ seconds, connection may be stuck');
		}
	}, 10000); // Check every 10 seconds

	let shouldContinue = true;

	// Keep iterating even after disconnections
	// When Envoy times out, the iterator ends, but eventsource-client will reconnect.
	// We need to continue iterating after reconnection.
	while (shouldContinue) {
		try {
			// Iterate over the eventSource - if connection drops, this will exit
			// but eventsource-client will reconnect automatically
			for await (const { data, event } of eventSource) {
				lastActivityCheck = Date.now();

				// Handle pods events - parse in worker
				if (event === 'pods') {
					try {
						const promiseId = `pods-${Date.now()}-${Math.random()}`;
						const pods = await new Promise<PodInfo[]>((resolve, reject) => {
							podPromises.set(promiseId, { resolve, reject });
							worker.postMessage({ type: 'parsePods', data });
						});
						if (onPodsUpdate) {
							onPodsUpdate(pods);
						}
					} catch (err) {
						console.error('[Logs Stream] Error parsing pods:', err);
					}
					continue;
				}

				// Handle ping events (keepalive)
				if (event === 'ping') {
					continue;
				}

				// Handle error events
				if (event === 'error') {
					console.error('[Logs Stream] Received error event:', data);
					try {
						const errorObj = JSON.parse(data);
						throw new Error(errorObj.error || data);
					} catch (err) {
						throw err instanceof Error ? err : new Error(data);
					}
				}

				// Handle log events - parse and format in worker, then batch
				if (event === 'log') {
					try {
						logCount++;
						lastLogTime = Date.now();

						// Parse and format timestamp in worker
						const promiseId = `log-${Date.now()}-${Math.random()}`;
						const logLine = await new Promise<LogLine>((resolve, reject) => {
							logPromises.set(promiseId, { resolve, reject });
							worker.postMessage({ type: 'parseLog', data });
						});

						// Add to batch
						logBatch.push(logLine);

						// Flush batch if it reaches the size limit or timeout
						const now = Date.now();
						const shouldFlush =
							logBatch.length >= BATCH_SIZE || now - lastBatchFlush >= BATCH_TIMEOUT;

						if (shouldFlush && logBatch.length > 0) {
							// Yield the entire batch as an array
							// The reducer will handle it as a single update
							yield logBatch as any; // Yield array, reducer will handle it
							logBatch.length = 0; // Clear the batch
							lastBatchFlush = now;
						}
					} catch (err) {
						console.error('[Logs Stream] Error parsing log line:', err);
					}
				}
			}

			// Flush any remaining logs in the batch before reconnecting
			if (logBatch.length > 0) {
				yield logBatch as any; // Yield array, reducer will handle it
				logBatch.length = 0;
			}
			// Iterator ended (connection dropped), but eventSource may reconnect
			// Wait a moment and check if it reconnected
			await new Promise((resolve) => setTimeout(resolve, 1000));
			// Check if eventSource is still active (not manually closed)
			if (eventSource.readyState === 'open' || eventSource.readyState === 'connecting') {
				// Continue the while loop to iterate again after reconnection
				continue;
			} else {
				// EventSource was closed, exit
				shouldContinue = false;
			}
		} catch (err) {
			console.error('[Logs Stream] Error in stream:', err);
			// Check if eventSource is still active
			if (eventSource.readyState === 'open' || eventSource.readyState === 'connecting') {
				// Wait a bit for reconnection and continue
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			} else {
				// EventSource was closed, throw the error
				throw err;
			}
		}
	}

	// Cleanup worker
	worker.terminate();
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
			streamFn: async () => {
				return createLogsStream(namespace, name, filterType, since, onPodsUpdate);
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
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false
	});
}
