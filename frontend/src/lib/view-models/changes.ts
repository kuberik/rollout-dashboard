/**
 * THE `/changes` INDEX'S OWN VIEW-MODEL. CHANGES-2026-09-10.md §3.
 *
 * One entry per `Change` (`api/changes.ts`) — a merged pull request or a bare
 * commit on the base branch — folded through the SAME machinery every other
 * change surface already uses: `buildPrPipeline` (the per-service/per-cell
 * state) then `buildLandingGrid` (the compact grid a dense row can afford).
 * Nothing here invents a second state machine; this module only shapes ONE
 * `Change` into the inputs those two already expect, then adds what the
 * INDEX needs on top — a short verdict word, day grouping, and the
 * mine/repo/pending/`?q=` filters the head band's chips and search box read.
 *
 * ── WHY `Change` MAPS ONTO `PrPipelineMeta` FOR BOTH KINDS ────────────────
 *
 * `GET /api/github/changes` computes `containedIn`/`containedInAll` for
 * EVERY change, a bare commit included (unlike `my-pulls.ts`'s older
 * client-side approximation, which only ever had `mergeCommitSha` to go on).
 * So a bare commit and a merged PR both hand `buildPrPipeline` a real,
 * server-computed containment set — one code path, no "PR" special case.
 *
 * ── THE LEDGER FALLBACK, A SEPARATE SHAPE ─────────────────────────────────
 *
 * When GitHub is not configured or not connected, the index still has to
 * render something useful (§3, "honest degrade, not an empty page") — but it
 * has no `Change[]` to fold, only the rollout/environment data every other
 * page already streams. `buildLedgerChangeRows` reads `revision-ledger.ts`'s
 * own `buildRevisionLedger` (read-only; this module does not modify that
 * file) and produces a DELIBERATELY SIMPLER row: a revision, its short sha,
 * and the `liveSlots`/`totalSlots` count the ledger already computed — no
 * author (GitHub is the only source of that), no PR link, no landing grid
 * (there is no PR/commit metadata to build one from). The page renders this
 * shape instead of `ChangeRowVM`, not as a lesser version of it.
 */
import type { Rollout, Environment, RolloutDependency } from '../../types';
import {
	buildPrPipeline,
	buildChangeVerdict,
	firstProdLanding,
	type PrPipelineMeta,
	type PrPipelineVM,
	type PrCell,
	type PrService,
	type PrState,
	type ChangeVerdictTone,
	ShaSet,
	prPipelineGraph
} from './pr-pipeline';
import type { RolloutGraph } from './dependency-graph';
import { buildLandingGrid, toneOf, type LandingGridVM, type LandingMarkVM, type MarkTone } from './landing-grid';
import { buildRevisionLedger } from './revision-ledger';
import { worstChangeCell, isEnvHeld } from '../rollout-cards';
import { median } from './lead-time';
import { cellReasonText, frontierUsuallyLabelForCell } from '../pr-cell-copy';
import { changePath } from '../pr-ref';
import { changeBuildPath, envFamilyWord } from '../version-utils';
import type { Change } from '../api/changes';
import { startOfDayMs, zonedYMD } from '../display-time';
import { tierOf, TIER_ORDER } from './promotion-lanes';
import { revisionSha } from '../git-ref';

// ── THE SHORT VERDICT WORD, §2b ───────────────────────────────────────────

// ⭐ RULING 3 (CHANGES-2026-09-10 fix pass, "ONE VERDICT, THE FRONTIER"). The
// canonical type now lives in `pr-pipeline.ts` (`buildChangeVerdict`'s own
// return type) — re-exported here so existing call sites importing it from
// this module (`ChangeRow.svelte`) keep working unchanged.
export type { ChangeVerdictTone };

/**
 * `PrPipelineVM.verdict`'s own word, thinly wrapped — §2b's own examples:
 * mint `live everywhere`, orange `held in dev on hello-api-app`, red
 * `failed in staging`, gray `not built here`, blue `deploying in dev`. A
 * change with no service on this cluster at all (no repo match) reads
 * `not built here`, the same phrase `mergedPullServiceSummary`
 * (`my-pulls.ts`) already uses for that case.
 *
 * ⚠️ RETAINED FOR COMPATIBILITY, NO LONGER CALLED BY `buildChangeRow`
 * (⭐ ROUND 3, 2026-09-10 ruling A). This function derives everything from
 * `vm.services` alone, which is exactly why it CANNOT distinguish "no
 * service on this cluster sources this repo at all" from "the repo IS
 * deployed here, but nothing built this exact change" — `buildPrPipeline`
 * itself now disambiguates the two via `noRelease`, a fact this function's
 * own inputs cannot see. The real pipeline's own caller reads
 * `vm.verdictWord`/`vm.verdictTone`/`vm.noRelease` directly instead. Kept
 * here, unchanged, for existing callers/tests that hand it a bare,
 * hand-built `PrPipelineVM` and expect this exact re-derivation.
 */
export function changeVerdict(vm: PrPipelineVM): { word: string; tone: ChangeVerdictTone } {
	if (vm.services.length === 0) return { word: 'not built here', tone: 'not-built' };
	return buildChangeVerdict(vm.services);
}

/**
 * ⭐ FOURTH OPERATOR WALK, ITEM B (2026-09-10 coordinator fix). "Not
 * everywhere" is exactly "not `live everywhere`" — §3's own definition,
 * restated to read the SAME frontier tone `buildChangeVerdict` already
 * computed rather than re-scanning raw cell states with a hand-picked
 * subset. The OLD `NOT_EVERYWHERE_STATES` set named `gated`/`pinned`/
 * `waiting-upstream`/`failed`/`not-built` but not `deploying`/`baking`/
 * `retrying`/`promoting`/`queued`/`cancelled`/`rolled-back` — so a change
 * every service was actively DEPLOYING (nothing live yet anywhere) read as
 * "everywhere" and dropped out of every "N not everywhere yet" count on the
 * index, the repo card and Home's rollup, all three of which read this same
 * field. A live fleet measured the head band at "2 not everywhere yet"
 * against 4 rows that were plainly not live everywhere (held, queued,
 * partial) — this is that undercount's root cause.
 */
function computeNotEverywhere(vm: PrPipelineVM): boolean {
	return vm.verdictTone !== 'live';
}

// ── ONE ROW, GITHUB-BACKED ────────────────────────────────────────────────

export type ChangeRowVM = {
	owner: string;
	repo: string;
	/** `owner/repo`, lower-cased — the repo chip's own filter value. */
	repoKey: string;
	kind: Change['kind'];
	number?: number;
	title: string;
	sha: string;
	shortSha: string;
	/** `changePath`'s own address — a PR page or a sha page, one page kind. */
	href: string;
	htmlUrl: string;
	author: string;
	mergedAt: string;
	verdictWord: string;
	verdictTone: ChangeVerdictTone;
	grid: LandingGridVM;
	notEverywhere: boolean;
	/**
	 * ⭐ ROUND 2, R2.2 ("Typical to prod"). merge → first-prod-deploy, in ms,
	 * or `null` when unmeasurable — no service's PROD-family history ever
	 * PROVABLY landed a build carrying this change (see `firstProdLeadMs`'s
	 * own doc comment for what "provably" rules out). Reads
	 * `PrCell.historyMatches` (every retained history entry that carries
	 * this change, in any PROD-family environment, across every service)
	 * and `PrCell.firstLandingProven`, never `PrCell.since` (a different
	 * fact, about the cell's CURRENT standing, not about when this change
	 * itself first landed). `changesSummary` folds this across the whole
	 * feed into one median; kept per-row (not just the aggregate) so a
	 * future caller can print an individual change's own trip without
	 * recomputing it.
	 */
	prodLeadMs: number | null;
	/**
	 * ⭐ ROUND 2, R2.2 (`ChangeCard`'s block 2, "the reason"). The FRONTIER
	 * cell's own muted reason (`cellReasonText`) plus its "usually N min
	 * once it starts" estimate (`frontierUsuallyLabelForCell`) where both
	 * are known, joined ` · ` — `lib/CLAUDE.md`'s "name the FRONTIER, never
	 * the deepest symptom" applied to the same frontier `buildChangeVerdict`
	 * already picks (restated here rather than exposed by that function,
	 * which returns a fused SENTENCE, not the cell itself). `null` when
	 * nothing is blocking (live everywhere) or nothing has built yet
	 * anywhere (the all-not-built case, which prints its own one-line fold
	 * in block 1 and needs no elaboration under it).
	 *
	 * ⚠️ KNOWN GAP: the design doc's own example also shows a `· opens in
	 * 1d 4h` clock tail for a schedule-style hold. `PrCell` carries no
	 * `clearsAt`/reopen instant today (only `gateContract`/
	 * `gateRequiredVersion`, both dependency-shaped) — that tail is not
	 * renderable from this VM yet. Flagged for whichever lane next touches
	 * `pr-pipeline.ts`'s gate fields, not silently approximated here.
	 */
	frontierReason: string | null;
	/**
	 * ⭐ CHANGES-2026-09-10.md ROUND 2, HOME FEEDBACK PASS ("whether it is
	 * progressing"). The frontier cell's OWN `since` (`PrCell.since` — the
	 * ISO instant its CURRENT state began, populated for every state, not
	 * just `live`) — `ChangeLine`'s age slot reads this instead of
	 * `mergedAt` for any row that is not live everywhere, so "5h" answers
	 * "how long has it been stuck here" rather than "how long ago did this
	 * merge" (a fact the reader already has from the row's own history).
	 * `null` exactly when `frontierReason` is `null` (live everywhere, or
	 * nothing built anywhere yet) OR the frontier's own `since` could not be
	 * determined — the same two guards, so a caller never sees one without
	 * the other.
	 */
	frontierSince: string | null;
	/**
	 * ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED"). Mirrors
	 * `PrPipelineVM.noRelease` — `true` when this repository IS deployed on
	 * this cluster but NONE of its services carry any release evidence for
	 * this exact change. `grid.services` is `[]` in this case (nothing to
	 * draw), and `standingWords`/`familyProgress` both read this flag rather
	 * than re-deriving "no release" from an empty `grid`, which is ALSO the
	 * shape a repo-mismatch (`vm.services.length === 0` for the OTHER reason)
	 * produces.
	 */
	noRelease: boolean;
	/**
	 * ⭐ COORDINATOR RULING (AD round 3, repo finding 8 / "item H") — THE
	 * CARRIER-SHA SUFFIX. Both the Changes row ("7b3c9f1 … failed in prod")
	 * and the Builds row ("7b3c9f1 … running in prod") can be true at once:
	 * this commit is CONTAINED IN a later build (`4a8d2e6`) that is the one
	 * actually failing, while no service literally running `7b3c9f1` itself
	 * is down. Rather than changing either row's truth, the Changes row
	 * names the carrier: `pickFrontierCell` (below) already is the worst
	 * cell — the SAME one `frontierReason`/`frontierSince` already read, not
	 * a second pick — and when that cell's own `revision` differs from this
	 * row's `sha`, THAT revision is what is actually live/failing/held, and
	 * the row owes the reader that name. `null` whenever the frontier cell
	 * runs this commit's own sha (the ordinary case), so most rows are
	 * unaffected. Optional — a hand-built fixture elsewhere that predates
	 * this field still type-checks and simply renders no suffix;
	 * `buildChangeRow` (the one real producer) always sets it.
	 */
	carrierSha?: string | null;
	/** `changePath` address for `carrierSha`'s own build page — `null`/unset iff `carrierSha` is. */
	carrierHref?: string | null;
	/**
	 * `vm.services` verbatim — the raw per-service `PrCell[]` `grid` has
	 * already folded away (family collapse, service fold) for the compact
	 * landing grid. `/changes` index (`journeyFromChange`) and this module's
	 * own `familyProgress` (the held-predicate correction, region naming for
	 * a partial rollback) both need the UNCOLLAPSED cells `grid` cannot give
	 * back. Optional so a hand-built fixture elsewhere that predates this
	 * field still type-checks and degrades to the old grid-only behaviour;
	 * `buildChangeRow` (the one real producer) always sets it.
	 */
	services?: PrService[];
};

/** THE ONE FRONTIER-PICKING PRECEDENCE, restated from `buildChangeVerdict`
 *  (`pr-pipeline.ts`) because that function returns only the fused
 *  sentence, never the cell itself — `frontierReasonFor` and this row's own
 *  `frontierSince` both need the CELL, not just its words, so they share
 *  this one selection rather than each re-deriving it. ⭐ ROUND 2 ("worst-wins",
 *  2026-10-09): both now read the SAME shared severity ranking
 *  (`worstChangeCell`, `rollout-cards.ts`) rather than each re-sorting by env
 *  rank alone — the two selections disagreeing was exactly the bug this
 *  round fixed (the two must never drift again, by construction: there is
 *  now only one sort to drift from). */
function pickFrontierCell(vm: PrPipelineVM): PrCell | null {
	const withBuild = vm.services.flatMap((s) => s.cells).filter((c) => c.state !== 'not-built');
	if (withBuild.length === 0) return null;
	if (withBuild.every((c) => c.state === 'live')) return null;
	const candidates = withBuild
		.filter((c) => c.state !== 'live')
		.map((cell) => ({ cell }));
	return worstChangeCell(candidates)?.cell ?? null;
}

/** `frontierReason`'s own computation off an already-picked frontier cell
 *  (`pickFrontierCell`) — see that function's doc for the precedence. */
function frontierReasonFor(frontier: PrCell | null, now: Date): string | null {
	if (!frontier) return null;
	const reason = cellReasonText(frontier, now);
	const eta = frontierUsuallyLabelForCell(frontier);
	if (reason && eta) return `${reason} · ${eta}`;
	return reason ?? eta ?? null;
}

/**
 * ⭐ HOME FEEDBACK PASS, ROUND 2 FIX (2026-09-10) — "in this state for Xh".
 * `pickFrontierCell` (above) answers a slightly different question: it picks
 * ONE cell, the earliest-env-rank non-live cell across every service,
 * tie-broken by cluster name — a reasonable single instant for
 * `frontierReason`'s prose, but the wrong one for "how long has it been
 * stuck HERE" once two services are both stuck in the SAME frontier family
 * at two different instants (the earlier one wins the tie-break above,
 * understating how long the family has actually been held). This reads the
 * SAME frontier `familyProgress` computes for the meter (never a second,
 * disagreeing frontier) and takes the MOST RECENT `since` among the raw
 * cells that put that family in its classification — a service that got
 * stuck five minutes ago should not make the row claim "stuck for 3 days"
 * because a DIFFERENT service in the same family has been stuck that long.
 * `null` when live everywhere, nothing built anywhere yet, or none of the
 * matching cells carry a `since` (`ChangeLine` falls back to `mergedAt`).
 */
function frontierFamilySince(vm: PrPipelineVM, grid: LandingGridVM): string | null {
	const steps = familyProgress({ grid });
	const idx = steps.findIndex((s) => s.tone !== 'live');
	if (idx === -1 || steps[idx].builtCount === 0) return null;
	const step = steps[idx];

	const matches = (state: PrState): boolean => {
		if (step.tone === 'stuck') return HELD_LIKE_PR_STATES.has(state);
		if (step.tone === 'failed') return state === 'failed';
		return state !== 'not-built';
	};

	let maxMs: number | null = null;
	for (const service of vm.services) {
		for (const cell of service.cells) {
			if (envFamilyWord(cell.envName) !== step.family) continue;
			if (!matches(cell.state) || !cell.since) continue;
			const ms = new Date(cell.since).getTime();
			if (!Number.isFinite(ms)) continue;
			if (maxMs == null || ms > maxMs) maxMs = ms;
		}
	}
	return maxMs != null ? new Date(maxMs).toISOString() : null;
}

/**
 * ⭐ QA FIX (round 2, "take the suffix from the SAME cell as the standing
 * word"). `carrierSha`'s own source cell — the SAME family step
 * `frontierFamilySince`/`frontierStandingStep`/`standingWords` already
 * picked (first non-live family in the frontier-freeze walk), never
 * `pickFrontierCell`'s own flat worst-cell ranking, which can name a
 * different service/family on a multi-service row and disagree with the
 * word printed right next to the suffix. Shares `frontierFamilySince`'s own
 * family/`matches` selection (duplicated rather than refactored together —
 * that function has its own tests pinning its current behaviour) but adds
 * ONE more exclusion on top: a RESOLVED cell (`rolled-back`) is never the
 * carrier — it is an OLDER build now running again, never something
 * carrying this change forward. Picks the most-recently-updated matching
 * cell, same tie-break as `frontierFamilySince`.
 */
function frontierStandingCell(vm: PrPipelineVM, grid: LandingGridVM): PrCell | null {
	// ⭐ QA FIX (round 4, 2026-10-11) — THE SAME PICK THE WORD USES, NOT A
	// SECOND SCAN. This used to run its OWN `findIndex(s => s.tone !==
	// 'live')` — narrower than `frontierStandingStep`'s own `tone !== 'live'
	// || liveCount < builtCount`, so a PARTIAL rollback (tone `'live'`,
	// `liveCount < builtCount` — the D3 shape) was invisible to THIS scan
	// while `standingWords` still picked that exact family for its text,
	// via `frontierStandingStep`. The two could land on different families
	// and disagree about which one the carrier suffix was even about.
	// Calling `frontierStandingStep` directly means there is only one pick
	// to drift from.
	const step = frontierStandingStep({ grid, services: vm.services });
	if (!step || step.builtCount === 0) return null;
	// ⭐ D1/D3 FIX (QA round 3+4, 2026-10-11, coordinator's rule) — A STEP
	// WITH ANY ROLLBACK NEVER CARRIES A CARRIER SUFFIX, whether the whole
	// family resolved (`step.resolved`) or only some of its regions did
	// (`step.anyResolved`, the D3 partial-live-ring shape). The step itself
	// is already the regression being named ("rolled back in
	// prod-eu-central"); naming a DIFFERENT build as its "carrier" in the
	// same breath reads as two disagreeing facts about the same row.
	if (step.anyResolved) return null;

	const matches = (state: PrState): boolean => {
		if (state === 'rolled-back') return false;
		if (step.tone === 'stuck') return HELD_LIKE_PR_STATES.has(state);
		if (step.tone === 'failed') return state === 'failed';
		return state !== 'not-built';
	};

	let best: PrCell | null = null;
	let bestMs = -Infinity;
	for (const service of vm.services) {
		for (const cell of service.cells) {
			if (envFamilyWord(cell.envName) !== step.family) continue;
			if (!matches(cell.state)) continue;
			const ms = cell.since ? new Date(cell.since).getTime() : -Infinity;
			if (best === null || ms >= bestMs) {
				best = cell;
				bestMs = ms;
			}
		}
	}
	return best;
}

/**
 * `prodLeadMs`'s own computation — see the field's doc comment. `null`
 * whenever the delta cannot be trusted as a real trip: no PROD-family
 * history entry PROVABLY landed this change first (below), an unparseable
 * timestamp on either end, or a non-positive delta (the same "not a lead
 * time for this hop" guard `lead-time.ts`'s own `leadTime` applies to a
 * build seen downstream before up).
 *
 * ⭐ FIX (2026-10-11, squad-changes "Median merge→prod" fix). Used to read
 * `cell.since` on a `state === 'live'` PROD cell — but `since` answers a
 * DIFFERENT question ("when did the cell's CURRENT standing begin", for the
 * row's own "live since" sentence) and `buildCell` (`pr-pipeline.ts`)
 * deliberately NULLS it whenever the merge predates the OLDEST entry this
 * rollout's retained history still remembers (`'live (since before
 * recorded history)'` — a defensive guard against claiming a landing date
 * earlier than the window can prove). A live fleet measured this against
 * `orders-api` #89: merged 2026-10-02, prod's own retained history's oldest
 * entry is a `01ab7c9` redeploy from 2026-10-05 — three days AFTER the
 * merge — so the guard fired and nulled `since` even though the cell's own
 * `historyMatches` (every retained history entry that carries THIS change,
 * independent of `since`/`state`) has exactly one entry for `7c14e2a`
 * itself, `Succeeded`, with a perfectly good timestamp.
 *
 * This reads `historyMatches` directly instead — "the first prod history
 * entry whose version contains the change, not the latest redeploy" — but
 * NEVER accepts the oldest matching entry on faith alone, because the same
 * failure mode cuts both ways: a rollout whose retained history happens to
 * START already carrying the change (the window rolled past its real
 * arrival) would make THIS entry look like "the first landing" when it is
 * really just "the oldest one still remembered". `PrCell.firstLandingProven`
 * (`pr-pipeline.ts`) is the guard — `true` only when an OLDER retained
 * entry in the SAME rollout exists and (by construction) does not carry the
 * change, which is the one thing that actually proves this is where the
 * change first arrived, not merely where the window's memory happens to
 * end. A cell that fails this guard contributes no sample at all, same as
 * one with no match — never a loosened, unproven guess.
 *
 * Within a proven cell, the entry accepted is the EARLIEST (oldest)
 * `historyMatches` entry whose `bakeStatus` is landed —
 * `bakeStatusLanded` (`pr-pipeline.ts`), the SAME `Succeeded`-or-`'None'`
 * rule `buildCell`'s own RULE 1 cascade already applies to a cell's current
 * head, reused rather than re-derived here so the two can never drift. An
 * in-flight/failed/cancelled attempt that happened to carry the change but
 * never actually served does not count as a landing.
 *
 * Works whether or not the cell's CURRENT state happens to be `live` (a
 * later build superseding/rolling back the one that landed this change
 * does not erase the fact that it once reached prod).
 *
 * ⭐ (2026-10-12, squad-changes QA pass — item 2, "ONE FIRST-LANDING
 * SOURCE"). The walk itself now lives in `pr-pipeline.ts`'s own exported
 * `firstProdLanding(vm, mergedAtIso)` — this is a thin unwrap (`.ms`, or
 * `null`) so every OTHER caller of this function keeps its existing
 * `number | null` shape. A second surface needing the LANDING INSTANT
 * itself (not just the span), e.g. a page's own "first deployed" line,
 * should call `firstProdLanding` directly rather than re-deriving `at`
 * from `mergedAtIso + prodLeadMs`.
 */
function firstProdLeadMs(vm: PrPipelineVM, mergedAtIso: string): number | null {
	return firstProdLanding(vm, mergedAtIso)?.ms ?? null;
}

function buildChangeRow(
	change: Change,
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date,
	graph?: RolloutGraph
): ChangeRowVM {
	const meta: PrPipelineMeta = {
		owner: change.owner,
		repo: change.repo,
		number: change.number ?? 0,
		mergedAt: change.mergedAt,
		mergeCommitSha: change.mergeCommitSha,
		containedIn: change.containedIn,
		containedInAll: change.containedInAll,
		// ⭐ FIX PASS ITEM 1 (2026-09-10). `GET /api/github/changes` computes
		// `containedIn`/`containedInAll` for EVERY row (the module doc above)
		// — an empty `containedIn` here is a REAL, server-verified answer
		// ("nothing merged after this yet"), never the bare-sha stub's
		// ambiguity. Leaving this unset let `buildPrPipeline`'s own default
		// (`containedIn.length > 0 || containedInAll`) read the newest change
		// (empty `containedIn`, `containedInAll: false`) as UNKNOWN and print
		// "not built yet" over a HELD release that genuinely exists.
		containmentKnown: true
	};
	const vm = buildPrPipeline(meta, rollouts, environments, rolloutDependencies, now, { graph });
	// ⭐ ROUND 3 (2026-09-10 ruling A). Read `vm`'s OWN word/tone/`noRelease`
	// directly rather than `changeVerdict(vm)` — that wrapper re-derives its
	// verdict purely from `vm.services` (kept that way on purpose; see its
	// own doc and the tests that hand it a bare, hand-built VM) and so
	// CANNOT tell "no service on this cluster sources this repo at all"
	// apart from "the repo is deployed here but nothing carries this exact
	// change" — both read `services.length === 0` from the outside.
	// `buildPrPipeline` itself already disambiguates the two (`noRelease`),
	// so this is the one caller that must read its answer rather than
	// recompute a coarser one.
	const verdict = { word: vm.verdictWord, tone: vm.verdictTone };
	const frontier = pickFrontierCell(vm);
	const grid = buildLandingGrid(vm, now);
	const href =
		change.kind === 'pr' && change.number != null
			? changePath(change.owner, change.repo, { number: change.number })
			: changePath(change.owner, change.repo, { sha: change.mergeCommitSha });
	// See `ChangeRowVM.carrierSha`'s own doc — the SAME cell the standing
	// word's own frontier step picked (`frontierStandingCell`, not
	// `pickFrontierCell`'s unrelated flat ranking), named only when its
	// revision both (a) is NOT this row's own commit — `ShaSet`/`revisionSha`
	// compare by actual sha, not raw string equality, so a 40-char revision
	// and a 7-char merge sha for the IDENTICAL commit are never read as two
	// different builds (QA round 2: this alone produced a false "· in
	// <own-sha>" suffix on the large majority of in-flight rows) — and (b)
	// IS one of the shas GitHub has already verified this change is
	// contained in (`change.containedIn`), so this never points at an
	// unrelated build that merely happens to differ in sha.
	const standingCell = frontierStandingCell(vm, grid);
	const carrierRevision = (() => {
		const sha = revisionSha(standingCell?.revision) || standingCell?.revision || null;
		if (!sha) return null;
		if (new ShaSet([change.mergeCommitSha]).has(sha)) return null;
		if (!new ShaSet(change.containedIn).has(sha)) return null;
		return sha;
	})();
	const carrierSha = carrierRevision ? carrierRevision.slice(0, 7) : null;
	const carrierHref = carrierRevision
		? changePath(change.owner, change.repo, { sha: carrierRevision })
		: null;

	return {
		owner: change.owner,
		repo: change.repo,
		repoKey: `${change.owner}/${change.repo}`.toLowerCase(),
		kind: change.kind,
		number: change.number,
		title: change.title,
		sha: change.mergeCommitSha,
		shortSha: change.mergeCommitSha.slice(0, 7),
		href,
		htmlUrl: change.htmlUrl,
		author: change.author,
		mergedAt: change.mergedAt,
		verdictWord: verdict.word,
		verdictTone: verdict.tone,
		grid,
		notEverywhere: computeNotEverywhere(vm),
		prodLeadMs: firstProdLeadMs(vm, change.mergedAt),
		frontierReason: frontierReasonFor(frontier, now),
		frontierSince: frontierFamilySince(vm, grid),
		noRelease: vm.noRelease,
		carrierSha,
		carrierHref,
		services: vm.services
	};
}

/** THE ONE ENTRY POINT for the GitHub-backed feed — one row per `Change`,
 *  in the SAME (newest-first) order the backend already sorts them. */
export function buildChangeRows(
	changes: readonly Change[],
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date = new Date()
): ChangeRowVM[] {
	if (changes.length === 0) return [];
	// The contract-hold graph depends only on the cluster inputs: build it
	// once for every row, never once per change (Home round 1, 26082260).
	const graph = prPipelineGraph(rollouts, environments, rolloutDependencies);
	return changes.map((c) => buildChangeRow(c, rollouts, environments, rolloutDependencies, now, graph));
}

// ── FILTERS — ALL URL-BACKED (`?mine`, `?repo=`, `?pending`, `?q=`) ───────

/**
 * ⚠️ `mine`/`pendingOnly`/`kind` ARE DEPRECATED CHIPS (⭐ ROUND 3 RULING B,
 * 2026-09-10, "TWO VIEWS, NOT ONE LIST"): "The chips Mine/Pull
 * requests/Not yet everywhere go." `/changes` no longer renders them — "Your
 * changes" is simply every row authored by the current user (`author`
 * equality, the same test `mine` already ran), and "Repositories" replaces
 * the pending/kind chips with one card per repo. The fields stay on this
 * type (not deleted) for a caller that still wants programmatic filtering —
 * `repos` and `q` are the two that SURVIVE as visible UI (search stays on
 * both pages; a repo page pre-filters via `repos`).
 */
export type ChangesFilter = {
	mine?: boolean;
	/** Repo keys (`owner/repo`, lower-cased). Multi-select, OR'd. Empty/undefined = no repo filter. */
	repos?: readonly string[];
	pendingOnly?: boolean;
	/**
	 * ⭐ RULING 5 (CHANGES-2026-09-10 fix pass). A "Pull requests" chip —
	 * `'pr'` shows only changes that came through a pull request,
	 * `'commit'` only bare base-branch commits. Undefined = no kind filter,
	 * matching every other multi-select chip's "unset = everything" rule.
	 */
	kind?: Change['kind'];
	q?: string;
};

/**
 * `?q=` over title, `#n` and sha — §3's own scope. Case-insensitive.
 *
 * ⛔ A LEADING `#` COMMITS TO "THIS IS A PR NUMBER" AND NOTHING ELSE. Without
 * that split, `#5` matched `bf5be49` — the digit `5` is just a substring of
 * a perfectly unrelated sha — which is a false positive a developer pasting
 * `#5` to find PR 5 would never expect. A bare `#n` never falls through to
 * the sha check.
 */
export function matchesChangeText(
	row: Pick<ChangeRowVM, 'title' | 'number' | 'sha' | 'shortSha'>,
	query: string
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	if (row.title.toLowerCase().includes(q)) return true;
	if (q.startsWith('#')) {
		const n = q.slice(1);
		return n.length > 0 && row.number != null && String(row.number) === n;
	}
	if (row.number != null && String(row.number) === q) return true;
	if (row.sha.toLowerCase().startsWith(q) || row.shortSha.toLowerCase().startsWith(q)) return true;
	return false;
}

export function filterChangeRows(
	rows: readonly ChangeRowVM[],
	currentUser: string,
	filter: ChangesFilter
): ChangeRowVM[] {
	const q = filter.q ?? '';
	return rows.filter((r) => {
		if (filter.mine && r.author.toLowerCase() !== currentUser.toLowerCase()) return false;
		if (filter.repos && filter.repos.length > 0 && !filter.repos.includes(r.repoKey)) return false;
		if (filter.pendingOnly && !r.notEverywhere) return false;
		if (filter.kind && r.kind !== filter.kind) return false;
		if (q && !matchesChangeText(r, q)) return false;
		return true;
	});
}

/**
 * ⭐ RULING 5 (CHANGES-2026-09-10 fix pass, "COUNTS"). The head band's own
 * numbers — §3's `3 of the last 30 days' changes are not everywhere yet · 2
 * repositories` — computed on the FILTERED rows, never the full feed: a
 * reader who has narrowed to one repo via its chip should see that repo's
 * own count, not the whole cluster's.
 */
export type ChangesSummary = {
	count: number;
	notEverywhereCount: number;
	repoCount: number;
};

/**
 * ⭐ ROUND 3B (2026-09-10, "NO RELEASE MEANS NOT AFFECTED, AND MUST NOT
 * COMPETE"). `count`/`notEverywhereCount` are computed over changes that
 * carry at least one affected service (`!r.noRelease`) — a bare commit or a
 * merged PR nothing on the cluster ever released is not deployable and does
 * not get to inflate "N changes" or "N not everywhere yet" (a live fleet
 * measured 43 of 61 rows this way, all reading "no release", none of them
 * competing with the four that actually matter). `repoCount` is unchanged —
 * a repository is still "seen" whether or not its most recent activity has
 * a release yet.
 */
export function summarizeChangeRows(rows: readonly ChangeRowVM[]): ChangesSummary {
	const released = rows.filter((r) => !r.noRelease);
	return {
		count: released.length,
		notEverywhereCount: released.filter((r) => r.notEverywhere).length,
		repoCount: new Set(rows.map((r) => r.repoKey)).size
	};
}

/**
 * ⭐ RULING 5. ONE definition of "your changes" — merged PRs AND bare
 * commits authored by `user` in whatever window `rows` already covers — so
 * the palette's Browse tile count and the Home header's own count can never
 * drift apart by counting differently (e.g. one PR-only, one PR+commit).
 */
export function myChangesCount(rows: readonly ChangeRowVM[], user: string): number {
	const u = user.toLowerCase();
	return rows.filter((r) => r.author.toLowerCase() === u).length;
}

/**
 * ⭐ RULING 5. Home's own row order — stuck-first (a frontier verdict that
 * is not `live` sorts ahead of one that is), then newest within each group.
 * `verdictTone !== 'live'` is the exact predicate `changeVerdict` guarantees
 * true only for "live everywhere" (§2b/§3), so this needs no second read of
 * `grid`/`services`.
 */
export function orderHomeChangeRows(rows: readonly ChangeRowVM[]): ChangeRowVM[] {
	return [...rows].sort((a, b) => {
		const aStuck = a.verdictTone === 'live' ? 1 : 0;
		const bStuck = b.verdictTone === 'live' ? 1 : 0;
		if (aStuck !== bStuck) return aStuck - bStuck;
		return new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime();
	});
}

export type RepoChipOption = { repoKey: string; label: string };

/** One chip per repository seen in the (unfiltered) feed, alphabetical by
 *  the short repo name — the chip row's own "repo, not repository section"
 *  vocabulary (§3). */
export function repoChipOptions(rows: readonly ChangeRowVM[]): RepoChipOption[] {
	const seen = new Map<string, string>();
	for (const r of rows) if (!seen.has(r.repoKey)) seen.set(r.repoKey, r.repo);
	return [...seen.entries()]
		.map(([repoKey, label]) => ({ repoKey, label }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

// ── DAY GROUPING — `/activity`'s own labels, restated for a 30-day window ─
//
// ⛔ NOT `/activity`'s `clusterLabel`. That function's vocabulary ("In the
// last hour", a bare weekday name, "Earlier") is tuned for a feed the human
// reads within a day or two of it happening; §3 asks for a calendar date
// once a change is more than a day old ("`Today` / `Yesterday` / `8 Sep`"),
// which reads correctly across the full 30-day window this index covers —
// "Earlier" for anything past a week would fold three weeks of changes into
// one undated bucket.

const MONTH_ABBR = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

export function changeDayLabel(iso: string, now: Date): string {
	const d = new Date(iso);
	const today = startOfDayMs(now);
	const yesterday = today - 86_400_000;
	const day = startOfDayMs(d);
	if (day === today) return 'Today';
	if (day === yesterday) return 'Yesterday';
	// ⛔ NOT `toLocaleDateString`'s default ordering — `undefined` resolves to
	// the RUNTIME's own locale (en-US in this environment, "Sep 1"), not the
	// "8 Sep" day-then-month form §3 asks for. Built explicitly so the format
	// is the same in every environment this runs in, dev machine or CI.
	const { day: dom, month } = zonedYMD(d);
	return `${dom} ${MONTH_ABBR[month]}`;
}

export type DayGroup<T> = { label: string; rows: T[] };

/** Generic over the GitHub-backed row and the ledger-fallback row alike —
 *  both carry an ISO instant, just under a different field name, so the
 *  caller supplies the accessor. Assumes `rows` is already newest-first
 *  (both `buildChangeRows` and `buildLedgerChangeRows` guarantee it), so a
 *  day only ever opens once. */
export function groupByDay<T>(rows: readonly T[], dateOf: (row: T) => string, now: Date): DayGroup<T>[] {
	const groups: DayGroup<T>[] = [];
	let currentLabel = '';
	for (const row of rows) {
		const label = changeDayLabel(dateOf(row), now);
		if (label !== currentLabel || groups.length === 0) {
			groups.push({ label, rows: [] });
			currentLabel = label;
		}
		groups[groups.length - 1].rows.push(row);
	}
	return groups;
}

// ── THE LEDGER FALLBACK — GITHUB NOT CONFIGURED OR NOT CONNECTED ─────────

export type LedgerChangeRow = {
	repoKey: string;
	repoLabel: string;
	revision: string;
	short: string;
	href: string;
	createdAt: string;
	liveSlots: number;
	totalSlots: number;
};

/** One row per revision the ledger already knows about (deployed subset —
 *  `RepoLedger.rows`, not `knownRevisions`' pending remainder), newest
 *  first. No author, no PR link, no landing grid — there is no GitHub
 *  metadata here to build either from; see the module doc. */
export function buildLedgerChangeRows(rollouts: Rollout[], environments: Environment[]): LedgerChangeRow[] {
	const ledgers = buildRevisionLedger(rollouts, environments);
	const rows: LedgerChangeRow[] = [];
	for (const repo of ledgers) {
		for (const row of repo.rows) {
			rows.push({
				repoKey: repo.repoKey,
				repoLabel: repo.repoLabel,
				revision: row.revision,
				short: row.short,
				href: changeBuildPath(repo.repoKey, row.revision, row.short),
				createdAt: new Date(row.createdMs).toISOString(),
				liveSlots: row.liveSlots,
				totalSlots: row.totalSlots
			});
		}
	}
	rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return rows;
}

// ── ROUND 2 — THE ONE-LINE ROW'S STANDING WORD, ≤4 WORDS. R2.1/§2b's own
// examples (`live everywhere`, `held in prod`, `not built yet`, `deploying
// to stg`, `failed in dev`, `2 of 5 live`) never carry `buildChangeVerdict`'s
// own SUBJECT (the blocked service's name) or its "will not move on its own"
// tail — both real, useful facts, and both already printed in full on the
// change page and the change card's own reason line (R2.2). This is the
// SHORTER reading for the row that only has one line: which environment,
// not which service. It reads off `row.grid` (`landing-grid.ts`'s own
// family-collapsed marks, already computed for the compact grid) rather
// than re-deriving a frontier from raw `PrCell[]`, so it never disagrees
// with what the SAME row's own landing grid draws two lines below it. ─────

/** The states R2.5(b) reserves amber for — `stuck`, in the design doc's own
 *  word. Byte-identical to `pr-pipeline.ts`'s own `HELD_LIKE_STATES`
 *  (private there); redeclared here rather than exported/imported across a
 *  lane boundary for one three-item set. */
const HELD_LIKE_PR_STATES = new Set<PrState>(['gated', 'waiting-upstream', 'pinned']);

/** Verb + preposition for every "something is moving, or about to" state —
 *  the states `HELD_LIKE_PR_STATES`/`failed`/`live`/`not-built` do not
 *  already cover. Absent from this table on purpose: those four, handled
 *  separately below because none of them takes an "in <env>" clause the
 *  same way (`live`/`not-built` are whole-change facts, `failed`/held are
 *  handled by their own branches ahead of this one). */
const STANDING_VERB: Partial<Record<PrState, { verb: string; prep: string }>> = {
	deploying: { verb: 'deploying', prep: 'to' },
	// ⭐ QA FIX (round 6, 2026-10-12) — "CHECKING", NOT "BAKING". The product's
	// own word for a health-check-in-progress stage is "checking" (the
	// status chip, `StatusMark`, `ChangeLine`'s own leading glyph title all
	// already say it) — "baking" was the one place in the change-row copy
	// still using the internal state name as if it were the reader-facing
	// word. The internal `PrState` literal (`'baking'`, this object's own
	// KEY) is UNCHANGED — only the rendered verb text moves.
	baking: { verb: 'checking', prep: 'in' },
	retrying: { verb: 'retrying', prep: 'in' },
	promoting: { verb: 'promoting', prep: 'to' },
	queued: { verb: 'queued', prep: 'for' },
	cancelled: { verb: 'cancelled', prep: 'in' },
	'rolled-back': { verb: 'rolled back', prep: 'in' }
};

/** Hard floor — a defensive truncation, not the primary mechanism (every
 *  branch below is already worded to land at ≤4 words on its own). Kept so
 *  a future word added to a branch above cannot silently blow the budget
 *  without a test catching it. */
function capWords(s: string, max = 4): string {
	const words = s.trim().split(/\s+/);
	return words.length <= max ? s : words.slice(0, max).join(' ');
}

/**
 * ⭐ HOME FEEDBACK PASS, ROUND 2 FIX (2026-09-10). Both `standingWords` and
 * `standingWordsCompact` used to scan EVERY mark for the worst state,
 * independent of position — so a row already live in `dev` but incidentally
 * `held` on some unrelated service way out in `prod` read "held in prod",
 * burying the fact that the change is actually MOVING. That is the same bug
 * `familyProgress` fixes for the meter (§2's "DEV·STG·PRD all amber"); this
 * reads the SAME frontier steps rather than re-deriving a second, possibly
 * disagreeing one. `idx` is the first family that is not fully `live`; a
 * `partial` family (some live, none stuck — `familyProgress`'s own doc) has
 * nothing to name but a count, which is exactly the "prefer the services
 * that ARE live over the consequential holds" the human asked for.
 */
/**
 * The step the standing phrase names: the WORST one, not the first unfinished
 * one (worstChangeCell's rule: failed > held/stuck > in flight > queued). A
 * change that failed in staging while dev has not taken it yet reads "failed
 * in staging", never "queued for dev" (squad-changes, incident #14).
 */
/**
 * ⭐ QA FIX (round 6, 2026-10-12) — THE PICK FOLLOWS THE FURTHEST LIVE
 * STAGE, NOT THE FIRST NOT-YET-REACHED ONE. `d0ff17e` (payments-core) is
 * the real shape this exists for: dev/test/staging all read `queued` (a
 * NEWER build superseded this one there before it ever deployed), while
 * ONE prod region is genuinely `live` — this build reached further than
 * dev ever did. The OLD `findIndex(tone !== 'live' || …)` scan walked
 * forward from the START and stopped at the first gap, so it named "queued
 * for dev" — technically true of dev, but not the furthest point this
 * build actually reached, and actively misleading (it reads as "nothing
 * has happened yet"). Mirrors `journey.ts`'s own `pickFrontier` — the
 * furthest-reached stop, not the first unreached one — restated here at
 * the family-step grain: scan forward and remember the LAST step with any
 * live cell; if that step is itself not fully live, it IS the frontier.
 * Only when nothing anywhere has gone live yet does this fall back to the
 * old "first not-yet-reached" reading (a normal row simply hasn't started).
 */
function frontierStandingStep(row: Pick<ChangeRowVM, 'grid' | 'services'>): FamilyProgressStep | null {
	const steps = familyProgress(row);
	const failed = steps.find((s) => s.tone === 'failed');
	if (failed) return failed;
	const stuck = steps.find((s) => s.tone === 'stuck');
	if (stuck) return stuck;

	let frontierIdx = -1;
	for (let i = 0; i < steps.length; i++) {
		if (steps[i].liveCount > 0) frontierIdx = i;
	}
	if (frontierIdx !== -1 && steps[frontierIdx].liveCount < steps[frontierIdx].builtCount) {
		return steps[frontierIdx];
	}

	const idx = steps.findIndex((s) => s.tone !== 'live' || s.liveCount < s.builtCount);
	return idx === -1 ? null : steps[idx];
}

function totalLiveBuilt(row: Pick<ChangeRowVM, 'grid' | 'services'>): { live: number; built: number } {
	const steps = familyProgress(row);
	return steps.reduce(
		(acc, s) => ({ live: acc.live + s.liveCount, built: acc.built + s.builtCount }),
		{ live: 0, built: 0 }
	);
}

/**
 * ⭐ D1 FIX (QA round 3, 2026-10-11, coordinator's rule) — THE ROLLBACK
 * REGION-NAMING COPY. Fires whenever `step.anyResolved` (at least one raw
 * cell in this family rolled back, whether the family as a whole is fully
 * live, partially live, or fully resolved):
 *
 *   - exactly ALL of the family's built cells rolled back → the plain
 *     family word, unchanged copy ("rolled back in prod").
 *   - 1–2 regions rolled back (out of a larger, otherwise-fine family) →
 *     name them by their real env name, both if two ("rolled back in
 *     prod-eu-central", "rolled back in prod-eu-central and prod-us-west").
 *   - more than 2 → the count ("rolled back in 3 prod regions").
 *
 * `null` without `row.services` (no raw per-region data to name regions
 * from) or when the step is not actually `anyResolved` — the caller falls
 * back to its own normal phrase in either case.
 */
function rolledBackPhrase(row: Pick<ChangeRowVM, 'services'>, step: FamilyProgressStep): string | null {
	if (!row.services || !step.anyResolved) return null;
	const cells: PrCell[] = [];
	for (const service of row.services) {
		for (const cell of service.cells) {
			if (envFamilyWord(cell.envName) === step.family) cells.push(cell);
		}
	}
	const built = cells.filter((c) => c.state !== 'not-built');
	const rolledBack = built.filter((c) => c.state === 'rolled-back');
	if (rolledBack.length === 0) return null;
	// ⭐ QA FIX (round 4, 2026-10-11) — DISTINCT REGIONS, NOT CELLS. Two
	// SERVICES can both carry a cell for the same env name (e.g. both
	// deployed to `prod-eu-central`) — counting raw cells would double-name
	// or over-count the SAME region. `built`/`rolledBack` are de-duplicated
	// by `envName` before anything downstream compares counts or lengths,
	// including the "did EVERY region in this family roll back" check.
	const builtRegions = [...new Set(built.map((c) => c.envName))];
	const rolledBackRegions = [...new Set(rolledBack.map((c) => c.envName))];
	if (rolledBackRegions.length === builtRegions.length) {
		return `rolled back in ${step.family.toLowerCase()}`;
	}
	if (rolledBackRegions.length <= 2) {
		return `rolled back in ${rolledBackRegions.join(' and ')}`;
	}
	return `rolled back in ${rolledBackRegions.length} ${step.family.toLowerCase()} regions`;
}

/**
 * ⭐ COORDINATOR RULING (QA round 4, 2026-10-11) — A PARTIAL-LIVE FAMILY
 * NAMES ITS OWN MOTION. `edge-mesh #77`'s own shape: 11 of 13 live overall,
 * because PROD is 10-of-12 live — the other two regions are not resolved
 * (D1/D3 take priority there), they are simply still `promoting`. The dot
 * already draws the correct partial-live ring (D3); this is the WORD half —
 * "11 of 13 live · promoting to 2" — so the reader knows the remaining two
 * are MOVING, not stuck or silently dropped. `null` whenever the picked
 * step is not a partial-live family, carries a rollback (`anyResolved` — D1
 * always wins that precedence), or none of its own non-live cells are a
 * state `STANDING_VERB` has a verb for. The count is DISTINCT REGIONS in
 * the DOMINANT state among the family's own non-live cells (the same
 * "regions, not cells" rule D2 applies to `rolledBackPhrase`) — ties break
 * on whichever state's cells were seen first.
 */
function inFlightMotionForStep(
	row: Pick<ChangeRowVM, 'services'>,
	step: FamilyProgressStep
): { verb: string; prep: string; count: number } | null {
	if (!row.services || step.tone !== 'live' || step.liveCount >= step.builtCount || step.anyResolved) {
		return null;
	}
	const cells: PrCell[] = [];
	for (const service of row.services) {
		for (const cell of service.cells) {
			if (envFamilyWord(cell.envName) === step.family) cells.push(cell);
		}
	}
	const nonLive = cells.filter((c) => c.state !== 'not-built' && c.state !== 'live' && c.state !== 'rolled-back');
	if (nonLive.length === 0) return null;

	let bestState: PrState | null = null;
	let bestCount = 0;
	const seenOrder: PrState[] = [];
	const counts = new Map<PrState, number>();
	for (const c of nonLive) {
		if (!counts.has(c.state)) seenOrder.push(c.state);
		counts.set(c.state, (counts.get(c.state) ?? 0) + 1);
	}
	for (const s of seenOrder) {
		const n = counts.get(s)!;
		if (n > bestCount) {
			bestCount = n;
			bestState = s;
		}
	}
	if (!bestState || !STANDING_VERB[bestState]) return null;
	const vp = STANDING_VERB[bestState]!;
	const distinctRegions = new Set(nonLive.filter((c) => c.state === bestState).map((c) => c.envName));
	return { verb: vp.verb, prep: vp.prep, count: distinctRegions.size };
}

/**
 * ⭐ COORDINATOR RULING (QA round 4) — `ChangeLine.svelte`'s OWN ENTRY POINT
 * for the motion clause, so it can wrap the COUNT alone in a span that
 * drops below 420px of container width (the same rule `.cl-carrier`
 * already follows) while the verb itself ("promoting") stays — the reader
 * still learns something is moving even when there is no room for "to 2".
 * `standingWords` calls the SAME underlying computation (`
 * inFlightMotionForStep`) for its own full-string reading, so the two can
 * never name a different verb or count for the same row.
 */
export function standingMotion(
	row: Pick<ChangeRowVM, 'grid' | 'services'>
): { verb: string; prep: string; count: number } | null {
	const step = frontierStandingStep(row);
	if (!step) return null;
	return inFlightMotionForStep(row, step);
}

/**
 * THE ≤4-WORD STANDING PHRASE. `ChangeLine`'s "where it stands" slot and
 * `ChangeCard`'s header `verdict` both print this — one function, so the
 * one-line row and the card can never drift on what a change's own state
 * reads as. Takes the row (not the raw `PrPipelineVM`) because everything
 * it needs — the frontier tone and the family-collapsed marks — is already
 * on `row.grid`/`row.verdictTone`, computed once at `buildChangeRow` time.
 */
export function standingWords(
	row: Pick<ChangeRowVM, 'verdictTone' | 'grid' | 'services'> & { noRelease?: boolean }
): string {
	// ⭐ ROUND 3 (2026-09-10 ruling A). "not built" is retired copy — checked
	// FIRST, ahead of `verdictTone`, so this reads correctly however the
	// caller reached `not-built` (the real pipeline's own `noRelease`, or a
	// hand-built fixture that never set the flag).
	if (row.noRelease) return 'no release';
	if (row.verdictTone === 'live') return 'live everywhere';
	if (row.verdictTone === 'not-built') {
		// `grid.services.length === 0` with `noRelease` falsy is the OTHER
		// zero-service shape — no app on this cluster deploys this repo at
		// all (`buildPrPipeline`'s own `verdictWord`/`vm.verdict` still say
		// "not built here" for that fact; this is the dense STANDING word,
		// a deliberately different vocabulary — see `pr-pipeline.ts`'s
		// `furthestCompact` for the same split). A service that DOES exist
		// with an actual `not-built` cell (a hand-built fixture bypassing
		// `buildPrPipeline`, which never produces this shape for real) reads
		// the same "no release" `noRelease` does, rather than a THIRD
		// phrase for a case the real pipeline cannot produce.
		//
		// ⛔ U-18 (2026-10-08, polish pass). "not deployed here" leaves
		// "here" undefined — nothing on screen names a place for it to
		// point at. "not deployed anywhere" needs no caller-supplied
		// referent: it is true of every environment there is, full stop.
		return row.grid.services.length === 0 ? 'not deployed anywhere' : 'no release';
	}

	const step = frontierStandingStep(row);
	if (step) {
		if (step.tone === 'failed') return capWords(`failed in ${step.family.toLowerCase()}`);
		if (step.tone === 'stuck') {
			// ⭐ shared/approval-words (2026-10-12, coordinator ruling). An
			// approval wait is NOT a rule hold — see `held.ts`'s own doc
			// comment. This is the one line every reader mistook for "held
			// in prod" (six blind reads, this ruling's own motivation); the
			// phrase runs 5 words, one over the ≤4-word budget every other
			// branch here keeps, which is why it is spelled out directly
			// rather than routed through `capWords`.
			if (step.approvalWait) return `waits for you in ${step.family.toLowerCase()}`;
			return capWords(`held in ${step.family.toLowerCase()}`);
		}
		// ⭐ D1 FIX — a rolled-back region is named even when the family is
		// otherwise live/partial (never capped to 4 words — the design asks
		// for the real env name(s), which can run longer than that budget).
		const rollback = rolledBackPhrase(row, step);
		if (rollback) return rollback;
		if (step.state && STANDING_VERB[step.state]) {
			const vp = STANDING_VERB[step.state]!;
			return capWords(`${vp.verb} ${vp.prep} ${step.family.toLowerCase()}`);
		}
	}

	const { live, built } = totalLiveBuilt(row);
	if (live > 0 && built > 0) {
		const base = capWords(`${live} of ${built} live`);
		// ⭐ COORDINATOR RULING (QA round 4) — the motion clause is never
		// capped to 4 words, same exemption `rolledBackPhrase` already gets:
		// the count can run past the base budget ("11 of 13 live · promoting
		// to 2" is 7 words) and that is fine, it is additive detail, not a
		// replacement for the base phrase's own brevity.
		const motion = step ? inFlightMotionForStep(row, step) : null;
		return motion ? `${base} · ${motion.verb} ${motion.prep} ${motion.count}` : base;
	}
	return built > 0 ? capWords(`${built} in progress`) : 'not deployed anywhere';
}

/**
 * `ChangeCard`'s `verdictCompact` — `Card`'s own narrower spelling below a
 * 560px card width (R2.2's own table: `held · prd`). Same precedence as
 * `standingWords`, worded to the family alone: `<short state> · <family>`.
 */
export function standingWordsCompact(
	row: Pick<ChangeRowVM, 'verdictTone' | 'grid' | 'services'> & { noRelease?: boolean }
): string {
	// ⭐ ROUND 3 (2026-09-10 ruling A). "not built" retired — see
	// `standingWords`'s own doc for the full reasoning; this is its
	// compact-card twin.
	if (row.noRelease) return 'no release';
	if (row.verdictTone === 'live') return 'live';
	if (row.verdictTone === 'not-built') return 'no release';

	const step = frontierStandingStep(row);
	if (step) {
		if (step.tone === 'failed') return `failed · ${step.family.toLowerCase()}`;
		if (step.tone === 'stuck') {
			// Same ruling as `standingWords` — never "held" for an approval wait.
			if (step.approvalWait) return `waits for you · ${step.family.toLowerCase()}`;
			return `held · ${step.family.toLowerCase()}`;
		}
		if (step.state && STANDING_VERB[step.state]) {
			return `${STANDING_VERB[step.state]!.verb} · ${step.family.toLowerCase()}`;
		}
	}

	const { live, built } = totalLiveBuilt(row);
	if (live > 0 && built > 0) return `${live}/${built} live`;
	return built > 0 ? `${built} moving` : 'no release';
}

// ── ROUND 2 — R2.2's RAIL CARD 1, `How your changes are going` ───────────

export type ChangesRailSummary = {
	/** `rows.length` — the feed is already the 30-day window
	 *  (`fetchChanges(30, …)`'s own default), so this needs no separate
	 *  date filter. */
	mergedCount: number;
	/** `typicalToProdMs(rows)` — see that function's own doc for the
	 *  definition and the 2-sample floor. */
	typicalToProdMs: number | null;
	typicalToProdSamples: number;
	/** `verdictTone === 'held'` — R2.5(b)'s `stuck` bucket, the same
	 *  predicate the section-1 dot's amber-vs-gray decision reads. */
	heldCount: number;
	neverBuiltCount: number;
};

/**
 * ⭐ ROUND 3 (2026-09-10, third operator walk) — THE ONE "TYPICAL TO PROD"
 * DEFINITION. Before this fix, four surfaces (Home's rail, `/changes`' own
 * rail, the change page, the app page) each derived their own median
 * merge→first-prod-deploy span and disagreed on the SAME underlying data —
 * 5m / 1d / 3m / "no measured trip yet" for one fleet at one instant. This
 * is the ONE function every one of those surfaces must read VERBATIM (the
 * route lane is responsible for migrating the three that don't yet).
 *
 * The median of `ChangeRowVM.prodLeadMs` (`firstProdLeadMs`'s own doc: the
 * merge → first-PRD-family-`live` span) over `rows`, optionally narrowed to
 * ONE repository via `repoKey` (omitted = the whole fleet). `null` under
 * fewer than 2 samples — a "median" of one trip is not a typical anything.
 * `rows` may be in any order and any scope the caller likes (the 30-day
 * feed, a single repo's changes, …) — this does no date filtering of its
 * own; the caller's own `rows` IS the window.
 */
export function typicalToProdMs(rows: readonly ChangeRowVM[], repoKey?: string): number | null {
	const scoped = repoKey ? rows.filter((r) => r.repoKey === repoKey) : rows;
	const samples = scoped.map((r) => r.prodLeadMs).filter((ms): ms is number => ms != null);
	return samples.length >= 2 ? median(samples) : null;
}

export function changesSummary(rows: readonly ChangeRowVM[]): ChangesRailSummary {
	const samples = rows
		.map((r) => r.prodLeadMs)
		.filter((ms): ms is number => ms != null);
	return {
		mergedCount: rows.length,
		typicalToProdMs: typicalToProdMs(rows),
		typicalToProdSamples: samples.length,
		heldCount: rows.filter((r) => r.verdictTone === 'held').length,
		// ⭐ ROUND 3B — "No release · 43" (was "Never built"). Reads `r.noRelease`
		// directly, not `verdictTone === 'not-built'`: the latter tone is also
		// worn by the OTHER zero-service shape ("no app on this cluster
		// deploys this repository at all", a fact about the REPO, never
		// printed as "no release" anywhere else — folding it in here would
		// have double-counted a different bucket under this label).
		neverBuiltCount: rows.filter((r) => r.noRelease).length
	};
}

// ── ROUND 2 — R2.2's RAIL CARD 2, `Repositories` ──────────────────────────

export type RepoChangeCount = {
	repoKey: string;
	label: string;
	count: number;
	heldCount: number;
};

/** One entry per repository seen in `rows`, alphabetical by label — the
 *  SAME ordering `repoChipOptions` already uses, so the rail card and the
 *  head band's own chip row never disagree on repo order. */
export function perRepoCounts(rows: readonly ChangeRowVM[]): RepoChangeCount[] {
	const byRepo = new Map<string, RepoChangeCount>();
	for (const r of rows) {
		let entry = byRepo.get(r.repoKey);
		if (!entry) {
			entry = { repoKey: r.repoKey, label: r.repo, count: 0, heldCount: 0 };
			byRepo.set(r.repoKey, entry);
		}
		entry.count += 1;
		if (r.verdictTone === 'held') entry.heldCount += 1;
	}
	return [...byRepo.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ── ROUND 3 (2026-09-10 ruling B, "TWO VIEWS, NOT ONE LIST") ──────────────
//
// `/changes` stops being one mixed list with Mine/Pull requests/Not yet
// everywhere chips (R2.2's own sections, `splitChangeSections` below, are
// superseded by this — kept, not deleted, see its own doc). The new shape is
// two blocks: "Your changes" (`filterChangeRows(rows, user, { mine: true })`
// + `orderHomeChangeRows`, both unchanged, no new export needed) and
// "Repositories" — one card per repo with a progress summary
// (`repoProgress`) and its `recentByRepo` most-recent rows.

export type RepoProgress = {
	/** Every change in `rows` for this repo — the card's own `N changes`. */
	changes: number;
	/** `notEverywhere` count within this repo — "N not everywhere". */
	notEverywhere: number;
	/** `typicalToProdMs(rows, repoKey)` — `null` under 2 samples. */
	typicalToProdMs: number | null;
	/** The newest change's own `mergedAt` in this repo, or `null` when the
	 *  repo has no rows at all. `rows` is assumed newest-first (every
	 *  producer of `ChangeRowVM[]` in this module already guarantees it). */
	latestMergedAt: string | null;
};

/**
 * ⭐ ROUND 3 RULING B. The "Repositories" card's own progress line — "6
 * changes · 2 not everywhere · typical to prod 5m". Scopes `rows` to
 * `repoKey` itself (the caller does not need to pre-filter), so it is safe
 * to call once per repo over the SAME full feed `recentByRepo` also reads.
 *
 * ⭐ ROUND 3B — excludes `noRelease` rows from every count. A repo's card
 * counts what it actually shipped, not the bare commits sitting beside it
 * with nothing to show.
 */
export function repoProgress(rows: readonly ChangeRowVM[], repoKey: string): RepoProgress {
	const repoRows = rows.filter((r) => r.repoKey === repoKey && !r.noRelease);
	return {
		changes: repoRows.length,
		notEverywhere: repoRows.filter((r) => r.notEverywhere).length,
		typicalToProdMs: typicalToProdMs(repoRows),
		latestMergedAt: repoRows[0]?.mergedAt ?? null
	};
}

/**
 * ⭐ ROUND 3C FIX (2026-09-10, "REPOSITORIES DUPLICATES YOUR CHANGES"). A
 * repo card's own row list is ONLY its `notEverywhere` changes — a live
 * fleet measured 10 of 10 rows across two repo cards href-identical to rows
 * already printed in "Your changes" above, because the old cut here was
 * "5 most recent, any standing" over the SAME feed "Your changes" already
 * shows in full. A repository card answers "what of mine (or anyone's) in
 * this repo is NOT everywhere yet" — the live rows are already accounted
 * for by the card's own header rollup and by `notEverywhereCount === 0`'s
 * one-line "all live everywhere" (the caller's job, see `repoAllLive`
 * below); this list would just be reprinting them for no new fact.
 *
 * Ordered newest-first, capped at `n` per repo.
 *
 * ⭐ FIX PASS ITEM 11, 2026-09-11 — ONE SORT KEY FOR THE SAME CHANGES ON ONE
 * SCREEN. This used to re-rank by `SECTION_RANK` (failed → held → active →
 * not-built) — a FINER split than "Your changes" applies to the identical
 * population. `orderHomeChangeRows` (RULING 5, this file's own "ONE
 * definition") sorts everything newest-first inside its one non-live
 * bucket, so a repo whose "Your changes" card put a `held` row above an
 * `active` one (both non-live, tied on that binary key, newest wins) could
 * show the SAME two rows in the opposite order in its own "Repositories"
 * card two hundred pixels away, on a live fleet. Matched to
 * `orderHomeChangeRows`'s own tie-break — newest first, no second key —
 * rather than the reverse: that function is the ruling's canonical
 * definition and also drives Home's identical card.
 *
 * ⭐ ROUND 3B — a `noRelease` row is skipped outright: it has nothing to
 * show (no landing grid, no standing beyond "no release") and must not
 * spend one of the "not everywhere" slots a released change could use.
 */
export function recentByRepo(rows: readonly ChangeRowVM[], n: number): Map<string, ChangeRowVM[]> {
	const byRepo = new Map<string, { r: ChangeRowVM; i: number }[]>();
	rows.forEach((row, i) => {
		if (row.noRelease || !row.notEverywhere) return;
		const bucket = byRepo.get(row.repoKey);
		if (bucket) bucket.push({ r: row, i });
		else byRepo.set(row.repoKey, [{ r: row, i }]);
	});
	const out = new Map<string, ChangeRowVM[]>();
	for (const [repoKey, entries] of byRepo) {
		const sorted = entries
			.sort((a, b) => a.i - b.i)
			.slice(0, n)
			.map(({ r }) => r);
		out.set(repoKey, sorted);
	}
	return out;
}

// ── ROUND 2 — R2.2's TWO SECTIONS ─────────────────────────────────────────
//
// ⚠️ DEPRECATED BY ROUND 3 RULING B ("TWO VIEWS, NOT ONE LIST"). `/changes`
// no longer renders a single mixed list split into "Not everywhere yet" /
// "Live everywhere" — see the ruling-B block above. `splitChangeSections`
// and `ChangeSections` are KEPT (not deleted — the task's own instruction,
// and `/changes/<repo>` may still want a similar split over one repo's own
// rows) but are no longer the index page's own shape. Do not wire a NEW
// call site to this without checking whether `repoProgress`/`recentByRepo`
// already say what is needed.

export type ChangeSections = {
	/** §"Not everywhere yet" — failed → held (§'s own "stuck") → in-flight →
	 *  not-built, newest first inside each bucket. */
	notEverywhere: ChangeRowVM[];
	/** §"Live everywhere" — day-grouped by the caller via `groupByDay`,
	 *  unchanged order (newest first) here. */
	liveEverywhere: ChangeRowVM[];
};

const SECTION_RANK: Record<ChangeVerdictTone, number> = {
	failed: 0,
	held: 1,
	active: 2,
	'not-built': 3,
	live: 4
};

/** Splits the already-newest-first feed into the index's two sections
 *  (R2.2) — `notEverywhere` re-ordered failed-first per the section's own
 *  ordering rule, `liveEverywhere` left in the feed's own (newest-first)
 *  order for `groupByDay` to fold. */
export function splitChangeSections(rows: readonly ChangeRowVM[]): ChangeSections {
	const notEverywhere = rows
		.filter((r) => r.notEverywhere)
		.map((r, i) => ({ r, i }))
		.sort((a, b) => SECTION_RANK[a.r.verdictTone] - SECTION_RANK[b.r.verdictTone] || a.i - b.i)
		.map(({ r }) => r);
	const liveEverywhere = rows.filter((r) => !r.notEverywhere);
	return { notEverywhere, liveEverywhere };
}

// ── HOME FEEDBACK PASS — "whether it is progressing, how far, without
// showing every single environment" ──────────────────────────────────────
//
// The human, on Home's `YourChangesCard` (2026-09-10, after round 2 shipped):
// *"the PRs on homepage don't display enough information. I'd want to see at
// a glance whether they're progressing, how far, and whatnot. without
// showing every single environment."* `ChangeLine`'s one-line row already
// refuses the full landing grid (R2.1's own cut list — "the norm drawn
// seventy-five times inside a 320px rail"); the answer is not to bring the
// grid back but to compress it one level further: one step per environment
// FAMILY (`DEV`/`STG`/`PRD`, `landing-grid.ts`'s own tiers), not one mark per
// service/env cell.

/**
 * ⭐ FIX PASS (2026-09-10, "FRONTIER-AWARE METER"). One stage in the compact
 * per-family progress meter — `ChangeLine`'s own slot. Reuses
 * `landing-grid.ts`'s `MarkTone` (`live`/`stuck`/`active`/`queued`/`none`/
 * `failed`) rather than inventing a second state-colour vocabulary: `none`
 * now ALSO carries "this family is unreachable given where the change is
 * actually stuck" (the frontier freeze below), the same dashed/neutral
 * treatment `LandingMark` already gives a plain not-built cell — visually
 * identical, the difference is only in `sentence`/the tooltip. `state` keeps
 * the underlying `PrState` (`null` when nothing built or frozen) because a
 * single `active` tone covers both `deploying` (blue) and `baking`/
 * `retrying` (yellow) — the same two-way split `ChangeLine`'s own row icon
 * already makes off `standingWords`' leading verb.
 */
export type FamilyProgressStep = {
	/** `DEV` / `STG` / `PRD` / `TEST`, or a 3-letter fallback. */
	family: string;
	familyOrder: number;
	tone: MarkTone;
	/** Representative underlying state — the stuck cell's own state for
	 *  `stuck`, the active cell's for `active`/`queued`, `null` otherwise
	 *  (nothing to single out for `live`/`none`/`failed`). */
	state: PrState | null;
	/** Marks with a build in this family (`state !== 'not-built'`), BEFORE
	 *  the frontier freeze — always the real count, even on a frozen step,
	 *  so a caller summing "N of M live" across every step never undercounts
	 *  a family the meter itself must draw as moot. */
	builtCount: number;
	/** Of `builtCount`, how many are `live`. */
	liveCount: number;
	/** Every contributing mark's own sentence, joined — for the step's
	 *  `title`/tooltip. */
	sentence: string;
	/**
	 * ⭐ shared/approval-words (2026-10-12). `true` exactly when `tone ===
	 * 'stuck'` AND the stuck mark it is drawn from is held on a PERSON —
	 * `LandingMarkVM.approvalWait`, carried through unchanged (never
	 * re-derived). `false` on every other tone, and on a `stuck` step whose
	 * hold is a rule rather than an approval. `standingWords`/
	 * `standingWordsCompact` read this to pick "waits for you" over "held".
	 */
	approvalWait: boolean;
	/**
	 * ⭐ QA FIX (squad-changes shared row, round 2, 2026-10-11) — DRAWING ONLY.
	 * `true` when this step's own representative `state` is a RESOLVED one
	 * (today, `rolled-back` — a build that WAS here, failed or was undone,
	 * and is gone again). Earlier round wrongly took this out of `builtCount`
	 * entirely, which also changed `standingWords`'/`frontierStandingStep`'s
	 * own pick ("3 of 3 live · in d0ff17e" instead of "rolled back in
	 * prod") — counts and words must stay exactly as `tone`/`state` already
	 * say. This flag exists ONLY so a caller drawing the compact meter's dot
	 * (`ChangeLine.svelte`, `CommandPalette.svelte` — both read this same
	 * function) can draw it neutral/dashed instead of `tone`'s own `active`
	 * (blue, pulsing — "something is moving right now", the opposite of
	 * resolved) WITHOUT touching the tone/state/counts every other reader
	 * depends on. */
	resolved: boolean;
	/**
	 * ⭐ D1/D3 FIX (QA round 3, 2026-10-11) — `true` when ANY cell in this
	 * family rolled back, even a family that is otherwise mostly/fully live
	 * (`resolved` above is `true` only when EVERY built cell did — the dot's
	 * own drawing rule; this is the WORD's rule, which must call the
	 * regression out even while the dot still draws the live ring because
	 * most of the family is fine). `standingWords` reads this to NAME the
	 * regressed region(s) — `coordinator`: "rolled back in prod-eu-central"
	 * (1–2 regions, both named), "rolled back in N prod regions" (more), or
	 * the plain family word only once EVERY region in it rolled back. Always
	 * `false` without `row.services` (no raw per-region data to find this
	 * from — a grid-only fixture keeps today's behaviour). */
	anyResolved: boolean;
};

/** §"AMBER IS THE FRONTIER, NOT EVERY STUCK CELL". `gated`/`pinned`/
 *  `waiting-upstream` — byte-identical to `pr-pipeline.ts`'s own
 *  `HELD_LIKE_STATES` (private there) and this module's own
 *  `HELD_LIKE_PR_STATES`; restated as a `MarkTone`-level check below because
 *  `LandingMarkVM` already carries the collapsed `tone`, not the raw state,
 *  for a mark spanning multiple regions. */

/**
 * THE PER-FAMILY PROGRESS METER, FRONTIER-AWARE. `familyProgress` used to
 * take the WORST mark per family independently — so a change held in `dev`
 * on one service read `DEV·STG·PRD` all amber the moment ANY service was
 * ALSO (independently) held in staging/prod, even though the change cannot
 * possibly have moved past `dev` yet. Walks families in rank order instead:
 *
 *  - `live` — every mark WITH A BUILD in this family is `live` (a family
 *    with zero built marks is `none`, not `live` — nothing to claim).
 *  - `live` (partial) — some marks are live, none are `stuck`/`failed` —
 *    `liveCount < builtCount` tells a caller (the meter's ring-vs-fill, the
 *    standing word's "N of M live") this family is not FULLY there yet,
 *    without inventing a second green tone.
 *  - `stuck` / `failed` — the FIRST family (walking forward from the last
 *    `live` one) that has a stuck/failed mark. This family, and only this
 *    one, gets the loud amber/red — and FREEZES the walk: every family
 *    after it is forced to `none` regardless of ITS OWN marks, because the
 *    change cannot have reached further than its own frontier. This is the
 *    fix — a service ALSO independently held three stages downstream no
 *    longer repaints every stage amber.
 *  - `active` / `queued` — nothing live yet, nothing stuck, something is
 *    moving (or waiting its promotion-order turn). Does not freeze the
 *    walk: it is still genuinely in flight, not blocked.
 *  - `none` — no mark in this family carries a build (or the walk has
 *    already frozen past an upstream stuck/failed family).
 *
 * Reads `row.grid.services` (`landing-grid.ts`'s own family-collapsed
 * marks, already computed once at `buildChangeRow` time), so this can never
 * disagree with what the SAME row's own `ChangeCard` landing grid draws in
 * full two sections down.
 *
 * ⭐ THE HELD-PREDICATE CORRECTION (2026-10-11, coordinator ruling —
 * "refused here vs not reached yet"). `landing-grid.ts`'s `toneOf` folds
 * EVERY held-like `PrState` (`gated`/`pinned`/`waiting-upstream`) into
 * `'stuck'`, with no notion of "did the stage before this one actually
 * clear first" — a service genuinely held on a real gate at `staging` while
 * `dev` has not even reached it yet used to draw loud amber at `dev` too
 * (one stage not yet offered the build, read as a SECOND independent
 * hold). `PrCell.held` is now ALWAYS the correct, already-computed answer
 * (`pr-pipeline.ts`'s `buildCell` call site reads `held.ts`'s `heldVerdict`
 * directly — see that field's own doc) — `isEnvHeld` (the SAME predicate
 * every other list surface reads, never re-derived here) is what this walk
 * consults, via `row.services`' raw cells, before trusting a family's own
 * `stuck` mark. No local held/waits-for inference: when `row.services` is
 * present, a `stuck` mark only stands if some RAW cell in that family is
 * genuinely held per `isEnvHeld`; otherwise it falls through to the
 * active/queued branch exactly as a plain not-yet-reached wait would. A
 * caller with no `row.services` (a hand-built grid-only fixture) keeps the
 * OLD mark-only reading — this is additive, never a behaviour change for
 * marks alone.
 */
export function familyProgress(row: Pick<ChangeRowVM, 'grid' | 'services'>): FamilyProgressStep[] {
	const byFamily = new Map<string, LandingMarkVM[]>();
	for (const service of row.grid.services) {
		for (const mark of service.marks) {
			const list = byFamily.get(mark.family);
			if (list) list.push(mark);
			else byFamily.set(mark.family, [mark]);
		}
	}

	// Raw cells, grouped the SAME way (`envFamilyWord`) — `null` when the
	// caller handed no `services` (grid-only fixture), in which case every
	// genuine-held check below trusts the mark as before.
	const rawByFamily: Map<string, PrCell[]> | null = row.services
		? (() => {
				const m = new Map<string, PrCell[]>();
				for (const service of row.services!) {
					for (const cell of service.cells) {
						const fam = envFamilyWord(cell.envName);
						(m.get(fam) ?? m.set(fam, []).get(fam)!).push(cell);
					}
				}
				return m;
			})()
		: null;

	// ⭐ ROUND 3 (2026-09-10 ruling A). `grid.services` is `[]` for BOTH
	// zero-service shapes — a `noRelease` change and the repo-mismatch case
	// — so the meter still draws SOMETHING rather than nothing: three
	// neutral placeholders, `DEV`/`STAGING`/`PROD`, tone `none`, no
	// service/state to name. This is the "three dashed dots" the design doc
	// asks a `noRelease` row's meter to show.
	// ⛔ 2026-10-08 (U-13 vocabulary fix) — `STG`/`PRD` renamed to the full
	// words; see `version-utils.ts`'s `FAMILY_WORD`.
	if (byFamily.size === 0) {
		return [
			{
				family: 'DEV',
				familyOrder: 0,
				tone: 'none',
				state: null,
				builtCount: 0,
				liveCount: 0,
				sentence: '',
				approvalWait: false,
				resolved: false,
				anyResolved: false
			},
			{
				family: 'STAGING',
				familyOrder: 2,
				tone: 'none',
				state: null,
				builtCount: 0,
				liveCount: 0,
				sentence: '',
				approvalWait: false,
				resolved: false,
				anyResolved: false
			},
			{
				family: 'PROD',
				familyOrder: 3,
				tone: 'none',
				state: null,
				builtCount: 0,
				liveCount: 0,
				sentence: '',
				approvalWait: false,
				resolved: false,
				anyResolved: false
			}
		];
	}

	// ⭐ BUG 1 FIX (squad-changes shared row, round 1 2026-10-10, revised round
	// 2 2026-10-11) — CHAIN ORDER MUST MATCH `promotion-lanes.ts`'s
	// `TIER_ORDER` (dev → test → staging → other → prod), the SAME chain
	// order `journey.ts`'s adapters use. Sorting by `landing-grid.ts`'s own
	// `familyOrder` metadata put an unmatched/fallback family (an env name
	// none of `envFamilyWord`'s four regexes match, e.g. `canary`) AFTER
	// prod — `familyOrderFor`'s fallback is `Object.keys(FAMILY_ORDER)
	// .length`, one past `PROD`'s own `3` — while `promotion-lanes.ts`'s
	// `tierOf` places that same environment in `'other'`, rank 6, BEFORE
	// prod (which starts at rank 7). The full `LandingGrid` never actually
	// hits this: it draws marks in first-appearance order, already
	// rank-correct from `pr-pipeline.ts` (`collapseFamilies`'s own doc).
	// This explicit re-sort is the one place that can visibly disagree with
	// the chain. ROUND 2: reads `tierOf` DIRECTLY off the family word rather
	// than through a second hand-written `family → number` table (QA found
	// the round-1 `CHAIN_ORDER` map was itself just another string table,
	// with its own chance to drift from `promotion-lanes.ts`). A mark's
	// `family` is EITHER one of the four canonical words (`DEV`/`TEST`/
	// `STAGING`/`PROD`, `version-utils.ts`'s `FAMILY_WORD`) or, for an
	// unmatched env, that env's OWN name uppercased (`envFamilyWord`'s
	// fallback) — so lower-casing it and handing it to `tierOf` IS "the
	// minimum tier over this family's cells": the four canonical words
	// resolve to their own tier by definition, and a fallback family is the
	// literal env name `tierOf` would already rank.
	const families = [...byFamily.entries()].sort(
		(a, b) => TIER_ORDER.indexOf(tierOf(a[0].toLowerCase())) - TIER_ORDER.indexOf(tierOf(b[0].toLowerCase()))
	);

	const steps: FamilyProgressStep[] = [];
	let frozen = false;
	for (const [family, marks] of families) {
		const familyOrder = marks[0].familyOrder;
		const sentence = marks.map((m) => m.sentence).join('; ');
		const rawCells = rawByFamily?.get(family);

		// ⭐ D1/D3 FIX (QA round 3, 2026-10-11) — PER-REGION DETAIL NEEDS RAW
		// CELLS, NOT MARKS. `landing-grid.ts`'s `collapseFamilies` already
		// folds every region of a family into ONE worst-of mark BEFORE this
		// function ever sees it — so a single-service row with 6 prod
		// regions, 5 live and 1 rolled back, arrived here as ONE mark
		// (`rolled-back`, because `STATE_RANK` ranks it worse than `live`),
		// losing the other 5 entirely. That is why a 5-of-6-live family used
		// to read as fully resolved ("3 of 3 live · in <sha>", then "rolled
		// back in prod" with no partial ring). When `row.services` is
		// available (every real row; a grid-only fixture is not), this walk
		// classifies straight off the UNCOLLAPSED cells instead — the marks
		// path below is kept only as the fallback for those fixtures.
		let built: { tone: MarkTone; state: PrState }[];
		let liveCount: number;
		let tone: MarkTone;
		let state: PrState | null;
		let approvalWait = false;
		let anyResolved = false;

		if (rawCells && rawCells.length > 0) {
			const builtCells = rawCells.filter((c) => c.state !== 'not-built');
			built = builtCells.map((c) => ({ tone: toneOf(c.state), state: c.state }));
			liveCount = builtCells.filter((c) => c.state === 'live').length;
			anyResolved = builtCells.some((c) => c.state === 'rolled-back');

			if (builtCells.length === 0) {
				tone = 'none';
				state = 'not-built';
			} else if (liveCount === builtCells.length) {
				tone = 'live';
				state = null;
			} else {
				const failedCell = builtCells.find((c) => toneOf(c.state) === 'failed');
				// ⭐ THE HELD-PREDICATE CORRECTION — see this function's own doc.
				// `isEnvHeld` reads `PrCell.held`, now `held.ts`'s own
				// `heldVerdict` verbatim (`pr-pipeline.ts`'s `buildCell`), so a
				// held-like cell only counts here when it is GENUINELY refused,
				// never merely "hasn't reached this stage yet".
				const heldCell = builtCells.find((c) => toneOf(c.state) === 'stuck' && isEnvHeld(c));
				if (failedCell) {
					tone = 'failed';
					state = failedCell.state;
				} else if (heldCell) {
					tone = 'stuck';
					state = heldCell.state;
					// ⭐ shared/approval-words (2026-10-12) — carried through
					// unchanged from the cell; see `FamilyProgressStep.approvalWait`'s
					// own doc comment.
					approvalWait = heldCell.approvalWait ?? false;
				} else if (liveCount > 0) {
					// Partial: some live, none stuck/failed — still green, just
					// not full. D3: this is exactly the "5 of 6 regions live,
					// 1 rolled back" shape — the dot draws the partial-live
					// ring, never dashed, because the family is NOT settled.
					tone = 'live';
					state = null;
				} else {
					// ⭐ D3 — A RESOLVED CELL IS NEVER PREFERRED OVER A
					// GENUINELY IN-FLIGHT ONE when nothing is live yet either.
					const nonResolvedActive = builtCells.find(
						(c) => c.state !== 'rolled-back' && toneOf(c.state) === 'active'
					);
					const queuedCell = builtCells.find((c) => toneOf(c.state) === 'queued');
					const downgradedHeld = builtCells.find((c) => toneOf(c.state) === 'stuck');
					if (nonResolvedActive) {
						tone = 'active';
						state = nonResolvedActive.state;
					} else if (queuedCell) {
						tone = 'queued';
						state = queuedCell.state;
					} else if (downgradedHeld) {
						// Held-like, but not genuinely held — an ordinary
						// not-yet-reached wait, neutral, never amber/blue.
						tone = 'queued';
						state = downgradedHeld.state;
					} else {
						// Every built cell is resolved — the family's own
						// `resolved` flag (below) is what draws this
						// neutral/dashed, not this tone/state pair.
						tone = 'active';
						state = 'rolled-back';
					}
				}
			}
		} else {
			// ⭐ QA FIX (round 2) — A RESOLVED MARK (`rolled-back`) STAYS
			// "BUILT". The first round of this fix excluded it from `built`
			// entirely, which changed the row's WORDS, not just its dot — see
			// `carrier-sha.test.ts` / `changes.test.ts` for the live example.
			// Counts/tone/state are exactly what they were before BUG 1.
			const builtMarks = marks.filter((m) => m.tone !== 'none');
			built = builtMarks;
			liveCount = builtMarks.filter((m) => m.tone === 'live').length;
			anyResolved = builtMarks.some((m) => m.state === 'rolled-back');

			if (builtMarks.length === 0) {
				tone = 'none';
				state = 'not-built';
			} else if (liveCount === builtMarks.length) {
				tone = 'live';
				state = null;
			} else {
				const failedMark = builtMarks.find((m) => m.tone === 'failed');
				const stuckMark = builtMarks.find((m) => m.tone === 'stuck');
				const genuinelyHeld = stuckMark ? true : false; // no raw cells — trust the mark, as before
				if (failedMark) {
					tone = 'failed';
					state = failedMark.state;
				} else if (stuckMark && genuinelyHeld) {
					tone = 'stuck';
					state = stuckMark.state;
					// ⭐ shared/approval-words (2026-10-12) — carried through
					// unchanged from the mark; see `FamilyProgressStep.approvalWait`'s
					// own doc comment.
					approvalWait = stuckMark.approvalWait;
				} else if (liveCount > 0) {
					tone = 'live';
					state = null;
				} else {
					const nonResolvedActive = builtMarks.find((m) => m.tone === 'active' && m.state !== 'rolled-back');
					const queuedMark = builtMarks.find((m) => m.tone === 'queued');
					if (nonResolvedActive) {
						tone = 'active';
						state = nonResolvedActive.state;
					} else if (queuedMark) {
						tone = 'queued';
						state = queuedMark.state;
					} else {
						const resolvedMark = builtMarks.find((m) => m.state === 'rolled-back') ?? builtMarks[0];
						tone = 'active';
						state = resolvedMark.state;
					}
				}
			}
		}

		// ⭐ QA FIX (round 2) — DRAWING-ONLY RESOLVED FLAG. `rolled-back` is
		// the one `PrState` this meter needs to call out for its own dot:
		// the build WAS here and is gone again, never a filled or moving
		// (blue/pulsing) dot, matching `journey.ts`'s resolved-failure rule
		// — but `tone`/`state`/counts above are untouched, so the standing
		// word and the "N of M live" tally stay exactly what they were.
		const resolved = state === 'rolled-back';

		if (frozen) {
			// §"THE CHANGE CANNOT HAVE MOVED FURTHER" — this family's own
			// classification is moot once an upstream one is stuck/failed;
			// draw it quiet regardless of what it would have said on its own.
			steps.push({
				family,
				familyOrder,
				tone: 'none',
				state,
				builtCount: built.length,
				liveCount,
				sentence,
				// Frozen (the change cannot have moved further than its own
				// frontier): the family's own `approvalWait` is moot here, same
				// as its `tone` — nothing downstream reads amber or "waits for
				// you" for a family the walk has already passed.
				approvalWait: false,
				resolved,
				anyResolved
			});
			continue;
		}

		steps.push({
			family,
			familyOrder,
			tone,
			state,
			builtCount: built.length,
			liveCount,
			sentence,
			approvalWait,
			resolved,
			anyResolved
		});
		if (tone === 'stuck' || tone === 'failed') frozen = true;
	}
	return steps;
}

/** `DEV`/`STAGING`/`PROD`/`TEST` → the lowercase word the accessible label
 *  reads — `landing-grid.ts`'s own family-word vocabulary (2026-10-08: the
 *  visible word and the aria word are now the SAME spelling — `STG`/`PRD`
 *  were retired as abbreviations everywhere, not only here — so this map is
 *  a case-fold, not a spell-out). */
const FAMILY_FULL_WORD: Record<string, string> = { DEV: 'dev', TEST: 'test', STAGING: 'staging', PROD: 'prod' };

const STEP_ARIA_WORD: Record<MarkTone, string> = {
	live: 'live',
	stuck: 'held',
	failed: 'failed',
	active: 'active',
	queued: 'queued',
	none: 'not yet'
};

/** The meter's own `aria-label` — "dev live · staging held · prod not yet".
 *  A `live` step whose `liveCount < builtCount` (partial) still reads plain
 *  `live`: the count is a visual nicety the label does not need to spell
 *  out, and "partly live" is not a phrase a reader unfamiliar with the
 *  meter would parse faster than the simple word.
 *
 *  ⭐ D4 FIX (QA round 3, 2026-10-11) — THE LABEL NAMES THE SAME WORD THE DOT
 *  DRAWS. A `resolved` step (`FamilyProgressStep.resolved`) draws the
 *  neutral dashed ring (`ChangeLine.svelte`/`CommandPalette.svelte`'s own
 *  `step.resolved` check), not `tone`'s own `active` — the label used to say
 *  "active" over a dot that visibly was not, which is exactly the kind of
 *  disagreement between the picture and its own description an `aria-label`
 *  exists to prevent. Reads the SAME `'not yet'` word `tone === 'none'`
 *  already uses, since a resolved family's dot is visually identical to a
 *  not-built one. */
export function familyMeterAriaLabel(steps: readonly FamilyProgressStep[]): string {
	return steps
		.map((s) => `${FAMILY_FULL_WORD[s.family] ?? s.family.toLowerCase()} ${s.resolved ? STEP_ARIA_WORD.none : STEP_ARIA_WORD[s.tone]}`)
		.join(' · ');
}
