import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import type { LogLine, PodInfo } from '$lib/api/logs';
import type { RolloutTestsResponse } from '$lib/api/rollouts';

/**
 * ⛔ `null.forEach` — LOGS TAB, `filterType="test"`, ONCE PER `broadcastPodsLoop`
 * TICK (2s). Go's `json.Marshal` on a nil `[]PodInfo` slice (`var pods
 * []PodInfo`, never appended to because the filter matched nothing) writes
 * the JSON literal `null`, not `[]`. `handlePodsUpdate` called
 * `newPods.forEach(...)` with no guard, so every rollout with a Tests tab
 * and zero test pods crashed on a 2s cadence the instant it was opened. This
 * is an HONEST empty set on the wire, not a contract violation — the fix is
 * `normalizePodsPayload` (exported from `LogsViewer.svelte`'s module script,
 * same pattern as `GateRecord.svelte`'s `gateMark`), not a backend change.
 *
 * The render-level test below reproduces the exact failure mode: it captures
 * the `onPodsUpdate` callback `LogsViewer` hands to the stream layer and
 * calls it with `null` directly, the same shape the real `pods` SSE event
 * decodes to via `JSON.parse('null')`. Before the fix this threw synchronously
 * out of the callback; after it, the component both survives it AND stops
 * showing "Connecting to pods…" forever, because a `pods` snapshot — even an
 * empty one — is now treated as proof the stream is open.
 */

let capturedOnPodsUpdate: ((pods: PodInfo[] | null) => void) | null = null;

/**
 * The real stream's `queryFn` never resolves — see the comment below — and
 * log LINES actually land in the cache the same way the real SSE handler
 * lands them: an external `queryClient.setQueryData` call, not the fetch
 * promise. `capturedResolveLogs` is that seam for tests: capture the
 * in-flight fetch's own `resolve`, let the component finish mounting (and
 * its `onMount` reset-to-`[]` run) first, THEN call it — mirroring "the
 * stream pushed a batch after the pane opened", which is also what avoids a
 * hazard the first version of this harness hit: resolving synchronously,
 * before `onMount`, let the mount-time `queryClient.setQueryData(key, [])`
 * reset win the race and silently discard the seeded rows.
 */
let capturedResolveLogs: ((logs: LogLine[]) => void) | null = null;

vi.mock('$lib/api/logs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/logs')>();
	return {
		...actual,
		logsStreamQueryOptions: (opts: {
			namespace: string;
			name: string;
			filterType?: string;
			onPodsUpdate?: (pods: PodInfo[] | null) => void;
			cluster?: string;
		}) => {
			capturedOnPodsUpdate = opts.onPodsUpdate ?? null;
			return {
				queryKey: ['test-logs', opts.namespace, opts.name, opts.filterType, opts.cluster],
				// Never resolves on its own — mirrors the real stream's
				// `isFetching: true` for its whole life (see the `isLoading`
				// comment in LogsViewer.svelte). `capturedResolveLogs` is the
				// escape hatch a test can use to land a batch, exactly once,
				// whenever it chooses to.
				queryFn: () =>
					new Promise<LogLine[]>((resolve) => {
						capturedResolveLogs = resolve;
					})
			};
		}
	};
});

/**
 * `rolloutTestsQueryOptions` is what the Tests view's empty state reads to
 * name the last run instead of talking about "pods" — see the defect #5
 * comment on `lastTestRun` in `LogsViewer.svelte`. Controllable per test via
 * `rolloutTestsResponse`, defaulting to an honestly empty set so tests that
 * don't care about it still resolve instead of hanging on an unmocked fetch.
 */
let rolloutTestsResponse: RolloutTestsResponse = { rolloutTests: { items: [] } };

vi.mock('$lib/api/rollouts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api/rollouts')>();
	return {
		...actual,
		rolloutTestsQueryOptions: (opts: { namespace: string; name: string }) => ({
			queryKey: ['test-rollout-tests', opts.namespace, opts.name],
			queryFn: () => Promise.resolve(rolloutTestsResponse)
		})
	};
});

import LogsViewer, { normalizePodsPayload } from './LogsViewer.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

afterEach(() => {
	capturedOnPodsUpdate = null;
	capturedResolveLogs = null;
	rolloutTestsResponse = { rolloutTests: { items: [] } };
});

describe('normalizePodsPayload — the pure edge the crash lived in', () => {
	test('null becomes an empty array, not a throw', () => {
		expect(() => normalizePodsPayload(null)).not.toThrow();
		expect(normalizePodsPayload(null)).toEqual([]);
	});

	test('undefined is treated the same as null', () => {
		expect(normalizePodsPayload(undefined)).toEqual([]);
	});

	test('a real payload passes through unchanged', () => {
		const pods: PodInfo[] = [{ name: 'hello-app-abc123', namespace: 'hello-world-prod', type: 'pod' }];
		expect(normalizePodsPayload(pods)).toEqual(pods);
	});
});

describe('LogsViewer: a null pods payload does not crash the Tests tab, and does not spin forever', () => {
	test('feeding handlePodsUpdate a null payload throws nothing', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());

		// This is the exact call that used to throw `TypeError: Cannot read
		// properties of null (reading 'forEach')` every ~2s.
		expect(() => capturedOnPodsUpdate!(null)).not.toThrow();
	});

	test('before any pods event on the Tests view: the pane says Connecting to test runs, not Connecting to pods', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());

		// defect #5: the Tests view is not the Pods view with a different data
		// source — its own connecting caption says so.
		expect(screen.getByText('Connecting to test runs…')).toBeInTheDocument();
		expect(screen.queryByText('Connecting to pods…')).not.toBeInTheDocument();
		// The literal reported bug: "Stream closed" must not print while the
		// header is still saying "Connecting…" — they are two readings of the
		// same fact and can no longer disagree.
		expect(screen.queryByText('Stream closed')).not.toBeInTheDocument();
	});

	test('before any pods event on the Pods view: the caption is still Connecting to pods (the untouched half of defect #5)', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());

		expect(screen.getByText('Connecting to pods…')).toBeInTheDocument();
	});

	test('a null pods snapshot on the Pods view resolves to the pod-flavoured empty state, unchanged', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());
		capturedOnPodsUpdate!(null);

		// A `pods` event — even an honestly empty one — is proof the stream is
		// live, so the pane stops claiming it is still "connecting" and settles
		// on the informative empty state instead of spinning forever.
		await waitFor(() => expect(screen.getByText('No log lines yet')).toBeInTheDocument());
		expect(screen.queryByText('Connecting to pods…')).not.toBeInTheDocument();
		// And the closed-stream caption must not appear either: the connection
		// is open, just quiet. Only one of the three captions may ever be true.
		expect(screen.queryByText('Stream closed')).not.toBeInTheDocument();
	});

	test('a null pods snapshot on the Tests view does not say "the pods have written nothing"', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());
		capturedOnPodsUpdate!(null);

		// defect #5's literal reported bug: a rollout with zero test PODS but a
		// completed test RUN read "the pods have written nothing", which is
		// both the wrong noun and, once a run is known, the wrong claim.
		await waitFor(() => expect(screen.getByText('No test output yet')).toBeInTheDocument());
		expect(screen.queryByText(/the pods have written nothing/)).not.toBeInTheDocument();
		expect(screen.queryByText('No log lines yet')).not.toBeInTheDocument();
		expect(screen.queryByText('Connecting to test runs…')).not.toBeInTheDocument();
	});

	test('the Tests view empty state names the last run when RolloutTest status says when it finished', async () => {
		// `RolloutTest.spec` is required by the generated CRD type and irrelevant
		// to this test — `lastTestRun` (LogsViewer.svelte) only reads `metadata`
		// and `status`. Cast rather than pad out a real job template nobody
		// asserts against.
		rolloutTestsResponse = {
			rolloutTests: {
				items: [
					{
						metadata: { name: 'hello-python-test', namespace: 'hello-world-prod' },
						status: {
							phase: 'Succeeded',
							jobName: 'hello-python-test',
							conditions: [
								{
									type: 'Complete',
									status: 'True',
									reason: 'JobSucceeded',
									message: '',
									lastTransitionTime: new Date(Date.now() - 6 * 60 * 1000).toISOString()
								}
							]
						}
					}
				]
			}
		} as unknown as RolloutTestsResponse;

		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());
		capturedOnPodsUpdate!(null);

		// The name and a relative "ago" — not a claim that no run exists.
		await waitFor(() => expect(screen.getByText('hello-python-test')).toBeInTheDocument());
		expect(screen.getByText(/finished .*ago/)).toBeInTheDocument();
	});

	test('the Tests view empty state stays honest when no completed run is known', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());
		capturedOnPodsUpdate!(null);

		await waitFor(() => expect(screen.getByText('No test output yet')).toBeInTheDocument());
		// No fabricated run name or time — the honest empty, not a lie dressed
		// up as a fact.
		expect(screen.queryByText(/finished .*ago/)).not.toBeInTheDocument();
	});
});

/**
 * ⛔ THE VIRTUALIZER COUNT-SYNC RACE (F9, 2026-09-03). Selecting one pod out
 * of several in the `Source` filter updated `selectedPods` and its badge
 * immediately (both pure state), but the rendered rows kept showing every
 * pod. Root cause, reproduced live against `hello-multi-dev/hello-multi-app`
 * (5 real pods, real SSE volume) with a playwright-core script: TWO
 * `$effect`s each called `$virtualizer.setOptions({ count })`, and reading
 * `$virtualizer` (the `$`-prefixed store subscription) inside an `$effect`
 * makes that effect a subscriber of every future emission the store
 * produces — including the one `setOptions` itself triggers via `onChange`
 * — so they ping-ponged. One extra plain read of `$virtualizer.options.count`
 * (added temporarily to log the race) was enough to tip it into Svelte's own
 * `effect_update_depth_exceeded`. See `LogsViewer.svelte`'s own comments on
 * the write-side effect (one effect now, tracked and self-guarding — the
 * loop was two independent effects racing, not "an effect reads
 * `$virtualizer`" by itself) and on `virtualItems` (filtered to
 * `item.index < allLogLines.length`, closing a real one-render-tick gap
 * between a `$derived` filter recomputing and the write-side `$effect`
 * getting its next turn — captured live: `allLogLines.length` fell from
 * 5005 to 1001 while `$virtualizer.options.count` was still 5005, handing
 * back indices up to 3037 and crashing on
 * `allLogLines[3037].formattedTimestamp`).
 *
 * jsdom NOTE: `@tanstack/virtual-core` only computes a virtual range when
 * `outerSize > 0` (`calculateRange`'s own memo: `measurements.length > 0 &&
 * outerSize > 0 ? calculateRange(...) : null`), and jsdom's layout engine
 * always reports `offsetHeight`/`offsetWidth` as `0` — there IS no layout.
 * Without a stub, `virtualItems` is `[]` regardless of how correct the
 * count-sync is, and every assertion in this suite would vacuously pass
 * (zero rows "satisfies" zero-of-one-pod too). The stub below gives the
 * scroll pane a realistic size so the virtualizer actually produces rows to
 * assert against.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
	configurable: true,
	get() {
		return 600;
	}
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
	configurable: true,
	get() {
		return 800;
	}
});

/**
 * flowbite-svelte's `Popper` (behind `Dropdown`, used by the `Source`
 * filter this suite drives) calls the native Popover API (`showPopover`/
 * `hidePopover`) and animates its fade transition with `Element.animate`
 * on open/close — neither exists in jsdom. Without these no-op stubs the
 * dropdown opening in the test below throws asynchronously (outside the
 * test's own try/catch, since it fires from a transition lifecycle
 * callback), which vitest reports as an unhandled error and fails the
 * whole file even though every assertion passed. Unrelated to the
 * virtualizer bug this file exists to catch — just jsdom's usual gap
 * around anything the real browser does natively.
 */
if (!HTMLElement.prototype.showPopover) {
	HTMLElement.prototype.showPopover = function () {};
	HTMLElement.prototype.hidePopover = function () {};
}
if (!Element.prototype.animate) {
	const stubAnimate = () =>
		({
			finished: Promise.resolve(undefined as unknown as Animation),
			cancel: () => {},
			play: () => {},
			pause: () => {},
			addEventListener: () => {},
			removeEventListener: () => {}
		}) as unknown as Animation;
	Element.prototype.animate = stubAnimate;
}

describe('LogsViewer: selecting one pod actually narrows the rendered rows', () => {
	const PODS = ['pod-alpha', 'pod-beta', 'pod-gamma', 'pod-delta'];

	function interleavedLogLines(): LogLine[] {
		const lines: LogLine[] = [];
		for (let i = 0; i < 15; i++) {
			for (const pod of PODS) {
				lines.push({
					pod,
					container: 'app',
					type: 'pod',
					line: `${pod} line ${i}`,
					timestamp: i * 1000,
					formattedTimestamp: `00:00:0${i % 10}`
				});
			}
		}
		return lines;
	}

	function renderedRowPods(container: HTMLElement): Set<string | null> {
		const rows = Array.from(container.querySelectorAll('[data-index]'));
		const pods = new Set<string | null>();
		for (const row of rows) {
			// singlePodMode collapses the pod column to a colour dot carrying
			// `title`; multi-pod mode prints the name as text. Either way the
			// pod identity for a row is recoverable from the DOM.
			const dot = row.querySelector('span[title]');
			const name = row.querySelector('span.font-semibold');
			pods.add(dot?.getAttribute('title') ?? name?.textContent ?? null);
		}
		return pods;
	}

	/**
	 * jsdom fires no native `scroll` event for a programmatic `scrollTop`
	 * assignment (`LogsViewer`'s own auto-scroll does exactly that in
	 * `scrollToBottom()`), and `@tanstack/virtual-core` only re-notifies its
	 * Svelte store from inside `observeElementOffset`/`observeElementRect`'s
	 * own scroll/resize callbacks (see `getVirtualIndexes` and `maybeNotify`
	 * in `virtual-core`) — a `setOptions({ count })` call alone, with no
	 * scroll/resize event, updates the instance's data (verified directly:
	 * `inst.getVirtualItems()` is correct immediately) but never PUSHES that
	 * to `$virtualizer` subscribers on its own. Dispatching a synthetic
	 * `scroll` event on the pane is what a real browser does for free the
	 * moment `scrollTop` changes; jsdom needs it spelled out.
	 */
	function nudgeVirtualizer(container: HTMLElement) {
		const pane = container.querySelector('.overflow-auto');
		if (pane) fireEvent.scroll(pane);
	}

	test('before selecting: rows span every discovered pod (sanity check on the fixture)', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-multi-dev', name: 'hello-multi-app', filterType: 'pod' }
			}
		});

		// Let `onMount`'s reset-to-`[]` land first, exactly like the real
		// stream's SSE push always arrives after the pane's own reset — then
		// hand the query its data via the captured resolver.
		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!(interleavedLogLines());

		await waitFor(() => {
			nudgeVirtualizer(container);
			expect(container.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			nudgeVirtualizer(container);
			expect(renderedRowPods(container).size).toBe(PODS.length);
		});
	});

	test('selecting one pod in the Source filter leaves only that pod on screen', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-multi-dev', name: 'hello-multi-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!(interleavedLogLines());

		await waitFor(() => {
			nudgeVirtualizer(container);
			expect(container.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			nudgeVirtualizer(container);
			expect(renderedRowPods(container).size).toBe(PODS.length);
		});

		// The exact control the live bug was found through: the `Source`
		// dropdown's per-pod checkbox, labelled by its wrapping `<label>`.
		// flowbite-svelte's `Dropdown`/`Popper` only renders its items once
		// opened, and it opens on `mousedown` (its click-trigger toggles on
		// `mousedown`, not `click` — see `Popper.svelte`'s `_open_popover`).
		await fireEvent.mouseDown(screen.getByRole('button', { name: /Source/ }));
		const target = PODS[0];
		// `Popper`'s click trigger is debounced 200ms (`DEFAULT_TRIGGER_DELAY`,
		// via `requestAnimationFrame` polling in `createMutualDebounce`) before
		// `isOpen` actually flips — comfortably under 1s alone, but tight
		// against the default `findByRole` timeout when the whole suite is
		// running and rAF ticks are competing for CPU. A generous explicit
		// timeout avoids flaking on load rather than on this test's own logic.
		const checkbox = await screen.findByRole(
			'checkbox',
			{ name: target },
			{ timeout: 5000 }
		);

		// This used to throw `Cannot read properties of undefined (reading
		// 'formattedTimestamp')` synchronously out of the click — see the
		// comment above. A regression here means the crash is back.
		expect(() => fireEvent.click(checkbox)).not.toThrow();

		await waitFor(() => {
			nudgeVirtualizer(container);
			const pods = renderedRowPods(container);
			expect(pods.size).toBe(1);
			expect(pods.has(target)).toBe(true);
		});

		// The badge and the checkbox both agree with the rows.
		expect(screen.getByText('1')).toBeInTheDocument();
		expect(checkbox).toBeChecked();

		// defect #7 (2026-09-03): one pod selected is one pod in view — the
		// header's own rollup already carries the count, so the row collapses
		// to a colour dot instead of repeating the name on every line.
		const rows = Array.from(container.querySelectorAll('[data-index]'));
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.querySelector('span.font-semibold')).toBeNull();
			expect(row.querySelector('span[title]')?.getAttribute('title')).toBe(target);
		}
	});
});
