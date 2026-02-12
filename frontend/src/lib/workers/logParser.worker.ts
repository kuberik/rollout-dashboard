// Web worker for parsing JSON log lines from SSE stream
// This offloads JSON parsing and timestamp formatting from the main thread to improve performance

interface LogLine {
	pod: string;
	container: string;
	type: string;
	line: string;
	timestamp?: number;
	formattedTimestamp?: string;
}

interface PodInfo {
	name: string;
	namespace: string;
	type: string;
}

interface WorkerMessage {
	type: 'parseLog' | 'parsePods' | 'parseLogBatch';
	data: string | string[];
	id: string;
}

// Format timestamp in user's local timezone
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

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
	const { type, data, id } = e.data;

	try {
		if (type === 'parseLogBatch') {
			// Batch parsing: data is an array of raw JSON strings
			const rawLines = data as string[];
			const results: LogLine[] = [];
			for (const raw of rawLines) {
				try {
					const logLine = JSON.parse(raw) as LogLine;
					if (logLine.timestamp) {
						logLine.formattedTimestamp = formatTimestamp(logLine.timestamp);
					} else {
						const now = Date.now();
						logLine.timestamp = now;
						logLine.formattedTimestamp = formatTimestamp(now);
					}
					results.push(logLine);
				} catch {
					// Skip unparseable lines
				}
			}
			self.postMessage({ type: 'logBatch', data: results, id });
		} else if (type === 'parseLog') {
			const logLine = JSON.parse(data as string) as LogLine;
			if (logLine.timestamp) {
				logLine.formattedTimestamp = formatTimestamp(logLine.timestamp);
			} else {
				const now = Date.now();
				logLine.timestamp = now;
				logLine.formattedTimestamp = formatTimestamp(now);
			}
			self.postMessage({ type: 'log', data: logLine, id });
		} else if (type === 'parsePods') {
			const pods = JSON.parse(data as string) as PodInfo[];
			self.postMessage({ type: 'pods', data: pods, id });
		}
	} catch (err) {
		self.postMessage({
			type: 'error',
			error: err instanceof Error ? err.message : 'Unknown parsing error',
			id
		});
	}
};
