<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, Environment } from '../types';
	import { Alert, Badge, Popover } from 'flowbite-svelte';
	import {
		SearchOutline,
		ArrowUpOutline,
		HeartSolid,
		CloseOutline,
		CheckCircleSolid,
		ClockSolid,
		FilterOutline,
		FilterSolid,
		ChevronDownOutline,
		ChevronUpOutline,
		ChevronRightOutline,
		QuestionCircleOutline,
		PauseSolid,
	} from 'flowbite-svelte-icons';
	import { slide } from 'svelte/transition';
	import { getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 30000 } })
	);

	const rollouts = $derived<Rollout[]>(rolloutsQuery.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(rolloutsQuery.data?.environments?.items || []);
	const envByRollout = $derived.by(() => {
		const m = new Map<string, Environment>();
		for (const env of environments) {
			const ns = env.metadata?.namespace || '';
			const refName = env.spec?.rolloutRef?.name;
			if (ns && refName) m.set(`${ns}/${refName}`, env);
		}
		return m;
	});
	const loading  = $derived(rolloutsQuery.isLoading);
	const error    = $derived(
		rolloutsQuery.isError ? (rolloutsQuery.error as Error).message || 'Unknown error' : null
	);

	function envForRollout(r: Rollout): Environment | undefined {
		const ns = r.metadata?.namespace || '';
		const name = r.metadata?.name || '';
		return envByRollout.get(`${ns}/${name}`);
	}

	type GroupBy = 'namespace' | 'name' | 'environment';
	const GROUP_BY_STORAGE_KEY = 'rollouts:groupBy';

	function loadGroupBy(): GroupBy {
		if (typeof window === 'undefined') return 'namespace';
		const v = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
		return v === 'name' || v === 'environment' || v === 'namespace' ? v : 'namespace';
	}

	let searchQuery   = $state('');
	let statusFilters = $state<StatusKey[]>([]);
	let envFilters    = $state<string[]>([]);
	let nsFilters     = $state<string[]>([]);
	let groupBy       = $state<GroupBy>(loadGroupBy());
	let showFilters   = $state(false);

	$effect(() => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(GROUP_BY_STORAGE_KEY, groupBy);
		}
	});

	const activeFilterCount = $derived(statusFilters.length + envFilters.length + nsFilters.length);
	const uniqueNamespaces = $derived(
		[...new Set(rollouts.map((r) => r.metadata?.namespace || 'default'))].sort()
	);

	function nsCount(ns: string): number {
		return rollouts.filter((r) => (r.metadata?.namespace || 'default') === ns).length;
	}

	function getBakeStatus(r: Rollout): string {
		return r.status?.history?.[0]?.bakeStatus || 'None';
	}

	function compactTime(timestamp: string | undefined, n: Date): string | null {
		if (!timestamp) return null;
		const s = Math.floor((n.getTime() - new Date(timestamp).getTime()) / 1000);
		if (s < 60)    return `${s}s`;
		if (s < 3600)  return `${Math.floor(s / 60)}m`;
		if (s < 86400) return `${Math.floor(s / 3600)}h`;
		return `${Math.floor(s / 86400)}d`;
	}

	function parseDuration(duration: string): number {
		const m = duration.match(/^(\d+)([smhd])$/);
		if (!m) return 0;
		const v = parseInt(m[1]);
		switch (m[2]) {
			case 's': return v * 1000;
			case 'm': return v * 60000;
			case 'h': return v * 3600000;
			case 'd': return v * 86400000;
			default:  return 0;
		}
	}

	const uniqueEnvironments = $derived.by(() => {
		const seen = new Map<string, string>();
		rollouts.forEach((r) => {
			const t = getRolloutEnvironmentTheme(r, envForRollout(r));
			if (t?.environmentName) seen.set(t.environmentName.toLowerCase(), t.environmentName);
		});
		return [...seen.values()].sort();
	});

	const STATUS_SORT: Record<string, number> = {
		Failed: 0, InProgress: 1, Deploying: 2, None: 3, Cancelled: 4, Succeeded: 5
	};

	type HistoryDot = { status: string; ts: string; version: string };

	type Row = {
		ns: string;
		name: string;
		status: string;
		version: string | null;
		age: string | null;
		upgradeCount: number;
		failedHCCount: number;
		bakeProgressPct: number | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme>;
		waitingCandidateVersion: string | null; // oldest non-deployed, non-gated candidate
		waitingSeconds: number;                 // how long the oldest waiting candidate has been waiting
		stuckThresholdSec: number;              // when waitingSeconds exceeds this, considered "stuck"
		isStuck: boolean;                       // waiting > historical norm
		gatesBlocking: number;                  // number of failing gates
		history: HistoryDot[];                  // recent deploy outcomes (oldest first)
		displayHistory: HistoryDot[];           // history clipped to group context (set by groupedRows)
		latestTs: number;                       // for sorting by recency
		pinnedVersion: string | null;           // spec.wantedVersion when set — automated deploys paused
		// Behind-lead info (set by behindInfoMap derivation; null if no siblings or this row IS the lead)
		behindCount: number;                    // versions in lead.history not yet deployed here
		behindOldestLagSec: number;             // oldest unpromoted version's current lag vs lead
		behindThresholdSec: number;             // mean+stdev of historical promotion lags
		isBehindSlow: boolean;                  // oldest unpromoted version's lag exceeds threshold
		leadKey: string | null;                 // lead env label (preferred) or namespace
	};

	function buildRow(r: Rollout, n: Date): Row {
		const latest = r.status?.history?.[0];
		const status = getBakeStatus(r);
		let bakeProgressPct: number | null = null;
		if (status === 'InProgress' && latest?.bakeStartTime && r.spec?.bakeTime) {
			const elapsed = n.getTime() - new Date(latest.bakeStartTime).getTime();
			const total = parseDuration(r.spec.bakeTime);
			if (total > 0) bakeProgressPct = Math.min(100, Math.max(0, (elapsed / total) * 100));
		}

		// Find oldest waiting release candidate (not deployed, not in gated set)
		const rcs = r.status?.releaseCandidates ?? [];
		const gated = new Set((r.status?.gatedReleaseCandidates ?? []).map((g) => g.tag ?? g.version ?? ''));
		const deployedVersion = latest?.version?.version ?? latest?.version?.tag ?? '';
		let waitingCandidateVersion: string | null = null;
		let waitingSeconds = 0;
		for (const rc of rcs) {
			const id = rc.tag ?? rc.version ?? '';
			if (!id || id === deployedVersion) continue;
			if (gated.size > 0 && gated.has(id)) continue;
			if (rc.created) {
				const secs = Math.floor((n.getTime() - new Date(rc.created).getTime()) / 1000);
				if (secs > waitingSeconds) {
					waitingSeconds = secs;
					waitingCandidateVersion = id;
				}
			} else if (!waitingCandidateVersion) {
				waitingCandidateVersion = id;
			}
		}

		// Compute historical wait-time stats: how long versions usually sat before deploy.
		const histWaits: number[] = [];
		for (const h of r.status?.history ?? []) {
			if (h.version?.created && h.timestamp) {
				const wait = (new Date(h.timestamp).getTime() - new Date(h.version.created).getTime()) / 1000;
				if (wait > 0) histWaits.push(wait);
			}
		}
		// Threshold = mean + 1 stdev of historical waits, with sensible fallbacks.
		// Floor of 30 min so a flaky single-sample doesn't trigger 'stuck' instantly.
		let stuckThresholdSec = 7 * 86400; // default: 7 days when no usable history
		if (histWaits.length >= 3) {
			const mean = histWaits.reduce((a, b) => a + b, 0) / histWaits.length;
			const variance = histWaits.reduce((s, x) => s + (x - mean) ** 2, 0) / histWaits.length;
			const stdev = Math.sqrt(variance);
			stuckThresholdSec = Math.max(mean + stdev, 30 * 60);
		} else if (histWaits.length > 0) {
			// Small sample: 2x the max historical wait, with 30-min floor
			stuckThresholdSec = Math.max(Math.max(...histWaits) * 2, 30 * 60);
		}
		const isStuck = waitingCandidateVersion !== null && waitingSeconds > stuckThresholdSec;

		const gatesBlocking = (r.status?.gates ?? []).filter((g) => g.passing === false).length;

		const history: HistoryDot[] = (r.status?.history ?? [])
			.slice(0, 12)
			.map((h) => ({
				status: h.bakeStatus ?? 'None',
				ts: h.timestamp,
				version: h.version?.version ?? h.version?.tag ?? '',
			}))
			.reverse(); // oldest left, newest right

		return {
			ns:                      r.metadata?.namespace || 'default',
			name:                    r.metadata?.name || '',
			status,
			version:                 latest?.version ? getDisplayVersion(latest.version) : null,
			age:                     compactTime(latest?.timestamp, n),
			upgradeCount:            rcs.length,
			failedHCCount:           latest?.failedHealthChecks?.length || 0,
			bakeProgressPct,
			theme:                   getRolloutEnvironmentTheme(r, envForRollout(r)),
			waitingCandidateVersion,
			waitingSeconds,
			stuckThresholdSec,
			isStuck,
			gatesBlocking,
			history,
			displayHistory:          history, // overwritten in groupedRows once we know group context
			latestTs:                latest?.timestamp ? new Date(latest.timestamp).getTime() : 0,
			pinnedVersion:           r.spec?.wantedVersion || null,
			behindCount:             0,
			behindOldestLagSec:      0,
			behindThresholdSec:      0,
			isBehindSlow:            false,
			leadKey:                 null,
		};
	}

	function matchesStatusFilter(row: Row): boolean {
		if (statusFilters.length === 0) return true;
		return statusFilters.some((k) => {
			if (k === 'failed')    return row.status === 'Failed';
			if (k === 'active')    return row.status === 'InProgress' || row.status === 'Deploying';
			if (k === 'stuck')     return row.isStuck;
			if (k === 'succeeded') return row.status === 'Succeeded';
			if (k === 'idle')      return row.status === 'None';
			return false;
		});
	}

	const allRows = $derived.by(() => {
		const n = $now;
		const nowMs = n.getTime();
		const rows = rollouts.map((r) => buildRow(r, n));

		// Second pass: compute "behind lead" info per row, using same-named siblings as the comparison set.
		// Threshold = mean + 1 stdev of HISTORICAL promotion lags (versions present in both this row and the lead),
		// matching the same shape as the stuck heuristic so behaviour is comparable.
		const byName = new Map<string, Row[]>();
		for (const row of rows) {
			const list = byName.get(row.name);
			if (list) list.push(row); else byName.set(row.name, [row]);
		}
		for (const row of rows) {
			const siblings = byName.get(row.name) || [];
			if (siblings.length <= 1) continue;
			// Lead = sibling with newest latest deploy
			let lead = row;
			for (const s of siblings) if (s.latestTs > lead.latestTs) lead = s;
			if (lead === row || lead.history.length === 0) continue;

			const myVersions = new Set(row.history.map((h) => h.version));
			const leadByVersion = new Map<string, number>();
			for (const h of lead.history) leadByVersion.set(h.version, new Date(h.ts).getTime());

			// Historical promotion lags: versions that this row eventually deployed AFTER the lead did.
			const histLags: number[] = [];
			for (const h of row.history) {
				const leadTs = leadByVersion.get(h.version);
				if (leadTs === undefined) continue;
				const myTs = new Date(h.ts).getTime();
				if (myTs > leadTs) histLags.push((myTs - leadTs) / 1000);
			}
			let threshold = 7 * 86400;
			if (histLags.length >= 3) {
				const mean = histLags.reduce((a, b) => a + b, 0) / histLags.length;
				const stdev = Math.sqrt(histLags.reduce((s, x) => s + (x - mean) ** 2, 0) / histLags.length);
				threshold = Math.max(mean + stdev, 30 * 60);
			} else if (histLags.length > 0) {
				threshold = Math.max(Math.max(...histLags) * 2, 30 * 60);
			}

			// Unpromoted: versions in lead.history this row hasn't deployed yet.
			let behindCount = 0;
			let oldestLag = 0;
			for (const h of lead.history) {
				if (myVersions.has(h.version)) continue;
				behindCount++;
				const lag = Math.max(0, (nowMs - new Date(h.ts).getTime()) / 1000);
				if (lag > oldestLag) oldestLag = lag;
			}

			row.behindCount = behindCount;
			row.behindOldestLagSec = oldestLag;
			row.behindThresholdSec = threshold;
			row.isBehindSlow = behindCount > 0 && oldestLag > threshold;
			row.leadKey = lead.theme?.environmentName ?? lead.ns;
		}
		return rows;
	});

	const filteredRollouts = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return allRows.filter((row) => {
			if (q && !row.name.toLowerCase().includes(q) && !row.ns.toLowerCase().includes(q)) return false;
			if (nsFilters.length > 0  && !nsFilters.includes(row.ns)) return false;
			if (envFilters.length > 0 && !envFilters.includes(row.theme?.environmentName ?? '')) return false;
			if (!matchesStatusFilter(row)) return false;
			return true;
		});
	});

	function compactSeconds(s: number): string {
		if (s < 60)    return `${s}s`;
		if (s < 3600)  return `${Math.floor(s / 60)}m`;
		if (s < 86400) return `${Math.floor(s / 3600)}h`;
		return `${Math.floor(s / 86400)}d`;
	}

	type Group = {
		key: string;
		label: string;
		labelKind: 'namespace' | 'name' | 'environment';
		rows: Row[];
		failedCount: number;
		activeCount: number;
		stuckCount: number;
		severity: number;          // 0 healthy, 1 active, 2 stuck, 3 failed
		versions: Set<string>;     // for drift detection when grouping by name
		rangeMin: number;          // earliest history ts across the group (ms)
		rangeMax: number;          // latest history ts (ms) or 'now'
		rangeSpan: number;         // max - min (>=1)
	};

	function groupKeyOf(row: Row, gb: GroupBy): { key: string; label: string; labelKind: Group['labelKind'] } {
		if (gb === 'name')        return { key: row.name, label: row.name, labelKind: 'name' };
		if (gb === 'environment') {
			// Use the normalized theme name (e.g. 'prod') as the merge key so a rollout
			// bound via Environment.spec.environment=prod groups with another rollout
			// that only carries the 'prod' theme annotation. The display label prefers
			// the explicit environment name, then the preset label.
			const key = row.theme?.name || 'no-environment';
			const label = row.theme?.environmentName || row.theme?.label || 'No environment';
			return { key, label, labelKind: 'environment' };
		}
		return { key: row.ns, label: row.ns, labelKind: 'namespace' };
	}

	const groupedRows = $derived.by<Group[]>(() => {
		const nowMs = $now.getTime();
		const groups: Record<string, Group> = {};
		for (const row of filteredRollouts) {
			const { key, label, labelKind } = groupKeyOf(row, groupBy);
			let g = groups[key];
			if (!g) {
				g = groups[key] = { key, label, labelKind, rows: [], failedCount: 0, activeCount: 0, stuckCount: 0, severity: 0, versions: new Set(), rangeMin: Infinity, rangeMax: -Infinity, rangeSpan: 1 };
			}
			g.rows.push(row);
			if (row.status === 'Failed') g.failedCount++;
			if (row.status === 'InProgress' || row.status === 'Deploying') g.activeCount++;
			if (row.isStuck) g.stuckCount++;
			if (row.version) g.versions.add(row.version);
			for (const h of row.history) {
				const t = new Date(h.ts).getTime();
				if (t < g.rangeMin) g.rangeMin = t;
				if (t > g.rangeMax) g.rangeMax = t;
			}
		}
		for (const g of Object.values(groups)) {
			g.rows.sort((a, b) => {
				const d = (STATUS_SORT[a.status] ?? 3) - (STATUS_SORT[b.status] ?? 3);
				return d !== 0 ? d : a.name.localeCompare(b.name);
			});
			g.severity =
				g.failedCount > 0 ? 3 :
				g.stuckCount  > 0 ? 2 :
				g.activeCount > 0 ? 1 : 0;

			// Clip per-rollout history so timelines only go back as far as
			// "the deploy immediately before the group's oldest CURRENT version".
			// History older than that predates everyone's current state and just adds noise.
			const currentTsList = g.rows.map((r) => (r.history.length > 0 ? new Date(r.history[r.history.length - 1].ts).getTime() : Infinity));
			const oldestCurrentTs = Math.min(...currentTsList);
			let clippedMinTs = Infinity;
			for (const r of g.rows) {
				if (r.history.length === 0) { r.displayHistory = []; continue; }
				// Keep all entries >= oldestCurrentTs plus the single most recent entry < oldestCurrentTs (the "minus 1" anchor)
				const kept: HistoryDot[] = [];
				let predecessor: HistoryDot | null = null;
				for (const h of r.history) {
					const t = new Date(h.ts).getTime();
					if (t >= oldestCurrentTs) {
						kept.push(h);
					} else if (!predecessor || new Date(predecessor.ts).getTime() < t) {
						predecessor = h;
					}
				}
				if (predecessor) kept.unshift(predecessor);
				r.displayHistory = kept;
				for (const h of kept) {
					const t = new Date(h.ts).getTime();
					if (t < clippedMinTs) clippedMinTs = t;
				}
			}

			// Range: clipped min → now (so latest deploys land near the right edge, not pinned to it)
			if (clippedMinTs === Infinity) {
				g.rangeMin = nowMs - 86400000;
				g.rangeMax = nowMs;
			} else {
				g.rangeMin = clippedMinTs;
				g.rangeMax = nowMs;
			}
			g.rangeSpan = Math.max(1, g.rangeMax - g.rangeMin);
		}
		return Object.values(groups).sort((a, b) => {
			if (b.severity !== a.severity) return b.severity - a.severity;
			// For env groups, prefer tier order (dev → staging → prod) over alphabetical.
			if (a.labelKind === 'environment' && b.labelKind === 'environment') {
				return compareEnvironmentNames(a.label, b.label);
			}
			return a.label.localeCompare(b.label);
		});
	});

	const totalFiltered = $derived(filteredRollouts.length);

	const statusCounts = $derived.by(() => {
		const c = { active: 0, failed: 0, stuck: 0, succeeded: 0, idle: 0 };
		allRows.forEach((row) => {
			if (row.status === 'InProgress' || row.status === 'Deploying') c.active++;
			else if (row.status === 'Failed')    c.failed++;
			else if (row.status === 'Succeeded') c.succeeded++;
			else if (row.status === 'None')      c.idle++;
			if (row.isStuck)                     c.stuck++;
		});
		return c;
	});

	const stuckTotal = $derived(statusCounts.stuck);

	function envCount(env: string): number {
		return rollouts.filter((r) => getRolloutEnvironmentTheme(r, envForRollout(r))?.environmentName === env).length;
	}

	type StatusKey = 'failed' | 'active' | 'stuck' | 'succeeded' | 'idle';

	const STATUS_META: Record<StatusKey, { label: string; color: 'red' | 'yellow' | 'green' | 'gray' | 'orange'; dot: string; help: string }> = {
		failed:    { label: 'Failed',  color: 'red',    dot: 'bg-red-500',                    help: 'Bake or health checks failed for the last deploy' },
		active:    { label: 'Active',  color: 'yellow', dot: 'bg-yellow-400',                 help: 'A deploy is currently baking or rolling out' },
		stuck:     { label: 'Stuck',   color: 'orange', dot: 'bg-orange-500',                 help: 'A waiting candidate has exceeded the historical wait-time norm (mean + 1 stdev)' },
		succeeded: { label: 'Healthy', color: 'green',  dot: 'bg-green-500',                  help: 'Last deploy succeeded; no pending upgrades blocked' },
		idle:      { label: 'Idle',    color: 'gray',   dot: 'bg-gray-400 dark:bg-gray-600',  help: 'No deploys have run yet (no history)' },
	};
	const STATUS_FILTER_KEYS: StatusKey[] = ['failed', 'active', 'stuck', 'succeeded', 'idle'];

	const STATUS_BADGE: Record<string, { color: 'green' | 'red' | 'yellow' | 'blue' | 'gray'; label: string; dot: string; sparkBg: string }> = {
		Succeeded:  { color: 'green',  label: 'Healthy',   dot: 'bg-green-500',  sparkBg: 'bg-green-500' },
		Failed:     { color: 'red',    label: 'Failed',    dot: 'bg-red-500',    sparkBg: 'bg-red-500' },
		InProgress: { color: 'yellow', label: 'Baking',    dot: 'bg-yellow-400', sparkBg: 'bg-yellow-400' },
		Deploying:  { color: 'blue',   label: 'Deploying', dot: 'bg-blue-500',   sparkBg: 'bg-blue-500' },
		Cancelled:  { color: 'gray',   label: 'Cancelled', dot: 'bg-gray-400',   sparkBg: 'bg-gray-400' },
		None:       { color: 'gray',   label: 'Idle',      dot: 'bg-gray-400 dark:bg-gray-600', sparkBg: 'bg-gray-300 dark:bg-gray-600' },
	};

	function isRunning(s: string) { return s === 'InProgress' || s === 'Deploying'; }

	function toggleStatus(k: StatusKey) {
		statusFilters = statusFilters.includes(k) ? statusFilters.filter((x) => x !== k) : [...statusFilters, k];
	}
	function toggleEnv(env: string) {
		envFilters = envFilters.includes(env) ? envFilters.filter((x) => x !== env) : [...envFilters, env];
	}
	function toggleNs(ns: string) {
		nsFilters = nsFilters.includes(ns) ? nsFilters.filter((x) => x !== ns) : [...nsFilters, ns];
	}
	function toggleGroupKey(g: Group) {
		// Clicking a group header toggles a filter using the appropriate filter set
		if (g.labelKind === 'namespace') toggleNs(g.key);
		else if (g.labelKind === 'environment') envFilters = envFilters.includes(g.key) ? envFilters.filter((x) => x !== g.key) : [...envFilters, g.key];
		else searchQuery = searchQuery === g.key ? '' : g.key;
	}

	const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
		{ value: 'namespace',   label: 'Namespace' },
		{ value: 'name',        label: 'App' },
		{ value: 'environment', label: 'Environment' },
	];
</script>

<div class="flex min-h-full flex-col bg-white dark:bg-gray-900">

	<!-- ── Toolbar: search + Filter button + active chips + group-by ── -->
	<header class="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 sm:px-6">
			<!-- Search -->
			<div class="relative w-full min-w-0 sm:w-56">
				<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
				<input
					type="search"
					placeholder="Search rollouts…"
					bind:value={searchQuery}
					class="h-8 w-full rounded-md border border-gray-200 bg-gray-50 pl-8 pr-2 text-[13px] text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-700/40 dark:text-white dark:placeholder-gray-500"
				/>
			</div>

			<!-- Filter trigger -->
			<button
				type="button"
				onclick={() => (showFilters = !showFilters)}
				aria-expanded={showFilters}
				aria-controls="filter-panel"
				class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors
					{showFilters
						? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/30 dark:text-blue-300'
						: activeFilterCount > 0
							? 'border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'
							: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700/60'}"
			>
				{#if activeFilterCount > 0}
					<FilterSolid class="h-3.5 w-3.5" />
				{:else}
					<FilterOutline class="h-3.5 w-3.5" />
				{/if}
				Filters
				{#if activeFilterCount > 0}
					<span class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold tabular-nums text-white dark:bg-blue-500">{activeFilterCount}</span>
				{/if}
				{#if showFilters}
					<ChevronUpOutline class="h-3 w-3 opacity-60" />
				{:else}
					<ChevronDownOutline class="h-3 w-3 opacity-60" />
				{/if}
			</button>

			<!-- Group-by toggle (always stays at the right of row 1) -->
			<div class="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
				<span class="hidden sm:inline">Group</span>
				<div class="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
					{#each GROUP_OPTIONS as opt}
						{@const sel = groupBy === opt.value}
						<button
							type="button"
							onclick={() => (groupBy = opt.value)}
							aria-pressed={sel}
							class="cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors
								{sel
									? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900'
									: 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}"
						>{opt.label}</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Row 2: active filter chips (ghost style, own row) -->
		{#if !showFilters && activeFilterCount > 0}
			<div class="flex flex-wrap items-center gap-1 px-4 pb-2 sm:px-6">
				{#each statusFilters as k}
					{@const meta = STATUS_META[k]}
					<button
						type="button"
						onclick={() => toggleStatus(k)}
						title="Remove filter"
						class="inline-flex h-5 cursor-pointer items-center gap-1 rounded border border-gray-200 bg-white px-1.5 text-[10px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-gray-100"
					>
						<span class="h-1.5 w-1.5 rounded-full {meta.dot}"></span>
						{meta.label}
						<CloseOutline class="h-2.5 w-2.5 opacity-50" />
					</button>
				{/each}
				{#each envFilters as env}
					<button
						type="button"
						onclick={() => toggleEnv(env)}
						title="Remove filter"
						class="inline-flex h-5 cursor-pointer items-center gap-1 rounded border border-gray-200 bg-white px-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-gray-100"
					>{env}<CloseOutline class="h-2.5 w-2.5 opacity-50" /></button>
				{/each}
				{#each nsFilters as ns}
					<button
						type="button"
						onclick={() => toggleNs(ns)}
						title="Remove filter"
						class="inline-flex h-5 cursor-pointer items-center gap-1 rounded border border-gray-200 bg-white px-1.5 font-mono text-[10px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-gray-100"
					>{ns}<CloseOutline class="h-2.5 w-2.5 opacity-50" /></button>
				{/each}
			</div>
		{/if}

		<!-- Expandable filter panel -->
		{#if showFilters}
			<div id="filter-panel" transition:slide={{ duration: 180 }} class="border-t border-gray-100 bg-gray-50/70 dark:border-gray-700/60 dark:bg-gray-900/40">
				<div class="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
					<!-- Status section -->
					<section>
						<div class="mb-2 flex items-baseline justify-between">
							<h3 class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</h3>
							{#if statusFilters.length > 0}
								<button type="button" onclick={() => (statusFilters = [])} class="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
							{/if}
						</div>
						<div class="flex flex-col gap-1">
							{#each STATUS_FILTER_KEYS as k}
								{@const meta = STATUS_META[k]}
								{@const c = k === 'failed' ? statusCounts.failed : k === 'active' ? statusCounts.active : k === 'stuck' ? statusCounts.stuck : k === 'succeeded' ? statusCounts.succeeded : statusCounts.idle}
								{@const sel = statusFilters.includes(k)}
								{@const empty = c === 0 && !sel}
								<button
									type="button"
									onclick={() => toggleStatus(k)}
									aria-pressed={sel}
									title={meta.help}
									disabled={empty}
									class="group flex items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40
										{sel
											? 'bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700'
											: 'hover:bg-white dark:hover:bg-gray-800/60'}"
								>
									<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 {sel ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">
										{#if sel}<CheckCircleSolid class="h-3 w-3 text-white" />{/if}
									</span>
									<span class="h-1.5 w-1.5 shrink-0 rounded-full {meta.dot}"></span>
									<span class="flex-1 truncate text-gray-700 dark:text-gray-300">{meta.label}</span>
									<span class="shrink-0 tabular-nums text-[11px] text-gray-400 dark:text-gray-500">{c}</span>
								</button>
							{/each}
						</div>
					</section>

					<!-- Environment section -->
					{#if uniqueEnvironments.length > 0}
						<section>
							<div class="mb-2 flex items-baseline justify-between">
								<h3 class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Environment</h3>
								{#if envFilters.length > 0}
									<button type="button" onclick={() => (envFilters = [])} class="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
								{/if}
							</div>
							<div class="flex flex-col gap-1">
								{#each uniqueEnvironments as env}
									{@const sel = envFilters.includes(env)}
									{@const c = envCount(env)}
									<button
										type="button"
										onclick={() => toggleEnv(env)}
										aria-pressed={sel}
										class="group flex items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors
											{sel
												? 'bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700'
												: 'hover:bg-white dark:hover:bg-gray-800/60'}"
									>
										<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 {sel ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">
											{#if sel}<CheckCircleSolid class="h-3 w-3 text-white" />{/if}
										</span>
										<span class="flex-1 truncate font-mono text-[12px] uppercase tracking-wider text-gray-700 dark:text-gray-300">{env}</span>
										<span class="shrink-0 tabular-nums text-[11px] text-gray-400 dark:text-gray-500">{c}</span>
									</button>
								{/each}
							</div>
						</section>
					{/if}

					<!-- Namespace section -->
					{#if uniqueNamespaces.length > 1}
						<section>
							<div class="mb-2 flex items-baseline justify-between">
								<h3 class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Namespace</h3>
								{#if nsFilters.length > 0}
									<button type="button" onclick={() => (nsFilters = [])} class="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
								{/if}
							</div>
							<div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
								{#each uniqueNamespaces as ns}
									{@const sel = nsFilters.includes(ns)}
									{@const c = nsCount(ns)}
									<button
										type="button"
										onclick={() => toggleNs(ns)}
										aria-pressed={sel}
										class="group flex items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors
											{sel
												? 'bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700'
												: 'hover:bg-white dark:hover:bg-gray-800/60'}"
									>
										<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 {sel ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'}">
											{#if sel}<CheckCircleSolid class="h-3 w-3 text-white" />{/if}
										</span>
										<span class="flex-1 truncate font-mono text-[12px] text-gray-700 dark:text-gray-300">{ns}</span>
										<span class="shrink-0 tabular-nums text-[11px] text-gray-400 dark:text-gray-500">{c}</span>
									</button>
								{/each}
							</div>
						</section>
					{/if}
				</div>
			</div>
		{/if}
	</header>

	<!-- ── Group cards grid ── -->
	<div class="flex-1 bg-gray-50/70 px-4 py-5 dark:bg-gray-900/40 sm:px-6 sm:py-6">
		{#if loading}
			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
				{#each Array(6) as _}
					<div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
							<div class="h-3.5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						</div>
						<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each Array(2) as _}
								<div class="px-4 py-3">
									<div class="flex items-center gap-2.5">
										<div class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-3.5 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									</div>
									<div class="mt-2 h-2.5 w-2/3 animate-pulse rounded bg-gray-100 pl-[18px] dark:bg-gray-700/60"></div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if error}
			<Alert color="red">{error}</Alert>
		{:else if rollouts.length === 0}
			<Alert color="yellow">No rollouts found</Alert>
		{:else if totalFiltered === 0}
			<div class="py-20 text-center">
				<p class="text-sm text-gray-500 dark:text-gray-400">No rollouts match these filters.</p>
				<button onclick={() => { searchQuery = ''; statusFilters = []; envFilters = []; nsFilters = []; }} class="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Clear filters</button>
			</div>
		{:else}
			<!-- Status summary bar -->
			{#if statusCounts.failed > 0 || statusCounts.active > 0 || stuckTotal > 0 || statusCounts.succeeded > 0}
				<div class="mb-5 flex flex-wrap items-center gap-2">
					{#if statusCounts.failed > 0}
						<button
							type="button"
							onclick={() => toggleStatus('failed')}
							class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
								{statusFilters.includes('failed')
									? 'bg-red-500 text-white dark:bg-red-600'
									: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'}"
						>
							<span class="h-2 w-2 rounded-full bg-red-500 {statusFilters.includes('failed') ? 'bg-white' : ''}"></span>
							{statusCounts.failed} Failed
						</button>
					{/if}
					{#if statusCounts.active > 0}
						<button
							type="button"
							onclick={() => toggleStatus('active')}
							class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
								{statusFilters.includes('active')
									? 'bg-yellow-400 text-gray-900'
									: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400 dark:hover:bg-yellow-900/30'}"
						>
							<span class="relative flex h-2 w-2 shrink-0">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{statusCounts.active} Baking
						</button>
					{/if}
					{#if stuckTotal > 0}
						<button
							type="button"
							onclick={() => toggleStatus('stuck')}
							class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
								{statusFilters.includes('stuck')
									? 'bg-orange-500 text-white dark:bg-orange-600'
									: 'bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:hover:bg-orange-900/30'}"
						>
							<span class="h-2 w-2 rounded-full bg-orange-500 {statusFilters.includes('stuck') ? 'bg-white' : ''}"></span>
							{stuckTotal} Stuck
						</button>
					{/if}
					<div class="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
						{#if statusCounts.succeeded > 0}
							<span class="flex items-center gap-1">
								<span class="h-1.5 w-1.5 rounded-full bg-green-400"></span>
								{statusCounts.succeeded} healthy
							</span>
						{/if}
						{#if statusCounts.idle > 0}
							<span class="flex items-center gap-1">
								<span class="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>
								{statusCounts.idle} idle
							</span>
						{/if}
					</div>
				</div>
			{/if}

			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
				{#each groupedRows as group}
					{@const groupHighlighted =
						(group.labelKind === 'namespace' && nsFilters.includes(group.key)) ||
						(group.labelKind === 'environment' && envFilters.includes(group.key))}
					{@const detailHref =
						group.labelKind === 'namespace'
							? `/namespaces/${group.key}`
							: group.labelKind === 'environment' && group.key !== 'no-environment'
								? `/envs/${encodeURIComponent(group.key)}`
								: group.labelKind === 'name'
									? `/apps/${group.key}`
									: null}
					<section class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
					>
						<!-- Group header row (toggle + optional detail link) -->
						<div class="flex border-b border-gray-100 dark:border-gray-700/60
							{group.severity === 3
								? 'bg-red-50 dark:bg-red-950/20'
								: group.severity === 2
									? 'bg-orange-50 dark:bg-orange-950/20'
									: ''}">
						<button
							type="button"
							onclick={() => toggleGroupKey(group)}
							aria-pressed={groupHighlighted}
							class="flex flex-1 items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors
								{group.severity === 3
									? 'hover:bg-red-100/60 dark:hover:bg-red-900/20'
									: group.severity === 2
										? 'hover:bg-orange-100/60 dark:hover:bg-orange-900/20'
										: 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}"
						>
							<div class="flex min-w-0 items-center gap-2">
								<!-- Severity indicator — only when not healthy -->
								{#if group.severity === 3}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="{group.failedCount} failed"></span>
								{:else if group.severity === 2}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" title="{group.stuckCount} stuck"></span>
								{:else if group.severity === 1}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" title="{group.activeCount} active"></span>
								{/if}
								{#if group.labelKind === 'environment'}
									{#if group.rows[0]?.theme}
										<span
											class="environment-theme-scope environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
											style={getEnvironmentThemeStyle(group.rows[0].theme)}
										>{group.label}</span>
									{:else}
										<span class="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-mono font-semibold text-gray-400 dark:border-gray-600 dark:text-gray-500">No env</span>
									{/if}
								{:else}
									<h3 class="truncate text-xs
										{group.labelKind === 'name' ? 'font-semibold text-gray-900 dark:text-white' : 'font-mono font-semibold text-gray-700 dark:text-gray-200'}
										{groupHighlighted ? 'text-blue-600 dark:text-blue-400' : ''}"
									>{group.label}</h3>
								{/if}
								<span class="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{group.rows.length}</span>
									{#if group.failedCount > 0}
										<span class="shrink-0 text-[10px] font-medium text-red-600 dark:text-red-400">{group.failedCount} failed</span>
									{:else if group.stuckCount > 0}
										<span class="shrink-0 text-[10px] font-medium text-orange-600 dark:text-orange-400">{group.stuckCount} stuck</span>
									{:else if group.activeCount > 0}
										<span class="shrink-0 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">{group.activeCount} baking</span>
									{/if}
							</div>
							{#if groupHighlighted}
								<CloseOutline class="h-3.5 w-3.5 text-blue-500" />
							{/if}
						</button>
						{#if detailHref}
							<a
								href={detailHref}
								class="flex shrink-0 items-center border-l border-gray-100 px-3 text-gray-300 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700/60 dark:text-gray-600 dark:hover:bg-gray-700/40 dark:hover:text-gray-300"
								title={group.labelKind === 'namespace' ? 'View namespace timeline' : group.labelKind === 'environment' ? 'View environment overview' : 'View app across environments'}
								aria-label="View detail"
							>
								<ChevronRightOutline class="h-4 w-4" />
							</a>
						{/if}
						</div>

						<!-- Rows -->
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each group.rows as row}
								{@const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE['None']}
								<li>
									<a
										href="/rollouts/{row.ns}/{row.name}"
										style={row.theme ? getEnvironmentThemeStyle(row.theme) : undefined}
										class="environment-theme-scope relative block px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<!-- Line 1: dot + name + env -->
										<div class="flex items-center gap-2.5">
											<span class="relative flex h-2 w-2 shrink-0">
												{#if isRunning(row.status)}
													<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {badge.dot}"></span>
												{/if}
												<span class="relative inline-flex h-2 w-2 rounded-full {badge.dot}"></span>
											</span>
											{#if groupBy === 'name'}
												<h4 class="min-w-0 flex-1 truncate font-mono text-[12.5px] text-gray-700 dark:text-gray-300">{row.ns}</h4>
												{#if row.theme?.environmentName}
													<span
														class="environment-theme-scope environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
														style={getEnvironmentThemeStyle(row.theme)}
													>{row.theme.environmentName}</span>
												{/if}
											{:else if groupBy === 'environment'}
												<h4 class="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{row.name}</h4>
												<span class="shrink-0 truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{row.ns}</span>
											{:else}
												<h4 class="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{row.name}</h4>
												{#if row.theme?.environmentName}
													<span
														class="environment-theme-scope environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
														style={getEnvironmentThemeStyle(row.theme)}
													>{row.theme.environmentName}</span>
												{/if}
											{/if}
										</div>

										<!-- Line 2: meta — wraps naturally on narrow screens -->
										<div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[18px] text-[11px] text-gray-500 dark:text-gray-500">
											<!-- Status label only when not Healthy/Idle (those are implied by the dot) -->
											{#if row.status === 'Failed'}
												<span class="shrink-0 font-medium text-red-600 dark:text-red-400">Failed</span>
											{:else if isRunning(row.status)}
												<span class="shrink-0 font-medium text-yellow-700 dark:text-yellow-400">
													{badge.label}{#if row.bakeProgressPct !== null}&nbsp;{Math.round(row.bakeProgressPct)}%{/if}
												</span>
											{/if}

											{#if row.version}
												<span class="min-w-0 max-w-full truncate font-mono">{row.version}</span>
											{:else}
												<span class="text-gray-300 dark:text-gray-700">no version</span>
											{/if}

											<!-- Signals — flow inline, wrap on narrow viewports -->
											{#if row.pinnedVersion}
												<span class="inline-flex shrink-0 items-center gap-1 text-orange-600 dark:text-orange-400" title="Pinned to {row.pinnedVersion} — automated deploys are paused until the pin is cleared">
													<PauseSolid class="h-3 w-3" />Pinned
												</span>
											{/if}
											{#if row.isStuck}
												{@const waitId = `wait-${row.ns}-${row.name}`.replace(/[^a-z0-9-]/gi, '-')}
												<span id={waitId} class="inline-flex shrink-0 cursor-help items-center gap-1 font-medium text-orange-600 dark:text-orange-400">
													<ClockSolid class="h-3 w-3" />stuck {compactSeconds(row.waitingSeconds)}
												</span>
											{:else if row.upgradeCount > 0}
												<span class="inline-flex shrink-0 items-center gap-1 text-orange-600 dark:text-orange-400" title="{row.upgradeCount} {row.upgradeCount === 1 ? 'upgrade' : 'upgrades'} available">
													<ArrowUpOutline class="h-3 w-3" />{row.upgradeCount} {row.upgradeCount === 1 ? 'upgrade' : 'upgrades'}
												</span>
											{/if}
											{#if row.failedHCCount > 0}
												<span class="inline-flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400" title="{row.failedHCCount} failed health check{row.failedHCCount === 1 ? '' : 's'}">
													<HeartSolid class="h-3 w-3" />{row.failedHCCount} unhealthy
												</span>
											{/if}
											{#if row.behindCount > 0}
												{@const behindId = `behind-${row.ns}-${row.name}`.replace(/[^a-z0-9-]/gi, '-')}
												<span
													id={behindId}
													class="inline-flex shrink-0 cursor-help items-center gap-1
														{row.isBehindSlow ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-gray-500 dark:text-gray-500'}"
												>
													<ChevronDownOutline class="h-3 w-3" />
													{row.behindCount} behind {row.leadKey}{#if row.isBehindSlow}&nbsp;·&nbsp;{compactSeconds(row.behindOldestLagSec)}{/if}
													<QuestionCircleOutline class="ml-0.5 h-3 w-3 opacity-60" />
												</span>
											{/if}
											{#if row.age}
												<span class="ml-auto shrink-0 font-mono text-gray-400 dark:text-gray-500">{row.age}</span>
											{/if}
										</div>

										<!-- Subtle per-rollout deploy timeline -->
										{#if row.displayHistory.length > 0}
											<div class="mt-2.5 pl-[18px]">
												<div class="relative h-1.5">
													<div class="absolute inset-x-0 top-[3px] h-px bg-gradient-to-r from-gray-200/40 via-gray-200 to-gray-300/80 dark:from-gray-700/30 dark:via-gray-700/60 dark:to-gray-600/80"></div>
													{#each row.displayHistory as h}
														{@const t = new Date(h.ts).getTime()}
														{@const x = Math.min(100, Math.max(0, ((t - group.rangeMin) / group.rangeSpan) * 100))}
														{@const b = STATUS_BADGE[h.status] ?? STATUS_BADGE['None']}
														<span
															class="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full {b.sparkBg} ring-1 ring-white transition-transform hover:scale-150 dark:ring-gray-800"
															style="left: {x}%"
															title="{h.version} · {h.status}"
														></span>
													{/each}
													<!-- 'now' dot anchor on the right -->
													<span class="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-gray-300 ring-1 ring-white dark:bg-gray-600 dark:ring-gray-800" title="now"></span>
												</div>
											</div>
										{/if}

										{#if row.bakeProgressPct !== null}
											<span class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-100 dark:bg-gray-700">
												<span class="block h-full bg-yellow-400 transition-all duration-500 dark:bg-yellow-500" style="width: {row.bakeProgressPct}%"></span>
											</span>
										{/if}
									</a>

									{#if row.behindCount > 0}
										{@const behindId = `behind-${row.ns}-${row.name}`.replace(/[^a-z0-9-]/gi, '-')}
										<Popover triggeredBy={`#${behindId}`} class="max-w-sm">
											<div class="p-3">
												<div class="mb-2 flex items-center gap-2">
													<ChevronDownOutline class="h-4 w-4 {row.isBehindSlow ? 'text-orange-500' : 'text-gray-400'}" />
													<h4 class="text-sm font-semibold text-gray-900 dark:text-white">
														{row.isBehindSlow ? 'Slow promotion' : 'Behind lead'}
													</h4>
												</div>
												<dl class="space-y-1 text-xs text-gray-600 dark:text-gray-300">
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Lead</dt>
														<dd class="truncate font-mono">{row.leadKey}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Versions behind</dt>
														<dd class="tabular-nums">{row.behindCount}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Oldest unpromoted lag</dt>
														<dd class="font-mono tabular-nums {row.isBehindSlow ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}">{compactSeconds(row.behindOldestLagSec)}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Slow threshold</dt>
														<dd class="font-mono tabular-nums">{compactSeconds(row.behindThresholdSec)}</dd>
													</div>
												</dl>
												<p class="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
													Threshold = mean + 1·stdev of historical promotion lag (per matching version that landed in both this rollout and the lead). With &lt;3 samples, falls back to 2× max historical lag, then to 7 days.
												</p>
											</div>
										</Popover>
									{/if}

									{#if row.isStuck}
										{@const waitId = `wait-${row.ns}-${row.name}`.replace(/[^a-z0-9-]/gi, '-')}
										<Popover triggeredBy={`#${waitId}`} class="max-w-sm">
											<div class="p-3">
												<div class="mb-2 flex items-center gap-2">
													<ClockSolid class="h-4 w-4 text-orange-500" />
													<h4 class="text-sm font-semibold text-gray-900 dark:text-white">
														Stuck on gates
													</h4>
												</div>
												<dl class="space-y-1 text-xs text-gray-600 dark:text-gray-300">
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Candidate</dt>
														<dd class="truncate font-mono">{row.waitingCandidateVersion}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Waiting</dt>
														<dd class="font-mono tabular-nums {row.isStuck ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}">{compactSeconds(row.waitingSeconds)}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Threshold</dt>
														<dd class="font-mono tabular-nums">{compactSeconds(row.stuckThresholdSec)}</dd>
													</div>
													<div class="flex justify-between gap-3">
														<dt class="text-gray-500 dark:text-gray-400">Gates blocking</dt>
														<dd class="tabular-nums">{row.gatesBlocking}</dd>
													</div>
												</dl>
												<p class="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
													Threshold = mean + 1·stdev of historical wait times (from <span class="font-mono">version.created</span> to deploy). With &lt;3 samples, falls back to 2× max historical wait, then to 7 days.
												</p>
											</div>
										</Popover>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
	</div>

</div>
