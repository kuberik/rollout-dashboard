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
	let CONNECT_SETTLE_MS: typeof import('./events').CONNECT_SETTLE_MS;

	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		capturedOptions = null;
		createEventSourceMock.mockClear();
		const mod = await import('./events');
		startEventStream = mod.startEventStream;
		_resetEventStreamForTests = mod._resetEventStreamForTests;
		CONNECT_SETTLE_MS = mod.CONNECT_SETTLE_MS;
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
		vi.advanceTimersByTime(CONNECT_SETTLE_MS);
		expect(qc.invalidateQueries).not.toHaveBeenCalledWith();
	});

	it('a RECONNECT that SETTLES (stays up past CONNECT_SETTLE_MS) invalidates everything once', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!(); // first connect
		vi.advanceTimersByTime(CONNECT_SETTLE_MS); // settles: connectedOnce = true, no invalidate yet
		capturedOptions!.onDisconnect!(); // dropped
		capturedOptions!.onConnect!(); // reconnected
		vi.advanceTimersByTime(CONNECT_SETTLE_MS); // and this one STAYS up
		expect(qc.invalidateQueries).toHaveBeenCalledWith();
	});

	/**
	 * ⭐ ITEM 2 FOLLOW-UP (squad-rollout coordinator, 2026-10-11). Pins the
	 * actual outage shape: `eventsource-client`'s `onFetchResponse` fires
	 * `onConnect()` for ANY HTTP response, including a 503 that resolves and
	 * closes in the same tick — so a dead `/api` produced a `connect →
	 * invalidateQueries() → disconnect` cycle roughly every 2 seconds before
	 * this fix. A connection that dies before `CONNECT_SETTLE_MS` must never
	 * reach `invalidateQueries()`, no matter how many times it repeats.
	 */
	it('a FAILED reconnect (dies before CONNECT_SETTLE_MS) does not invalidate — not once, not on repeat', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!(); // first connect
		vi.advanceTimersByTime(CONNECT_SETTLE_MS); // settles — connectedOnce = true now

		// Three failed reconnect attempts in a row, each dying immediately —
		// the shape of a dead `/api` under `eventsource-client`'s own ~2s loop.
		for (let i = 0; i < 3; i++) {
			capturedOptions!.onConnect!();
			capturedOptions!.onDisconnect!();
			vi.advanceTimersByTime(CONNECT_SETTLE_MS);
		}

		expect(qc.invalidateQueries).not.toHaveBeenCalled();
	});

	it('a "changes" message applies its invalidations through the same path applyChangeEvents uses', async () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		fakeSource.push({
			event: 'changes',
			data: JSON.stringify([
				{
					type: 'update',
					kind: 'Rollout',
					namespace: 'team-a',
					name: 'app-1',
					cluster: 'hub',
					resourceVersion: '1',
					ts: 1
				}
			])
		});
		// Let the pump's microtask/await chain run. Fake timers are active in
		// this describe block (for `CONNECT_SETTLE_MS`), so advance them
		// rather than waiting on a real `setTimeout` that will never fire.
		await vi.advanceTimersByTimeAsync(0);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['rollouts', 'all'] });
	});
});

/**
 * ⭐ MULTI-CLUSTER — `event: clusters` feeds `isClusterStreamHealthy`/
 * `areAllClustersHealthy`, which `./errors`' `pollWhenHealthy`/
 * `staleTimeWhenHealthy` consult when a caller passes a `cluster`. Covered
 * here (not `events.test.ts`) because it needs the same fake EventSource
 * harness as the "changes" message above — this is stream WIRING, not the
 * pure per-kind mapping.
 */
describe('startEventStream — the `clusters` event and per-cluster health', () => {
	let startEventStream: typeof import('./events').startEventStream;
	let _resetEventStreamForTests: typeof import('./events')._resetEventStreamForTests;
	let isClusterStreamHealthy: typeof import('./events').isClusterStreamHealthy;
	let areAllClustersHealthy: typeof import('./events').areAllClustersHealthy;
	let isEventStreamHealthy: typeof import('./events').isEventStreamHealthy;

	beforeEach(async () => {
		vi.resetModules();
		capturedOptions = null;
		createEventSourceMock.mockClear();
		const mod = await import('./events');
		startEventStream = mod.startEventStream;
		_resetEventStreamForTests = mod._resetEventStreamForTests;
		isClusterStreamHealthy = mod.isClusterStreamHealthy;
		areAllClustersHealthy = mod.areAllClustersHealthy;
		isEventStreamHealthy = mod.isEventStreamHealthy;
	});

	afterEach(() => {
		_resetEventStreamForTests();
		vi.useRealTimers();
	});

	it('before the first `clusters` event, both fall back to the whole-stream signal — connection open = healthy', () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		expect(isEventStreamHealthy()).toBe(true);
		expect(isClusterStreamHealthy('dev-spoke')).toBe(true);
		expect(areAllClustersHealthy()).toBe(true);
	});

	it('a `clusters` event with one spoke down: that spoke reports unhealthy, a healthy sibling does not, and the fleet-wide check is false', async () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		fakeSource.push({
			event: 'clusters',
			data: JSON.stringify({ hub: true, 'dev-spoke': false, 'staging-spoke': true })
		});
		await new Promise((r) => setTimeout(r, 0));

		expect(isClusterStreamHealthy('dev-spoke')).toBe(false);
		expect(isClusterStreamHealthy('hub')).toBe(true);
		expect(isClusterStreamHealthy('staging-spoke')).toBe(true);
		// ⭐ one spoke down → the fleet-wide gate is false, even though the
		// whole EventSource connection is still up.
		expect(areAllClustersHealthy()).toBe(false);
	});

	it('an UNKNOWN cluster name (not in the last `clusters` event) falls back to the whole-stream signal, not to a hardcoded default', async () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		fakeSource.push({ event: 'clusters', data: JSON.stringify({ hub: true }) });
		await new Promise((r) => setTimeout(r, 0));

		expect(isClusterStreamHealthy('never-heard-of-this-cluster')).toBe(isEventStreamHealthy());
	});

	it('a full disconnect discards the last snapshot — every cluster (and the fleet gate) reports unhealthy until a fresh `clusters` event arrives', async () => {
		const qc = fakeQueryClient();
		startEventStream(qc as never);
		capturedOptions!.onConnect!();
		fakeSource.push({ event: 'clusters', data: JSON.stringify({ hub: true, 'dev-spoke': true }) });
		await new Promise((r) => setTimeout(r, 0));
		expect(isClusterStreamHealthy('dev-spoke')).toBe(true);

		capturedOptions!.onDisconnect!();

		expect(isEventStreamHealthy()).toBe(false);
		expect(isClusterStreamHealthy('dev-spoke')).toBe(false);
		expect(areAllClustersHealthy()).toBe(false);
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
