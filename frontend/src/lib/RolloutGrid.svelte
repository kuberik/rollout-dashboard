<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact } from '$lib/utils';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { slide } from 'svelte/transition';
	import { Spinner } from 'flowbite-svelte';
	import {
		SearchOutline,
		ExclamationCircleSolid,
		CheckCircleSolid,
		ChevronRightOutline,
		ChevronDownOutline,
		ClockSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	function envForRollout(r: Rollout): Environment | undefined {
		return environments.find(
			(e) =>
				e.metadata?.namespace === r.metadata?.namespace &&
				e.spec?.rolloutRef?.name === r.metadata?.name
		);
	}

	type StatusKey = 'succeeded' | 'failed' | 'active' | 'pending';

	type Card = {
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
		pinnedVersion: string | null;
		behind: { fromEnv: string; version: string; behindBy: number | null } | null;
		rollout: Rollout;
	};

	// Build a per-app map: appName → Array<{envName, rollout, env}> sorted by env tier.
	// Used to compute "N versions behind" diagnostics on each card.
	const appIndex = $derived.by(() => {
		const map = new Map<string, { envName: string; rollout: Rollout }[]>();
		for (const env of environments) {
			const appName = env.spec?.rolloutRef?.name;
			const envName = env.spec?.environment;
			if (!appName || !envName) continue;
			const ns = env.metadata?.namespace;
			const r = rollouts.find((x) => x.metadata?.name === appName && x.metadata?.namespace === ns);
			if (!r) continue;
			if (!map.has(appName)) map.set(appName, []);
			map.get(appName)!.push({ envName, rollout: r });
		}
		for (const list of map.values()) {
			list.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
		}
		return map;
	});

	function computeBehind(
		r: Rollout,
		envName: string
	): { fromEnv: string; version: string; behindBy: number | null } | null {
		// Pinned rollouts are intentionally held.
		if (r.spec?.wantedVersion) return null;
		const myH = r.status?.history?.[0];
		if (!myH) return null;
		const myV = getDisplayVersion(myH.version);
		const peers = appIndex.get(r.metadata?.name ?? '');
		if (!peers || peers.length < 2) return null;
		// Find the closest earlier-tier env that deploys this app.
		const earlierPeers = peers.filter((p) => compareEnvironmentNames(p.envName, envName) < 0);
		if (earlierPeers.length === 0) return null;
		const source = earlierPeers[earlierPeers.length - 1];
		const sourceH = source.rollout.status?.history?.[0];
		if (!sourceH || sourceH.bakeStatus !== 'Succeeded') return null;
		const sourceV = getDisplayVersion(sourceH.version);
		if (sourceV === myV) return null;
		// Count distinct versions between myV (inclusive) and sourceV (newest) in source history.
		const distinct: string[] = [];
		for (const h of source.rollout.status?.history ?? []) {
			const v = getDisplayVersion(h.version);
			if (distinct[distinct.length - 1] !== v) distinct.push(v);
			if (v === myV) break;
		}
		const idx = distinct.indexOf(myV);
		return { fromEnv: source.envName, version: sourceV, behindBy: idx >= 0 ? idx : null };
	}

	const cards = $derived.by<Card[]>(() => {
		return rollouts.map((r) => {
			const latest = r.status?.history?.[0];
			const env = envForRollout(r);
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
			const behind = envName ? computeBehind(r, envName) : null;
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
				pinnedVersion: r.spec?.wantedVersion || null,
				behind,
				rollout: r
			};
		});
	});

	// Filters
	let searchQuery = $state('');
	let statusFilters = $state<StatusKey[]>([]);
	let envFilters = $state<string[]>([]);
	let expandedNs = $state<Set<string>>(new Set());

	function toggleStatus(k: StatusKey) {
		statusFilters = statusFilters.includes(k)
			? statusFilters.filter((x) => x !== k)
			: [...statusFilters, k];
	}
	function toggleEnv(name: string) {
		envFilters = envFilters.includes(name)
			? envFilters.filter((x) => x !== name)
			: [...envFilters, name];
	}
	function toggleNs(ns: string) {
		const next = new Set(expandedNs);
		if (next.has(ns)) next.delete(ns);
		else next.add(ns);
		expandedNs = next;
	}
	function clearFilters() {
		statusFilters = [];
		envFilters = [];
		searchQuery = '';
	}

	const knownEnvs = $derived.by(() => {
		const map = new Map<string, { display: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> }>();
		for (const c of cards) {
			if (!c.envKey) continue;
			if (!map.has(c.envKey)) map.set(c.envKey, { display: c.envDisplay, theme: c.theme });
		}
		return [...map.entries()]
			.map(([key, v]) => ({ key, display: v.display, theme: v.theme }))
			.sort((a, b) => compareEnvironmentNames(a.display, b.display));
	});

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return cards.filter((c) => {
			if (statusFilters.length > 0 && !statusFilters.includes(c.statusKey)) return false;
			if (envFilters.length > 0 && !envFilters.includes(c.envKey)) return false;
			if (q) {
				const hay = `${c.ns} ${c.name} ${c.title} ${c.envKey} ${c.envDisplay} ${c.version ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Group filtered cards by namespace, sort cards within group by severity then recency,
	// sort groups by worst severity first then alphabetical.
	type NsGroup = {
		ns: string;
		cards: Card[];
		failedCount: number;
		activeCount: number;
		pendingCount: number;
		severity: number; // 3 failed, 2 active, 1 pending, 0 healthy
		newestDeploy: string | null;
	};

	const grouped = $derived.by<NsGroup[]>(() => {
		const sevRank: Record<StatusKey, number> = { failed: 0, active: 1, pending: 2, succeeded: 3 };
		const map = new Map<string, NsGroup>();
		for (const c of filtered) {
			let g = map.get(c.ns);
			if (!g) {
				g = {
					ns: c.ns,
					cards: [],
					failedCount: 0,
					activeCount: 0,
					pendingCount: 0,
					severity: 0,
					newestDeploy: null
				};
				map.set(c.ns, g);
			}
			g.cards.push(c);
			if (c.statusKey === 'failed') g.failedCount++;
			else if (c.statusKey === 'active') g.activeCount++;
			else if (c.statusKey === 'pending') g.pendingCount++;
			if (c.timestamp && (!g.newestDeploy || new Date(c.timestamp) > new Date(g.newestDeploy))) {
				g.newestDeploy = c.timestamp;
			}
		}
		for (const g of map.values()) {
			g.severity =
				g.failedCount > 0 ? 3 : g.activeCount > 0 ? 2 : g.pendingCount > 0 ? 1 : 0;
			g.cards.sort((a, b) => {
				const s = sevRank[a.statusKey] - sevRank[b.statusKey];
				if (s !== 0) return s;
				const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
				const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
				return bt - at;
			});
		}
		return [...map.values()].sort((a, b) => {
			if (b.severity !== a.severity) return b.severity - a.severity;
			return a.ns.localeCompare(b.ns);
		});
	});

	// Counters from full set (not filtered) for the header pills
	const counts = $derived.by(() => {
		const c = { succeeded: 0, failed: 0, active: 0, pending: 0 };
		for (const card of cards) c[card.statusKey]++;
		return c;
	});
	const newestDeploy = $derived.by<string | null>(() => {
		let t: string | null = null;
		for (const c of cards) {
			if (c.timestamp && (!t || new Date(c.timestamp) > new Date(t))) t = c.timestamp;
		}
		return t;
	});

	// Timeline events for a namespace: merge deploy histories from all rollouts in the ns,
	// most recent first.
	type TimelineEvent = {
		ns: string;
		appName: string;
		appTitle: string;
		envDisplay: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme>;
		version: string;
		bakeStatus: string;
		timestamp: string;
	};

	function timelineForNs(ns: string, limit = 20): TimelineEvent[] {
		const events: TimelineEvent[] = [];
		for (const c of cards) {
			if (c.ns !== ns) continue;
			const history = c.rollout.status?.history ?? [];
			for (const h of history.slice(0, 12)) {
				if (!h.timestamp) continue;
				events.push({
					ns,
					appName: c.name,
					appTitle: c.title,
					envDisplay: c.envDisplay,
					theme: c.theme,
					version: getDisplayVersion(h.version),
					bakeStatus: h.bakeStatus || 'None',
					timestamp: h.timestamp
				});
			}
		}
		events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return events.slice(0, limit);
	}

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	const STATUS_LABEL: Record<string, string> = {
		Succeeded: 'Succeeded',
		Failed: 'Failed',
		InProgress: 'Baking',
		Deploying: 'Deploying',
		Cancelled: 'Cancelled',
		None: 'No deploy'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600'
	};
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Header -->
	<div class="mb-5 flex flex-wrap items-baseline justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Rollouts</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{cards.length} rollouts across the cluster</p>
		</div>
		{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
	</div>

	<!-- Fleet summary banner -->
	{#if cards.length > 0}
		<section class="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<div class="flex items-baseline gap-1.5">
					<span class="text-3xl font-light {counts.succeeded === cards.length ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}">{counts.succeeded}</span>
					<span class="text-sm text-gray-400 dark:text-gray-500">/ {cards.length} healthy</span>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					{#if counts.active > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{counts.active} deploying
						</span>
					{/if}
					{#if counts.pending > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
							<span class="h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-500"></span>
							{counts.pending} pending
						</span>
					{/if}
					{#if counts.failed > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
							<ExclamationCircleSolid class="h-3 w-3 text-red-500" />
							{counts.failed} failed
						</span>
					{/if}
					{#if counts.failed === 0 && counts.active === 0 && counts.pending === 0 && cards.length > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
							<CheckCircleSolid class="h-3 w-3" />All healthy
						</span>
					{/if}
					{#if newestDeploy}
						<span class="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 dark:text-gray-500" title={`Newest deploy ${formatTimeAgo(newestDeploy, $now)}`}>
							<ClockSolid class="h-3 w-3" />
							{formatTimeAgoCompact(newestDeploy, $now)}
						</span>
					{/if}
				</div>
			</div>
			<div class="mt-3 flex h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
				{#if counts.succeeded > 0}
					<span class="bg-green-500" style="width:{(counts.succeeded / cards.length) * 100}%"></span>
				{/if}
				{#if counts.active > 0}
					<span class="bg-yellow-400" style="width:{(counts.active / cards.length) * 100}%"></span>
				{/if}
				{#if counts.pending > 0}
					<span class="bg-gray-400 dark:bg-gray-500" style="width:{(counts.pending / cards.length) * 100}%"></span>
				{/if}
				{#if counts.failed > 0}
					<span class="bg-red-500" style="width:{(counts.failed / cards.length) * 100}%"></span>
				{/if}
			</div>
		</section>
	{/if}

	<!-- Filter bar -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<div class="relative min-w-0 flex-1 sm:max-w-sm">
			<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search rollouts…"
				class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
			/>
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			{#each [{key:'failed', label:'Failed', color:'red', dot:'bg-red-500'}, {key:'active', label:'Deploying', color:'yellow', dot:'bg-yellow-400'}, {key:'pending', label:'Pending', color:'gray', dot:'bg-gray-400'}, {key:'succeeded', label:'Healthy', color:'green', dot:'bg-green-500'}] as p}
				{@const k = p.key as StatusKey}
				{@const sel = statusFilters.includes(k)}
				{@const n = counts[k]}
				{#if n > 0}
					<button
						type="button"
						onclick={() => toggleStatus(k)}
						class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors
							{sel
								? p.color === 'red'    ? 'bg-red-100 text-red-800 ring-1 ring-red-300 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-700/60'
								: p.color === 'yellow' ? 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-700/60'
								: p.color === 'gray'   ? 'bg-gray-200 text-gray-800 ring-1 ring-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-500'
								:                        'bg-green-100 text-green-800 ring-1 ring-green-300 dark:bg-green-900/30 dark:text-green-200 dark:ring-green-700/60'
								: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-700'}"
					>
						<span class="h-1.5 w-1.5 rounded-full {p.dot}"></span>
						{n} {p.label}
					</button>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Env chip row -->
	{#if knownEnvs.length > 1}
		<div class="mb-5 flex flex-wrap items-center gap-1.5">
			<span class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">env</span>
			{#each knownEnvs as e}
				<button
					type="button"
					onclick={() => toggleEnv(e.key)}
					class="environment-theme-scope environment-theme-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity {envFilters.includes(e.key) ? 'ring-2 ring-gray-900/20 dark:ring-gray-100/20' : 'opacity-70 hover:opacity-100'}"
					style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
				>{e.display}</button>
			{/each}
			{#if envFilters.length > 0 || statusFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="ml-2 text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear all</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-6">
			<!-- Fleet summary skeleton -->
			<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="flex items-center justify-between gap-4">
					<div class="flex items-baseline gap-2">
						<div class="h-8 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-4 w-20 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="hidden gap-2 sm:flex">
						{#each Array(3) as _}
							<div class="h-4 w-16 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
						{/each}
					</div>
				</div>
				<div class="mt-3 h-1 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<!-- Namespace groups skeleton -->
			{#each Array(2) as _}
				<div class="space-y-3">
					<div class="flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-4 w-16 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each Array(3) as _}
							<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
								<div class="flex items-start justify-between gap-2">
									<div class="flex flex-col gap-1.5">
										<div class="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-3 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
									</div>
									<div class="h-4 w-12 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
								</div>
								<div class="mt-3 flex items-end justify-between">
									<div class="flex flex-col gap-1.5">
										<div class="h-3.5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-3 w-12 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
									</div>
									<div class="h-3 w-8 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load rollouts: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<p class="text-sm font-medium text-gray-900 dark:text-white">No rollouts yet</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">Create a Rollout resource in your cluster to see it here.</p>
		</div>
	{:else if grouped.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No matches</p>
			<button
				type="button"
				onclick={clearFilters}
				class="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			>Clear filters</button>
		</div>
	{:else}
		<div class="space-y-6">
			{#each grouped as g (g.ns)}
				{@const open = expandedNs.has(g.ns)}
				{@const events = open ? timelineForNs(g.ns) : []}
				<section>
					<!-- Namespace header -->
					<div class="mb-2 flex items-center justify-between gap-2 border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="flex min-w-0 items-baseline gap-2">
							{#if g.severity === 3}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"></span>
							{:else if g.severity === 2}
								<span class="relative flex h-1.5 w-1.5 shrink-0">
									<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
									<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400"></span>
								</span>
							{:else if g.severity === 1}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400"></span>
							{:else}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 dark:bg-green-500"></span>
							{/if}
							<h2 class="truncate font-mono text-sm font-semibold text-gray-800 dark:text-gray-200">{g.ns}</h2>
							<span class="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{g.cards.length}</span>
							{#if g.failedCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400">· {g.failedCount} failed</span>
							{:else if g.activeCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-yellow-700 dark:text-yellow-400">· {g.activeCount} deploying</span>
							{:else if g.pendingCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">· {g.pendingCount} pending</span>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<button
								type="button"
								onclick={() => toggleNs(g.ns)}
								class="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-200"
								aria-expanded={open}
							>
								<ChevronDownOutline class="h-3 w-3 transition-transform {open ? 'rotate-180' : ''}" />
								<span>timeline</span>
							</button>
							<a
								href={`/namespaces/${g.ns}`}
								class="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-700/60 dark:hover:text-gray-200"
								title="Open namespace detail"
							>
								<ChevronRightOutline class="h-3 w-3" />
							</a>
						</div>
					</div>

					<!-- Rollouts grid -->
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each g.cards as c (c.ns + '/' + c.name)}
							<a
								href={`/rollouts/${c.ns}/${c.name}`}
								class="environment-theme-scope group flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
								style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
							>
								<div class="flex min-w-0 items-start justify-between gap-2">
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-center gap-2">
											<span class="relative flex h-2 w-2 shrink-0">
												{#if c.isRunning}
													<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[c.bakeStatus]}"></span>
												{/if}
												<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[c.bakeStatus] ?? STATUS_DOT.None}"></span>
											</span>
											<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
										</div>
										<div class="mt-0.5 truncate pl-4 font-mono text-[11px] text-gray-400 dark:text-gray-500">{c.name}</div>
									</div>
									{#if c.envDisplay}
										<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{c.envDisplay}</span>
									{/if}
								</div>

								<div class="flex min-w-0 items-end justify-between gap-2">
									<div class="flex min-w-0 flex-1 flex-col gap-0.5">
										<span class="truncate font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
											{c.version ?? '—'}
										</span>
										<span class="text-[11px] {STATUS_TEXT[c.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[c.bakeStatus]}</span>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										{#if c.pinnedVersion}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
												title={`Pinned to ${c.pinnedVersion}`}
											>pinned</span>
										{/if}
										{#if c.timestamp}
											<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(c.timestamp, $now)}>
												{formatTimeAgoCompact(c.timestamp, $now)}
											</span>
										{/if}
									</div>
								</div>

								{#if c.behind}
									<div class="flex items-center gap-1 truncate text-[10px] text-orange-700 dark:text-orange-300">
										<span aria-hidden="true">←</span>
										{#if c.behind.behindBy && c.behind.behindBy > 0}
											<span class="font-semibold">{c.behind.behindBy}</span>
											<span>{c.behind.behindBy === 1 ? 'version' : 'versions'} behind</span>
										{:else}
											<span>behind</span>
										{/if}
										<span class="font-mono">{c.behind.version}</span>
										<span class="text-orange-500/70 dark:text-orange-400/70">on {c.behind.fromEnv}</span>
									</div>
								{/if}

								{#if c.statusKey === 'failed' && c.bakeStatusMessage}
									<div class="line-clamp-2 break-words rounded-md bg-red-50/70 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/15 dark:text-red-300">
										{c.bakeStatusMessage}
									</div>
								{/if}
							</a>
						{/each}
					</div>

					<!-- Inline expandable timeline for this namespace -->
					{#if open}
						<div transition:slide={{ duration: 180 }} class="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
							<div class="flex items-baseline justify-between border-b border-gray-100 px-4 py-2 dark:border-gray-700/60">
								<span class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Deploy timeline</span>
								<a href={`/namespaces/${g.ns}`} class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">full view ›</a>
							</div>
							{#if events.length === 0}
								<div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No deploy history yet.</div>
							{:else}
								<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
									{#each events as e}
										<li class="environment-theme-scope" style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}>
											<a
												href={`/rollouts/${e.ns}/${e.appName}`}
												class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
											>
												<span class="environment-theme-badge shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{e.envDisplay || 'no-env'}</span>
												<div class="flex min-w-0 items-center gap-2">
													<span class="truncate text-gray-800 dark:text-gray-200">{e.appTitle}</span>
													<span class="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">{e.version}</span>
												</div>
												<span class="flex shrink-0 items-center gap-1.5 text-[11px]">
													<span class="relative flex h-1.5 w-1.5">
														{#if isRunning(e.bakeStatus)}
															<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[e.bakeStatus]}"></span>
														{/if}
														<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[e.bakeStatus] ?? STATUS_DOT.None}"></span>
													</span>
													<span class={STATUS_TEXT[e.bakeStatus] ?? STATUS_TEXT.None}>{STATUS_LABEL[e.bakeStatus]}</span>
													<span class="font-mono text-gray-400 dark:text-gray-500" title={formatTimeAgo(e.timestamp, $now)}>{formatTimeAgoCompact(e.timestamp, $now)}</span>
												</span>
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</section>
			{/each}
		</div>

		<p class="mt-6 text-center text-[11px] text-gray-400 dark:text-gray-600">
			{filtered.length} rollout{filtered.length === 1 ? '' : 's'} in {grouped.length} namespace{grouped.length === 1 ? '' : 's'}
		</p>
	{/if}
</div>
