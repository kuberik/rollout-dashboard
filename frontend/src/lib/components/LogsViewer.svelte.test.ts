import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
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
				// Never resolves — mirrors the real stream's `isFetching: true` for
				// its whole life (see the `isLoading` comment in LogsViewer.svelte).
				// The component's only source of truth for "has anything come back
				// yet" is `onPodsUpdate`/log data, exactly as it is against the
				// live SSE connection.
				queryFn: () => new Promise<LogLine[]>(() => {})
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
