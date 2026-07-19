import type { AppGroup, AppCell } from '$lib/version-utils';
import { compareEnvironmentNames } from '$lib/env-order';
import { getDisplayVersion } from '$lib/utils';

// Order an app's cells into promotion order (upstream/newest environments
// first, e.g. dev, staging, prod). `Environment.spec.relationship` doesn't
// exist in the current CRD schema, so env-order rank is both the primary
// signal and the fallback for now; if an explicit `After` edge is ever added
// to the schema, wire it in here ahead of the rank comparison.
function orderedCells(group: AppGroup): AppCell[] {
	return [...group.cells].sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
}

function cellVersion(cell: AppCell): string | null {
	const versionInfo = cell.rollout?.status?.history?.[0]?.version;
	if (!versionInfo) return null;
	return getDisplayVersion(versionInfo) || null;
}

// The cell immediately upstream (one promotion step earlier) of `envName`
// within the app's promotion chain, or null if `envName` is first/unknown.
export function upstreamCell(group: AppGroup, envName: string): AppCell | null {
	const cells = orderedCells(group);
	const idx = cells.findIndex((c) => c.envName === envName);
	if (idx <= 0) return null;
	return cells[idx - 1];
}

// How many deploys behind `envName`'s cell is relative to its upstream
// neighbor. Built from the app's distinct versions collected in promotion
// order (upstream/newest cells first), so the resulting list is
// newest-first without needing per-rollout deploy history. `behindBy` is the
// index distance between the two versions in that list, floored at 0 so a
// cell that's converged or ahead of its upstream never reports negative lag.
export function cellLag(
	group: AppGroup,
	envName: string
): { behindBy: number; upstreamVersion: string | null } | null {
	const upstream = upstreamCell(group, envName);
	if (!upstream) return null;

	const cells = orderedCells(group);
	const myCell = cells.find((c) => c.envName === envName);
	const myVersion = myCell ? cellVersion(myCell) : null;
	const upstreamVersion = cellVersion(upstream);

	if (!myVersion || !upstreamVersion) return { behindBy: 0, upstreamVersion };

	// Distinct versions across the app, in promotion order (upstream/newest
	// cell's version appears first) — this is the app's version list,
	// newest-first.
	const versions: string[] = [];
	for (const c of cells) {
		const v = cellVersion(c);
		if (v && !versions.includes(v)) versions.push(v);
	}

	const myIdx = versions.indexOf(myVersion);
	const upstreamIdx = versions.indexOf(upstreamVersion);
	if (myIdx === -1 || upstreamIdx === -1) return { behindBy: 0, upstreamVersion };

	return { behindBy: Math.max(0, myIdx - upstreamIdx), upstreamVersion };
}
