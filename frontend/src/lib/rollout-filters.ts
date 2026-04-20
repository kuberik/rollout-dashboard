import type { Rollout } from '../types';
import { getRolloutStatus } from '$lib/utils';

// ---- Types ----

export type BakeStatusFilter = 'Succeeded' | 'Failed' | 'InProgress' | 'Deploying' | 'Cancelled' | 'None';
export type ReadinessFilter = 'Ready' | 'Error' | 'Unknown';
export type SortField = 'name' | 'lastDeployed' | 'upgradeCount';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'list' | 'grid';

export interface FilterState {
	searchQuery: string;
	namespaces: string[];
	bakeStatuses: BakeStatusFilter[];
	readiness: ReadinessFilter[];
	hasUpgradesOnly: boolean;
}

export interface SortState {
	field: SortField;
	direction: SortDirection;
	groupByNamespace: boolean;
}

export interface RolloutStats {
	total: number;
	healthy: number;
	failing: number;
	upgrades: number;
}

// ---- Defaults ----

export const DEFAULT_FILTER: FilterState = {
	searchQuery: '',
	namespaces: [],
	bakeStatuses: [],
	readiness: [],
	hasUpgradesOnly: false
};

export const DEFAULT_SORT: SortState = {
	field: 'lastDeployed',
	direction: 'desc',
	groupByNamespace: true
};

// ---- Helpers ----

export function getBakeStatus(r: Rollout): string {
	return r.status?.history?.[0]?.bakeStatus || 'None';
}

export function getReadiness(r: Rollout): ReadinessFilter {
	const s = getRolloutStatus(r);
	return s.text as ReadinessFilter;
}

export function getUpgradeCount(r: Rollout): number {
	return r.status?.releaseCandidates?.length || 0;
}

export function getLastDeployedTime(r: Rollout): number {
	const ts = r.status?.history?.[0]?.timestamp;
	return ts ? new Date(ts).getTime() : 0;
}

// ---- Statistics ----

export function computeStats(rollouts: Rollout[]): RolloutStats {
	let healthy = 0,
		failing = 0,
		upgrades = 0;
	for (const r of rollouts) {
		const readiness = getReadiness(r);
		if (readiness === 'Ready') healthy++;
		if (readiness === 'Error' || getBakeStatus(r) === 'Failed') failing++;
		if (getUpgradeCount(r) > 0) upgrades++;
	}
	return { total: rollouts.length, healthy, failing, upgrades };
}

// ---- Filtering ----

export function filterRollouts(rollouts: Rollout[], filters: FilterState): Rollout[] {
	return rollouts.filter((r) => {
		if (filters.searchQuery) {
			const q = filters.searchQuery.toLowerCase();
			const name = (r.metadata?.name || '').toLowerCase();
			const title = (r.status?.title || '').toLowerCase();
			const desc = (r.status?.description || '').toLowerCase();
			if (!name.includes(q) && !title.includes(q) && !desc.includes(q)) return false;
		}

		if (filters.namespaces.length > 0) {
			const ns = r.metadata?.namespace || 'default';
			if (!filters.namespaces.includes(ns)) return false;
		}

		if (filters.bakeStatuses.length > 0) {
			const bs = getBakeStatus(r);
			if (!filters.bakeStatuses.includes(bs as BakeStatusFilter)) return false;
		}

		if (filters.readiness.length > 0) {
			const rd = getReadiness(r);
			if (!filters.readiness.includes(rd)) return false;
		}

		if (filters.hasUpgradesOnly) {
			if (getUpgradeCount(r) === 0) return false;
		}

		return true;
	});
}

// ---- Sorting ----

export function sortRollouts(rollouts: Rollout[], sort: SortState): Rollout[] {
	const sorted = [...rollouts];
	const dir = sort.direction === 'asc' ? 1 : -1;

	sorted.sort((a, b) => {
		switch (sort.field) {
			case 'name':
				return dir * (a.metadata?.name || '').localeCompare(b.metadata?.name || '');
			case 'lastDeployed':
				return dir * (getLastDeployedTime(a) - getLastDeployedTime(b));
			case 'upgradeCount':
				return dir * (getUpgradeCount(a) - getUpgradeCount(b));
			default:
				return 0;
		}
	});

	return sorted;
}

// ---- Grouping ----

export function groupByNamespace(rollouts: Rollout[]): Record<string, Rollout[]> {
	const grouped: Record<string, Rollout[]> = {};
	for (const r of rollouts) {
		const ns = r.metadata?.namespace || 'default';
		if (!grouped[ns]) grouped[ns] = [];
		grouped[ns].push(r);
	}
	return Object.keys(grouped)
		.sort()
		.reduce(
			(acc, key) => {
				acc[key] = grouped[key];
				return acc;
			},
			{} as Record<string, Rollout[]>
		);
}

// ---- Extract unique values for filter options ----

export function getUniqueNamespaces(rollouts: Rollout[]): string[] {
	const ns = new Set(rollouts.map((r) => r.metadata?.namespace || 'default'));
	return Array.from(ns).sort();
}

// ---- LocalStorage persistence ----

const STORAGE_KEY = 'rollout-list-preferences';

export interface StoredPreferences {
	sort: SortState;
	filters: FilterState;
	viewMode: ViewMode;
}

export function loadPreferences(): Partial<StoredPreferences> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {
		/* ignore */
	}
	return {};
}

export function savePreferences(prefs: StoredPreferences): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* ignore */
	}
}
