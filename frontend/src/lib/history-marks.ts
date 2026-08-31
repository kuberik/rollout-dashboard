/**
 * ⛔ THE PAGE WHOSE JOB IS HISTORY WAS THE ONE PAGE THAT HID THE ROLLBACK.
 *
 * Measured on the live hub 2026-08-30, `hello-world-prod/hello-world-app`:
 * five deploys, five green ticks, five `Succeeded` badges, a header reading
 * **100% success** — and TWO of the five moved production BACKWARDS.
 *
 *     idx 0  991829b  release 5   ← 14 releases back from what it replaced
 *     idx 1  0afab6f  release 19
 *     idx 2  51b976a  release 0   ← 7 releases back from what it replaced
 *     idx 3  aa17645  release 7
 *     idx 4  51b976a  release 0
 *
 * `/` and `/rollouts` both flag that state AT REST (`rollout-cards.ts::
 * detectRollback` / `cardStateMark`). The history tab said the word only
 * inside an expanded row — and the audit string it printed there said
 * "Pinned version", which loses the rollback entirely.
 *
 * ⛔ WHY THIS IS NOT `detectRollback`. That function answers ONE question —
 * "is this rollout, right now, running something older than what it replaced?"
 * — and it is deliberately keyed to `history[0]` vs `history[1]`, because that
 * is the only pair a LIST card can draw. A history page has to ask the same
 * question of EVERY adjacent pair. Same rule, applied n times.
 *
 * `rollout-cards.ts` is the definition of record and is NOT duplicated here in
 * spirit: `history-marks.test.ts` asserts `deployActs(r)[0]` and
 * `detectRollback(r)` agree on every fixture, so the two can never drift into
 * telling an operator two different stories about the same deploy.
 *
 * ⚠️ IT RETURNS `null` RATHER THAN GUESSING — same contract as `detectRollback`.
 * `availableReleases` is the controller's oldest→newest ordering and it is the
 * ONLY ordering there is; a version that has aged out of it, or a hand-written
 * tag that was never in it, has no position, and an absent record is not an
 * observation. Timestamps cannot substitute: they order the DEPLOYS, never the
 * RELEASES.
 */

import type { Rollout } from '../types';
import { getDisplayVersion } from './utils';

/** What one history entry DID, relative to the entry it replaced. */
export type DeployAct =
	| {
			kind: 'rollback';
			/** How many releases backwards, in `availableReleases` positions. */
			by: number;
			from: string;
			to: string;
			/** The product's word, for a chip at rest. */
			word: string;
			/** One sentence stating what happened, for a title and for `sr-only`. */
			sentence: string;
	  }
	| { kind: 'forward'; by: number; from: string; to: string; word: string; sentence: string }
	| { kind: 'redeploy'; word: string; sentence: string }
	/** No predecessor, or no position to compare — say nothing. */
	| null;

// The OCI tag identifies a release; `version` is the display form. Real cluster
// payloads carry both. Same accessor as `rollout-cards.ts::releaseKey`, which
// is module-private there.
function releaseKey(v: { tag?: string; version?: string } | undefined): string | null {
	return v?.tag || v?.version || null;
}

/**
 * One act per history entry, index-aligned with `rollout.status.history`.
 * The oldest entry is always `null` — nothing precedes it to move away from.
 */
export function deployActs(r: Rollout | null | undefined): DeployAct[] {
	const history = r?.status?.history ?? [];
	const releases = r?.status?.availableReleases ?? [];
	const keys = releases.map((x) => releaseKey(x));

	return history.map((entry, i) => {
		const prev = history[i + 1];
		if (!prev) return null;
		const nowKey = releaseKey(entry.version);
		const prevKey = releaseKey(prev.version);
		if (!nowKey || !prevKey) return null;

		const from = getDisplayVersion(prev.version);
		const to = getDisplayVersion(entry.version);

		if (nowKey === prevKey) {
			return {
				kind: 'redeploy' as const,
				word: 'Redeployed',
				sentence: `Redeployed the same release, ${to}.`
			};
		}

		const nowIdx = keys.indexOf(nowKey);
		const prevIdx = keys.indexOf(prevKey);
		if (nowIdx === -1 || prevIdx === -1) return null;

		const by = Math.abs(prevIdx - nowIdx);
		const plural = by === 1 ? '' : 's';
		if (nowIdx < prevIdx) {
			return {
				kind: 'rollback' as const,
				by,
				from,
				to,
				word: 'Rolled back',
				sentence: `Rolled back ${by} release${plural}: ${from} → ${to}.`
			};
		}
		return {
			kind: 'forward' as const,
			by,
			from,
			to,
			word: 'Moved forward',
			sentence: `Moved forward ${by} release${plural}: ${from} → ${to}.`
		};
	});
}

/**
 * How many of these deploys went backwards. This is the number the history
 * header's `100% success` was standing in front of: a rollback IS a successful
 * deploy, so a success rate can never contain it, and the two facts have to be
 * stated side by side.
 */
export function rollbackCount(r: Rollout | null | undefined): number {
	return deployActs(r).filter((a) => a?.kind === 'rollback').length;
}
