import { describe, test, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { outageEscalation, ESCALATE_AFTER } from './outage-escalation.svelte';

/**
 * ⭐ ITEM 2 (AD palette round 8, squad-rollout coordinator, 2026-10-11, then
 * round 2): measured with every `/api` request answering 503, the rollout
 * Overview's primary button and pill flipped between "Try again"/"Checking…"
 * about every 4 seconds — the SSE reconnect loop (`lib/api/events.ts`)
 * force-refetched every active query on every reconnect attempt, far faster
 * than `RECOVERY_POLL_MS`. That storm is fixed at the source now, in
 * `events.ts` — but a round-2 60s sample still caught "Checking…" once per
 * automatic recheck (a real fact, just one a random screenshot must never
 * show unless a person pressed something). These pin the narrower fix:
 * `isRetrying` reads true ONLY for a pressed `retry()`, never for the
 * automatic recheck's own `isFetching` span, no matter how it is spaced.
 */

type Q = {
	isLoading: boolean;
	isError: boolean;
	isFetching: boolean;
	failureCount: number;
	error: unknown;
	failureReason: unknown;
	data: unknown;
	refetch: () => void;
};

function setup() {
	const refetch = vi.fn();
	const query = $state<Q>({
		isLoading: true,
		isError: false,
		isFetching: true,
		failureCount: 0,
		error: null,
		failureReason: null,
		data: undefined,
		refetch
	});
	let hook!: ReturnType<typeof outageEscalation>;
	const cleanup = $effect.root(() => {
		hook = outageEscalation(
			() => query,
			() => 'dev/checkout-api-dev/checkout-api'
		);
	});
	flushSync();

	/** Fails `ESCALATE_AFTER` times and settles — the tab is now on `ErrorState`. */
	function latch() {
		query.error = new Error('Request failed (503)');
		query.failureCount = ESCALATE_AFTER;
		query.isFetching = false;
		flushSync();
	}

	return { query, refetch, latch, get hook() { return hook; }, cleanup };
}

describe('outageEscalation: isRetrying ignores a background refetch storm', () => {
	afterEach(() => vi.useRealTimers());

	test('a sub-second background refetch after latching does not show "Checking"', () => {
		const { query, hook, latch, cleanup } = setup();
		try {
			latch();
			expect(hook.error).not.toBeNull();

			// The SSE reconnect storm forces a refetch well under RECOVERY_POLL_MS later.
			query.isFetching = true;
			flushSync();
			expect(hook.isRetrying).toBe(false);

			query.isFetching = false;
			flushSync();
			expect(hook.isRetrying).toBe(false);
		} finally {
			cleanup();
		}
	});

	test('a user-pressed retry() always shows "Checking", once', () => {
		const { query, refetch, hook, latch, cleanup } = setup();
		try {
			latch();

			hook.retry();
			expect(refetch).toHaveBeenCalledTimes(1);
			query.isFetching = true;
			flushSync();
			expect(hook.isRetrying).toBe(true);

			query.isFetching = false;
			flushSync();
			// The pressed flag does not outlive its own fetch.
			query.isFetching = true;
			flushSync();
			expect(hook.isRetrying).toBe(false);
		} finally {
			cleanup();
		}
	});

	test('even a refetch spaced a real RECOVERY_POLL_MS apart does NOT show "Checking" — only a press does', () => {
		vi.useFakeTimers();
		const { query, hook, latch, cleanup } = setup();
		try {
			latch();

			vi.advanceTimersByTime(30_000);
			query.isFetching = true;
			flushSync();
			// This IS the real, scheduled 30s recheck — and it still must not
			// read as "Checking…" unless the reader pressed the button.
			expect(hook.isRetrying).toBe(false);
		} finally {
			cleanup();
		}
	});
});
