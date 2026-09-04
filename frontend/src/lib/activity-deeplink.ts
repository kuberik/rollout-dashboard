import { formatDate } from './utils';

/**
 * ⭐ THE FEED'S OWN DEEP-LINK KEY — NOT `history-deeplink.ts`'s.
 *
 * (2026-09-04) `/activity` needed the same three effects rollout detail's
 * `revealEntry` already gives the History tab — a chart mark selects, scrolls
 * to and announces its row below — but `history-deeplink.ts`'s `deployKey` is
 * a REVISION SLUG, which is only unique because that page is scoped to ONE
 * rollout's `status.history[]`. `/activity` mixes ~15 rollouts in one feed, so
 * two different apps landing on the same sha (a shared base image, a fresh
 * `main` after a merge) would collide, and a rollback re-deploying a build
 * already in ITS OWN history collides with itself across two different
 * moments in time.
 *
 * The identity that IS unique on this page is the one `{#each dayGroup.entries
 * as entry (...)}` already keys its rows by: which rollout, and when. Rollout
 * identity + timestamp, not revision — the same pairing `chartServices`
 * builds its lanes' `history[]` from (see that derivation's own
 * `rolloutNamespace`/`rolloutName` fields), so a chart mark and a feed row for
 * the same deploy always compute the identical string.
 */
export const ACTIVITY_DEPLOY_PARAM = 'deploy';

/** The shape this module needs off either a feed row or a chart lane's own
    history entry — both `ActivityEntry` (the page) and `chartServices[i].history[j]`
    (fed to `DeploymentTimeline`) satisfy it. */
export type FeedEntryLike = {
	rolloutNamespace: string;
	rolloutName: string;
	timestamp: string;
};

/**
 * The correlation key: `<namespace>/<name>/<timestamp>`. Timestamps on this
 * feed come from `status.history[].deployTime`, which is per-transition —
 * two entries for the same rollout at the identical instant would mean two
 * deploys landed in the same millisecond, which the API does not produce.
 */
export function entryKey(e: FeedEntryLike): string {
	return `${e.rolloutNamespace}/${e.rolloutName}/${e.timestamp}`;
}

/** Resolve a key (from `?deploy=` or a chart click) to its index in `entries`,
    or `-1` when nothing matches — filtered out, outside the retained history,
    or a stale link to a rollout that no longer exists. */
export function findEntryIndex(
	entries: readonly FeedEntryLike[] | null | undefined,
	want: string | null | undefined
): number {
	if (!entries || !want) return -1;
	for (let i = 0; i < entries.length; i++) {
		if (entryKey(entries[i]) === want) return i;
	}
	return -1;
}

/**
 * ⭐ WHAT A SCREEN READER IS TOLD WHEN A ROW OPENS 500px DOWN THE PAGE.
 *
 * Same reasoning as `history-deeplink.ts`'s `deployAnnouncement`: both a
 * chart click and a `?deploy=` arrival move the reader's attention to a row
 * they may never see move, and announcing it is the one thing that makes
 * that true for someone who cannot see it happen. `subject` carries what the
 * History tab's version doesn't need to: WHICH rollout, since this feed holds
 * many.
 */
export function activityAnnouncement(args: {
	version: string;
	subject: string;
	envLabel: string | null;
	timestamp: string;
	wasAlreadySelected: boolean;
}): string {
	const { version, subject, envLabel, timestamp, wasAlreadySelected } = args;
	const place = envLabel ? ` in ${envLabel}` : '';
	const verb = wasAlreadySelected ? 'Showing' : 'Selected';
	return `${verb} ${version} on ${subject}${place}, ${formatDate(timestamp)}.`;
}
