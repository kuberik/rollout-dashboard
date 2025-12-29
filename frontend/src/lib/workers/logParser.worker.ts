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
	type: 'parseLog' | 'parsePods';
	data: string;
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
	const { type, data } = e.data;

	try {
		if (type === 'parseLog') {
			const logLine = JSON.parse(data) as LogLine;
			// Format timestamp in worker (uses user's local timezone)
			if (logLine.timestamp) {
				logLine.formattedTimestamp = formatTimestamp(logLine.timestamp);
			} else {
				// Fallback to current time if no timestamp provided
				const now = Date.now();
				logLine.timestamp = now;
				logLine.formattedTimestamp = formatTimestamp(now);
			}
			self.postMessage({ type: 'log', data: logLine });
		} else if (type === 'parsePods') {
			const pods = JSON.parse(data) as PodInfo[];
			self.postMessage({ type: 'pods', data: pods });
		}
	} catch (err) {
		self.postMessage({
			type: 'error',
			error: err instanceof Error ? err.message : 'Unknown parsing error'
		});
	}
};
