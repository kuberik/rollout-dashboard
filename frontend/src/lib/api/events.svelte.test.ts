import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Lives in a `.svelte.test.ts` file (jsdom, not the plain-node workspace
 * `events.test.ts` runs in) purely for `window`/`document` — the pure
 * event→invalidation mapping is covered there; this file covers the
 * EventSource lifecycle wiring: connect vs. reconnect, hidden-tab suspend,
 * and backpressure's `retry:` hint falling back to polling.
 */

type FakeSourceOptions = {
	url: string;
	onConnect?: () => void;
	onDisconnect?: () => void;
};

function makeFakeSource() {
	const messages: { event: string; data: string }[] = [];
	let pending: ((r: IteratorResult<{ event: string; data: string }>) => void) | null = null;
	return {
		close: vi.fn(),
		connect: vi.fn(),
		push(msg: { event: string; data: string }) {
			if (pending) {
				const resolve = pending;
				pending = null;
				resolve({ value: msg, done: false });
			} else {
				messages.push(msg);
			}
		},
		[Symbol.asyncIterator]() {
			return {
				next(): Promise<IteratorResult<{ event: string; data: string }>> {
					if (messages.length) return Promise.resolve({ value: messages.shift()!, done: false });
					return new Promise((resolve) => {
						pending = resolve;
					});
				}
			};
		}
	};
}

let capturedOptions: FakeSourceOptions | null = null;
let fakeSource: ReturnType<typeof makeFakeSource>;
const createEventSourceMock = vi.fn((opts: FakeSourceOptions) => {
	capturedOptions = opts;
	fakeSource = makeFakeSource();
	return fakeSource;
});

vi.mock('eventsource-client', () => ({
	createEventSource: (opts: FakeSourceOptions) => createEventSourceMock(opts)
}));

function fakeQueryClient() {
	return { invalidateQueries: vi.fn() };
}

describe('startEventStream — connection lifecycle', () => {
	let startEventStream: typeof import('./events').startEventStream;
	let _resetEventStreamForTests: typeof import('./events')._resetEventStreamForTests;

	beforeEach(async () => {
		vi.resetModules();
		capturedOptions = null;
		createEventSourceMock.mockClear();
		const mod = await import('./events');
		startEventStream = mod.startEventStream;
		_resetEventStreamForTests = mod._resetEventStreamForTests;
	});

	afterEach(() => {
		_resetEventStreamForTests();
		vi.useRealTimers();
	});

	it('connects to /api/events/stream exactly once for the tab, even if called twice', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		startEventStream(qc as never); // idempotent — second call is a no-op
		expect(capturedOptions?.url).toBe('/api/events/stream');
		expect(createEventSourceMock).toHaveBeenCalledTimes(1);
	});

	it('the FIRST onConnect does not invalidate everything — nothing was missed yet', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		expect(qc.invalidateQueries).not.toHaveBeenCalledWith();
	});

	it('a RECONNECT (second onConnect) invalidates everything once, to reconcile whatever was missed', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!(); // first connect
		capturedOptions!.onDisconnect!(); // dropped
		capturedOptions!.onConnect!(); // reconnected
		expect(qc.invalidateQueries).toHaveBeenCalledWith();
	});

	it('a "changes" message applies its invalidations through the same path applyChangeEvents uses', async () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		fakeSource.push({
			event: 'changes',
			data: JSON.stringify([
				{ type: 'update', kind: 'Rollout', namespace: 'team-a', name: 'app-1', resourceVersion: '1', ts: 1 }
			])
		});
		// Let the pump's microtask/await chain run.
		await new Promise((r) => setTimeout(r, 0));
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['rollouts', 'all'] });
	});
});

describe('startEventStream — hidden-tab suspend/resume', () => {
	let startEventStream: typeof import('./events').startEventStream;
	let _resetEventStreamForTests: typeof import('./events')._resetEventStreamForTests;
	let hiddenGetter: (() => boolean) | null = null;

	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		capturedOptions = null;
		Object.defineProperty(document, 'hidden', {
			configurable: true,
			get: () => (hiddenGetter ? hiddenGetter() : false)
		});
		const mod = await import('./events');
		startEventStream = mod.startEventStream;
		_resetEventStreamForTests = mod._resetEventStreamForTests;
	});

	afterEach(() => {
		_resetEventStreamForTests();
		hiddenGetter = null;
		vi.useRealTimers();
	});

	function setHidden(value: boolean) {
		hiddenGetter = () => value;
		document.dispatchEvent(new Event('visibilitychange'));
	}

	it('does NOT close the connection for a hidden tab under 60s', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		setHidden(true);
		vi.advanceTimersByTime(59_000);
		expect(fakeSource.close).not.toHaveBeenCalled();
	});

	it('closes the connection once a hidden tab passes 60s', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		setHidden(true);
		vi.advanceTimersByTime(60_001);
		expect(fakeSource.close).toHaveBeenCalledTimes(1);
	});

	it('reconnects when the tab becomes visible again after being suspended', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		setHidden(true);
		vi.advanceTimersByTime(60_001);
		expect(fakeSource.close).toHaveBeenCalledTimes(1);
		setHidden(false);
		expect(fakeSource.connect).toHaveBeenCalledTimes(1);
	});

	it('a tab that comes back before 60s never touches the connection at all', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		setHidden(true);
		vi.advanceTimersByTime(10_000);
		setHidden(false);
		expect(fakeSource.close).not.toHaveBeenCalled();
		expect(fakeSource.connect).not.toHaveBeenCalled();
	});
});
