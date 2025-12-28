import { queryOptions } from '@tanstack/svelte-query';
import type { QueryFunctionContext } from '@tanstack/svelte-query';
import { experimental_streamedQuery as streamedQuery } from '@tanstack/svelte-query';
import { createEventSource } from 'eventsource-client';

// Log streaming API types and utilities
export interface LogLine {
	pod: string;
	container: string;
	type: string; // "pod" or "test"
	line: string;
	timestamp?: number;
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
	console.log('[Logs Stream] Creating EventSource for:', url);

	let logCount = 0;
	let lastLogTime = Date.now();
	let lastActivityCheck = Date.now();

	const eventSource = createEventSource({
		url,
		onConnect: () => {
			console.log('[Logs Stream] EventSource connected, readyState:', eventSource.readyState);
			lastActivityCheck = Date.now();
		},
		onDisconnect: () => {
			console.log('[Logs Stream] EventSource disconnected');
		}
	});

	// Monitor for inactivity
	const activityMonitor = setInterval(() => {
		const now = Date.now();
		const timeSinceLastLog = now - lastLogTime;
		const timeSinceLastActivity = now - lastActivityCheck;

		console.log('[Logs Stream] Activity check:', {
			readyState: eventSource.readyState,
			timeSinceLastLog: `${timeSinceLastLog}ms`,
			timeSinceLastActivity: `${timeSinceLastActivity}ms`,
			totalLogsReceived: logCount
		});

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

				// Handle pods events
				if (event === 'pods') {
					try {
						console.log('[Logs Stream] Received pods event');
						const pods = JSON.parse(data) as PodInfo[];
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
					console.log('[Logs Stream] Received ping (keepalive)');
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

				// Handle log events - yield them directly!
				if (event === 'log') {
					try {
						logCount++;
						lastLogTime = Date.now();

						if (logCount <= 10 || logCount % 100 === 0) {
							console.log(`[Logs Stream] Received log event #${logCount}`);
						}

						const logLine = JSON.parse(data) as LogLine;
						if (!logLine.timestamp) {
							logLine.timestamp = Date.now();
						}

						// Yield directly - no queue needed!
						yield logLine;
					} catch (err) {
						console.error('[Logs Stream] Error parsing log line:', err);
					}
				}
			}
			// Iterator ended (connection dropped), but eventSource may reconnect
			// Wait a moment and check if it reconnected
			console.log('[Logs Stream] Iterator ended, checking for reconnection...');
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
				console.log('[Logs Stream] Waiting for reconnection after error...');
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			} else {
				// EventSource was closed, throw the error
				throw err;
			}
		}
	}
	console.log('[Logs Stream] Stream ended, total logs yielded:', logCount);
}

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
			reducer: (acc: LogLine[], chunk: LogLine) => {
				// Add timestamp if missing
				if (!chunk.timestamp) {
					chunk.timestamp = Date.now();
				}
				// Limit to MAX_LOGS, dropping oldest
				const newLogs = [...acc, chunk];
				if (newLogs.length > 10000) {
					return newLogs.slice(-10000);
				}
				return newLogs;
			},
			initialValue: [] as LogLine[]
		}),
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false
	});
}
