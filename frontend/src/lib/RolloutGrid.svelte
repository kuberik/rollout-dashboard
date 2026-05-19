<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact, categorizeFailure, formatStatusTime, compareRollouts } from '$lib/utils';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		SearchOutline,
		ChevronRightOutline,
		GridOutline
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
		failureCategory: string | null;
		previousSucceededVersion: string | null;
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

	// Find the most relevant peer env for this rollout — the one where my
	// current version exists as a past deploy. That env has progressed past
	// me, so we say I'm "behind <env>" — direction derived from data, not
	// from env-name tier assumptions. If no peer has progressed past me but
	// my history contains a peer's current version, I'm "ahead" of it.
	function computeBehind(
		r: Rollout,
		envName: string
	): { fromEnv: string; version: string; behindBy: number | null } | null {
		if (r.spec?.wantedVersion) return null;
		const peers = appIndex.get(r.metadata?.name ?? '');
		if (!peers || peers.length < 2) return null;
		// Prefer peers that have actually moved past me (kind === 'behind').
		// Among them, pick the one with the highest behindBy (furthest behind).
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
				failureCategory: bakeStatus === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null,
				previousSucceededVersion,
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

	// Activity pulse: how many deploys landed in the last 24h. Gives the user
	// a sense of cluster cadence (idle weekend vs busy release day).
	const recent24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const c of cards) {
			if (!c.timestamp) continue;
			if (new Date(c.timestamp).getTime() >= cutoff) n++;
		}
		return n;
	});

	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Header: title + inline status summary -->
	<div class="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="text-2xl font-light text-gray-900 dark:text-white">Rollouts</h1>
			{#if cards.length > 0}
				<span class="text-sm text-gray-500 dark:text-gray-400">
					<span class="tabular-nums {counts.succeeded === cards.length ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}">{counts.succeeded}</span>
					<span>of {cards.length} healthy</span>
					{#if counts.failed > 0}<span class="ml-2 font-medium text-red-600 dark:text-red-400">· {counts.failed} failed</span>{/if}
					{#if counts.active > 0}<span class="ml-2 font-medium text-yellow-700 dark:text-yellow-400">· {counts.active} deploying</span>{/if}
					{#if counts.pending > 0}<span class="ml-2 text-gray-500 dark:text-gray-400">· {counts.pending} pending</span>{/if}
				</span>
				{#if recent24h > 0}
					<a href="/activity" class="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300" title="View activity">
						{recent24h} deploy{recent24h === 1 ? '' : 's'} · 24h
					</a>
				{/if}
			{/if}
		</div>
		{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
	</div>

	<!-- Filter bar: search + status chips + env chips + clear -->
	{#if cards.length > 0}
		<div class="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search rollouts…"
					class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				{#each [{key:'failed', label:'Failed', dot:'bg-red-500'}, {key:'active', label:'Deploying', dot:'bg-yellow-400'}, {key:'pending', label:'Pending', dot:'bg-gray-400'}, {key:'succeeded', label:'Healthy', dot:'bg-green-500'}] as p}
					{@const k = p.key as StatusKey}
					{@const sel = statusFilters.includes(k)}
					{@const n = counts[k]}
					{#if n > 0}
						<button
							type="button"
							onclick={() => toggleStatus(k)}
							class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors
								{sel
									? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
									: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/60'}"
						>
							<span class="h-1.5 w-1.5 rounded-full {p.dot}"></span>
							{n} {p.label}
						</button>
					{/if}
				{/each}
			</div>
			{#if knownEnvs.length > 1}
				<div class="flex flex-wrap items-center gap-1">
					{#each knownEnvs as e}
						<button
							type="button"
							onclick={() => toggleEnv(e.key)}
							class="environment-theme-scope environment-theme-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity {envFilters.includes(e.key) ? 'ring-2 ring-gray-900/20 dark:ring-gray-100/20' : 'opacity-60 hover:opacity-100'}"
							style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
						>{e.display}</button>
					{/each}
				</div>
			{/if}
			{#if envFilters.length > 0 || statusFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-8">
			{#each Array(2) as _}
				<div>
					<div class="mb-3 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="h-3 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-4 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each Array(3) as _}
							<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
								<div class="flex items-center justify-between gap-2">
									<div class="h-3.5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-4 w-10 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
								</div>
								<div class="mt-3 flex items-center justify-between pl-4">
									<div class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
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
			<GridOutline class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
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
		<div class="space-y-8">
			{#each grouped as g (g.ns)}
				<section>
					<!-- Namespace header: subtle, single click target -->
					<a
						href={`/namespaces/${g.ns}`}
						class="group mb-3 flex items-center justify-between gap-2 border-b border-gray-100 pb-2 dark:border-gray-700/60"
					>
						<div class="flex min-w-0 items-baseline gap-2">
							<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
							<span class="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{g.cards.length}</span>
							{#if g.failedCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400">· {g.failedCount} failed</span>
							{:else if g.activeCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-yellow-700 dark:text-yellow-400">· {g.activeCount} deploying</span>
							{:else if g.pendingCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">· {g.pendingCount} pending</span>
							{/if}
						</div>
						<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
					</a>

					<!-- Rollouts grid -->
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each g.cards as c (c.ns + '/' + c.name)}
							<a
								href={`/rollouts/${c.ns}/${c.name}`}
								class="environment-theme-scope group flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
								style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
							>
								<!-- Title row: status dot, name, env badge -->
								<div class="flex min-w-0 items-center justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<span class="relative flex h-2 w-2 shrink-0">
											{#if c.isRunning}
												<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[c.bakeStatus]}"></span>
											{/if}
											<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[c.bakeStatus] ?? STATUS_DOT.None}"></span>
										</span>
										<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
									</div>
									{#if c.envDisplay}
										<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{c.envDisplay}</span>
									{/if}
								</div>

								<!-- Meta row: version + timestamp + pin -->
								<div class="flex min-w-0 items-baseline justify-between gap-2 pl-4">
									<div class="flex min-w-0 items-baseline gap-1.5">
										<span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">{c.version ?? '—'}</span>
										{#if c.pinnedVersion}
											<span
												class="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
												title={`Pinned to ${c.pinnedVersion}`}
											>·  pin</span>
										{/if}
									</div>
									{#if c.timestamp}
										<span class="shrink-0 font-mono text-[10px] {c.isRunning ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'}" title={formatTimeAgo(c.timestamp, $now)}>
											{formatStatusTime(c.bakeStatus, c.timestamp, $now)}
										</span>
									{/if}
								</div>

								{#if c.failureCategory}
									<div class="truncate pl-4 text-[10px] text-red-700 dark:text-red-300" title={c.bakeStatusMessage ?? ''}>
										{c.failureCategory} failed{#if c.previousSucceededVersion}
											<span class="text-red-500/70 dark:text-red-400/70"> · was <span class="font-mono">{c.previousSucceededVersion}</span></span>
										{/if}
									</div>
								{:else if c.behind}
									<div class="truncate pl-4 text-[10px] text-orange-700 dark:text-orange-300" title={`Behind ${c.behind.version} on ${c.behind.fromEnv}`}>
										{#if c.behind.behindBy && c.behind.behindBy > 0}
											{c.behind.behindBy} {c.behind.behindBy === 1 ? 'version' : 'versions'} behind {c.behind.fromEnv}
										{:else}
											behind {c.behind.fromEnv}
										{/if}
									</div>
								{/if}
							</a>
						{/each}
					</div>

				</section>
			{/each}
		</div>
	{/if}
</div>
