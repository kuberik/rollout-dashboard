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
	type PrPipelineMeta,
	type PrPipelineVM,
	type PrCell,
	type PrState,
	type ChangeVerdictTone
} from './pr-pipeline';
import { buildLandingGrid, type LandingGridVM, type LandingMarkVM, type MarkTone } from './landing-grid';
import { buildRevisionLedger } from './revision-ledger';
import { median } from './lead-time';
import { cellReasonText, frontierUsuallyLabelForCell } from '../pr-cell-copy';
import { changePath } from '../pr-ref';
import { changeBuildPath, envFamilyWord } from '../version-utils';
import type { Change } from '../api/changes';

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

/** Any cell held, failed or not-built — §3's own definition of the "Not yet
 *  everywhere" filter. A change with no matching service at all counts too:
 *  nothing built anywhere is the furthest thing from "everywhere". */
const NOT_EVERYWHERE_STATES = new Set<PrState>(['gated', 'pinned', 'waiting-upstream', 'failed', 'not-built']);

function computeNotEverywhere(vm: PrPipelineVM): boolean {
	if (vm.services.length === 0) return true;
	return vm.services.some((s) => s.cells.some((c) => NOT_EVERYWHERE_STATES.has(c.state)));
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
	 * or `null` when unmeasurable — no service reached a PRD-family
	 * environment yet, or its `since` was not recorded. Reads `PrCell.since`
	 * on a `live` cell in a `PRD`-family environment (the earliest across
	 * every service), the same instant `cellStateSentence`'s own "live
	 * since" reads — never a second, independently-derived timestamp.
	 * `changesSummary` folds this across the whole feed into one median;
	 * kept per-row (not just the aggregate) so a future caller can print an
	 * individual change's own trip without recomputing it.
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
};

/** THE ONE FRONTIER-PICKING PRECEDENCE, restated from `buildChangeVerdict`
 *  (`pr-pipeline.ts`) because that function returns only the fused
 *  sentence, never the cell itself — `frontierReasonFor` and this row's own
 *  `frontierSince` both need the CELL, not just its words, so they share
 *  this one selection rather than each re-deriving it (and, before this,
 *  disagreeing were the tie-break ever to drift). Two ties break
 *  differently on purpose elsewhere in this codebase (`landing-grid.ts`'s
 *  own module doc makes the same call for the same reason) — restating the
 *  four lines here is cheaper than exporting a cell handle across a lane
 *  boundary for two readers in the same file. */
function pickFrontierCell(vm: PrPipelineVM): PrCell | null {
	const withBuild = vm.services.flatMap((s) => s.cells).filter((c) => c.state !== 'not-built');
	if (withBuild.length === 0) return null;
	if (withBuild.every((c) => c.state === 'live')) return null;
	const candidates = withBuild
		.filter((c) => c.state !== 'live')
		.sort((a, b) => a.envRank - b.envRank || a.cluster.localeCompare(b.cluster));
	return candidates[0] ?? null;
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
 * `prodLeadMs`'s own computation — see the field's doc comment. `null`
 * whenever the delta cannot be trusted as a real trip: no PRD-family `live`
 * cell with a recorded `since`, an unparseable timestamp on either end, or a
 * non-positive delta (the same "not a lead time for this hop" guard
 * `lead-time.ts`'s own `leadTime` applies to a build seen downstream before
 * up).
 */
function firstProdLeadMs(vm: PrPipelineVM, mergedAtIso: string): number | null {
	const mergedMs = new Date(mergedAtIso).getTime();
	if (!Number.isFinite(mergedMs)) return null;
	let earliestProdMs: number | null = null;
	for (const service of vm.services) {
		for (const cell of service.cells) {
			if (cell.state !== 'live' || !cell.since) continue;
			if (envFamilyWord(cell.envName) !== 'PRD') continue;
			const ms = new Date(cell.since).getTime();
			if (!Number.isFinite(ms)) continue;
			if (earliestProdMs == null || ms < earliestProdMs) earliestProdMs = ms;
		}
	}
	if (earliestProdMs == null) return null;
	const delta = earliestProdMs - mergedMs;
	return delta > 0 ? delta : null;
}

function buildChangeRow(
	change: Change,
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date
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
	const vm = buildPrPipeline(meta, rollouts, environments, rolloutDependencies, now);
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
		noRelease: vm.noRelease
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
	return changes.map((c) => buildChangeRow(c, rollouts, environments, rolloutDependencies, now));
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
	const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const today = startOfDay(now);
	const yesterday = today - 86_400_000;
	const day = startOfDay(d);
	if (day === today) return 'Today';
	if (day === yesterday) return 'Yesterday';
	// ⛔ NOT `toLocaleDateString`'s default ordering — `undefined` resolves to
	// the RUNTIME's own locale (en-US in this environment, "Sep 1"), not the
	// "8 Sep" day-then-month form §3 asks for. Built explicitly so the format
	// is the same in every environment this runs in, dev machine or CI.
	return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
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
	baking: { verb: 'baking', prep: 'in' },
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
function frontierStandingStep(row: Pick<ChangeRowVM, 'grid'>): FamilyProgressStep | null {
	const steps = familyProgress(row);
	const idx = steps.findIndex((s) => s.tone !== 'live' || s.liveCount < s.builtCount);
	return idx === -1 ? null : steps[idx];
}

function totalLiveBuilt(row: Pick<ChangeRowVM, 'grid'>): { live: number; built: number } {
	const steps = familyProgress(row);
	return steps.reduce(
		(acc, s) => ({ live: acc.live + s.liveCount, built: acc.built + s.builtCount }),
		{ live: 0, built: 0 }
	);
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
	row: Pick<ChangeRowVM, 'verdictTone' | 'grid'> & { noRelease?: boolean }
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
		return row.grid.services.length === 0 ? 'not deployed here' : 'no release';
	}

	const step = frontierStandingStep(row);
	if (step) {
		if (step.tone === 'failed') return capWords(`failed in ${step.family.toLowerCase()}`);
		if (step.tone === 'stuck') return capWords(`held in ${step.family.toLowerCase()}`);
		if (step.state && STANDING_VERB[step.state]) {
			const vp = STANDING_VERB[step.state]!;
			return capWords(`${vp.verb} ${vp.prep} ${step.family.toLowerCase()}`);
		}
	}

	const { live, built } = totalLiveBuilt(row);
	if (live > 0 && built > 0) return capWords(`${live} of ${built} live`);
	return built > 0 ? capWords(`${built} in progress`) : 'not deployed here';
}

/**
 * `ChangeCard`'s `verdictCompact` — `Card`'s own narrower spelling below a
 * 560px card width (R2.2's own table: `held · prd`). Same precedence as
 * `standingWords`, worded to the family alone: `<short state> · <family>`.
 */
export function standingWordsCompact(
	row: Pick<ChangeRowVM, 'verdictTone' | 'grid'> & { noRelease?: boolean }
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
		if (step.tone === 'stuck') return `held · ${step.family.toLowerCase()}`;
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
 * ⭐ ROUND 3 RULING B. The "Repositories" card's own "5 most recent changes"
 * sub-list — one pass over the WHOLE (newest-first) feed, capping each
 * repo's own bucket at `n` as it goes, rather than the caller looping
 * `repoChipOptions()` and re-filtering/re-slicing the full array once per
 * repo. Preserves the feed's own newest-first order within each bucket
 * (never re-sorts) because `rows` is assumed newest-first already.
 *
 * ⭐ ROUND 3B — a `noRelease` row is skipped outright: it has nothing to
 * show (no landing grid, no standing beyond "no release") and must not
 * spend one of the 5 "most recent" slots a released change could use.
 */
export function recentByRepo(rows: readonly ChangeRowVM[], n: number): Map<string, ChangeRowVM[]> {
	const out = new Map<string, ChangeRowVM[]>();
	for (const row of rows) {
		if (row.noRelease) continue;
		const bucket = out.get(row.repoKey);
		if (bucket) {
			if (bucket.length < n) bucket.push(row);
		} else {
			out.set(row.repoKey, [row]);
		}
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
 */
export function familyProgress(row: Pick<ChangeRowVM, 'grid'>): FamilyProgressStep[] {
	const byFamily = new Map<string, LandingMarkVM[]>();
	for (const service of row.grid.services) {
		for (const mark of service.marks) {
			const list = byFamily.get(mark.family);
			if (list) list.push(mark);
			else byFamily.set(mark.family, [mark]);
		}
	}

	// ⭐ ROUND 3 (2026-09-10 ruling A). `grid.services` is `[]` for BOTH
	// zero-service shapes — a `noRelease` change and the repo-mismatch case
	// — so the meter still draws SOMETHING rather than nothing: three
	// neutral placeholders, `DEV`/`STG`/`PRD`, tone `none`, no service/state
	// to name. This is the "three dashed dots" the design doc asks a
	// `noRelease` row's meter to show.
	if (byFamily.size === 0) {
		return [
			{ family: 'DEV', familyOrder: 0, tone: 'none', state: null, builtCount: 0, liveCount: 0, sentence: '' },
			{ family: 'STG', familyOrder: 2, tone: 'none', state: null, builtCount: 0, liveCount: 0, sentence: '' },
			{ family: 'PRD', familyOrder: 3, tone: 'none', state: null, builtCount: 0, liveCount: 0, sentence: '' }
		];
	}

	const families = [...byFamily.entries()].sort((a, b) => a[1][0].familyOrder - b[1][0].familyOrder);

	const steps: FamilyProgressStep[] = [];
	let frozen = false;
	for (const [family, marks] of families) {
		const familyOrder = marks[0].familyOrder;
		const sentence = marks.map((m) => m.sentence).join('; ');
		const built = marks.filter((m) => m.tone !== 'none');
		const liveCount = built.filter((m) => m.tone === 'live').length;

		// The NATURAL classification for this family, on its own — computed
		// regardless of `frozen`, so a frozen family's `state` still says
		// what is honestly true of it (`not-built` if nothing ever built
		// here, the real stuck/active state otherwise), even though `tone`
		// below gets overridden to the quiet `none` the frontier freeze
		// requires.
		let tone: MarkTone;
		let state: PrState | null;
		if (built.length === 0) {
			tone = 'none';
			state = 'not-built';
		} else if (liveCount === built.length) {
			tone = 'live';
			state = null;
		} else {
			const failedMark = built.find((m) => m.tone === 'failed');
			const stuckMark = built.find((m) => m.tone === 'stuck');
			if (failedMark) {
				tone = 'failed';
				state = failedMark.state;
			} else if (stuckMark) {
				tone = 'stuck';
				state = stuckMark.state;
			} else if (liveCount > 0) {
				// Partial: some live, none stuck/failed — still green, just
				// not full (`liveCount < builtCount` is the caller's own
				// ring-vs-fill signal; no second tone invented for it).
				tone = 'live';
				state = null;
			} else {
				const activeMark =
					built.find((m) => m.tone === 'active') ?? built.find((m) => m.tone === 'queued') ?? built[0];
				tone = activeMark.tone === 'queued' ? 'queued' : 'active';
				state = activeMark.state;
			}
		}

		if (frozen) {
			// §"THE CHANGE CANNOT HAVE MOVED FURTHER" — this family's own
			// classification is moot once an upstream one is stuck/failed;
			// draw it quiet regardless of what it would have said on its own.
			steps.push({ family, familyOrder, tone: 'none', state, builtCount: built.length, liveCount, sentence });
			continue;
		}

		steps.push({ family, familyOrder, tone, state, builtCount: built.length, liveCount, sentence });
		if (tone === 'stuck' || tone === 'failed') frozen = true;
	}
	return steps;
}

/** `DEV`/`STG`/`PRD`/`TEST` → the full lowercase word the accessible label
 *  reads — `landing-grid.ts`'s own family-word vocabulary, spelled out
 *  rather than abbreviated (an abbreviation is a visual-budget concession,
 *  not something a screen reader should have to decode). */
const FAMILY_FULL_WORD: Record<string, string> = { DEV: 'dev', TEST: 'test', STG: 'staging', PRD: 'prod' };

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
 *  meter would parse faster than the simple word. */
export function familyMeterAriaLabel(steps: readonly FamilyProgressStep[]): string {
	return steps.map((s) => `${FAMILY_FULL_WORD[s.family] ?? s.family.toLowerCase()} ${STEP_ARIA_WORD[s.tone]}`).join(' · ');
}
