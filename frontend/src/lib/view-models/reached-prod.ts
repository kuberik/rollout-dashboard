/**
 * REACHED PROD — which timestamps mark a release's FIRST deploy to a
 * production-tier environment. (Round 7 review, 2026-10-10: Home's Deploys
 * chart marks the bucket a build first reached prod with `emphasis: true`,
 * drawn in a darker fill by the shared `DeployBars`; /activity's own volume
 * chart didn't carry this layer yet.)
 *
 * Pure so the "first, not every" rule is provable without a browser: a
 * release redeployed to the SAME prod region twice only emphasises the
 * bucket its first prod deploy landed in — a second rollout to a region
 * already on that version isn't a new "reached prod" event.
 */

export type ReachedProdEntry = {
	/** Groups entries into one release — the same (app, version) pair
	 *  `medianTimeToProdMs` keys on. */
	releaseKey: string;
	timestampMs: number;
	isProd: boolean;
};

/** One timestamp per release that reached prod in the input — its
 *  EARLIEST prod-tier deploy. Releases that never reached prod are
 *  omitted; a release's own non-prod deploys don't produce a timestamp. */
export function reachedProdTimestamps(entries: readonly ReachedProdEntry[]): number[] {
	const first = new Map<string, number>();
	for (const e of entries) {
		if (!e.isProd) continue;
		const cur = first.get(e.releaseKey);
		if (cur === undefined || e.timestampMs < cur) first.set(e.releaseKey, e.timestampMs);
	}
	return [...first.values()];
}
