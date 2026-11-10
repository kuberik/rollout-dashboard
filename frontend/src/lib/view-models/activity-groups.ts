/**
 * ACTIVITY GROUPS — collapses the feed's fan-out into one row per release.
 * (Round 4 review, 2026-10-09 — the owner's own complaint: "6 consecutive
 * checkout-api rows at 21:36 for one release, dev/staging/4 prod regions."
 * Railway's logs and Linear's activity group repeats the same way: one line
 * per change, with the places it went as a trailing list.)
 *
 * Pure and tiny on purpose: the page maps its own `ActivityEntry[]` into
 * `GroupableEntry[]`, this groups them, the page renders one
 * `ActivitySentence` per `ActivityGroup` with the joined env text as its
 * `env` prop. No change to `ActivitySentence` itself.
 */
import { tierOf, TIER_ORDER, type Tier } from './promotion-lanes';
import { regionsPhrase, siteCount } from './regions';

export type GroupableEntry = {
	/** Stable per-entry id (this page uses `entryKey`). */
	key: string;
	rolloutName: string;
	rolloutNamespace: string;
	displayName: string;
	envLabel: string;
	envKey: string;
	version: string;
	previousVersion: string | null;
	timestamp: string;
	href: string;
	bakeStatus: string;
	/** The entry's own failure message, when `bakeStatus === 'Failed'` —
	 *  carried onto the group's `worstBakeStatusMessage` so a GROUPED row
	 *  can still tell `categorizeFailure` apart (health check vs a genuine
	 *  deploy failure), the same split a solo row already makes. Without
	 *  this a grouped row has no message to classify and always reads as
	 *  the generic "failed to deploy" — see `activity-kind.ts`'s doc
	 *  comment and `/activity`'s `activityKindForGroup`. */
	bakeStatusMessage?: string | null;
	/** Default `false`. Part of the grouping key alongside `bakeStatus` — see
	 *  `groupKeyFor`'s own note. */
	isRollback?: boolean;
};

export type ActivityGroup<E extends GroupableEntry> = {
	/** Stable key for the rendered list. */
	key: string;
	displayName: string;
	version: string;
	previousVersion: string | null;
	/** The earliest member's timestamp — the group reads as "when it started". */
	timestamp: string;
	/** The first member's own rollout page — a group's one destination. */
	href: string;
	/** "dev · staging · 4 prod regions" — ready for a `.dot-list` or a plain join. */
	envText: string;
	/** Every environment label in the group, in tier order, uncollapsed — for
	 *  a title attribute or an expanded view. */
	envLabels: string[];
	/** Every member's `bakeStatus` — grouping is scoped to one KIND (see
	 *  `groupKeyFor`), so this is never a blend; it is simply the group's
	 *  own state. */
	worstBakeStatus: string;
	/** The message belonging to whichever member set `worstBakeStatus` — the
	 *  one field `activityKindForGroup` needs to classify a grouped failure
	 *  the same way a solo row's `categorizeFailure` does. `null` unless the
	 *  worst status is `Failed` and that member actually carried one. */
	worstBakeStatusMessage: string | null;
	/** Every original entry, newest first — what a row-level "Details" expand shows. */
	members: E[];
};

/**
 * One release is the same app, the same release, in the same minute — AND
 * the same KIND (round 5 review, 2026-10-09, design-rollout condition on
 * the grouping: "a release that deployed to staging but FAILED in prod is
 * two rows, and the failed env breaks out"). `bakeStatus` + `isRollback`
 * stand in for `activityKindOf`'s verb/tone here — the pure parts of its
 * classification (the rest, actor kind and env rank, don't change WHETHER
 * two entries should merge, only which word a merged or solo row prints).
 * A row is never a blend of "succeeded in staging" and "failed in prod"
 * dressed up as one quiet sentence.
 */
function groupKeyFor(e: GroupableEntry): string {
	const minuteBucket = Math.floor(new Date(e.timestamp).getTime() / 60_000);
	const kind = `${e.bakeStatus}${e.isRollback ? ':rb' : ''}`;
	return `${e.displayName}::${e.version}::${minuteBucket}::${kind}`;
}

const BAKE_RANK: Record<string, number> = {
	Failed: 0,
	Deploying: 1,
	InProgress: 1,
	Cancelled: 2,
	Succeeded: 3,
	None: 4
};
function worseBakeStatus(a: string, b: string): string {
	return (BAKE_RANK[a] ?? 9) <= (BAKE_RANK[b] ?? 9) ? a : b;
}

/** Tier label as it reads in the collapsed text — "prod" gets "regions"
 *  (the real-world multi-region tier); any other tier with 3+ members just
 *  gets its own name ("3 dev", "3 test"), which is rare but still legible. */
function collapsedTierLabel(tier: Tier, labels: string[]): string {
	// QA2: "regions" only when more than one SITE is involved (regions.ts); several prod entries on one default site are "N prod"
	if (tier === 'prod') return regionsPhrase(siteCount(labels), 'prod') ?? `${labels.length} prod`;
	return `${labels.length} ${tier}`;
}

/**
 * Groups and joins the env text in tier order. A tier with fewer than 3
 * members lists each label individually; 3 or more collapse to "N <tier>".
 */
export function groupActivityEntries<E extends GroupableEntry>(entries: E[]): ActivityGroup<E>[] {
	const order = new Map<string, number>();
	const groups = new Map<string, E[]>();
	entries.forEach((e, i) => {
		const k = groupKeyFor(e);
		if (!groups.has(k)) {
			groups.set(k, []);
			order.set(k, i);
		}
		groups.get(k)!.push(e);
	});

	const out: ActivityGroup<E>[] = [];
	for (const [key, members] of groups) {
		// Newest first within the group, matching the feed's own order.
		members.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		const first = members[0];
		// ⭐ A MEMBER WITH NO ENV DOESN'T JOIN THE TEXT AT ALL (round 7 review,
		// 2026-10-10, AD finding 8: "payments-svc deployed · 2.4.1" — a
		// leading separator with nothing before it). A release-level deploy
		// (no specific environment recorded) grouped alongside members that
		// DO have one was pushing `''` into `envParts`, and `''.join(' · ')`
		// with real labels puts the separator first. Skipped entirely now —
		// a member with nothing to say about its environment says nothing,
		// rather than an empty seat in the list.
		const byTier = new Map<Tier, string[]>();
		for (const m of members) {
			const label = m.envLabel || m.envKey;
			if (!label) continue;
			const tier = tierOf(m.envKey || m.envLabel);
			if (!byTier.has(tier)) byTier.set(tier, []);
			byTier.get(tier)!.push(label);
		}
		const envLabels: string[] = [];
		const envParts: string[] = [];
		for (const tier of TIER_ORDER) {
			const labels = byTier.get(tier);
			if (!labels || labels.length === 0) continue;
			envLabels.push(...labels);
			if (labels.length >= 3) envParts.push(collapsedTierLabel(tier, labels));
			else envParts.push(...labels);
		}
		let worstBakeStatus = first.bakeStatus;
		let worstBakeStatusMessage = first.bakeStatusMessage ?? null;
		for (const m of members) {
			const next = worseBakeStatus(worstBakeStatus, m.bakeStatus);
			if (next !== worstBakeStatus) {
				// `m` is strictly worse — it owns the message now.
				worstBakeStatus = next;
				worstBakeStatusMessage = m.bakeStatusMessage ?? null;
			} else if (next === m.bakeStatus && m.bakeStatus === worstBakeStatus && worstBakeStatusMessage == null) {
				// Tied with the current worst and we have no message yet —
				// take this member's, so one missing message on the first
				// occurrence doesn't blank the whole group.
				worstBakeStatusMessage = m.bakeStatusMessage ?? null;
			}
		}
		out.push({
			key,
			displayName: first.displayName,
			version: first.version,
			previousVersion: first.previousVersion,
			timestamp: members[members.length - 1].timestamp,
			href: first.href,
			envText: envParts.join(' · '),
			envLabels,
			worstBakeStatus,
			worstBakeStatusMessage,
			members
		});
	}
	// Newest-group-first, by the order its first member appeared in `entries`
	// (which is already newest-first) — not re-sorted by timestamp, so two
	// groups that interleave in time still read in the feed's own order.
	out.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
	return out;
}
