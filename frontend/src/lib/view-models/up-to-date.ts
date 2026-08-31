/**
 * The two sentences `UpToDate.svelte` prints, lifted out so they can be
 * pinned by a unit test.
 *
 * ⛔ WHY THIS IS A MODULE AND NOT MORE `$derived` IN THE COMPONENT.
 * (2026-08-31) A live critique of `/apps` caught the pair
 * `0 of 3 up to date` / `in all 3 environments` — the caption completing a
 * headline it does not belong to. `in all N environments` is the tail of
 * `All up to date` and was reached by FALL-THROUGH from an `if` chain with
 * nothing left to say. That is exactly the class of bug a unit test pins
 * permanently, and it could not be written while the sentence lived inside
 * a `$derived` in markup.
 */

export type UpToDateFacts = {
	/** Places running the newest version available to them. */
	onHead: number;
	/** Places that have deployed anything at all — the denominator. */
	deployed: number;
	/** Places configured, deployed or not. */
	total: number;
	/** Distinct versions across the deployed places. */
	spread?: number;
	pending?: number;
	diverged?: number;
	unknown?: number;
	/** What the denominator counts. Plural is derived, never passed. */
	noun?: string;
};

/** Every place that has deployed is on the newest version available to it. */
export function isAllCurrent(f: UpToDateFacts): boolean {
	return f.deployed > 0 && f.onHead === f.deployed;
}

/** Nothing has been deployed anywhere. */
export function isNowhere(f: UpToDateFacts): boolean {
	return f.deployed === 0;
}

export function upToDateHeadline(f: UpToDateFacts): string {
	if (isNowhere(f)) return 'Never deployed';
	if (isAllCurrent(f)) return 'All up to date';
	return `${f.onHead} of ${f.deployed} up to date`;
}

/**
 * THE CAPTION NEVER RESTATES THE HEADLINE, AND NEVER COMPLETES THE WRONG ONE.
 *
 * The headline carries `onHead/deployed`; this carries only what a distance
 * cannot say — how many different versions are live, and the places that have
 * no distance at all.
 *
 * The final branch asks WHICH headline it is completing:
 *   · converged and current → `in all N environments`, the tail of
 *     `All up to date`.
 *   · converged and BEHIND → the fact that actually distinguishes this row:
 *     they agree with each other and they are behind together. That shape is
 *     not an edge case; on the live hub it is `hello-world-app` on any
 *     settled day, and it is what produced the reported contradiction.
 */
export function upToDateCaption(f: UpToDateFacts): string {
	const noun = f.noun ?? 'environment';
	const plural = (n: number) => `${noun}${n === 1 ? '' : 's'}`;
	if (f.total === 0) return `no ${noun}s`;
	if (isNowhere(f)) return `${f.total} ${plural(f.total)} waiting`;

	const parts: string[] = [];
	if ((f.spread ?? 1) > 1) parts.push(`${f.spread} versions live`);
	if ((f.pending ?? 0) > 0) parts.push(`${f.pending} never deployed`);
	if ((f.diverged ?? 0) > 0) parts.push(`${f.diverged} unreleased`);
	if ((f.unknown ?? 0) > 0) parts.push(`${f.unknown} unknown`);
	if (parts.length > 0) return parts.join(' · ');

	if (isAllCurrent(f)) return `in all ${f.total} ${plural(f.total)}`;
	return `all ${f.deployed} on one older version`;
}
