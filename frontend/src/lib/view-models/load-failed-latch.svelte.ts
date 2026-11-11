import { untrack } from 'svelte';
import { healthLoadFailed } from './health-witness';

/**
 * THE ONE KEYED "LOAD FAILED" LATCH (batch4, QA30). The rune wrapper around `healthLoadFailed` (health-witness.ts), used by every
 * region that shows `UnavailableCard`: the rollout Overview's health card and the Gates tab's fleet list. tanstack resets an errored
 * query that holds no data to `pending` while "Try again" refetches, so `isError` alone flips false and the card would be swapped for
 * a skeleton; the latch holds the failure until a success clears it, so the card stays and says "Checking…".
 *
 * KEYED: a client navigation that keeps the component instance but changes the query (another rollout) never inherits the latch.
 * Call during component init (it registers an `$effect`).
 */
export function createLoadFailedLatch(
	key: () => string,
	q: () => { isError: boolean; isSuccess: boolean }
): { readonly failed: boolean } {
	let state = $state({ key: '', failed: false });
	$effect(() => {
		const k = key();
		const query = q();
		const prev = untrack(() => state);
		state = {
			key: k,
			failed: healthLoadFailed(prev.key === k && prev.failed, {
				isError: query.isError,
				isSuccess: query.isSuccess
			})
		};
	});
	return {
		get failed() {
			return q().isError || (state.key === key() && state.failed);
		}
	};
}
