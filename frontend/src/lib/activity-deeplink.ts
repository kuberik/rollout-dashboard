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
 * as entry (...)}` already keys its rows by: which rollout, and which of its
 * history entries (id; the timestamp alone is not unique, see `entryKey`).
 * Rollout identity + history entry, not revision — the same pairing `chartServices`
 * builds its lanes' `history[]` from (see that derivation's own
 * `rolloutNamespace`/`rolloutName` fields), so a chart mark and a feed row for
 * the same deploy always compute the identical string.
 */
export const ACTIVITY_DEPLOY_PARAM = 'deploy';

/** The shape this module needs off either a feed row or a chart lane's own
    history entry — both `ActivityEntry` (the page) and `chartServices[i].history[j]`
    (fed to `DeploymentTimeline`) satisfy it.

    `timestamp` must be the history entry's OWN `timestamp` (its deploy time),
    never a display instant: `/activity` prints a Failed row at the moment it
    was judged, and that moment is routinely the same second as the automatic
    rollback's deploy, so a key built from it collides with the rollback's.
    A caller that carries a display timestamp passes the precomputed `key`. */
export type FeedEntryLike = {
	rolloutNamespace: string;
	rolloutName: string;
	timestamp: string;
	/** `status.history[].id` — unique per rollout. */
	historyId?: number | string | null;
	/** Source cluster; '' for the hub. Two clusters can hold the same ns/name. */
	cluster?: string | null;
	/** When present, the caller's precomputed `entryKey`, used as is. */
	key?: string;
};

/**
 * The correlation key:
 * `<cluster>/<namespace>/<name>/<timestamp>/<history id>`.
 *
 * ⛔ (2026-11-21, owner: `each_key_duplicate … hello-multi-dev/hello-multi-app/
 * 2026-11-21T14:23:02Z at indexes 3 and 4`) The key used to stop at the
 * timestamp on the assumption that two entries of one rollout never share
 * one. They do: `deployTime` has SECOND precision, and an automatic rollback
 * is deployed in the same second its failed deploy is judged (live, ids 25
 * and 26 of hello-multi-app carry the identical timestamp). The history
 * entry's `id` is the identity; the timestamp stays for legacy links.
 * Without an id the caller must pass something unique within the rollout
 * (its position) as `historyId`.
 */
export function entryKey(e: FeedEntryLike): string {
	if (e.key) return e.key;
	const id = e.historyId ?? '';
	return `${e.cluster ?? ''}/${e.rolloutNamespace}/${e.rolloutName}/${e.timestamp}/${id}`;
}

/** Resolve a key (from `?deploy=` or a chart click) to its index in `entries`,
    or `-1` when nothing matches — filtered out, outside the retained history,
    or a stale link to a rollout that no longer exists.

    A LEGACY key (`<namespace>/<name>/<timestamp>`, written before the id was
    part of it) can name two entries; it resolves to the newest of them —
    the highest history id, else the first in `entries`' order. */
export function findEntryIndex(
	entries: readonly FeedEntryLike[] | null | undefined,
	want: string | null | undefined
): number {
	if (!entries || !want) return -1;
	for (let i = 0; i < entries.length; i++) {
		if (entryKey(entries[i]) === want) return i;
	}
	const parts = want.split('/');
	if (parts.length !== 3) return -1;
	const [ns, name, ts] = parts;
	let best = -1;
	let bestId = -Infinity;
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.rolloutNamespace !== ns || e.rolloutName !== name) continue;
		// The legacy key held the entry's deploy timestamp; a precomputed key
		// carries it as its fourth segment, so prefer that over `timestamp`
		// (which a feed row may have replaced with a display instant).
		const own = e.key ? e.key.split('/')[3] : e.timestamp;
		if (own !== ts) continue;
		const id = Number(e.historyId);
		const rank = Number.isFinite(id) ? id : -Infinity;
		if (best === -1 || rank > bestId) {
			best = i;
			bestId = rank;
		}
	}
	return best;
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
