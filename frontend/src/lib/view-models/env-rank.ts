import type { Rollout, Environment } from '$lib/../types';
import type { AppGroup, AppCell } from '$lib/version-utils';
import { groupRolloutsByApp } from '$lib/version-utils';
import { getDisplayVersion } from '$lib/utils';
import { buildLadder, divergedFromLine } from './build-ladder';

/**
 * ⛔ WHAT "N BEHIND" MEANS, AND WHY IT IS THIS AND NOT THE OTHER TWO.
 * (Decided 2026-08-30, from three surfaces disagreeing about one rollout.)
 *
 * **N behind = the rank of the build an environment is RUNNING on its APP'S
 * BUILD LADDER** — the union, across every environment of that app, of every
 * rollout's `availableReleases` plus every build any of them has actually
 * deployed, ordered newest-first by release creation time (`build-ladder.ts`).
 *
 * There were three defensible denominators and the product was silently
 * mixing them. Measured on the live hub, `hello-world-app`, cluster settled:
 *
 *   |          | dev 991829b | staging 991829b | prod 51b976a |
 *   |----------|-------------|-----------------|--------------|
 *   | own list |     15      |       14        |      19      |
 *   | LADDER   |   **19**    |     **19**      |    **24**    |
 *
 * **(1) THE ROLLOUT'S OWN `availableReleases` / `releaseCandidates` LOSES.**
 * It is a real quantity — *"what could this rollout deploy next"* — and the
 * product still prints it, as `N versions waiting to move` (`promotion.ts`).
 * It cannot be the RANK, because it is not a property of the build. dev and
 * staging run the IDENTICAL build `991829b` and their own lists answer 15 and
 * 14, because each rollout's gates and retention admit a different subset. Put
 * that in a chip attached to a sha and the same sha carries two numbers on
 * adjacent rows. A reader cannot act on a number that moves when a DIFFERENT
 * rollout's window rolls.
 *
 * **(2) EVERY BUILD THE REPO PRODUCED LOSES.** `/versions` groups by repo, and
 * apps that share a source repo ship independent streams — `hello-world-app`
 * and `hello-multi-app` are both built out of `kuberik-testing`. Ranking one
 * against the other's builds is a comparison that cannot be resolved, and
 * DESIGN.md's rule is that those print `unknown`, not a number.
 *
 * **(3) THE LADDER WINS, AND IT EXPLAINS THE ASYMMETRY RATHER THAN HIDING IT.**
 * dev publishes 16 releases, staging 15, prod 20. Those are not three ladders;
 * they are three WINDOWS onto one ladder of 25 builds. The union is the app's
 * real history and each rollout's own list is a view of it — which is exactly
 * why the union is the denominator for "how old is this code" and each
 * rollout's own list is the denominator for "what can move next". Two
 * questions, two numbers, and now neither is spelled in the other's words.
 *
 * It is also the only candidate that is per-APP and shared, which is what
 * `/apps` and `/environments` need: those pages RANK ENVIRONMENTS AGAINST EACH
 * OTHER, and a ranking needs one denominator or it is not a ranking.
 *
 * ── THE ORIGINAL 2026-08-23 NOTE, WHICH THIS EXTENDS ──────────────────────
 *
 * ONE DENOMINATOR FOR "HOW FAR BEHIND IS THIS ENVIRONMENT", PRODUCT-WIDE.
 *
 * `/apps/[name]` already had the right answer and called it THE ONE
 * DENOMINATOR: a build's rank is a property OF THE BUILD, so the same build
 * prints the same `−N` wherever it appears. It computed that rank inline from
 * `buildLadder`, which meant every OTHER page that wanted a `−N` had to invent
 * one. Three did, and measured on one fixture rollout — `checkout-edge` in
 * prod — they disagreed:
 *
 *   /apps/[name]    −19   ladder rank (correct: 19 builds newer than d09e6f4)
 *   /apps           −17   `cellLag`, the HOP to its upstream (staging is −2)
 *   /envs/prod      −17   same hop
 *   /environments    −2   the index of the version in the list of DISTINCT
 *                         versions currently deployed, capped at
 *                         `versionCount − 1`. Not a lag at all.
 *
 * All four printed into the same chip geometry, so one glyph carried three
 * different meanings and one of them was arithmetic noise. This module is that
 * derivation lifted out of the page, unchanged, so the pages share it instead
 * of each keeping an opinion.
 *
 * WHY THE HOP LAG LOST. "staging is 2 behind dev" is a real question, but it is
 * not the question the `−N` chip is asking anywhere else in the product, and it
 * is not stable: it changes when a DIFFERENT environment deploys. A rank is a
 * fact about the build in the row; a hop is a fact about two rows. Only one of
 * those can be printed in a chip beside a sha without lying about what the
 * number counts.
 */
export type RankVerdict =
	/** Rank 0 on this app's ladder — nothing newer exists. */
	| { kind: 'newest' }
	/** `by` builds newer than this one exist on the app's ladder. */
	| { kind: 'behind'; by: number }
	/**
	 * Running a build that is on no environment's release line, deployed inside
	 * the window that line still covers. A rank here is not a distance:
	 * promoting N times never arrives at it. See `divergedFromLine`.
	 */
	| { kind: 'diverged' }
	/**
	 * Nothing deployed, or the comparison cannot be resolved. Callers must
	 * print NO NUMBER — never a `0`, which reads as "newest".
	 */
	| { kind: 'unknown' };

function cellVersion(cell: AppCell): string | null {
	const v = cell.rollout?.status?.history?.[0]?.version;
	return v ? getDisplayVersion(v) || null : null;
}

function cellDeployedMs(cell: AppCell): number {
	const ts = cell.rollout?.status?.history?.[0]?.timestamp;
	if (!ts) return 0;
	const t = new Date(ts).getTime();
	return Number.isFinite(t) ? t : 0;
}

/**
 * Every cell in the group, ranked against the app's ONE ladder.
 *
 * Returned as a map keyed by cell so callers pay for the ladder once per app
 * rather than once per row — `/environments` renders 22 environments over 6
 * apps and would otherwise rebuild the same ladder 22 times.
 */
export function rankVerdicts(group: AppGroup): Map<AppCell, RankVerdict> {
	const ladder = buildLadder(group.cells);
	const out = new Map<AppCell, RankVerdict>();
	for (const cell of group.cells) {
		const version = cellVersion(cell);
		if (!version) {
			out.set(cell, { kind: 'unknown' });
			continue;
		}
		if (divergedFromLine(ladder, version, cellDeployedMs(cell))) {
			out.set(cell, { kind: 'diverged' });
			continue;
		}
		const rank = ladder.rankOf(version);
		if (rank < 0) out.set(cell, { kind: 'unknown' });
		else if (rank === 0) out.set(cell, { kind: 'newest' });
		else out.set(cell, { kind: 'behind', by: rank });
	}
	return out;
}

/**
 * EVERY ROLLOUT ON THE CLUSTER, RANKED, KEYED BY ROLLOUT OBJECT.
 *
 * `/` and `/rollouts` do not have an `AppGroup` in hand — they render a flat
 * list of rollouts — and that is the whole reason they went on inventing their
 * own answer for three rounds. This is the flat-list door onto the same
 * derivation: it groups the fleet exactly as `/apps` does and ranks every cell
 * against its own app's ladder, so a rollout card and an app row cannot print
 * different numbers for one rollout.
 *
 * Rollouts with no `Environment` binding still get a group (by rollout name,
 * one cell per namespace — `groupRolloutsByApp`'s own fallback), so nothing
 * silently drops out and renders as `newest`.
 */
export function rankVerdictsByRollout(
	rollouts: Rollout[],
	environments: Environment[]
): Map<Rollout, RankVerdict> {
	const out = new Map<Rollout, RankVerdict>();
	for (const group of groupRolloutsByApp(rollouts, environments).values()) {
		const ranks = rankVerdicts(group);
		for (const cell of group.cells) out.set(cell.rollout, ranks.get(cell) ?? { kind: 'unknown' });
	}
	return out;
}

/** One environment tier's verdict within an app, or `unknown` if unbound. */
export function rankVerdictFor(group: AppGroup, envTier: string): RankVerdict {
	const cell = group.cells.find((c) => (c.environment?.spec?.environment ?? c.envName) === envTier);
	if (!cell) return { kind: 'unknown' };
	return rankVerdicts(group).get(cell) ?? { kind: 'unknown' };
}

/**
 * THE CHIP LABEL — ONE SPELLING, PRODUCT-WIDE, AND IT IS TOTAL.
 *
 * ⛔ It used to return `null` for `unknown`, and every call site then spelled
 * its own fallback. Four of them fell through to the word `newest`, which is
 * the exact defect DESIGN.md forbids: *never render an unresolvable comparison
 * as a definite claim.* Returning `null` invited the fallback; returning the
 * WORD removes the branch. `unknown` is a legible answer and it is the honest
 * one — the `unranked` Chip role exists for precisely this.
 *
 * ⛔ AND IT IS `N behind`, NOT `−N`. (2026-08-30) A signed integer beside a
 * build id reads as a diff and names no unit. `/environments`, `/envs/*`,
 * `/apps` and the dependencies tab already said `N behind` while `/`,
 * `/rollouts` and `/versions/<rev>` still said `−N` — one fact, two spellings,
 * which is how a term becomes insider vocabulary. It is spelled here now, so
 * no page can spell it a third way.
 */
export function rankLabel(v: RankVerdict): string {
	switch (v.kind) {
		case 'newest':
			return 'newest';
		case 'behind':
			return `${v.by} behind`;
		case 'diverged':
			// Not git's word. The fact is that this build was never released
			// to any environment — see the vocabulary table in DESIGN.md.
			return 'unreleased';
		default:
			return 'unknown';
	}
}

/** The Chip role that matches the verdict. Total — `unknown` is `unranked`. */
export function rankRole(v: RankVerdict): 'newest' | 'rank' | 'diverged' | 'unranked' {
	switch (v.kind) {
		case 'newest':
			return 'newest';
		case 'behind':
			return 'rank';
		case 'diverged':
			return 'diverged';
		default:
			return 'unranked';
	}
}

/**
 * The `title` for a rank chip, in one voice. `subject` names what is being
 * ranked — an app name on a per-environment page, an environment label on a
 * per-app one.
 */
export function rankTitle(v: RankVerdict, subject: string): string {
	switch (v.kind) {
		case 'newest':
			return `${subject} is on the newest version this app has`;
		case 'behind':
			return `${subject} is ${v.by} version${v.by === 1 ? '' : 's'} older than the newest one this app has`;
		case 'diverged':
			return `${subject} is running a version that is on no environment’s release list`;
		default:
			return `${subject}'s distance from the newest version cannot be resolved`;
	}
}

/**
 * How many builds behind, for sorting and counting only — 0 for every state
 * that is not `behind`. Do NOT render this: a `0` from `unknown` and a `0`
 * from `newest` mean different things and neither is a lag.
 */
export function rankBehindBy(v: RankVerdict): number {
	return v.kind === 'behind' ? v.by : 0;
}

/** Anything that needs a person's attention about propagation. */
export function rankIsAdverse(v: RankVerdict): boolean {
	return v.kind === 'behind' || v.kind === 'diverged';
}
