import type { AppCell } from '$lib/version-utils';
import { getDisplayVersion } from '$lib/utils';
import { getEnvironmentRank } from '$lib/env-order';

/**
 * The app's build ladder — every build this app knows about, newest first.
 *
 * This is the page's spine. The Builds table renders it, the Ember ramp is
 * computed over it, the Gantt colours its segments by rank in it, and the
 * ledger's rank chips index into it. One derivation, so those four objects
 * cannot disagree about which build is newer than which.
 *
 * Union across every env's `availableReleases`, because each rollout has
 * its OWN retention window — prod may still know about a build dev has
 * already aged out, and vice versa. Every version that appears in any
 * env's deploy history is folded in too, so a build an environment is
 * currently RUNNING can never be missing from the ladder just because it
 * fell out of that rollout's release list. That case is not hypothetical:
 * it is exactly what a badly-lagging production looks like.
 *
 * Ordering is by release creation time, NOT by deploy time. A build pinned
 * in staging must not read as "newer" than a build released after it.
 *
 * THE LADDER ALSO RECORDS *WHERE A BUILD CAME FROM*, and that is what makes
 * `diverged` sayable. `availableReleases` is the release LINE — the
 * controller's own ordered list of what this app may deploy. `history` is
 * what an environment actually ran. A build that appears only in a history
 * and in no environment's release list is a build the pipeline does not
 * contain: a hotfix built off-branch, a manual `wantedVersion`, a restored
 * snapshot. That environment is not "N behind"; promoting N times would
 * never reach it, and never come from it.
 */

export type Build = {
	/** Display sha, e.g. `9f10e49`. Stable identity within this app. */
	version: string;
	revision: string | null;
	tag: string | null;
	/** Release creation time, ms epoch. 0 when genuinely unknown. */
	createdMs: number;
	/** 0 = newest. */
	rank: number;
	/**
	 * True when SOME environment's `availableReleases` contains this build —
	 * i.e. it is on the app's release line. False means it was seen only in
	 * a deploy history. False alone is NOT divergence: see
	 * `divergedFromLine`, which is the only thing allowed to make that claim.
	 */
	onReleaseLine: boolean;
};

export type BuildLadder = {
	builds: Build[];
	/** -1 when the version is not on the ladder — never a fabricated rank. */
	rankOf(version: string | null | undefined): number;
	get(version: string | null | undefined): Build | undefined;
	/**
	 * Created time of the OLDEST build on the release line, ms epoch — the
	 * left edge of the window the line can still speak about. 0 when no
	 * environment published an `availableReleases` list at all, in which
	 * case there is no line and nothing may be claimed against it.
	 */
	releaseLineOldestMs: number;
};

type Raw = { version?: string; revision?: string; tag?: string; created?: string };

function toMs(created: string | undefined): number {
	if (!created) return 0;
	const t = new Date(created).getTime();
	return Number.isFinite(t) ? t : 0;
}

function displayOf(v: Raw | undefined | null): string | null {
	if (!v) return null;
	const d = getDisplayVersion(v as { version?: string; revision?: string; tag: string });
	return d || null;
}

export function buildLadder(cells: AppCell[]): BuildLadder {
	const seen = new Map<string, Build>();
	/**
	 * ORDERING FALLBACKS, and why there are three of them.
	 *
	 * `created` is the only signal that is a property of the BUILD, so it wins
	 * whenever it is present — a build pinned in staging must not read as newer
	 * than one released after it.
	 *
	 * It is not always present. `Rollout.status.availableReleases` is what
	 * carries it, and a rollout that publishes no release list at all (no image
	 * policy wired yet, a bare fixture, an app the controller has not scanned)
	 * gives every build `createdMs === 0`. The ladder used to break that tie
	 * with `version.localeCompare`, i.e. it ranked builds ALPHABETICALLY BY
	 * SHA — measured on `orders-api`, whose newest build `e936e6f` is deployed
	 * in dev and was printed `−3` while `01ab7c9`, live in staging, was printed
	 * `newest`. A sha is a hash; sorting by it is sorting by noise, and it fails
	 * silently because the output still looks like a rank.
	 *
	 * So three fallbacks, in this order:
	 *   1. `created` — a fact about the build.
	 *   2. ITS POSITION IN AN `availableReleases` LIST THAT CONTAINS IT. The
	 *      list is oldest-first by contract, so `len - 1 - idx` counts the
	 *      builds a single rollout can prove are newer. See `newerInLine`
	 *      below for the 25-build under-report this fixes, and for why it is
	 *      the MAX across lists and not the MIN.
	 *   3. THE ENV-ORDER RANK OF THE ENVIRONMENT CURRENTLY RUNNING IT. A
	 *      promotion chain guarantees a build reaches dev before staging before
	 *      prod, so of two builds that are live right now, the one live further
	 *      UPSTREAM is the newer one. This is the strongest signal available
	 *      without release metadata.
	 *   4. Latest deploy time. Only reached for builds that are live NOWHERE —
	 *      superseded entries in some environment's history — where the chain
	 *      argument does not apply and "when did anyone last run it" is all
	 *      there is.
	 *
	 * Deploy time is deliberately BELOW env rank, which is where
	 * `newestFirstVersions` used to put it (that module is deleted) and this did not.
	 * Getting that order wrong is not academic: `orders-api` promotes `7c14e2a`
	 * into prod at 17:35 while dev has been running the newer `e936e6f` since
	 * 13:27, so the LATEST deploy in wall-clock time is of the OLDEST build.
	 * That is the normal shape of a promotion, not an edge case.
	 *
	 * `localeCompare` survives only as the final total-order tiebreak, so the
	 * sort stays stable across renders. It is no longer allowed to decide a
	 * rank on its own.
	 */
	const deployedMs = new Map<string, number>();
	const envRank = new Map<string, number>();
	/**
	 * HOW MANY BUILDS ARE NEWER THAN THIS ONE, AS THE LIST THAT KNOWS MOST
	 * ABOUT IT ATTESTS. `availableReleases` is OLDEST-FIRST by the API's
	 * contract, so `len - 1 - idx` counts the entries a single rollout can
	 * PROVE are newer than this build.
	 *
	 * ⛔ THIS SIGNAL WAS BEING THROWN AWAY, AND IT UNDER-REPORTED BY 25. When
	 * no rollout publishes `created` (a bare fixture, an app with no image
	 * policy wired, `orders-api` in the mock), every `createdMs` is 0 and the
	 * sort fell straight through to "which environment is running it" — so a
	 * production sitting at index 8 of its own 33-entry release list, with 24
	 * entries provably newer, ranked **1**, because dev happened to be running
	 * the only build above it. Array position is not noise the way a sha is:
	 * it is the controller's own ordering and it is a property of the BUILD
	 * within a list, not of whichever environment happens to run it. So it
	 * sits directly under `created` and above env order.
	 *
	 * ⚠️ IT IS THE MAX ACROSS LISTS, NOT THE MIN, AND THE DIFFERENCE IS NOT
	 * COSMETIC. Two rollouts' lists have different HEADS whenever one has seen
	 * a release the other has not, so "distance from the end" is not on a
	 * common scale between them. Taking the MIN lets a build sitting near the
	 * end of a SHORT list jump above a build further from the end of a LONG
	 * one — measured on the aged-out fixture, it ranked `rel-5`, `rel-6` and
	 * `rel-7` as NEWER than the build that sits at index 8 of the very list
	 * that contains all four. That is a sort that contradicts its own input.
	 * The MAX is the most pessimistic proof available and preserves each
	 * list's internal order; where two builds never co-occur in any list their
	 * true relation is genuinely undetermined, and over-stating a lag is the
	 * safe direction — under-stating one is what this whole pass exists to
	 * stop.
	 */
	const newerInLine = new Map<string, number>();

	const absorb = (raw: Raw | undefined | null) => {
		const version = displayOf(raw);
		if (!version || !raw) return;
		const createdMs = toMs(raw.created);
		const prev = seen.get(version);
		if (prev) {
			// Keep the richest record: a history entry may carry a revision an
			// availableReleases entry lacks, and vice versa.
			if (!prev.revision && raw.revision) prev.revision = raw.revision;
			if (!prev.tag && raw.tag) prev.tag = raw.tag;
			if (createdMs > prev.createdMs) prev.createdMs = createdMs;
			if (onReleaseLine) prev.onReleaseLine = true;
			return;
		}
		seen.set(version, {
			version,
			revision: raw.revision ?? null,
			tag: raw.tag ?? null,
			createdMs,
			rank: -1,
			onReleaseLine
		});
	};

	// Two passes, and the ORDER matters: every release list is absorbed
	// before any history is, so a build that is on the line is flagged as
	// such no matter which environment's history also happens to mention it.
	let onReleaseLine = true;
	for (const c of cells) {
		const releases = c.rollout.status?.availableReleases ?? [];
		releases.forEach((r, i) => {
			absorb(r as Raw);
			const v = displayOf(r as Raw);
			if (!v) return;
			const newer = releases.length - 1 - i;
			newerInLine.set(v, Math.max(newerInLine.get(v) ?? -Infinity, newer));
		});
	}
	onReleaseLine = false;
	for (const c of cells) {
		const history = c.rollout.status?.history ?? [];
		history.forEach((h, i) => {
			absorb(h.version as Raw);
			const v = displayOf(h.version as Raw);
			if (!v) return;
			const t = h.timestamp ? new Date(h.timestamp).getTime() : NaN;
			if (Number.isFinite(t)) deployedMs.set(v, Math.max(deployedMs.get(v) ?? -Infinity, t));
			// Only the CURRENT deploy places a build in the promotion chain —
			// a build that has since been replaced everywhere says nothing
			// about where it sits relative to what is running now.
			if (i === 0) {
				const r = getEnvironmentRank(c.environment?.spec?.environment ?? c.envName);
				envRank.set(v, Math.min(envRank.get(v) ?? Infinity, r));
			}
		});
	}

	const builds = [...seen.values()].sort((a, b) => {
		if (b.createdMs !== a.createdMs) return b.createdMs - a.createdMs;
		const na = newerInLine.get(a.version) ?? Number.POSITIVE_INFINITY;
		const nb = newerInLine.get(b.version) ?? Number.POSITIVE_INFINITY;
		if (na !== nb) return na - nb;
		const ra = envRank.get(a.version) ?? Number.POSITIVE_INFINITY;
		const rb = envRank.get(b.version) ?? Number.POSITIVE_INFINITY;
		if (ra !== rb) return ra - rb;
		const ta = deployedMs.get(a.version);
		const tb = deployedMs.get(b.version);
		if (ta !== undefined && tb !== undefined && ta !== tb) return tb - ta;
		return a.version.localeCompare(b.version);
	});
	builds.forEach((b, i) => (b.rank = i));

	let releaseLineOldestMs = 0;
	for (const b of builds) {
		if (!b.onReleaseLine || b.createdMs <= 0) continue;
		if (releaseLineOldestMs === 0 || b.createdMs < releaseLineOldestMs) {
			releaseLineOldestMs = b.createdMs;
		}
	}

	const index = new Map(builds.map((b) => [b.version, b]));
	return {
		builds,
		rankOf: (version) => (version ? (index.get(version)?.rank ?? -1) : -1),
		get: (version) => (version ? index.get(version) : undefined),
		releaseLineOldestMs
	};
}

/**
 * DIVERGED — the third drift state, and the only one this page could not
 * say. `up to date` is rank 0, `N behind` is rank N, and this is the case
 * where a rank is not a distance at all.
 *
 * An environment is diverged when the build it is RUNNING is on no
 * environment's release line, and it was deployed INSIDE the window that
 * line still covers. Both halves are load-bearing:
 *
 *   · off the line alone is not evidence. `availableReleases` is a bounded
 *     retention window, so a build old enough simply drops out of it. That
 *     is "we cannot say", which the page already renders correctly as no
 *     rank chip at all (`newerReleaseCount` returns null).
 *   · deployed at or after the line's oldest surviving release is what
 *     separates the two. If the line still remembers releases older than
 *     this deploy and STILL does not contain it, the build did not age
 *     out — it was never on the line.
 *
 * WHY NOT `compareRollouts(...).kind === 'divergent'`, which already
 * exists and is what this looked like it should reuse: that predicate is
 * computed from `status.history`, whose limit is 5, and
 * `rollout-cards.ts` already carries the post-mortem — "the further behind
 * a rollout falls, the more certain it is to age out of its peers'
 * history, return 'divergent'". On the live fixture prod is 4 builds
 * behind dev with zero history overlap, so that predicate calls the most
 * lagging environment on the cluster diverged. It is a retention artifact
 * wearing the name of a drift state. This one asks the release line, which
 * is 30+ entries deep and is the thing promotion actually walks.
 *
 * Returns false whenever it cannot prove the claim. Silence beats a
 * confident wrong cause.
 */
export function divergedFromLine(
	ladder: BuildLadder,
	version: string | null | undefined,
	deployedMs: number
): boolean {
	if (!version) return false;
	// No environment published a release list — there is no line to be off.
	if (ladder.releaseLineOldestMs === 0) return false;
	const build = ladder.get(version);
	if (!build) return false;
	if (build.onReleaseLine) return false;
	// Prefer the build's own release time; fall back to when this
	// environment deployed it, which every history entry carries.
	const at = build.createdMs > 0 ? build.createdMs : deployedMs;
	if (!Number.isFinite(at) || at <= 0) return false;
	return at >= ladder.releaseLineOldestMs;
}

/** version -> the cells whose CURRENT deploy is that version. */
export function liveIn(cells: AppCell[]): Map<string, AppCell[]> {
	const out = new Map<string, AppCell[]>();
	for (const c of cells) {
		const v = displayOf(c.rollout.status?.history?.[0]?.version as Raw);
		if (!v) continue;
		const list = out.get(v);
		if (list) list.push(c);
		else out.set(v, [c]);
	}
	return out;
}

/**
 * version -> the cells whose deploy HISTORY contains that version at any
 * position, current or past.
 *
 * This is the honest half of "where did this build go". `liveIn` answers
 * "who is on it NOW"; this answers "who has ever run it, as far as the
 * retained history can prove".
 *
 * The asymmetry matters and is deliberate: history is a bounded window, so
 * an ABSENCE here proves nothing at all — a build may well have shipped and
 * then aged out. Callers must therefore only ever render the POSITIVE case
 * (`ran in dev · staging`) and must never turn an empty set into a claim
 * like "never deployed". That would be inventing data out of a retention
 * limit, which is the one thing this page does not do.
 */
export function everIn(cells: AppCell[]): Map<string, AppCell[]> {
	const out = new Map<string, AppCell[]>();
	for (const c of cells) {
		const seenHere = new Set<string>();
		for (const h of c.rollout.status?.history ?? []) {
			const v = displayOf(h.version as Raw);
			if (!v || seenHere.has(v)) continue;
			seenHere.add(v);
			const list = out.get(v);
			if (list) list.push(c);
			else out.set(v, [c]);
		}
	}
	return out;
}
