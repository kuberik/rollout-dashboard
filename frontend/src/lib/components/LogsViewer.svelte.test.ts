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

/**
 * ⭐ THE OTHER SEAM: `client.setQueryData`, NOT the fetch promise.
 * (2026-09-03, design pass 6, operator-walk finding #3) `capturedResolveLogs`
 * above SETTLES the fetch — fine for the null-crash and pod-filter suites,
 * which never needed `isFetching` to stay true once data existed, but wrong
 * for testing the `streaming` tone specifically: `connectionState` reads
 * `isPending || isFetching` (see its own comment in LogsViewer.svelte), and
 * resolving the mocked promise flips that false, landing on `closed` no
 * matter what data arrived. `context.client` is the same `QueryClient` the
 * real production write path uses (per this file's own comment above,
 * mirroring the SSE handler's `queryClient.setQueryData` push) — captured
 * here so a test can land data WITHOUT ever settling the fetch, exactly like
 * a real open stream pushing a batch mid-flight.
 */
let capturedPushLogs: ((logs: LogLine[]) => void) | null = null;

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
			const queryKey = ['test-logs', opts.namespace, opts.name, opts.filterType, opts.cluster];
			return {
				queryKey,
				// Never resolves on its own — mirrors the real stream's
				// `isFetching: true` for its whole life (see the `isLoading`
				// comment in LogsViewer.svelte). `capturedResolveLogs` is the
				// escape hatch a test can use to land a batch, exactly once,
				// whenever it chooses to.
				queryFn: (context: { client: { setQueryData: (key: unknown, data: LogLine[]) => void } }) => {
					capturedPushLogs = (logs: LogLine[]) => context.client.setQueryData(queryKey, logs);
					return new Promise<LogLine[]>((resolve) => {
						capturedResolveLogs = resolve;
					});
				}
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

import LogsViewer, {
	normalizePodsPayload,
	computeLineFreshness,
	FRESH_LINE_WINDOW_MS,
	truncateAtWordBoundary,
	lineCountLabel,
	applyNonSearchFilters,
	applySearchFilter,
	parseStructuredFields,
	structuredFieldTone,
	stripLogLinePrefix,
	truncateMiddle,
	podValueLabel,
	withSourceFields
} from './LogsViewer.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

afterEach(() => {
	capturedOnPodsUpdate = null;
	capturedResolveLogs = null;
	capturedPushLogs = null;
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

		// LOGOPEN (AD round 5, item 2): the `pods` snapshot always arrives a
		// beat before the backlog, so "no lines" is not a fact the moment it
		// lands. The pane holds its loaded-shape placeholder first and never
		// claims "nothing written" before the quiet grace has passed.
		await waitFor(() => expect(screen.getByText('Reading recent lines…')).toBeInTheDocument());
		expect(screen.queryByText('No log lines yet')).not.toBeInTheDocument();
		expect(screen.queryByText(/written nothing/)).not.toBeInTheDocument();
		// A `pods` event — even an honestly empty one — is proof the stream is
		// live, so the pane stops claiming it is still "connecting" and settles
		// on the informative empty state instead of spinning forever.
		await waitFor(() => expect(screen.getByText('No log lines yet')).toBeInTheDocument(), {
			timeout: 3000
		});
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
		await waitFor(() => expect(screen.getByText('No test output yet')).toBeInTheDocument(), {
			timeout: 3000
		});
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
		// (LOGOPEN: the empty state now waits out the quiet grace first.)
		const sentence = await screen.findByText(/finished .*ago/, {}, { timeout: 3000 });
		expect(sentence.textContent).toMatch(/hello-python-test/);
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

		await waitFor(() => expect(screen.getByText('No test output yet')).toBeInTheDocument(), {
			timeout: 3000
		});
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
			const dot = row.querySelector('span[data-pod]');
			const name = row.querySelector('span.log-pod-name');
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
		const pane = container.querySelector('.overflow-y-auto');
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

		// ⭐ THE CONTROL IS A `.pill` NOW, NOT A DROPDOWN CHECKBOX
		// (2026-10-08, design-language pass). Pods/containers/levels/columns
		// moved from Flowbite `Dropdown`+`Checkbox` menus to direct
		// `.pill` + `aria-pressed` buttons — one per pod, always visible, no
		// popover to open first. The pod's own name is the pill's
		// accessible name (the colour dot beside it carries no text).
		//
		// ⭐ TWO BUTTONS NOW SHARE THIS NAME (SPEC.md §2, Sources pane,
		// 2026-10-09): the `lg:hidden` toolbar pill AND the ≥1024 sidebar
		// row both name themselves after the pod — one is the mobile/
		// tablet fallback, the other the desktop master/detail, and only
		// one is ever actually visible at a given viewport (CSS this jsdom
		// environment does not evaluate, so both sit in the a11y tree at
		// once). `aria-pressed` is still what tells them apart: only the
		// `.pill` carries it, same as before this pane had a second control
		// with the identical name.
		const target = PODS[0];
		const pill = screen
			.getAllByRole('button', { name: target })
			.find((el) => el.hasAttribute('aria-pressed'))!;
		expect(pill).toHaveAttribute('aria-pressed', 'false');

		// This used to throw `Cannot read properties of undefined (reading
		// 'formattedTimestamp')` synchronously out of the click — see the
		// comment above. A regression here means the crash is back.
		expect(() => fireEvent.click(pill)).not.toThrow();

		await waitFor(() => {
			nudgeVirtualizer(container);
			const pods = renderedRowPods(container);
			expect(pods.size).toBe(1);
			expect(pods.has(target)).toBe(true);
		});

		// The pill's own pressed state agrees with the rows.
		expect(pill).toHaveAttribute('aria-pressed', 'true');

		// defect #7 (2026-09-03): one pod selected is one pod in view — the
		// header's own rollup already carries the count, so the row collapses
		// to a colour dot instead of repeating the name on every line.
		const rows = Array.from(container.querySelectorAll('[data-index]'));
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.querySelector('span.log-pod-name')).toBeNull();
			expect(row.querySelector('span[data-pod]')?.getAttribute('title')).toBe(target);
		}
	});
});

/**
 * ⭐ FINDING #3 (operator-walk, 2026-09-03). Three defects in one header: a
 * live dot claimed freshness over a buffer whose newest line was hours old,
 * Follow opened at the top of a real backlog instead of the bottom, and a
 * traceback in the buffer had no count anywhere on screen. The pure
 * `computeLineFreshness` boundary is covered directly; the error count and
 * its filter toggle are covered through the rendered Card rollup — the same
 * surface `rollupDot`'s hollow/filled state lives on.
 */
describe('computeLineFreshness — the boundary the hollow dot and the head sentence read', () => {
	test('no line has ever arrived: not live, no age to show', () => {
		expect(computeLineFreshness(null, Date.now())).toEqual({ live: false, staleForMs: null });
		expect(computeLineFreshness(undefined, Date.now())).toEqual({ live: false, staleForMs: null });
	});

	test('a line 10s old is live — the fresh window is 60s, and a live line carries no age', () => {
		const now = 1_000_000;
		expect(computeLineFreshness(now - 10_000, now)).toEqual({ live: true, staleForMs: null });
	});

	test('a line exactly at the window edge reads as stale — the comparison is strict `<`', () => {
		const now = 1_000_000;
		const result = computeLineFreshness(now - FRESH_LINE_WINDOW_MS, now);
		expect(result).toEqual({ live: false, staleForMs: FRESH_LINE_WINDOW_MS });
	});

	test('the literal reported bug: a 3-hour-old newest line is stale, with its exact age', () => {
		const now = 1_000_000_000;
		const threeHoursMs = 3 * 60 * 60 * 1000;
		expect(computeLineFreshness(now - threeHoursMs, now)).toEqual({
			live: false,
			staleForMs: threeHoursMs
		});
	});

	test('a timestamp ahead of `now` (clock skew) never reads as negatively stale', () => {
		const now = 1_000_000;
		const result = computeLineFreshness(now + 5_000, now);
		// Clamped to 0ms of age, which is inside the fresh window.
		expect(result).toEqual({ live: true, staleForMs: null });
	});
});

describe('LogsViewer: the header states the freshness of the DATA, not only the socket', () => {
	function findRollupDot(container: HTMLElement): HTMLElement | null {
		return container.querySelector('.card-header-rollup span.rounded-full');
	}

	// ⭐ UPDATED (art director round 2, must-fix: "'Live' uses a solid
	// success dot"). The hollow-vs-filled ring that used to carry the
	// stale/fresh distinction is gone — ONE dot now, always solid, always
	// `bg-success-solid` while connected. The stale-aware sentence
	// (`rollupDot.label`) survives entirely on the `title` attribute,
	// which is what these two tests assert now instead of a class
	// difference that no longer exists.
	test('a newest line 3 hours old still carries "last line … ago" on the dot\'s title, not a bare live claim', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedPushLogs).not.toBeNull());
		const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
		capturedPushLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'the last thing that happened',
				timestamp: threeHoursAgo,
				formattedTimestamp: '00:00:00'
			}
		]);

		await waitFor(() => {
			const dot = findRollupDot(container);
			expect(dot).not.toBeNull();
			expect(dot?.getAttribute('title')).toMatch(/Streaming — last line .+ ago/);
		});
		const dot = findRollupDot(container)!;
		expect(dot.className).toContain('bg-success-solid');
	});

	test('a newest line that just arrived renders the plain "Streaming" title, no age', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedPushLogs).not.toBeNull());
		capturedPushLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'just written',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			}
		]);

		await waitFor(() => {
			const dot = findRollupDot(container);
			expect(dot?.getAttribute('title')).toBe('Streaming');
		});
		const dot = findRollupDot(container)!;
		expect(dot.className).toContain('bg-success-solid');
	});
});

describe('LogsViewer: the error count and its filter toggle', () => {
	function nudge(container: HTMLElement) {
		const pane = container.querySelector('.overflow-y-auto');
		if (pane) fireEvent.scroll(pane);
	}

	test('one ERROR-level line renders "1 error", and clicking it narrows the pane to just that line', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'starting up',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			},
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'ERROR: traceback follows',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:01'
			},
			{
				pod: 'pod-b',
				container: 'app',
				type: 'pod',
				line: 'still fine',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:02'
			}
		]);

		const errorButton = await screen.findByRole('button', { name: '1 error' });
		expect(errorButton).toHaveAttribute('aria-pressed', 'false');

		await waitFor(() => {
			nudge(container);
			expect(container.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
		});

		await fireEvent.click(errorButton);

		await waitFor(() => {
			nudge(container);
			const rows = Array.from(container.querySelectorAll('[data-index]'));
			expect(rows.length).toBe(1);
			// ⭐ UPDATED (squad-rollout coordinator review, 2026-10-09): the
			// level word now lives in its OWN column (`stripLogLinePrefix`),
			// not repeated inline in the message — the row's textContent is
			// "error" (the level cell) + "traceback follows" (the message
			// cell, "ERROR: " stripped off the front), not the original raw
			// line's "ERROR: traceback follows" as one unbroken string.
			expect(rows[0].textContent).toMatch(/error/i);
			expect(rows[0].textContent).toMatch(/traceback follows/);
		});
		expect(errorButton).toHaveAttribute('aria-pressed', 'true');

		// Clicking again clears the filter — the same control is the on/off
		// switch, not a one-way narrowing.
		await fireEvent.click(errorButton);
		await waitFor(() => {
			nudge(container);
			expect(container.querySelectorAll('[data-index]').length).toBe(3);
		});
		expect(errorButton).toHaveAttribute('aria-pressed', 'false');
	});

	test('with no ERROR-level lines in the buffer, no error control renders at all', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'all good here',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			}
		]);

		await waitFor(() => {
			nudge(container);
			expect(container.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
		});
		expect(screen.queryByRole('button', { name: /error/ })).not.toBeInTheDocument();
	});
});

describe('LogsViewer: a FAILED rollout opens on its errors (logs round 9, item 2)', () => {
	function nudge(container: HTMLElement) {
		const pane = container.querySelector('.overflow-y-auto');
		if (pane) fireEvent.scroll(pane);
	}

	const failedRollout = {
		status: { history: [{ bakeStatus: 'Failed', version: { tag: 'b-9' } }] }
	} as never;

	const calmRollout = {
		status: { history: [{ bakeStatus: 'Succeeded', version: { tag: 'b-9' } }] }
	} as never;

	test('a FAILED rollout auto-applies the Error filter and shows the state line, anchored at the latest error', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: {
					namespace: 'hello-world-prod',
					name: 'hello-world-app',
					filterType: 'pod',
					rollout: failedRollout
				}
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'starting up',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			},
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'ERROR: traceback follows',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:01'
			},
			{
				pod: 'pod-b',
				container: 'app',
				type: 'pod',
				line: 'still fine',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:02'
			}
		]);

		// The filter applied itself — no click needed — and the rollup
		// button reflects that it is already on.
		const errorButton = await screen.findByRole('button', { name: '1 error' });
		await waitFor(() => expect(errorButton).toHaveAttribute('aria-pressed', 'true'));

		// The state line names the count and offers the way out.
		// LOGOPEN round 7, item 3: one count, in the footer, with the way out.
		expect(await screen.findByText(/^Errors only · 3 lines$/)).toBeInTheDocument();
		const showAll = screen.getByRole('button', { name: 'Show all lines' });

		await waitFor(() => {
			nudge(container);
			const rows = Array.from(container.querySelectorAll('[data-index]'));
			expect(rows.length).toBe(1);
			expect(rows[0].textContent).toMatch(/traceback follows/);
		});

		// "Show all lines" clears the filter, same as toggling the rollup
		// button itself.
		await fireEvent.click(showAll);
		await waitFor(() => {
			nudge(container);
			expect(container.querySelectorAll('[data-index]').length).toBe(3);
		});
		expect(errorButton).toHaveAttribute('aria-pressed', 'false');
	});

	test('a calm, healthy build opens on all lines — the Error filter stays off', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: {
					namespace: 'hello-world-prod',
					name: 'hello-world-app',
					filterType: 'pod',
					rollout: calmRollout
				}
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'ERROR: a transient blip, already recovered',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			},
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'all good here',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:01'
			}
		]);

		const errorButton = await screen.findByRole('button', { name: '1 error' });
		expect(errorButton).toHaveAttribute('aria-pressed', 'false');
		expect(screen.queryByRole('button', { name: 'Show all lines' })).not.toBeInTheDocument();

		await waitFor(() => {
			nudge(container);
			expect(container.querySelectorAll('[data-index]').length).toBe(2);
		});
	});

	test('clicking the rollup "N errors" control shows the same state line a FAILED rollout opens with', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: {
					namespace: 'hello-world-prod',
					name: 'hello-world-app',
					filterType: 'pod',
					rollout: calmRollout
				}
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'ERROR: boom',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:00'
			},
			{
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: 'all good',
				timestamp: Date.now(),
				formattedTimestamp: '00:00:01'
			}
		]);

		const errorButton = await screen.findByRole('button', { name: '1 error' });
		await fireEvent.click(errorButton);

		expect(await screen.findByText(/^Errors only · 2 lines$/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show all lines' })).toBeInTheDocument();
	});
});

/**
 * ⭐ L5 "the log viewer survives a 60fps capture" (2026-09-12). Long lines
 * used to hard-clip at the pane's right edge mid-token, relying on the
 * pane's own horizontal scrollbar (easy to miss, invisible in a fixed-frame
 * video capture) to reach the rest. `truncateAtWordBoundary` is the pure cut
 * — the row's own rendered width feeds `maxChars` live (see the `$effect` in
 * `LogsViewer.svelte`), this only owns "given a budget, where does the
 * ellipsis land."
 */
describe('truncateAtWordBoundary — the unwrapped message column never shears a word', () => {
	test('text within budget is returned unchanged', () => {
		expect(truncateAtWordBoundary('short line', 80)).toBe('short line');
	});

	test('text exactly at the budget is returned unchanged', () => {
		expect(truncateAtWordBoundary('exactly ten', 11)).toBe('exactly ten');
	});

	test('a long sentence cuts at the last whole word before budget, never mid-word', () => {
		const text = 'Failed to connect to redis at redis-master.cache.svc.cluster.local:6379';
		const result = truncateAtWordBoundary(text, 30);
		expect(result.endsWith('…')).toBe(true);
		expect(result.length).toBeLessThanOrEqual(30);
		// The character right before the ellipsis is never mid-word: the
		// text with the ellipsis stripped is a PREFIX of the original that
		// ends exactly where a space did in the source.
		const withoutEllipsis = result.slice(0, -1);
		expect(text.startsWith(withoutEllipsis)).toBe(true);
		const nextChar = text[withoutEllipsis.length];
		expect(nextChar === ' ' || nextChar === undefined).toBe(true);
	});

	test('one long unbroken token with no whitespace hard-cuts at budget (the one case with no boundary to honour)', () => {
		const text = 'a'.repeat(100);
		const result = truncateAtWordBoundary(text, 20);
		expect(result).toBe(`${'a'.repeat(19)}…`);
		expect(result.length).toBe(20);
	});

	test('an empty budget does not throw and returns the text unchanged', () => {
		expect(() => truncateAtWordBoundary('anything', 0)).not.toThrow();
	});
});

/**
 * The search box's own result count — "2 of 214 lines" — shares this exact
 * sentence with the panel's existing footer stat (`lineCountLabel`), so the
 * two can never drift into two spellings of "how many lines match."
 */
describe('lineCountLabel — one sentence, shared by the search count and the footer', () => {
	test('the canonical shape', () => {
		expect(lineCountLabel(2, 214)).toBe('2 of 214 lines');
	});

	test('singular noun only when the TOTAL is exactly one', () => {
		expect(lineCountLabel(1, 1)).toBe('1 of 1 line');
	});

	test('zero matches is still a true sentence, not hidden', () => {
		expect(lineCountLabel(0, 42)).toBe('0 of 42 lines');
	});

	test('large counts get locale grouping, same as every other figure in this file', () => {
		expect(lineCountLabel(2, 2140)).toBe('2 of 2,140 lines');
	});
});

/**
 * `applyNonSearchFilters`/`applySearchFilter` are `filteredLogs` split at its
 * own joint (see the module-script comment) so the search box can report its
 * own scope. Covered directly here because the render-level pod-filter tests
 * above already exercise them indirectly, but not the search predicate or
 * the split itself.
 */
describe('applyNonSearchFilters / applySearchFilter — the search box measures against its own scope', () => {
	function getLevel(line: string): 'error' | 'warn' | 'info' | 'debug' | null {
		const upper = line.toUpperCase();
		if (upper.includes('ERROR')) return 'error';
		if (upper.includes('WARN')) return 'warn';
		return null;
	}

	const lines = [
		{ pod: 'pod-a', container: 'app', line: 'INFO all good' },
		{ pod: 'pod-a', container: 'app', line: 'ERROR redis unavailable' },
		{ pod: 'pod-b', container: 'sidecar', line: 'WARN retrying' },
		{ pod: 'pod-b', container: 'app', line: 'ERROR timeout' }
	];

	test('no filters is a pass-through', () => {
		const result = applyNonSearchFilters(
			lines,
			{ pods: new Set(), containers: new Set(), levels: new Set() },
			getLevel
		);
		expect(result).toEqual(lines);
	});

	test('pod, container and level filters AND together', () => {
		const result = applyNonSearchFilters(
			lines,
			{ pods: new Set(['pod-b']), containers: new Set(), levels: new Set(['error']) },
			getLevel
		);
		expect(result).toEqual([{ pod: 'pod-b', container: 'app', line: 'ERROR timeout' }]);
	});

	test('search matches the line, pod, or container, case-insensitively', () => {
		expect(applySearchFilter(lines, 'error')).toHaveLength(2);
		expect(applySearchFilter(lines, 'SIDECAR')).toEqual([lines[2]]);
		expect(applySearchFilter(lines, '')).toEqual(lines);
	});

	test('the count is of MATCHING LINES, not occurrences — a line matching twice still counts once', () => {
		const repeated = [{ pod: 'p', container: 'c', line: 'ERROR ERROR ERROR' }];
		expect(applySearchFilter(repeated, 'error')).toHaveLength(1);
	});

	test('search narrows what non-search filters already scoped to, not the raw unfiltered set', () => {
		const scoped = applyNonSearchFilters(
			lines,
			{ pods: new Set(['pod-a']), containers: new Set(), levels: new Set() },
			getLevel
		);
		expect(scoped).toHaveLength(2);
		const searched = applySearchFilter(scoped, 'error');
		expect(searched).toEqual([{ pod: 'pod-a', container: 'app', line: 'ERROR redis unavailable' }]);
	});
});

/**
 * ⭐ Render-level: the search box reports its own count once a query is
 * typed, and the footer no longer restates the identical fact when search is
 * the only active filter (2026-09-12, L5).
 */
describe('LogsViewer: the search box reports "N of M lines" once a query is typed', () => {
	test('typing a query renders the inline count beside the input, and the footer stays silent (search-only case)', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});

		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!([
			{ pod: 'pod-a', container: 'app', type: 'pod', line: 'all good here', timestamp: 1, formattedTimestamp: '00:00:01' },
			{ pod: 'pod-a', container: 'app', type: 'pod', line: 'ERROR something broke', timestamp: 2, formattedTimestamp: '00:00:02' },
			{ pod: 'pod-b', container: 'app', type: 'pod', line: 'still fine', timestamp: 3, formattedTimestamp: '00:00:03' }
		]);

		// No result label before anything is typed.
		expect(screen.queryByText(/of \d+ lines?/)).not.toBeInTheDocument();

		const search = screen.getByLabelText('Search logs');
		await fireEvent.input(search, { target: { value: 'ERROR' } });

		await waitFor(() => {
			expect(screen.getByText('1 of 3 lines')).toBeInTheDocument();
		});

		// Search is the ONLY active filter: the footer's own combined-filter
		// stat must not also render the same fact a second time.
		expect(screen.queryByText('1/3 lines')).not.toBeInTheDocument();
	});
});

/**
 * ⭐ squad-rollout coordinator addendum (2026-10-09): the structured-line
 * expand popover and the log-volume histogram, both pure-function tested
 * the same way the rest of this file's parsing/formatting logic is — see
 * `parseStructuredFields`/`computeHistogramBuckets`'s own doc comments in
 * the module script for why each shape was chosen.
 */
describe('parseStructuredFields — the structured-line expand trigger', () => {
	test('a logfmt line with 2+ key=value pairs parses in order', () => {
		expect(
			parseStructuredFields('GET /checkout/session 200 11ms | request_id=req_a0119f | cache=HIT')
		).toEqual([
			// LOGOPEN, item 6: the access-log head is parsed into fields too.
			{ key: 'method', value: 'GET' },
			{ key: 'path', value: '/checkout/session' },
			{ key: 'status', value: '200' },
			{ key: 'latency', value: '11ms' },
			{ key: 'request_id', value: 'req_a0119f' },
			{ key: 'cache', value: 'HIT' }
		]);
	});

	test('a single key=value pair is not enough to call it structured', () => {
		expect(parseStructuredFields('threshold=200ms')).toBeNull();
	});

	test('an embedded JSON object parses into its own fields, nested values re-stringified', () => {
		const line = 'Processing webhook payload: {"event":"order.completed","amount":149.99,"meta":{"source":"web"}}';
		expect(parseStructuredFields(line)).toEqual([
			{ key: 'event', value: 'order.completed' },
			{ key: 'amount', value: '149.99' },
			{ key: 'meta', value: '{"source":"web"}' }
		]);
	});

	test('a plain prose line with no pairs and no JSON has nothing to expand', () => {
		expect(parseStructuredFields('Ready to accept connections on 0.0.0.0:8080')).toBeNull();
	});

	test('malformed JSON-looking text falls back to the logfmt attempt instead of throwing', () => {
		expect(() => parseStructuredFields('config={not: valid, json} level=info')).not.toThrow();
	});
});

describe('structuredFieldTone — only an adverse HTTP status earns danger ink', () => {
	test('a status field at or above 500 is danger', () => {
		expect(structuredFieldTone({ key: 'status', value: '503' })).toBe('danger');
		expect(structuredFieldTone({ key: 'status_code', value: '500' })).toBe('danger');
	});

	test('a status field below 500 is not danger', () => {
		expect(structuredFieldTone({ key: 'status', value: '200' })).toBeNull();
	});

	test('a non-status field is never coloured, even if its value happens to be a big number', () => {
		expect(structuredFieldTone({ key: 'order_id', value: '509' })).toBeNull();
	});
});

describe('withSourceFields — pod and container in the expand (logs round 9, item 3)', () => {
	test('prepends pod and container ahead of the line\'s own parsed fields', () => {
		expect(
			withSourceFields(
				{ pod: 'hello-world-abc123', container: 'app' },
				[{ key: 'request_id', value: 'req_a0119f' }]
			)
		).toEqual([
			{ key: 'pod', value: 'hello-world-abc123' },
			{ key: 'container', value: 'app' },
			{ key: 'request_id', value: 'req_a0119f' }
		]);
	});

	test('still prepends pod and container when the line parsed no fields of its own', () => {
		expect(withSourceFields({ pod: 'pod-a', container: 'test-runner' }, [])).toEqual([
			{ key: 'pod', value: 'pod-a' },
			{ key: 'container', value: 'test-runner' }
		]);
	});
});

/**
 * ⭐ THE HISTOGRAM INSIDE THE CONSOLE (designer, 2026-10-10). The strip's
 * own math (window, buckets, drag) is unit-tested in
 * LogHistogram.svelte.test.ts; these tests pin its WIRING: a drag or click
 * filters the stream, Clear restores it, it follows the level filter, and
 * it survives a filter that hides every line. The window ends at NOW, so
 * the fixture's lines are stamped relative to the real clock.
 *
 * jsdom has no layout, so the strip resolves the slot under the pointer
 * with `document.elementFromPoint` (mocked here to return the bar the
 * test's synthetic pointer should land on).
 */
describe('LogsViewer: the histogram filters the stream to a time window', () => {
	function recentLogLines(count: number, level = 'INFO'): LogLine[] {
		const now = Date.now();
		return Array.from({ length: count }, (_, i) => ({
			pod: 'pod-a',
			container: 'app',
			type: 'pod',
			line: `${i % 4 === 0 ? 'ERROR' : level} line ${i}`,
			timestamp: now - (count - i) * 1000,
			formattedTimestamp: `00:00:${String(i).padStart(2, '0')}`
		}));
	}

	function nudge(container: HTMLElement) {
		const pane = container.querySelector('.overflow-y-auto');
		if (pane) fireEvent.scroll(pane);
	}

	function stubElementFromPoint(target: Element) {
		if (!('elementFromPoint' in document)) {
			(document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint =
				() => null;
		}
		return vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
	}

	async function renderWithLines(lines: LogLine[]) {
		const utils = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});
		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!(lines);
		await waitFor(() => {
			nudge(utils.container);
			expect(utils.container.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
		});
		return utils;
	}

	function filledBars(container: HTMLElement): HTMLElement[] {
		return Array.from(container.querySelectorAll<HTMLElement>('[data-histogram-bar]')).filter(
			(b) => Number(b.dataset.total) > 0
		);
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('a drag from one bar to another narrows the stream; Clear (outside the plot) restores it', async () => {
		const { container } = await renderWithLines(recentLogLines(40));
		const bars = await waitFor(() => {
			const found = filledBars(container);
			expect(found.length).toBeGreaterThan(10);
			return found;
		});

		expect(screen.getByText(/^40 lines$/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Clear time window/ })).not.toBeInTheDocument();

		const spy = stubElementFromPoint(bars[bars.length - 5]);
		await fireEvent.pointerDown(bars[5], { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
		await fireEvent.pointerMove(document, { clientX: 200, clientY: 10, pointerId: 1 });
		await fireEvent.pointerUp(document, { clientX: 200, clientY: 10, pointerId: 1 });
		spy.mockRestore();

		const clear = await screen.findByRole('button', { name: /Clear time window/ });
		// Clear is in the right gutter, not inside the plot.
		expect(clear.closest('[role="slider"]')).toBeNull();
		await waitFor(() => {
			expect(screen.getByText(/in this window$/).textContent).toMatch(/^\d+ lines? in this window$/); // LOGOPEN r7: the count follows the window
		});
		expect(container.querySelector('[data-histogram-band]')).not.toBeNull();

		await fireEvent.click(clear);
		await waitFor(() => {
			expect(screen.getByText(/^40 lines$/)).toBeInTheDocument();
			expect(container.querySelector('[data-histogram-band]')).toBeNull();
		});
	});

	test('a plain click (no movement) selects the one bucket it landed on', async () => {
		const { container } = await renderWithLines(recentLogLines(40));
		const bars = await waitFor(() => {
			const found = filledBars(container);
			expect(found.length).toBeGreaterThan(10);
			return found;
		});
		const spy = stubElementFromPoint(bars[10]);
		await fireEvent.pointerDown(bars[10], { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
		await fireEvent.pointerUp(document, { clientX: 10, clientY: 10, pointerId: 1 });
		spy.mockRestore();

		await screen.findByRole('button', { name: /Clear time window/ });
		expect(screen.getByText(/in this window$/).textContent).toMatch(/^\d+ lines? in this window$/); // LOGOPEN r7: the count follows the window
	});

	test('LOGOPEN r8: the Error filter changes the stream, never the chart', async () => {
		const { container } = await renderWithLines(recentLogLines(40));
		const totals = () =>
			Array.from(container.querySelectorAll<HTMLElement>('[data-histogram-bar]')).map((b) => b.dataset.total);
		await waitFor(() => expect(container.querySelector('[data-segment="total"]')).not.toBeNull());
		const before = totals();

		await fireEvent.click(screen.getByRole('button', { name: /^Error/ }));
		await waitFor(() => expect(screen.getByRole('button', { name: /^Error/ })).toHaveAttribute('aria-pressed', 'true'));
		expect(totals()).toEqual(before);
		// One neutral fill, never a stacked error segment.
		expect(container.querySelector('[data-segment="error"]')).toBeNull();
	});

	test('it survives a search that hides every line: the strip stays, bars and all', async () => {
		const { container } = await renderWithLines(recentLogLines(40));
		await waitFor(() => expect(filledBars(container).length).toBeGreaterThan(10));

		await fireEvent.input(screen.getByLabelText('Search logs'), {
			target: { value: 'no-line-says-this' }
		});
		await waitFor(() => {
			expect(screen.getByText('No lines match the current filters')).toBeInTheDocument();
		});
		expect(container.querySelector('[data-log-histogram]')).not.toBeNull();
		expect(filledBars(container).length).toBeGreaterThan(10);
	});
});

/**
 * ⭐ squad-rollout coordinator review (2026-10-09): the Level column strips
 * a leading ISO timestamp + level word off the raw line, so the message
 * column never repeats either.
 */
describe('stripLogLinePrefix — the Level column, not a second timestamp', () => {
	test('a timestamp + level prefix is stripped; the level is lifted out', () => {
		expect(stripLogLinePrefix('2026-10-09T16:44:37.341Z INFO Starting server on :8080')).toEqual({
			level: 'info',
			message: 'Starting server on :8080'
		});
	});

	test('FATAL and CRITICAL both classify as error, same as getLogLevel', () => {
		expect(stripLogLinePrefix('2026-10-09T00:00:00.000Z FATAL out of memory').level).toBe('error');
		expect(stripLogLinePrefix('2026-10-09T00:00:00.000Z CRITICAL disk full').level).toBe('error');
	});

	test('WARN and WARNING both classify as warn', () => {
		expect(stripLogLinePrefix('WARN retrying').level).toBe('warn');
		expect(stripLogLinePrefix('WARNING retrying').level).toBe('warn');
	});

	test('a level word with no leading timestamp still strips', () => {
		expect(stripLogLinePrefix('ERROR: traceback follows')).toEqual({
			level: 'error',
			message: 'traceback follows'
		});
	});

	test('a line with neither a timestamp nor a level word is returned unchanged, level null', () => {
		expect(stripLogLinePrefix('Ready to accept connections on 0.0.0.0:8080')).toEqual({
			level: null,
			message: 'Ready to accept connections on 0.0.0.0:8080'
		});
	});

	test('a level word mentioned mid-sentence (not front-anchored) is NOT lifted out', () => {
		// Front-anchored only — see this function's own doc comment for why
		// ("retrying after an ERROR" should not grow a badge and lose its
		// own leading words).
		expect(stripLogLinePrefix('Retrying after an ERROR occurred').level).toBeNull();
	});
});

/**
 * ⭐ art director round 1, must-fix #7: a test run's own name keeps its
 * distinguishing tail (the sha/retry suffix) instead of losing it to a
 * trailing `truncate`.
 */
describe('truncateMiddle — a test run name keeps its own distinguishing tail', () => {
	test('a name within budget is returned unchanged', () => {
		expect(truncateMiddle('short-name', 22)).toBe('short-name');
	});

	test('a long name keeps its tail, not just its head', () => {
		const result = truncateMiddle('hello-world-test-f68d0ac-retry-2', 22);
		expect(result.length).toBeLessThanOrEqual(22);
		expect(result.endsWith('retry-2')).toBe(true);
		expect(result).toContain('…');
	});

	test('the tail length is honoured even for a short budget', () => {
		const result = truncateMiddle('abcdefghijklmnopqrstuvwxyz', 12, 8);
		expect(result.endsWith('stuvwxyz')).toBe(true);
	});
});

/**
 * ⭐ THE CONSOLE OPENS AT ITS NEWEST LINE (LOGOPEN, AD round 5, items 1, 3
 * and 9). Frame traces at 1440 showed the well painting at `scrollTop` 0
 * (the OLDEST line) and only moving when the next streamed line arrived,
 * 3.7s/5.6s later, and the catch-up leaving the newest row 21-36px under
 * the footer. jsdom has no layout, so the well's box is stubbed: 100 rows
 * of 20px in a 400px well, the bottom being exactly `scrollTop` 1600.
 * `scrollTop` is a stored value here (jsdom does not clamp it), clamped to
 * the real range the way a browser does.
 */
describe('LogsViewer: opening and staying at the latest (LOGOPEN)', () => {
	const WELL_SCROLL_HEIGHT = 2000;
	const WELL_CLIENT_HEIGHT = 400;
	const stored = new WeakMap<Element, number>();
	const isWell = (el: Element) => el.hasAttribute('data-log-well');
	const original = {
		scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
		clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
		scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
	};
	function stubWell() {
		Object.defineProperty(Element.prototype, 'scrollHeight', {
			configurable: true,
			get() {
				return isWell(this) ? WELL_SCROLL_HEIGHT : 0;
			}
		});
		Object.defineProperty(Element.prototype, 'clientHeight', {
			configurable: true,
			get() {
				return isWell(this) ? WELL_CLIENT_HEIGHT : 0;
			}
		});
		Object.defineProperty(Element.prototype, 'scrollTop', {
			configurable: true,
			get() {
				return stored.get(this) ?? 0;
			},
			set(v: number) {
				const max = isWell(this) ? WELL_SCROLL_HEIGHT - WELL_CLIENT_HEIGHT : 0;
				stored.set(this, Math.max(0, Math.min(max, v)));
			}
		});
	}
	function restoreWell() {
		for (const [k, d] of Object.entries(original)) {
			if (d) Object.defineProperty(Element.prototype, k, d);
		}
	}

	function lines(n: number, errorEvery = 0): LogLine[] {
		return Array.from({ length: n }, (_, i) => ({
			pod: i % 2 ? 'pod-a' : 'pod-b',
			container: 'app',
			type: 'pod',
			line: errorEvery && i % errorEvery === 0 ? `ERROR line ${i}` : `INFO line ${i}`,
			timestamp: Date.now() - (n - i) * 1000,
			formattedTimestamp: ''
		}));
	}

	const failedRollout = {
		status: { history: [{ bakeStatus: 'Failed', version: { tag: 'b-9' } }] }
	} as never;

	test('the first batch lands at the newest line, before the well is shown', async () => {
		stubWell();
		try {
			const { container } = render(WithQueryClient, {
				props: {
					component: LogsViewer as never,
					props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
				}
			});
			await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
			capturedResolveLogs!(lines(100));
			await waitFor(() => {
				const well = container.querySelector('[data-log-well]') as HTMLElement;
				expect(well).not.toBeNull();
				// Flush with the bottom: the newest row's bottom edge on the
				// well's bottom edge, not a partial row under the footer.
				expect(well.scrollTop).toBe(WELL_SCROLL_HEIGHT - WELL_CLIENT_HEIGHT);
				expect(well.style.visibility).not.toBe('hidden');
			});
			// At the latest, there is no "Jump to latest" control.
			expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();
		} finally {
			restoreWell();
		}
	});

	test('a FAILED build opens its Error view at the NEWEST error', async () => {
		stubWell();
		try {
			const { container } = render(WithQueryClient, {
				props: {
					component: LogsViewer as never,
					props: {
						namespace: 'hello-world-prod',
						name: 'hello-world-app',
						filterType: 'pod',
						rollout: failedRollout
					}
				}
			});
			await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
			capturedResolveLogs!(lines(300, 3));
			await screen.findByText(/^Errors only · 300 lines$/);
			await waitFor(() => {
				const well = container.querySelector('[data-log-well]') as HTMLElement;
				expect(well.scrollTop).toBe(WELL_SCROLL_HEIGHT - WELL_CLIENT_HEIGHT);
			});
		} finally {
			restoreWell();
		}
	});

	test('any filter change re-anchors at the newest match (the rollup "N errors" tap too)', async () => {
		stubWell();
		try {
			const { container } = render(WithQueryClient, {
				props: {
					component: LogsViewer as never,
					props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
				}
			});
			await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
			capturedResolveLogs!(lines(300, 3));
			const well = () => container.querySelector('[data-log-well]') as HTMLElement;
			await waitFor(() => expect(well().scrollTop).toBe(1600));
			// The reader scrolls to the top (a real gesture, so Follow pauses).
			await fireEvent.wheel(well());
			well().scrollTop = 0;
			await fireEvent.scroll(well());
			expect(await screen.findByRole('button', { name: /Jump to latest/ })).toBeInTheDocument();
			// The rollup's "100 errors" is a filter change: newest match.
			await fireEvent.click(screen.getByRole('button', { name: /^\d+ errors$/ }));
			await waitFor(() => expect(well().scrollTop).toBe(1600));
			await waitFor(() =>
				expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument()
			);
		} finally {
			restoreWell();
		}
	});

	test('round 7: while loading, no counts and no Live, and a failed build has Error on from the first frame', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: {
					namespace: 'hello-world-prod',
					name: 'hello-world-app',
					filterType: 'pod',
					rollout: failedRollout
				}
			}
		});
		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());
		const error = screen.getAllByRole('button').find((b) => b.classList.contains('pill') && /Error/.test(b.textContent ?? ''))!;
		expect(error).toHaveAttribute('aria-pressed', 'true');
		expect(error.textContent).not.toMatch(/\d/);
		expect(screen.queryByText('Live')).not.toBeInTheDocument();
		expect(screen.queryByText(/\d+ lines?$/)).not.toBeInTheDocument();
	});

	test('LOGOPEN r8: on the phone an open line pauses Follow and freezes the list; new lines wait behind "N new"', async () => {
		const innerWidth = window.innerWidth;
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		try {
			const { container } = render(WithQueryClient, {
				props: {
					component: LogsViewer as never,
					props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
				}
			});
			await waitFor(() => expect(capturedPushLogs).not.toBeNull());
			const base = Array.from({ length: 5 }, (_, i) => ({
				pod: 'pod-a',
				container: 'app',
				type: 'pod',
				line: `GET /checkout/session 200 ${i}ms | request_id=r${i} | cache=HIT`,
				timestamp: Date.now() - (5 - i) * 1000,
				formattedTimestamp: ''
			}));
			capturedPushLogs!(base);
			await waitFor(() => expect(container.querySelectorAll('[data-phone-row]').length).toBe(5));
			// Tap the row: a structured row is one button, time line included.
			await fireEvent.click(container.querySelectorAll('[data-phone-row] > button')[2]);
			await waitFor(() => expect(container.querySelector('[data-phone-row] dl')).not.toBeNull());
			expect(screen.getByText('Paused')).toBeInTheDocument();

			capturedPushLogs!([
				...base,
				{ ...base[0], line: 'GET /checkout/session 200 99ms | request_id=new | cache=HIT', timestamp: Date.now() }
			]);
			const pill = await screen.findByRole('button', { name: 'Show 1 new line' });
			// Frozen: the new line is counted, not inserted above the open one.
			expect(container.querySelectorAll('[data-phone-row]').length).toBe(5);
			await fireEvent.click(pill);
			await waitFor(() => expect(container.querySelectorAll('[data-phone-row]').length).toBe(6));
			expect(container.querySelector('[data-phone-row] dl')).not.toBeNull();
		} finally {
			scrollTo.mockRestore();
			Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
		}
	});

	test('the phone lists newest first and never scrolls the document on open', async () => {
		const innerWidth = window.innerWidth;
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		try {
			const { container } = render(WithQueryClient, {
				props: {
					component: LogsViewer as never,
					props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
				}
			});
			await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
			capturedResolveLogs!(lines(20));
			await waitFor(() => {
				const rows = container.querySelectorAll('[data-phone-row]');
				expect(rows.length).toBe(20);
				expect(rows[0].textContent).toMatch(/line 19\b/);
				expect(rows[19].textContent).toMatch(/line 0\b/);
			});
			expect(scrollTo).not.toHaveBeenCalled();
		} finally {
			scrollTo.mockRestore();
			Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
		}
	});

	/** Renders the phone viewer at 390 with `n` lines; returns helpers. */
	async function phoneWith(n: number, errorEvery: number, structured = false) {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		const { container } = render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'pod' }
			}
		});
		await waitFor(() => expect(capturedResolveLogs).not.toBeNull());
		capturedResolveLogs!(
			lines(n, errorEvery).map((l, i) =>
				structured ? { ...l, line: `${l.line} | request_id=r${i} | cache=HIT` } : l
			)
		);
		const rows = () => container.querySelectorAll('[data-phone-row]');
		return { container, rows };
	}

	test('the phone list is bounded: 100 rows and a fold; the fold reveals the next 100; a filter resets it', async () => {
		const innerWidth = window.innerWidth;
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		try {
			const { rows } = await phoneWith(400, 2);
			await waitFor(() => expect(rows().length).toBe(100));
			const fold = await screen.findByRole('button', { name: /Show 100 earlier lines/ });
			expect(fold.textContent).toMatch(/\(of 400 total\)/);
			await fireEvent.click(fold);
			await waitFor(() => expect(rows().length).toBe(200));
			// A filter is a new list: back to the first page of it (200 errors).
			await fireEvent.click(screen.getByRole('button', { name: /^200 errors$/ }));
			await waitFor(() => expect(rows().length).toBe(100));
			expect(screen.getByRole('button', { name: /Show 100 earlier lines/ }).textContent).toMatch(
				/\(of 200 total\)/
			);
		} finally {
			scrollTo.mockRestore();
			Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
		}
	});

	test('phone: "Show in context" with a filter on clears it and the frozen list shows the unfiltered lines', async () => {
		const innerWidth = window.innerWidth;
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		Element.prototype.scrollIntoView = vi.fn();
		try {
			const { rows } = await phoneWith(400, 3, true);
			await waitFor(() => expect(rows().length).toBe(100));
			await fireEvent.click(screen.getByRole('button', { name: /^134 errors$/ }));
			await waitFor(() => expect(rows().length).toBe(100));
			expect([...rows()].every((r) => /ERROR/.test(r.textContent ?? ''))).toBe(true);
			// Open an error: this freezes the list (a snapshot of the FILTERED rows).
			await fireEvent.click(rows()[3].querySelector('button')!);
			await waitFor(() => expect(rows()[3].querySelector('dl')).not.toBeNull());
			await fireEvent.click(await screen.findByRole('button', { name: /Show in context/ }));
			await waitFor(() =>
				expect([...rows()].some((r) => /INFO line/.test(r.textContent ?? ''))).toBe(true)
			);
			// The opened line is still open, in the unfiltered list.
			expect(document.querySelector('[data-phone-row] dl')).not.toBeNull();
		} finally {
			scrollTo.mockRestore();
			Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
		}
	});
});

describe('podValueLabel — the pod value is its distinguishing suffix (LOGOPEN r9, item 4)', () => {
	test('a pod name shows only its last segment, behind an ellipsis', () => {
		expect(podValueLabel('checkout-worker-a02f1c4-5d6f7b9c8-n9p1v')).toBe('…n9p1v');
	});
	test('a name without a dash is shown whole', () => {
		expect(podValueLabel('standalone')).toBe('standalone');
	});
	test('a trailing dash is not an empty suffix', () => {
		expect(podValueLabel('odd-')).toBe('odd-');
	});
});
