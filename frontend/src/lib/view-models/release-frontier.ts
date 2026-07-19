import type { Rollout, Environment } from '$lib/../types';
import { groupRolloutsByApp } from '$lib/version-utils';
import type { AppGroup, AppCell } from '$lib/version-utils';
import { sortEnvironmentNames, compareEnvironmentNames } from '$lib/env-order';
import { getDisplayVersion } from '$lib/utils';

export type FrontierStop = {
	envName: string;
	state: 'live' | 'ahead' | 'behind' | 'absent';
	version: string | null;
};

export type FrontierApp = {
	appName: string;
	title: string;
	stops: FrontierStop[];
	reached: number;
	total: number;
};

function cellVersion(cell: AppCell): string | null {
	const versionInfo = cell.rollout?.status?.history?.[0]?.version;
	if (!versionInfo) return null;
	return getDisplayVersion(versionInfo) || null;
}

// The app's distinct versions in newest-first order, derived the same way
// `cellLag` (Task 3) does: walk the cells in promotion order (upstream/newest
// environments first, via env-order rank) and collect each cell's current
// version, deduped. This keeps ordering consistent with the rest of the
// dashboard without needing per-rollout deploy history.
function newestFirstVersions(group: AppGroup): string[] {
	const cells = [...group.cells].sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	const versions: string[] = [];
	for (const cell of cells) {
		const v = cellVersion(cell);
		if (v && !versions.includes(v)) versions.push(v);
	}
	return versions;
}

function classify(cellVer: string | null, target: string, versions: string[]): FrontierStop['state'] {
	if (cellVer === null) return 'absent';
	if (cellVer === target) return 'live';
	const cellIdx = versions.indexOf(cellVer);
	const targetIdx = versions.indexOf(target);
	// If either version is missing from the derived list (shouldn't happen
	// for cellVer, which always comes from a cell in this same list; target
	// might be absent from this app's version history entirely), fall back
	// to treating an unresolvable comparison as behind rather than crashing.
	if (cellIdx === -1 || targetIdx === -1) return 'behind';
	return cellIdx < targetIdx ? 'ahead' : 'behind';
}

// Builds the release-frontier view for a single (repoKey, version) pair,
// consumed by the Version detail page: for every app in that repo, how far
// has `version` reached across its env chain? Each stop is classified
// relative to the app's own newest-first version list (derived from its
// cells' current versions in promotion order), so "ahead"/"behind" reflect
// actual release order rather than raw string comparison.
export function buildReleaseFrontier(
	repoKey: string,
	version: string,
	rollouts: Rollout[],
	environments: Environment[]
): { apps: FrontierApp[] } {
	const groups = groupRolloutsByApp(rollouts, environments);

	// Every cell in a group already carries its own repoKey (computed once in
	// groupRolloutsByApp via repoKeyFor); an app's cells all share the same
	// appName-derived fallback and generally the same source repo, so the
	// first cell's repoKey is representative of the whole app.
	const matchedGroups = [...groups.values()].filter((g) => g.cells[0]?.repoKey === repoKey);

	// The frontier's env stops are the union of env names across every
	// matched app (mirrors buildMatrix's envTiers), not just one app's own
	// cells — otherwise an app that's absent from an env would simply have
	// no stop for it instead of an explicit 'absent' state.
	const envNameSet = new Set<string>();
	for (const group of matchedGroups) {
		for (const cell of group.cells) envNameSet.add(cell.envName);
	}
	const envNames = sortEnvironmentNames([...envNameSet]);

	const apps: FrontierApp[] = matchedGroups.map((group) => {
		let title = group.appName;
		const versions = newestFirstVersions(group);

		const stops: FrontierStop[] = envNames.map((envName) => {
			const cell = group.cells.find((c) => c.envName === envName);
			if (!cell) return { envName, state: 'absent', version: null };
			if (cell.rollout.status?.title) title = cell.rollout.status.title;
			const cellVer = cellVersion(cell);
			const state = classify(cellVer, version, versions);
			return { envName, state, version: cellVer };
		});

		const reached = stops.filter((s) => s.state === 'live').length;
		const total = stops.filter((s) => s.state !== 'absent').length;

		return { appName: group.appName, title, stops, reached, total };
	});

	return { apps };
}
