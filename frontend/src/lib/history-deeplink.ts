import { revisionSlug } from './version-utils';
import { getDisplayVersion } from './utils';

/**
 * ⭐ A LINK THAT NAMES THE DEPLOY, NOT THE PAGE THAT CONTAINS IT.
 *
 * (2026-09-02, from the human, about rollout detail's commits rollup: *"this
 * link on rollout page doesn't expand the latest history entry. it should also
 * navigate to it. it's not obvious now when we click the button what changes
 * are for the latest deployment."*)
 *
 * The rollup says `1 commit deployed · +1 −1 · 1 file` and pointed at
 * `…/history`. That is a promise of "these changes" answered with "a page that
 * contains them": the reader arrives with every row collapsed and has to find
 * the one they were just reading a summary of. This module is the key that
 * closes the gap, spelled ONCE for the side that WRITES it (rollout detail)
 * and the side that RESOLVES it (the History tab).
 *
 * ── WHY A QUERY PARAM AND NOT A HASH ────────────────────────────────────
 *
 * The product already deep-links by query and only by query — `?release=<env>`
 * on `/apps/<name>`, `?tab=` on the logs tab, `?env=`/`?app=`/`?ns=` on
 * `/activity` — each read off `page.url.searchParams` in an effect. A fragment
 * would be a second idiom for the same job.
 *
 * It would also be a RACE. A fragment makes the browser scroll on its own, and
 * on this page the row is collapsed at first paint, above it a timeline chart
 * that lays out after its data arrives. The browser's scroll would land at an
 * offset that is wrong a few hundred milliseconds later, and our own
 * `scrollIntoView` would then be seen fighting it. A query param has no
 * built-in behaviour to fight.
 *
 * ── WHY THE REVISION AND NOT THE INDEX ──────────────────────────────────
 *
 * An index is not identity. `history[0]` is a different deploy after the next
 * promotion, so `?deploy=0` pasted into a chat opens the wrong one tomorrow.
 * The revision is what the row PRINTS and what the rollup's own `head` is, so
 * the URL reads as the thing it opens.
 *
 * Twelve characters, via `revisionSlug` — the length `version-utils` already
 * derived for URLs ("a 7-char sha is a display convention, not a unique key")
 * and the same one `/versions/<rev>` carries. Display stays at seven.
 */
export const DEPLOY_PARAM = 'deploy';

/** The shape this module needs off a `status.history[]` entry. */
export type DeployEntryLike = {
	version?: { version?: string; revision?: string; tag?: string } | null;
};

/**
 * The URL key for one deploy.
 *
 * Falls back to the build name when the entry carries no commit — a rollout
 * that ships a semver tag has no revision, and the name is then what the row's
 * own primary link prints, so the URL still matches something a reader can see.
 * Returns `null` when the entry names nothing at all, which is the caller's
 * signal to render no deep link rather than a link to nowhere.
 */
export function deployKey(entry: DeployEntryLike | null | undefined): string | null {
	const v = entry?.version;
	if (!v) return null;
	if (v.revision) return revisionSlug(v.revision);
	const display = getDisplayVersion({ version: v.version, revision: v.revision, tag: v.tag ?? '' });
	return display || null;
}

/**
 * Resolve a `?deploy=` key to an index into `history`, or `-1`.
 *
 * ⚠️ A REVISION CAN NAME TWO ENTRIES, AND THE NEWEST ONE WINS. A rollback
 * re-deploys a build that is already in the list, so `hello-world-app` can and
 * does hold the same sha at two indices. The lowest index — the most recent
 * deploy of that build — is the one in effect, and it is exactly the entry the
 * rollup summarises, so resolving newest-first is both the safe default and
 * the correct answer for the link this was built for.
 *
 * Matching is by PREFIX in either direction, the same tolerance
 * `CommitSummary` uses against `availableReleases`: the URL carries 12
 * characters, the CRD may hold 40 or a short form, and `/versions/<rev>`
 * already promises that "the detail page resolves any prefix".
 */
export function findDeployIndex(
	history: readonly DeployEntryLike[] | null | undefined,
	want: string | null | undefined
): number {
	if (!history || !want) return -1;
	const w = want.trim().toLowerCase();
	if (!w) return -1;
	for (let i = 0; i < history.length; i++) {
		const key = deployKey(history[i]);
		if (!key) continue;
		const k = key.toLowerCase();
		if (k === w || k.startsWith(w) || w.startsWith(k)) return i;
		// The stored revision may be longer than either form; compare against it
		// too so a full 40-char sha in the URL still resolves.
		const full = (history[i]?.version?.revision ?? '').toLowerCase();
		if (full && (full.startsWith(w) || w.startsWith(full))) return i;
	}
	return -1;
}

/**
 * ⭐ WHAT A SCREEN READER IS TOLD WHEN A ROW OPENS 500px DOWN THE PAGE.
 *
 * The deep link scrolls and expands a row the reader may never see move, and
 * the chart click does the same from a control at the top of the page. Without
 * this, both are announced by pixels only — the defect
 * `stores/announce.svelte.ts` exists to close.
 *
 * IT NAMES THE BUILD, because that is the one axis the History tab does not
 * fix: the tab strip already says which app, which environment and which
 * cluster, and the list is rows that differ only by version. It is a fragment
 * of no page context, so it has to carry its own subject.
 *
 * `wasOpen` keeps it honest. Following a link to a row that is already open
 * changes nothing about the row, and claiming "expanded" for a state that did
 * not change is the kind of small lie `truth.test.ts` exists over.
 */
export function deployAnnouncement(args: {
	version: string;
	when: string;
	index: number;
	total: number;
	wasOpen: boolean;
}): string {
	const { version, when, index, total, wasOpen } = args;
	const position = index === 0 ? 'the current deploy' : `deploy ${index + 1} of ${total}`;
	const verb = wasOpen ? 'Showing' : 'Expanded';
	return `${verb} ${version}, ${when} — ${position}.`;
}
