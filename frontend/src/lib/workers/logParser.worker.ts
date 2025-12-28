// Web worker for parsing JSON log lines from SSE stream
// This offloads JSON parsing from the main thread to improve performance

interface LogLine {
	pod: string;
	container: string;
	type: string;
	line: string;
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

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
	const { type, data } = e.data;

	try {
		if (type === 'parseLog') {
			const logLine = JSON.parse(data) as LogLine;
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

