// Shared per-rollout card derivation used by both the Rollouts inventory
// list (RolloutGrid.svelte) and the Control Center overview (ControlCenter.svelte),
// so stuck/behind/failure classification logic lives in exactly one place.

import type { Rollout, Environment } from '../types';
import { getRolloutEnvironmentTheme, shortEnvLabel } from './environment-theme';
import { getDisplayVersion, categorizeFailure, compareRollouts, detectStuck } from './utils';
import type { StuckReason } from './utils';
import { compareEnvironmentNames } from './env-order';
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
