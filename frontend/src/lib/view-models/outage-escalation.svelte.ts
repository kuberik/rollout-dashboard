/**
 * WHEN "STILL TRYING" STOPS BEING AN ANSWER. (PALROW r8, AD palette round 7,
 * item 3; squad-rollout coordinator, 2026-10-10.)
 *
 * Measured with every `/api` request answering 503: the rollout Overview sat
 * on "The server did not answer (2 attempts) — trying again" for 75 seconds
 * and more, and never reached `ErrorState`. The page left its loading branch
 * only on `query.isError`, and a polled query rarely settles there during an
 * outage. Each refetch cycle starts pending again, and TanStack zeroes
 * `failureCount` at the start of every fetch, so the notice's counter went
 * 2 → 1 instead of climbing (the shot at 25s read "did not answer — trying
 * again" with no count at all).
 *
 * So the escalation LATCHES: once the query has failed `ESCALATE_AFTER`
 * times in a row (or reached `isError`) with no data, the tab shows
 * `ErrorState` ("Cannot reach the dashboard server", the Requested card,
 * Try again, Where to look) and stays there through later retry cycles,
 * until data arrives or the tab moves to another rollout (`key`). The
 * error it hands `ErrorState` is the query's own `error`, else its
 * `failureReason`, else the last reason seen, so the page never invents a
 * message the server did not send.
 *
 * Two failures, not three: with `MAX_RETRIES = 2` the third attempt is the
 * last, and it is the one the notice above showed hanging. Two consecutive
 * failed answers are already the fact the reader needs.
 *
 * ⭐ ITEM 2 (AD palette round 8, squad-rollout coordinator, 2026-10-11):
 * "Try again" / "Checking…" and the pill's "Rechecking every 30s" /
 * "Checking now…" flipped every ~4s, 21 requests to the rollout endpoint in
 * 29 seconds. The root cause was upstream of this file — `lib/api/events.ts`'s
 * SSE change stream reconnected continuously against a dead `/api` and
 * called `queryClient.invalidateQueries()` with no filter on every attempt,
 * forcing every active query (this rollout, permissions, schedules, …) to
 * refetch in lockstep, far faster than `RECOVERY_POLL_MS`. That is fixed at
 * the source now (`events.ts`'s own `onConnect`/`onDisconnect`, squad-rollout
 * coordinator round 2) — but a `/api` outage still drives this rollout's own
 * query through its bounded retry policy every `RECOVERY_POLL_MS`, and
 * `isFetching` is true for the whole of that, including every TanStack retry
 * inside it. A 60s sample still caught that: the button flips to "Checking…"
 * for the span of the automatic recheck, which is a REAL fact but one a
 * random screenshot must never show unless a person actually pressed
 * something (coordinator, round 2: "must never show that unless someone
 * pressed retry"). So `isRetrying` below is narrowed to ONLY a pressed
 * `retry()` — the chip's "Rechecking every 30s" / "Checking now…" distinction
 * is dropped in favour of always reading the former (see `ErrorState.svelte`'s
 * `selfHealing` chip, unchanged markup, now fed a prop that is simply never
 * true on its own). The recheck itself is untouched — it still fires every
 * `RECOVERY_POLL_MS` and still heals the page — only the DISPLAY of "a request
 * happens to be in flight right now" is gone, because nothing earns the
 * reader's attention here except their own press.
 */
export const ESCALATE_AFTER = 2;

type QueryLike = {
	isLoading: boolean;
	isError: boolean;
	isFetching: boolean;
	failureCount: number;
	error: unknown;
	failureReason: unknown;
	data: unknown;
	refetch: () => unknown;
};

export function outageEscalation(query: () => QueryLike, key: () => string) {
	let latched = $state(false);
	let lastReason = $state<unknown>(null);
	let latchedKey = $state('');
	// See the file doc comment, item 2: only a pressed `retry()` may ever
	// read as "Checking…" — the automatic recheck's own `isFetching` span is
	// deliberately not read here any more.
	let manualRetry = $state(false);
	let wasFetching = false;

	$effect(() => {
		const q = query();
		const k = key();
		if (k !== latchedKey) {
			latchedKey = k;
			latched = false;
			lastReason = null;
			manualRetry = false;
			wasFetching = false;
		}
		if (q.data) {
			latched = false;
			lastReason = null;
		} else {
			const reason = q.error ?? q.failureReason;
			if (reason) lastReason = reason;
			if (q.isError || q.failureCount >= ESCALATE_AFTER) latched = true;
		}
		// The pressed flag does not outlive its own fetch — the NEXT fetch
		// (automatic or pressed again) starts from "not pressed" and has to
		// earn "Checking…" again.
		if (!q.isFetching && wasFetching) {
			manualRetry = false;
		}
		wasFetching = q.isFetching;
	});

	return {
		/** True while the tab should still draw its loading skeleton. */
		get loading(): boolean {
			const q = query();
			return q.isLoading && !q.isError && !latched;
		},
		/** The error to hand `ErrorState`, or null when there is none. */
		get error(): unknown {
			const q = query();
			if (q.isError) return q.error;
			if (latched && !q.data) return q.error ?? q.failureReason ?? lastReason;
			return null;
		},
		/** Call this from the "Try again" button — the one press that always shows "Checking…". */
		retry(): void {
			manualRetry = true;
			query().refetch();
		},
		/**
		 * True only for a user-pressed `retry()`, in flight — never for the
		 * automatic recheck's own `isFetching` span. See the file doc
		 * comment, item 2.
		 */
		get isRetrying(): boolean {
			const q = query();
			return manualRetry && q.isFetching;
		}
	};
}
