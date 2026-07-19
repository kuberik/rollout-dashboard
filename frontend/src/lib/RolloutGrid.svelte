<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterInfo, ClusterError } from '$lib/api/rollouts';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { formatTimeAgo, formatStatusTime, shortenVersion } from '$lib/utils';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { SearchOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StatusTile from '$lib/components/StatusTile.svelte';
	import LagChip from '$lib/components/LagChip.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { computeBakeProgress } from '$lib/view-models/bake-progress';
	import type { Rollout, Environment } from '../types';
	import { rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const spokeClusters = $derived<ClusterInfo[]>(query.data?.clusters || []);
	const clusterErrors = $derived<ClusterError[]>(query.data?.clusterErrors || []);
	const localClusterURL = $derived<string>(clusterQuery.data?.url || '');

	// True when more than one cluster is represented in the current result set.
	const isMultiCluster = $derived(spokeClusters.length > 0);

	const localClusterName = $derived<string>(clusterQuery.data?.name || clusterLabelFromURL(localClusterURL));

	// All clusters for the filter pills: local + discovered spokes.
	const allClusters = $derived<ClusterInfo[]>([
		{ url: localClusterURL, name: localClusterName },
		...spokeClusters
	].filter((cl) => cl.url));

	function clusterLabelFromURL(rawURL: string): string {
		try {
			const host = new URL(rawURL).hostname;
			if (host.startsWith('kuberik.')) {
				const rest = host.slice('kuberik.'.length);
				const seg = rest.split('.')[0];
				// Skip numeric segments — IP-based dev URLs (nip.io etc.) have no
				// meaningful short form, so use the full hostname instead.
				if (seg && !/^\d+$/.test(seg)) return seg;
			}
			return host || rawURL;
		} catch {
			return rawURL;
		}
	}

	// Derive the label for a rollout's cluster URL.
	function clusterLabelForCard(c: RolloutCard): string {
		const url = c.sourceURL || localClusterURL;
		const found = allClusters.find((cl) => cl.url === url);
		return found?.name || clusterLabelFromURL(url);
	}

	const cards = $derived<RolloutCard[]>(buildRolloutCards(rollouts, environments, $now));

	// Quick filter tiles: All / Needs attention / In motion / Pending / Healthy.
	// Single-select — clicking a tile narrows the list to that bucket, clicking
	// "All" (or the already-selected tile) resets it. "Needs attention" merges
	// failed + stuck cards, mirroring ControlCenter's `needsYou` grouping so the
	// same rollout is triaged consistently across both pages.
	type QuickFilter = 'all' | 'attention' | 'active' | 'pending' | 'healthy';
	let quickFilter = $state<QuickFilter>('all');

	// Filters
	let searchQuery = $state('');
	let envFilters = $state<string[]>([]);
	let clusterFilters = $state<string[]>([]); // set of cluster URLs

	function toggleEnv(name: string) {
		envFilters = envFilters.includes(name)
			? envFilters.filter((x) => x !== name)
			: [...envFilters, name];
	}
	function toggleCluster(url: string) {
		clusterFilters = clusterFilters.includes(url)
			? clusterFilters.filter((x) => x !== url)
			: [...clusterFilters, url];
	}
	function clearFilters() {
		quickFilter = 'all';
		envFilters = [];
		clusterFilters = [];
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
			if (quickFilter === 'attention' && !(c.statusKey === 'failed' || c.stuck != null))
				return false;
			if (quickFilter === 'active' && !c.isRunning) return false;
			if (quickFilter === 'pending' && c.statusKey !== 'pending') return false;
			if (quickFilter === 'healthy' && !(c.statusKey === 'succeeded' && !c.stuck)) return false;
			if (envFilters.length > 0 && !envFilters.includes(c.envKey)) return false;
			if (clusterFilters.length > 0) {
				// Match against the source URL; treat empty/local sourceURL as localClusterURL.
				const cardURL = c.sourceURL || localClusterURL;
				if (!clusterFilters.includes(cardURL)) return false;
			}
			if (q) {
				const hay = `${c.ns} ${c.name} ${c.title} ${c.envKey} ${c.envDisplay} ${c.version ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Group filtered cards by cluster+namespace, sort groups by namespace name
	// (mockup: "grouped by namespace, sorted by ns name"), rows within a group
	// by severity (fail/stuck first) then title.
	type NsGroup = {
		ns: string;
		clusterURL: string; // source dashboard URL (empty = local)
		clusterLabel: string; // short cluster name for display
		cards: RolloutCard[];
		attentionCount: number; // failed + stuck, for the group header meta line
	};

	const grouped = $derived.by<NsGroup[]>(() => {
		const map = new Map<string, NsGroup>();
		for (const c of filtered) {
			// Key by cluster+ns so same namespace on different clusters is separate.
			const groupKey = (c.sourceURL || '') + '|' + c.ns;
			let g = map.get(groupKey);
			if (!g) {
				const cURL = c.sourceURL || localClusterURL;
				const cLabel = clusterLabelForCard(c);
				g = { ns: c.ns, clusterURL: cURL, clusterLabel: cLabel, cards: [], attentionCount: 0 };
				map.set(groupKey, g);
			}
			g.cards.push(c);
			if (c.statusKey === 'failed' || c.stuck) g.attentionCount++;
		}
		for (const g of map.values()) {
			g.cards.sort((a, b) => {
				const as = a.statusKey === 'failed' || a.stuck ? 0 : 1;
				const bs = b.statusKey === 'failed' || b.stuck ? 0 : 1;
				if (as !== bs) return as - bs;
				return a.title.localeCompare(b.title);
			});
		}
		return [...map.values()].sort(
			(a, b) => a.ns.localeCompare(b.ns) || a.clusterLabel.localeCompare(b.clusterLabel)
		);
	});

	// Quick-filter tile counts, from the full (unfiltered) set of cards —
	// "Needs attention" mirrors ControlCenter's needsYou grouping.
	const attentionCards = $derived.by(() => cards.filter((c) => c.statusKey === 'failed' || c.stuck != null));
	const inMotionCards = $derived.by(() => cards.filter((c) => c.isRunning));
	const pendingCardsAll = $derived.by(() => cards.filter((c) => c.statusKey === 'pending'));
	const healthyCards = $derived.by(() => cards.filter((c) => c.statusKey === 'succeeded' && !c.stuck));

	const namespaceCount = $derived(new Set(cards.map((c) => c.ns)).size);

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

	// Row "State" line: lifecycle status text per mockup examples ("failing",
	// "deploying", "baking · Nm left", "on newest"). Independent of the
	// "Relative position" column, which conveys version currency instead.
	function stateLine(c: RolloutCard): { text: string; tone: string } {
		if (c.statusKey === 'failed') return { text: 'failing', tone: 'text-red-600 dark:text-red-400' };
		if (c.bakeStatus === 'Deploying') {
			return { text: 'deploying', tone: 'text-blue-600 dark:text-blue-400' };
		}
		if (c.bakeStatus === 'InProgress') {
			const start = c.rollout.status?.history?.[0]?.bakeStartTime;
			const bakeTime = c.rollout.spec?.bakeTime;
			const progress = computeBakeProgress(start, bakeTime, $now);
			if (progress) {
				const remainingMin = Math.round(Math.max(0, progress.totalMs - progress.elapsedMs) / 60000);
				return {
					text: remainingMin > 0 ? `baking · ${remainingMin}m left` : 'baking · <1m left',
					tone: 'text-yellow-700 dark:text-yellow-400'
				};
			}
			return { text: 'baking', tone: 'text-yellow-700 dark:text-yellow-400' };
		}
		if (c.statusKey === 'pending') return { text: 'no deploy', tone: 'text-gray-400 dark:text-gray-500' };
		return { text: 'on newest', tone: 'text-green-600 dark:text-green-400' };
	}
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header: title + link back to the fleet overview. -->
	<div class="mb-1 flex items-baseline justify-between gap-3">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">Rollouts</h1>
		<a href="/" class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
			Control Center <ChevronRightOutline class="h-3 w-3" />
		</a>
	</div>

	<!-- Sub line: binding/namespace counts on the left, 24h deploy volume on
	     the right (per design — no refetch spinner, refetches happen silently). -->
	{#if cards.length > 0}
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<p class="text-xs text-gray-500 dark:text-gray-400">
				{cards.length} app·env binding{cards.length === 1 ? '' : 's'} · {namespaceCount} namespace{namespaceCount === 1 ? '' : 's'}
			</p>
			{#if recent24h > 0}
				<a href="/activity" class="hidden items-center gap-2 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 sm:inline-flex" title="View activity">
					<span class="font-mono uppercase tracking-wider">last 24h</span>
					<DeployVolumeSparkline {rollouts} hours={24} buckets={20} />
					<span class="font-mono tabular-nums">{recent24h} deploy{recent24h === 1 ? '' : 's'}</span>
				</a>
			{/if}
		</div>
	{/if}

	<!-- Filter tiles: All / Needs attention / In motion / Pending / Healthy.
	     Single-select — click a tile to narrow the list, "All" resets. -->
	{#if cards.length > 0}
		{@const tiles = [
			{ key: 'all' as QuickFilter, label: 'All', count: cards.length, color: 'gray' as const },
			{ key: 'attention' as QuickFilter, label: 'Needs attention', count: attentionCards.length, color: 'red' as const },
			{ key: 'active' as QuickFilter, label: 'In motion', count: inMotionCards.length, color: 'blue' as const },
			{ key: 'pending' as QuickFilter, label: 'Pending', count: pendingCardsAll.length, color: 'gray' as const },
			{ key: 'healthy' as QuickFilter, label: 'Healthy', count: healthyCards.length, color: 'green' as const }
		]}
		<div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
			{#each tiles as t (t.key)}
				<StatusTile
					n={t.count}
					label={t.label}
					color={t.color}
					selected={quickFilter === t.key}
					tone={t.key === 'attention' && t.count > 0 ? 'fail' : 'default'}
					disabled={t.key !== 'all' && t.count === 0}
					onclick={() => (quickFilter = t.key)}
				/>
			{/each}
		</div>
	{/if}

	<!-- Cluster error banner — soft warning, not in the red attention strip. -->
	{#if clusterErrors.length > 0}
		<div class="mb-4 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/10">
			{#each clusterErrors as ce}
				<div class="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
					<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
					</svg>
					<span><span class="font-semibold">{ce.name}</span> unreachable — {ce.error}</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Filter bar: search + compact env filter pills + cluster filter pills (per design). -->
	{#if cards.length > 0}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search rollouts…"
					class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				{#if isMultiCluster}
					{#each allClusters as cl}
						{@const sel = clusterFilters.includes(cl.url)}
						<button
							type="button"
							onclick={() => toggleCluster(cl.url)}
							aria-pressed={sel}
							class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors
								{sel
									? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
									: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
						>
							<svg class="h-2 w-2 shrink-0" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4"/></svg>
							{cl.name}
						</button>
					{/each}
					{#if allClusters.length > 0}
						<span class="h-4 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true"></span>
					{/if}
				{/if}
				{#each knownEnvs as e}
					{@const sel = envFilters.includes(e.key)}
					<button
						type="button"
						onclick={() => toggleEnv(e.key)}
						aria-pressed={sel}
						class="environment-theme-scope inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors
							{sel
								? 'environment-theme-badge'
								: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					>{e.display}</button>
				{/each}
			</div>
			{#if envFilters.length > 0 || quickFilter !== 'all' || clusterFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-6">
			{#each Array(2) as _}
				<div>
					<div class="mb-3 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="h-3 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-4 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each Array(3) as _}
								<li class="flex items-center gap-4 px-5 py-4">
									<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
									<div class="flex flex-1 flex-col gap-1.5">
										<div class="h-3.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
									</div>
									<div class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-4 w-12 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load rollouts: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<!-- Faded sample card preview showing what a rollout looks like -->
			<div class="pointer-events-none relative mx-auto w-full max-w-sm select-none opacity-60 grayscale" aria-hidden="true">
				<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class="inline-flex h-9 w-9 items-center justify-center rounded-full {getStatusCircleClass('Succeeded')}">
								<BakeStatusIcon bakeStatus="Succeeded" size="medium" />
							</span>
							<div class="flex flex-col">
								<span class="text-base font-bold text-gray-900 dark:text-white">My App</span>
								<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">my-app</span>
							</div>
						</div>
						<span class="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-700 dark:text-gray-300">PROD</span>
					</div>
					<div class="mt-2 flex items-baseline justify-between gap-3 pl-12">
						<span class="font-mono text-sm font-medium text-gray-700 dark:text-gray-300">v1.2.3</span>
						<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">2h</span>
					</div>
				</div>
			</div>
			<!-- Empty state message + CTA -->
			<div class="mt-8 text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No rollouts yet</p>
				<p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400 mx-auto">Cards like the one above will appear here once you create a <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code> resource in your cluster.</p>
				<a
					href="https://github.com/kuberik/rollout-controller"
					target="_blank"
					rel="noopener noreferrer"
					class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
				>
					Read the docs
					<span aria-hidden="true">↗</span>
				</a>
			</div>
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
			{#each grouped as g (g.clusterURL + '|' + g.ns)}
				<section>
					<!-- Namespace header: shows cluster prefix when multi-cluster. -->
					<a
						href={`/namespaces/${g.ns}`}
						class="group mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-2 dark:border-gray-700/60"
					>
						<div class="flex min-w-0 items-baseline gap-2">
							{#if isMultiCluster}
								<span class="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">{g.clusterLabel}</span>
								<span class="shrink-0 text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
							{/if}
							<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
							<span class="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
								{g.cards.length} rollout{g.cards.length === 1 ? '' : 's'}{#if g.attentionCount > 0}
									· <span class="font-medium text-red-600 dark:text-red-400">{g.attentionCount} need attention</span>
								{/if}
							</span>
						</div>
						<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
					</a>

					<!-- Rollouts panel with column headers + fixed-width rows so
					     all rollouts in this namespace align across columns. -->
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<!-- Column header row (lg only) -->
						<div class="row-grid hidden gap-x-4 border-b border-gray-100 px-5 py-2 font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:border-gray-700/60 dark:text-gray-500 lg:grid">
							<span></span>
							<span>Rollout</span>
							<span>State</span>
							<span class="text-right">Relative position</span>
							<span class="text-right">Build</span>
							<span class="text-center">Env</span>
						</div>
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each g.cards as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
								{@const rolloutHref = rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name)}
								{@const state = stateLine(c)}
								<li class="environment-theme-scope" style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}>
									<div class="relative row-grid gap-x-4 gap-y-2 px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 sm:px-5">
										<!-- Whole-row link: an absolute overlay so any click on the
										     row (except the version link below) opens the rollout
										     detail. Interactive children must stay `relative z-10`. -->
										<a href={rolloutHref} class="absolute inset-0 z-0" aria-label="Open rollout {c.name}"></a>

										<!-- Status circle. No animate-ping halo on list rows — the
										     icon (pulse for bake, spinner for deploy) is enough
										     signal; the halo at row scale read as "too much". -->
										<span class="pointer-events-none relative z-[1] col-start-1 row-span-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(c.bakeStatus)} sm:row-span-1">
											<BakeStatusIcon bakeStatus={c.bakeStatus} size="medium" />
										</span>

										<!-- Rollout: title (primary) + app name (mono, secondary). -->
										<div class="pointer-events-none relative z-[1] flex min-w-0 flex-col">
											<div class="flex min-w-0 items-baseline gap-2">
												<span class="truncate text-base font-semibold text-gray-900 dark:text-white">{c.title}</span>
												{#if c.stuck}<StuckBadge reason={c.stuck} size="xs" />{/if}
											</div>
											<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{c.name}</span>
										</div>

										<!-- State: deploy lifecycle status line. lg only — the
										     status circle + StuckBadge already carry the essential
										     signal at narrower widths. -->
										<div class="pointer-events-none relative z-[1] hidden shrink-0 flex-col lg:flex">
											<span class="text-xs font-medium {state.tone}">{state.text}</span>
											{#if c.failureCategory}
												<span class="truncate text-[10px] text-red-500/80 dark:text-red-400/70" title={c.bakeStatusMessage ?? ''}>{c.failureCategory}</span>
											{/if}
										</div>

										<!-- Relative position: version currency vs. the upstream env
										     it trails, independent of the State column. -->
										<div class="pointer-events-none relative z-[1] hidden shrink-0 flex-col items-end lg:flex">
											{#if c.statusKey === 'pending'}
												<span class="text-xs text-gray-400 dark:text-gray-500">—</span>
											{:else if c.behind}
												{#if c.behind.behindBy}
													<LagChip behindBy={c.behind.behindBy} />
												{:else}
													<span class="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">behind</span>
												{/if}
												<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">{c.behind.fromEnv}</span>
											{:else}
												<span class="text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">newest</span>
											{/if}
										</div>

										<!-- Build: version + age (right side). `min-w-0` on the
										     version span itself is required for `truncate` to
										     ellipsize inside flex parents — without it, long
										     versions (full git SHAs, pinned tags with hex
										     suffixes) overflow the column. `shortenVersion`
										     trims obvious SHA-like values for compactness; the
										     full string is preserved in the `title` attribute.
										     Stays `pointer-events-auto relative z-10` (opting back
										     in above the row overlay link) so the version itself
										     can link to its own detail page. -->
										<div class="pointer-events-auto relative z-10 col-start-2 row-start-2 flex min-w-0 flex-col sm:col-start-auto sm:row-start-auto sm:items-end">
											<div class="flex min-w-0 max-w-full items-baseline gap-1.5">
												{#if c.pinnedVersion}<PinBadge version={c.pinnedVersion} size="xs" />{/if}
												{#if c.version}
													<a href={versionPathForRollout(c.rollout, c.name, c.version)} class="min-w-0 truncate font-mono text-sm font-medium text-gray-900 hover:underline dark:text-white" title={c.version}>{shortenVersion(c.version)}</a>
												{:else}
													<span class="min-w-0 truncate font-mono text-sm font-medium text-gray-900 dark:text-white">—</span>
												{/if}
											</div>
											{#if c.timestamp}
												<span class="font-mono text-[10px] {c.isRunning ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}" title={formatTimeAgo(c.timestamp, $now)}>
													{c.isRunning ? 'started ' : ''}{formatStatusTime(c.bakeStatus, c.timestamp, $now)}
												</span>
											{:else}
												<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">no deploy</span>
											{/if}
										</div>

										<!-- Env badge -->
										{#if c.envDisplay}
											<span class="pointer-events-none relative z-[1] environment-theme-badge inline-flex shrink-0 items-center justify-self-center rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{c.envDisplay}</span>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>
