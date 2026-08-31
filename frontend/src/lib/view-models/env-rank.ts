import type { Rollout, Environment } from '$lib/../types';
import type { AppGroup, AppCell } from '$lib/version-utils';
import { groupRolloutsByApp } from '$lib/version-utils';
import { getDisplayVersion } from '$lib/utils';
import { buildLadder, divergedFromLine } from './build-ladder';
import { newerReleaseCount } from './promotion';

/**
 * ⛔ WHAT "N BEHIND" MEANS. ONE DEFINITION, AND IT IS THE ROLLOUT'S OWN LIST.
 * (Decided 2026-08-31. This REVERSES the 2026-08-30 ruling kept below, which
 * chose the app-wide build ladder. The reversal is measured, not preferred.)
 *
 * **N behind = how many releases newer than the one it is running THIS
 * ROLLOUT could still take** — `promotion.ts`'s `newerReleaseCount`, i.e.
 * `status.releaseCandidates.length`, validated against the rollout's own
 * OLDEST-FIRST `status.availableReleases`.
 *
 * ── WHAT THE API SAYS, MEASURED ON THE LIVE HUB 2026-08-31 ────────────────
 *
 * `hello-world-app`, prod running `205a312`:
 *
 *   | quantity                                     | value |
 *   |----------------------------------------------|-------|
 *   | prod's own `availableReleases`               |  33   |
 *   | prod's index of `205a312` in it              |   8   |
 *   | ⇒ newer in prod's own list                   | **24**|
 *   | prod's `status.releaseCandidates.length`     | **24**|
 *   | app-wide LADDER (union of all three envs)    |  37   |
 *   | ⇒ ladder rank of `205a312`                   |  28   |
 *
 * The ladder says 28. The CONTROLLER says 24. The four extra builds —
 * `139acae`, `171c103`, `bddd9e4`, `e87f059`, all released 2026-07-29 —
 * are in dev's and staging's lists and in NEITHER prod's `availableReleases`
 * NOR prod's `releaseCandidates`. Prod cannot deploy them. A chip reading
 * `28 behind` above a Change Version list with 24 rows is the same defect
 * one level down.
 *
 * Swept across all 15 live rollouts: every build the union adds to a
 * rollout's own list is OLDER than that rollout's own newest — the union
 * NEVER contributes a newer release, so it can only ever inflate. It is not
 * a better denominator; it is the same denominator plus other rollouts'
 * records. DESIGN.md: *an absent record is not an observation.*
 *
 * ── WHAT THIS COSTS, STATED PLAINLY ───────────────────────────────────────
 *
 * The 2026-08-30 ruling's objection is REAL and is not waved away: two
 * environments running the IDENTICAL sha can print different numbers,
 * because their upgrade paths genuinely differ. Measured on the live hub,
 * `hello-world-app` at `c78a9de4`: prod 30, dev 28, staging 29.
 *
 * That is surprising and it is TRUE. The three rollouts have three different
 * candidate lists, so three different numbers of steps to the head. The
 * ladder hid that asymmetry behind one pretty number that matched none of
 * the three controls the operator can actually press.
 *
 * The fix for the surprise is the SUBJECT, not the denominator: `behind` is
 * a fact about an ENVIRONMENT's upgrade path, never about a build. So
 * `rankTitle` names the environment and says *"can still take"*, and no
 * surface attaches this number to a bare sha. `/versions` ranks BUILDS and
 * keeps the ladder — different question, different words (see
 * `revision-ledger.ts`).
 *
 * ── WHY THIS RESOLVES THE REPORTED DEFECT AND THE LADDER COULD NOT ────────
 *
 * `/apps/<name>` printed `−20 PROD` (ladder) and `15 versions ready`
 * (`promotionCandidates`) inside ONE card, and rollout detail said
 * `15 upgrades available`. Under this definition all three are the same
 * number by construction:
 *
 *     N behind ≡ N versions ready ≡ N upgrades available
 *              ≡ rows in Change Version ≡ releaseCandidates.length
 *
 * Under the ladder they can never agree, because the ladder counts builds
 * that have no candidate row to point at.
 *
 * ── THE ONE FALLBACK, AND ITS FENCE ───────────────────────────────────────
 *
 * When a rollout publishes NEITHER `availableReleases` NOR
 * `releaseCandidates` there is no own-stream evidence at all, and the app
 * ladder is the only ordering that exists (it is then built from deploy
 * HISTORY alone). That case takes the ladder rank. It is the same question
 * answered from the only witness available — not a second definition — and
 * it does not occur on any live rollout. The fence is exact: the fallback
 * fires only when both lists are absent, never when a version merely fell
 * out of a list that exists (that is `unknown`, and it stays `unknown`).
 *
 * ── SUPERSEDED, KEPT FOR THE ARGUMENT ─────────────────────────────────────
 *
 * **(2026-08-30) THE LADDER WINS.** *"dev and staging run the IDENTICAL build
 * `991829b` and their own lists answer 15 and 14 … Put that in a chip attached
 * to a sha and the same sha carries two numbers on adjacent rows."* Correct
 * about the symptom, wrong about the cure: the number stopped matching the
 * controller, and the two numbers on one card were the result. Answered above
 * by naming the environment as the subject.
 *
 * **(2026-08-30) EVERY BUILD THE REPO PRODUCED LOSES.** Still true and
 * untouched: apps that share a source repo ship independent streams, so
 * ranking one against the other's builds is unresolvable and prints
 * `unknown`.
 *
 * ── THE ORIGINAL 2026-08-23 NOTE ──────────────────────────────────────────
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
	/** Nothing newer that this rollout could take. It is at the head of its
	 *  own release list. */
	| { kind: 'newest' }
	/** `by` releases newer than the running one that THIS rollout could still
	 *  take — the controller's own `releaseCandidates` count. Identically the
	 *  number of rows in this rollout's Change Version list. */
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
		// `diverged` is still a LADDER question and deliberately stays one: it
		// asks whether this build is on ANY environment's release line, which
		// no single rollout's list can answer. It is not a distance, so it
		// never competes with the count below.
		if (divergedFromLine(ladder, version, cellDeployedMs(cell))) {
			out.set(cell, { kind: 'diverged' });
			continue;
		}
		const own = newerReleaseCount(cell.rollout);
		if (own !== null) {
			out.set(cell, own === 0 ? { kind: 'newest' } : { kind: 'behind', by: own });
			continue;
		}
		// ⛔ THE FENCE. `newerReleaseCount` returns null for TWO reasons and
		// only ONE of them may fall back. See the header.
		//   · a list EXISTS and this version is not in it → the lag is
		//     genuinely unknowable. `unknown`, and no number. Never the
		//     ladder, which would answer a question the controller has
		//     declined to answer.
		//   · NO list exists at all → there is no own-stream witness, and the
		//     ladder (built from deploy history) is the only ordering there
		//     is. Does not occur on any live rollout.
		const st = cell.rollout?.status;
		const publishesNothing =
			!Array.isArray(st?.availableReleases) && !Array.isArray(st?.releaseCandidates);
		if (!publishesNothing) {
			out.set(cell, { kind: 'unknown' });
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
			return `${subject} is on the newest version available to it`;
		case 'behind':
			// ⛔ THE SUBJECT IS THE ENVIRONMENT'S UPGRADE PATH, NOT THE BUILD.
			// (2026-08-31) It read *"older than the newest one this app has"*,
			// which is a claim about the SHA — and two environments on one sha
			// can hold different numbers of candidates, so that sentence was
			// false for at least one of them. This says whose path it is and
			// what the number counts, which is also exactly what the Change
			// Version list will show.
			return `${subject} can still take ${v.by} newer version${v.by === 1 ? '' : 's'}`;
		case 'diverged':
			return `${subject} is running a version that is on no environment’s release list`;
		default:
			return `${subject}'s distance from the newest version cannot be resolved — the version it is running is not in its own release list`;
	}
}

/**
 * How many releases behind, for sorting and counting only — 0 for every state
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
