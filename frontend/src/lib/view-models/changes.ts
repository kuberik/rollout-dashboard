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
import { buildPrPipeline, type PrCell, type PrPipelineMeta, type PrPipelineVM, type PrState } from './pr-pipeline';
import { buildLandingGrid, type LandingGridVM } from './landing-grid';
import { buildRevisionLedger } from './revision-ledger';
import { changePath } from '../pr-ref';
import { changeBuildPath, envFamilyWord } from '../version-utils';
import type { Change } from '../api/changes';

// ── THE SHORT VERDICT WORD, §2b ───────────────────────────────────────────

export type ChangeVerdictTone = 'live' | 'held' | 'failed' | 'active' | 'not-built';

/** Worst-first, same precedence `landing-grid.ts`'s own `STATE_RANK` uses —
 *  restated here (not imported) because this module needs the WINNING
 *  CELL's own state/env, not just the closed word it folds to. */
const STATE_RANK: Record<PrState, number> = {
	failed: 0,
	gated: 1,
	pinned: 1,
	'waiting-upstream': 1,
	deploying: 2,
	baking: 2,
	retrying: 2,
	cancelled: 3,
	'rolled-back': 4,
	promoting: 5,
	'not-built': 6,
	live: 7
};

function worstCellOverall(vm: PrPipelineVM): PrCell | null {
	const all = vm.services.flatMap((s) => s.cells);
	if (all.length === 0) return null;
	return all.reduce((acc, c) => (STATE_RANK[c.state] < STATE_RANK[acc.state] ? c : acc));
}

function toneOf(state: PrState): ChangeVerdictTone {
	switch (state) {
		case 'failed':
			return 'failed';
		case 'gated':
		case 'pinned':
		case 'waiting-upstream':
			return 'held';
		case 'not-built':
			return 'not-built';
		case 'live':
			return 'live';
		default:
			return 'active';
	}
}

const ACTIVE_WORD: Record<PrState, string> = {
	deploying: 'deploying',
	baking: 'baking',
	retrying: 'retrying',
	cancelled: 'cancelled',
	'rolled-back': 'rolled back',
	promoting: 'promoting',
	// unreachable for the `active` tone — listed so the map is total.
	failed: 'failed',
	gated: 'held',
	pinned: 'held',
	'waiting-upstream': 'held',
	'not-built': 'not built',
	live: 'live'
};

/**
 * `PrPipelineVM.verdict` folded to ≤3 words — §2b's own examples: mint
 * `live everywhere`, orange `held in prod`, red `failed in staging`, gray
 * `not built yet`, blue `deploying`. A change with no service on this
 * cluster at all (no repo match) reads `not built here`, the same phrase
 * `mergedPullServiceSummary` (`my-pulls.ts`) already uses for that case.
 */
export function changeVerdict(vm: PrPipelineVM): { word: string; tone: ChangeVerdictTone } {
	if (vm.services.length === 0) return { word: 'not built here', tone: 'not-built' };
	const worst = worstCellOverall(vm);
	if (!worst) return { word: 'not built here', tone: 'not-built' };
	const tone = toneOf(worst.state);
	switch (tone) {
		case 'live':
			return { word: 'live everywhere', tone };
		case 'not-built':
			return { word: 'not built yet', tone };
		case 'held':
			return { word: `held in ${envFamilyWord(worst.envName).toLowerCase()}`, tone };
		case 'failed':
			return { word: `failed in ${envFamilyWord(worst.envName).toLowerCase()}`, tone };
		case 'active':
			return { word: ACTIVE_WORD[worst.state], tone };
	}
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
};

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
		containedInAll: change.containedInAll
	};
	const vm = buildPrPipeline(meta, rollouts, environments, rolloutDependencies, now);
	const verdict = changeVerdict(vm);
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
		grid: buildLandingGrid(vm, now),
		notEverywhere: computeNotEverywhere(vm)
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

export type ChangesFilter = {
	mine?: boolean;
	/** Repo keys (`owner/repo`, lower-cased). Multi-select, OR'd. Empty/undefined = no repo filter. */
	repos?: readonly string[];
	pendingOnly?: boolean;
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
		if (q && !matchesChangeText(r, q)) return false;
		return true;
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
