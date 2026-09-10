/**
 * THE HOME CARD / `/me` PROGRESS SUMMARY — "is my PR in yet", one line, no
 * network call of its own. Design doc, Approach B, item A/B:
 *
 * > "a one-word-per-service progress summary computed from the rollouts
 * > already in memory: for merged PRs use exact `mergeCommitSha` membership
 * > against each service's history/availableReleases (no per-PR commits
 * > fetch on the list; document that squash/merge-commit repos are exact
 * > and rebase repos may under-report until the page is opened) → 'live in
 * > 2 of 3 services · held in hello-frontend-app'; for open PRs 'open 3d'."
 *
 * ── WHY THIS REUSES `buildPrPipeline` RATHER THAN INVENTING A SECOND STATE
 *    MACHINE ──────────────────────────────────────────────────────────────
 *
 * `pr-pipeline.ts`'s `containment()` already has exactly the semantics this
 * task asks for, gated by ONE flag: pass `containedIn: []` and
 * `containedInAll: false`, and `buildContainedSet` produces a set holding
 * only `mergeCommitSha` — no GitHub `commits?since=` call was ever made, so
 * there is nothing else to union in. `containedInAll: false` then tells
 * `containment()`'s own fallback branch to refuse the `release.created` vs
 * `mergedAt` guess entirely (`if (!meta.containedInAll) return
 * 'not-contained'`) — which is *exactly* "exact `mergeCommitSha` membership,
 * no fallback". Reusing the real precedence (rule 1–4) rather than a
 * second, simplified copy of it also means a service already `live`,
 * `gated`, `pinned` etc. here can never disagree with what `/pr/{owner}/
 * {repo}/{number}` says about the same PR a moment later — only the
 * CONTAINMENT INPUT differs (exact-only vs. the real `commits?since=` set),
 * never the state rules on top of it.
 *
 * ⚠️ THE REBASE-MERGE UNDER-REPORT IS THE SAME ONE `pr-pipeline.ts` NAMES.
 * A rebase-merge repo's `mergeCommitSha` is only the LAST rebased commit;
 * if a service's head is an EARLIER commit from the same rebase (still, in
 * fact, carrying this PR), the exact-match set here will not find it and
 * this line under-reports "not built yet" for a service that has, in
 * truth, already deployed it. The design doc accepts this for the LIST
 * (`/pr/{owner}/{repo}/{number}` fetches the real `commits?since=` list and
 * is authoritative) — this module does not try to close that gap.
 */
import type { Rollout, Environment, RolloutDependency } from '../../types';
import { buildPrPipeline, type PrCell, type PrService } from './pr-pipeline';
import { formatTimeAgoCompact } from '../utils';
import type { MyPull } from '../api/my-pulls';

/** A cell whose build ATTEMPTED to carry the PR but is not (yet, or no
 *  longer) the live one — every non-terminal, non-active, non-live state.
 *  `failed` is included here (not its own bucket): for a one-word summary
 *  "a build carrying this PR exists somewhere and isn't running" is the one
 *  fact worth naming; the PR page's own per-cell state is where "failed" vs
 *  "gated" vs "pinned" gets its full, separate telling. */
const HELD_LIKE: ReadonlySet<PrCell['state']> = new Set([
	'gated',
	'pinned',
	'waiting-upstream',
	'promoting',
	'rolled-back',
	'cancelled',
	'failed'
]);
const ACTIVE_LIKE: ReadonlySet<PrCell['state']> = new Set(['deploying', 'baking', 'retrying']);

type ServiceProgress = 'live' | 'held' | 'active' | 'not-built';

/** A SERVICE (not a `cluster/env` cell) is `live` if the PR is live in ANY
 *  of its environments — "is it out there yet" is a yes/no per service,
 *  the pipeline's own per-cell detail is one click away on `/pr/…`. */
function classifyService(cells: readonly PrCell[]): ServiceProgress {
	if (cells.some((c) => c.state === 'live')) return 'live';
	if (cells.some((c) => HELD_LIKE.has(c.state))) return 'held';
	if (cells.some((c) => ACTIVE_LIKE.has(c.state))) return 'active';
	return 'not-built';
}

/**
 * The `PrService[]` this PR's progress is computed from — no GitHub call,
 * `rollouts`/`environments`/`rolloutDependencies` are whatever the caller
 * already has in memory (the same streamed list every other page reads).
 */
export function servicesForMergedPull(
	pull: {
		owner: string;
		repo: string;
		number: number;
		mergedAt: string | null;
		mergeCommitSha: string | null;
	},
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date = new Date()
): PrService[] {
	if (!pull.mergeCommitSha) return [];
	const vm = buildPrPipeline(
		{
			owner: pull.owner,
			repo: pull.repo,
			number: pull.number,
			mergedAt: pull.mergedAt,
			mergeCommitSha: pull.mergeCommitSha,
			containedIn: [],
			containedInAll: false
		},
		rollouts,
		environments,
		rolloutDependencies,
		now
	);
	return vm.services;
}

/**
 * `"live in 2 of 3 services · held in hello-frontend-app"` — the design
 * doc's own example, verbatim shape. Precedence: any service live → lead
 * with the live count, name every held service after it; none live but
 * some held → name them alone; none live or held but some mid-deploy →
 * `"N of M building"`; otherwise `"not built yet"`.
 */
export function mergedPullServiceSummary(services: readonly PrService[]): string {
	const total = services.length;
	if (total === 0) return 'not built here';
	const classified = services.map((s) => ({ name: s.appName, state: classifyService(s.cells) }));
	const live = classified.filter((c) => c.state === 'live');
	const held = classified.filter((c) => c.state === 'held');
	const active = classified.filter((c) => c.state === 'active');
	if (live.length > 0) {
		const base = `live in ${live.length} of ${total} service${total === 1 ? '' : 's'}`;
		return held.length > 0 ? `${base} · held in ${held.map((h) => h.name).join(', ')}` : base;
	}
	if (held.length > 0) return `held in ${held.map((h) => h.name).join(', ')}`;
	if (active.length > 0) return `${active.length} of ${total} building`;
	return 'not built yet';
}

/** `"open 3d"` — the design doc's own example, the compact age form every
 *  other dense row already uses (`formatTimeAgoCompact`, no "ago" suffix —
 *  the leading verb already reads as a state, not a duration). */
export function openPullAgeSummary(openedAt: string | null, now: Date = new Date()): string {
	if (!openedAt) return 'open';
	return `open ${formatTimeAgoCompact(openedAt, now)}`;
}

/**
 * THE ONE ENTRY POINT — dispatches a `MyPull` row to the right summary by
 * its own `state`, so Home/`/me` never re-derive which function applies.
 * `closed` (never merged) is handled defensively even though the design
 * doc's list is meant to exclude it one level up ("open + merged, last 30
 * days") — a caller that forgets the filter gets an honest word, not a
 * crash or a silently-wrong "live" claim.
 */
export function myPullSummary(
	pull: MyPull,
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date = new Date()
): string {
	if (pull.state === 'open') return openPullAgeSummary(pull.openedAt, now);
	if (pull.state === 'closed') return 'closed without merging';
	const services = servicesForMergedPull(pull, rollouts, environments, rolloutDependencies, now);
	return mergedPullServiceSummary(services);
}
