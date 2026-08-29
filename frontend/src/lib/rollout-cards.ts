// Shared per-rollout card derivation used by both the Rollouts inventory
// list (RolloutGrid.svelte) and the Control Center overview (ControlCenter.svelte),
// so stuck/behind/failure classification logic lives in exactly one place.

import type { Rollout, Environment } from '../types';
import { getRolloutEnvironmentTheme, shortEnvLabel } from './environment-theme';
import { getDisplayVersion, categorizeFailure, compareRollouts, detectStuck } from './utils';
import type { StuckReason } from './utils';
import { compareEnvironmentNames } from './env-order';
import { newerReleaseCount } from './view-models/promotion';
import {
	sourceDashboardURL,
	sourceClusterName,
	rolloutMatchesEnvironment
} from './source-dashboard';

export type StatusKey = 'succeeded' | 'failed' | 'active' | 'pending';

export type RolloutCard = {
	ns: string;
	name: string;
	title: string;
	envKey: string;
	envDisplay: string;
	envName: string; // raw env name (e.g. 'staging') for behind-by lookups
	theme: ReturnType<typeof getRolloutEnvironmentTheme>;
	version: string | null;
	timestamp: string | null;
	bakeStatus: string;
	statusKey: StatusKey;
	isRunning: boolean;
	bakeStatusMessage: string | null;
	failureCategory: string | null;
	previousSucceededVersion: string | null;
	pinnedVersion: string | null;
	stuck: StuckReason | null;
	behind: { fromEnv: string; version: string; behindBy: number | null } | null;
	rollout: Rollout;
	sourceURL: string; // dashboard URL this rollout belongs to (empty = local)
	sourceCluster: string; // cluster NAME this rollout belongs to (for name-based routing)
};

// Build a per-app map: appName → Array<{envName, rollout}> sorted by env tier.
// Used to compute "N versions behind" diagnostics on each card.
function buildAppIndex(
	rollouts: Rollout[],
	environments: Environment[]
): Map<string, { envName: string; rollout: Rollout }[]> {
	const map = new Map<string, { envName: string; rollout: Rollout }[]>();
	for (const env of environments) {
		const appName = env.spec?.rolloutRef?.name;
		const envName = env.spec?.environment;
		if (!appName || !envName) continue;
		const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
		if (!r) continue;
		if (!map.has(appName)) map.set(appName, []);
		map.get(appName)!.push({ envName, rollout: r });
	}
	for (const list of map.values()) {
		list.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	}
	return map;
}

// Find the most relevant peer env for this rollout — the one where my current
// version exists as a past deploy. That env has progressed past me, so we say
// I'm "behind <env>" — direction derived from data, not from env-name tier
// assumptions.
//
// HOW FAR behind comes from `newerReleaseCount` (view-models/promotion), NOT
// from `compareRollouts`. `compareRollouts` can only answer 'behind' when my
// current version still appears in the peer's `status.history`, and
// `versionHistoryLimit` is 5 — so the further behind a rollout falls, the more
// certain it is to age out of its peers' history, return 'divergent', and
// yield `null` here. Callers that do `(behind?.behindBy ?? 0) === 0` then
// classify a month-stale production rollout as *steady* and label it `newest`.
// The alarm went silent exactly when it mattered.
//
// `newerReleaseCount` is the controller's own count of releases newer than
// mine, carries a validity guard for the retention-truncation case, and needs
// no history overlap at all. `compareRollouts` is kept for peer ATTRIBUTION
// ("behind which env"), which is the question it is actually good at.
function computeBehind(
	r: Rollout,
	envName: string,
	appIndex: Map<string, { envName: string; rollout: Rollout }[]>
): { fromEnv: string; version: string; behindBy: number | null } | null {
	if (r.spec?.wantedVersion) return null;
	const peers = appIndex.get(r.metadata?.name ?? '');
	if (!peers || peers.length < 2) return null;
	let best: { fromEnv: string; version: string; behindBy: number | null } | null = null;
	for (const peer of peers) {
		if (peer.envName === envName) continue;
		const rel = compareRollouts(r, peer.rollout);
		if (!rel || rel.kind !== 'behind') continue;
		const candidate = { fromEnv: peer.envName, version: rel.otherVersion, behindBy: rel.by };
		if (!best || (candidate.behindBy ?? 0) > (best.behindBy ?? 0)) best = candidate;
	}

	const myNewer = newerReleaseCount(r);
	// `null` = lag is unknowable (current version aged out of its own
	// availableReleases). Say nothing rather than something false, and leave
	// whatever compareRollouts managed to work out.
	if (myNewer === null || myNewer === 0) return best;

	// compareRollouts named a peer — keep its attribution, take the accurate count.
	if (best) return { ...best, behindBy: myNewer };

	// compareRollouts went silent (history overlap lost). Attribute to the
	// most-advanced peer: the one with the fewest releases still newer than it.
	let ahead: { envName: string; version: string; newer: number } | null = null;
	for (const peer of peers) {
		if (peer.envName === envName) continue;
		const peerNewer = newerReleaseCount(peer.rollout);
		if (peerNewer === null || peerNewer >= myNewer) continue; // not ahead of me
		const peerV = peer.rollout.status?.history?.[0]?.version
			? getDisplayVersion(peer.rollout.status.history[0].version)
			: null;
		if (!peerV) continue;
		if (!ahead || peerNewer < ahead.newer) {
			ahead = { envName: peer.envName, version: peerV, newer: peerNewer };
		}
	}
	if (ahead) return { fromEnv: ahead.envName, version: ahead.version, behindBy: myNewer };
	return best;
}

export function buildRolloutCards(
	rollouts: Rollout[],
	environments: Environment[],
	now: Date
): RolloutCard[] {
	const appIndex = buildAppIndex(rollouts, environments);
	return rollouts.map((r) => {
		const latest = r.status?.history?.[0];
		const env = environments.find((e) => rolloutMatchesEnvironment(r, e));
		const theme = getRolloutEnvironmentTheme(r, env);
		const bakeStatus = latest?.bakeStatus || 'None';
		const isRunning = bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
		let statusKey: StatusKey;
		if (bakeStatus === 'Failed') statusKey = 'failed';
		else if (isRunning) statusKey = 'active';
		else if (!latest) statusKey = 'pending';
		else statusKey = 'succeeded';
		const envDisplay = shortEnvLabel(theme);
		const envName = env?.spec?.environment ?? '';
		const behind = envName ? computeBehind(r, envName, appIndex) : null;
		// For failed cards: find the most recent succeeded version that's different
		// from the current one. Gives the user a rollback target at a glance.
		let previousSucceededVersion: string | null = null;
		if (bakeStatus === 'Failed') {
			const currentV = latest?.version ? getDisplayVersion(latest.version) : null;
			for (const h of r.status?.history ?? []) {
				if (h.bakeStatus !== 'Succeeded') continue;
				const v = getDisplayVersion(h.version);
				if (v && v !== currentV) {
					previousSucceededVersion = v;
					break;
				}
			}
		}
		return {
			ns: r.metadata?.namespace || '',
			name: r.metadata?.name || '',
			title: r.status?.title || r.metadata?.name || '',
			envKey: theme?.name || '',
			envDisplay,
			envName,
			theme,
			version: latest?.version ? getDisplayVersion(latest.version) : null,
			timestamp: latest?.timestamp || null,
			bakeStatus,
			statusKey,
			isRunning,
			bakeStatusMessage: latest?.bakeStatusMessage || null,
			failureCategory:
				bakeStatus === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null,
			previousSucceededVersion,
			pinnedVersion: r.spec?.wantedVersion || null,
			stuck: detectStuck(r, { now }),
			behind,
			rollout: r,
			sourceURL: sourceDashboardURL(r),
			sourceCluster: sourceClusterName(r)
		};
	});
}
