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
	type PrState,
	type ChangeVerdictTone
} from './pr-pipeline';
import { buildLandingGrid, type LandingGridVM } from './landing-grid';
import { buildRevisionLedger } from './revision-ledger';
import { changePath } from '../pr-ref';
import { changeBuildPath } from '../version-utils';
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
 * `failed in staging`, gray `not built yet`, blue `deploying in dev`. A
 * change with no service on this cluster at all (no repo match) reads
 * `not built here`, the same phrase `mergedPullServiceSummary`
 * (`my-pulls.ts`) already uses for that case — the ONE thing this wrapper
 * still decides, because it is a fact about THIS INDEX's own repo match,
 * not something `buildChangeVerdict` (which only ever sees the services it
 * is handed) can tell apart from "some service matched, none built it" —
 * `vm.verdictWord`/`vm.verdictTone` (set by `buildPrPipeline`, which already
 * ran this exact function once) would read identically either way, so this
 * thin wrapper takes `vm.services` itself rather than trusting the VM's own
 * cached word to have made the same call this index wants.
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

export function summarizeChangeRows(rows: readonly ChangeRowVM[]): ChangesSummary {
	return {
		count: rows.length,
		notEverywhereCount: rows.filter((r) => r.notEverywhere).length,
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
