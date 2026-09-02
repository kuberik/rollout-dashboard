import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { LogLine, PodInfo } from '$lib/api/logs';

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

import LogsViewer, { normalizePodsPayload } from './LogsViewer.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

afterEach(() => {
	capturedOnPodsUpdate = null;
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

	test('before any pods event: the pane says Connecting, not Stream closed, not both', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
			}
		});

		await waitFor(() => expect(capturedOnPodsUpdate).not.toBeNull());

		expect(screen.getByText('Connecting to pods…')).toBeInTheDocument();
		// The literal reported bug: "Stream closed" must not print while the
		// header is still saying "Connecting…" — they are two readings of the
		// same fact and can no longer disagree.
		expect(screen.queryByText('Stream closed')).not.toBeInTheDocument();
	});

	test('a null pods snapshot resolves the pane to ONE honest state — not stuck connecting, not a duplicate status', async () => {
		render(WithQueryClient, {
			props: {
				component: LogsViewer as never,
				props: { namespace: 'hello-world-prod', name: 'hello-world-app', filterType: 'test' }
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
});
