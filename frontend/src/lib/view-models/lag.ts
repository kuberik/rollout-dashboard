import type { AppGroup, AppCell } from '$lib/version-utils';
import { compareEnvironmentNames } from '$lib/env-order';
import { getDisplayVersion } from '$lib/utils';
import { newerReleaseCount } from './promotion';

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
// neighbor.
//
// Oracle: each cell's own `newerReleaseCount` (view-models/promotion.ts) —
// the controller-computed distance from that rollout's current version to
// the head of ITS OWN release list (releaseCandidates, or an
// availableReleases index fallback). The hop gap between two adjacent
// cells in the promotion chain is the difference of their distances to
// their own heads: `myDistance - upstreamDistance`, floored at 0. This can
// express any lag width (e.g. 24 releases / 32 days), unlike the old
// approach below which could only ever report 0 or 1 because it indexed
// into a list built solely from cells' *current* versions (max index
// distance = #distinct current versions − 1).
//
// Fallback: when either side's `newerReleaseCount` is unknowable (`null` —
// e.g. neither cell's rollout carries releaseCandidates/availableReleases
// data), fall back to the original distinct-current-version index
// computation so existing behavior doesn't regress for payloads without
// release-candidate data.
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

	const myCount = myCell ? newerReleaseCount(myCell.rollout) : null;
	const upstreamCount = newerReleaseCount(upstream.rollout);
	if (myCount !== null && upstreamCount !== null) {
		return { behindBy: Math.max(0, myCount - upstreamCount), upstreamVersion };
	}

	// Fallback: distinct versions across the app, in promotion order
	// (upstream/newest cell's version appears first) — this is the app's
	// version list, newest-first. behindBy is the index distance between
	// the two versions in that list, floored at 0 so a cell that's
	// converged or ahead of its upstream never reports negative lag. This
	// path can only ever express 0..(#distinct versions − 1), which is why
	// it's a fallback rather than the primary path.
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
