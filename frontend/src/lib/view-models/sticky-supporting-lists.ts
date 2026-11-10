/**
 * QA (TL follow-up 2): the fleet list's supporting lists (`kruiseRollouts`, `kustomizations`) arrive empty when the server's read of them fails
 * (the response says nothing: see `partialReads` in api/rollouts.ts, which `/api/rollouts` does not fill). `derivePipeline` reads an empty
 * list as "no canary", so one such poll redrew a 5-stage strand (6 dots) as the 2-node fallback (3 dots) and the next poll drew it back:
 * the step count of the same rollout changed by load order. A list that was populated and comes back empty while the rollouts are still
 * there is a failed read, not a fact: keep the last populated list until a populated one arrives.
 */
export function stickyList<T>(prev: readonly T[] | null, next: readonly T[], rolloutsPresent: boolean): readonly T[] {
	if (next.length > 0 || !rolloutsPresent) return next;
	return prev && prev.length > 0 ? prev : next;
}
