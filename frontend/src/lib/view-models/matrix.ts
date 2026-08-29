import type { Rollout, Environment } from '$lib/../types';
import { groupRolloutsByApp } from '$lib/version-utils';
import type { AppGroup } from '$lib/version-utils';
import { sortEnvironmentNames } from '$lib/env-order';
import { getDisplayVersion } from '$lib/utils';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { StatusKey } from '$lib/rollout-cards';
import { rankVerdicts, rankBehindBy } from './env-rank';
import type { RankVerdict } from './env-rank';

export type MatrixCellVM = {
	envName: string;
	version: string;
	statusKey: string;
	/**
	 * THE SHARED RANK, from `env-rank.ts` — the same derivation `/apps/[name]`
	 * prints. Four states, one of which (`unknown`) must render no number at
	 * all. Read this, not `behindBy`, whenever anything is DISPLAYED.
	 */
	rank: RankVerdict;
	/**
	 * `rank` collapsed to a number for sorting and counting. 0 for `newest`,
	 * `diverged` AND `unknown` alike, which is exactly why it may not be
	 * rendered: three different facts share the value.
	 */
	behindBy: number;
	// Raw bakeStatus off the cell's rollout (status.history[0].bakeStatus).
	// statusKey collapses InProgress(baking) and Deploying into the same
	// 'active' bucket; components that need to tell baking apart from
	// deploying (e.g. to color a matrix dot yellow vs blue) read this.
	bakeStatus: string | undefined;
};

export type MatrixRow = {
	appName: string;
	title: string;
	worstLag: number;
	cells: Record<string, MatrixCellVM | null>;
};

// Builds the apps×env-tier matrix consumed by the Environments page: rows
// are apps (in the same grouping `groupRolloutsByApp` uses fleet-wide),
// columns are the distinct environment tiers seen across all apps, and each
// cell reuses the shared ladder rank (`env-rank.ts`) for how-far-behind and
// the same statusKey derivation as the Rollouts list (`buildRolloutCards`) so
// both the number and the status colouring stay consistent across pages.
//
// It used to call `cellLag`, which measures the HOP to the upstream
// environment. That is a different quantity, and it is why `/apps` printed
// `−17` for a rollout `/apps/[name]` printed `−19` for, in the same chip.
export function buildMatrix(
	rollouts: Rollout[],
	environments: Environment[]
): { envTiers: string[]; rows: MatrixRow[] } {
	const groups = groupRolloutsByApp(rollouts, environments);

	// Reuse the same per-rollout statusKey logic the Rollouts list uses,
	// keyed by rollout identity so each matrix cell can look its card up
	// without recomputing the succeeded|failed|active|pending classification.
	const cards = buildRolloutCards(rollouts, environments, new Date());
	const statusByRollout = new Map<Rollout, StatusKey>();
	for (const card of cards) statusByRollout.set(card.rollout, card.statusKey);

	const tierSet = new Set<string>();
	for (const group of groups.values()) {
		for (const cell of group.cells) {
			const tier = cell.environment?.spec?.environment;
			if (tier) tierSet.add(tier);
		}
	}
	const envTiers = sortEnvironmentNames([...tierSet]);

	const rows: MatrixRow[] = [];
	for (const group of groups.values()) {
		rows.push(buildRow(group, envTiers, statusByRollout));
	}

	return { envTiers, rows };
}

function buildRow(
	group: AppGroup,
	envTiers: string[],
	statusByRollout: Map<Rollout, StatusKey>
): MatrixRow {
	let title = group.appName;
	let worstLag = 0;
	const cells: Record<string, MatrixCellVM | null> = {};
	// One ladder per app, not one per tier.
	const ranks = rankVerdicts(group);

	for (const tier of envTiers) {
		const cell = group.cells.find((c) => c.environment?.spec?.environment === tier);
		if (!cell) {
			cells[tier] = null;
			continue;
		}

		if (cell.rollout.status?.title) title = cell.rollout.status.title;

		const latestHistory = cell.rollout.status?.history?.[0];
		const versionInfo = latestHistory?.version;
		const version = versionInfo ? getDisplayVersion(versionInfo) : '';
		const statusKey = statusByRollout.get(cell.rollout) ?? 'pending';
		const rank = ranks.get(cell) ?? ({ kind: 'unknown' } as RankVerdict);
		const behindBy = rankBehindBy(rank);
		const bakeStatus = latestHistory?.bakeStatus;

		cells[tier] = { envName: cell.envName, version, statusKey, rank, behindBy, bakeStatus };
		worstLag = Math.max(worstLag, behindBy);
	}

	return { appName: group.appName, title, worstLag, cells };
}
