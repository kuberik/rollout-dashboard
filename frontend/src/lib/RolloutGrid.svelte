<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterInfo, ClusterError } from '$lib/api/rollouts';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { formatTimeAgoCompact, formatDate, shortenVersion } from '$lib/utils';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { buildRolloutCards, cardVerdict, cardStateMark } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle } from '$lib/view-models/env-rank';
	import {
		isNeedsYou,
		isInMotion,
		isTrailing,
		isSteady,
		isPending
	} from '$lib/view-models/fleet-groups';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { SearchOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../types';
	import { rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import { pollWhenHealthy } from '$lib/api/errors';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) } })
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

	// ⛔ THE BUCKETS ARE `/`'S, AND `Healthy` IS SPLIT. (2026-08-31)
	//
	// From a live critique: *"`/rollouts` says the fleet is fine while four
	// other surfaces say it isn't."* The header read
	// `Attention 0 · In motion 1 · Pending 0 · Healthy 14` while
	// `hello-world-app` was behind and gate-blocked in all three environments
	// — and at the same second `/` filed those three under **Trailing**,
	// `/apps` drew an amber banner and `/environments` said "furthest behind:
	// 20 versions". **This is the page an operator opens to scan everything,
	// and it was the one page that could not show a lag.**
	//
	// The cause was one missing distinction, not a different opinion: `/`
	// splits `succeeded && !stuck` into **Trailing** (newer builds it could
	// take) and **Steady** (at the head of its own list); this page folded
	// both into `Healthy`, so the lag had nowhere to be counted. Every
	// predicate now comes from `view-models/fleet-groups.ts`, which is
	// `ControlCenter`'s own code, so the two pages cannot drift.
	//
	// `healthy` survives as a QuickFilter key for `trailing ∪ steady`; nothing
	// selects it, and it is kept only so a saved/deep-linked state that used
	// it still resolves rather than throwing away the filter.
	type QuickFilter = 'all' | 'attention' | 'active' | 'pending' | 'healthy' | 'trailing' | 'steady';
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
			if (quickFilter === 'attention' && !isNeedsYou(c)) return false;
			if (quickFilter === 'active' && !isInMotion(c)) return false;
			if (quickFilter === 'pending' && !isPending(c)) return false;
			if (quickFilter === 'trailing' && !isTrailing(c)) return false;
			if (quickFilter === 'steady' && !isSteady(c)) return false;
			if (quickFilter === 'healthy' && !(isTrailing(c) || isSteady(c))) return false;
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
				return a.name.localeCompare(b.name);
			});
		}
		return [...map.values()].sort(
			(a, b) => a.ns.localeCompare(b.ns) || a.clusterLabel.localeCompare(b.clusterLabel)
		);
	});

	// Quick-filter tile counts, from the full (unfiltered) set of cards. Every
	// predicate is `/`'s — see the note on QuickFilter.
	const attentionCards = $derived.by(() => cards.filter(isNeedsYou));
	const inMotionCards = $derived.by(() => cards.filter(isInMotion));
	const pendingCardsAll = $derived.by(() => cards.filter(isPending));
	const trailingCards = $derived.by(() => cards.filter(isTrailing));
	const steadyCards = $derived.by(() => cards.filter(isSteady));

	// Compact status filter pills (single-select) shown in the filter bar.
	//
	// ⚠️ `Trailing` SITS BETWEEN `Pending` AND `Steady`, IN SEVERITY ORDER, and
	// takes the same amber the product spends on drift everywhere else — NOT
	// red, which belongs to `Attention`. Drift is the normal state of a
	// promotion pipeline; the adverse state is stuck.
	//
	// ⚠️ `Healthy` IS RENAMED `Steady`, NOT REDEFINED IN PLACE. Leaving the
	// word `Healthy` on a count that no longer includes trailing rollouts
	// would be the same defect with a smaller number: an operator who learned
	// that `Healthy 14` means "everything is fine" would read `Healthy 11` the
	// same way. `/` has called this bucket Steady since it was built.
	const statusPills = $derived([
		{ key: 'attention' as QuickFilter, label: 'Attention', count: attentionCards.length, dot: 'bg-red-500' },
		{ key: 'active' as QuickFilter, label: 'In motion', count: inMotionCards.length, dot: 'bg-blue-500' },
		{ key: 'pending' as QuickFilter, label: 'Pending', count: pendingCardsAll.length, dot: 'bg-gray-400' },
		{ key: 'trailing' as QuickFilter, label: 'Trailing', count: trailingCards.length, dot: 'bg-amber-500' },
		{ key: 'steady' as QuickFilter, label: 'Steady', count: steadyCards.length, dot: 'bg-green-700 dark:bg-green-400' }
	]);


</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-4">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">Rollouts</h1>
	</div>

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
				<SearchOutline
					class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
				/>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search rollouts…"
					class="block w-full rounded border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				<!-- Status filter pills (compact, single-select) — replaces the old
				     tile banner while keeping the filtering it provided. -->
				{#each statusPills as sp (sp.key)}
					<button
						type="button"
						onclick={() => (quickFilter = quickFilter === sp.key ? 'all' : sp.key)}
						aria-pressed={quickFilter === sp.key}
						class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors
							{quickFilter === sp.key
								? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
								: 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
					>
						<span class="h-[5px] w-[5px] shrink-0 rounded {sp.dot}"></span>
						{sp.label}
						<!-- No `opacity-60` here. It composited to 2.32:1 in light /
						     3.27:1 in dark at 11px, and dimming instead of explaining is
						     the pattern `DESIGN.md` has now rejected twice (it is why
						     `valueDim` came out of `/envs/[name]`). The count inherits
						     the pill's own ink, which is the muted token in the resting
						     state and the knockout in the selected one - both measured. -->
						<span class="font-mono tabular-nums">{sp.count}</span>
					</button>
				{/each}
				<span class="h-4 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true"></span>
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
						class="environment-theme-scope inline-flex items-center rounded transition-opacity
							{sel
								? 'ring-1 ring-gray-900/30 dark:ring-gray-100/30'
								: envFilters.length === 0
									? ''
									: 'opacity-40 hover:opacity-100'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					><Chip role="env" theme={e.theme} label={e.display} wide /></button>
				{/each}
			</div>
			{#if envFilters.length > 0 || quickFilter !== 'all' || clusterFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
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
								<span class="font-mono text-[11px] text-gray-500 dark:text-gray-400">my-app</span>
							</div>
						</div>
						<span class="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-700 dark:text-gray-300">PROD</span>
					</div>
					<div class="mt-2 flex items-baseline justify-between gap-3 pl-12">
						<span class="font-mono text-sm font-medium text-gray-700 dark:text-gray-300">v1.2.3</span>
						<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400">2h</span>
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
					class="mt-4 inline-flex items-center gap-1.5 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
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
								<span class="shrink-0 font-mono text-[11px] text-gray-500 dark:text-gray-400">{g.clusterLabel}</span>
								<span class="shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true">/</span>
							{/if}
							<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
							<span class="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
								{g.cards.length} rollout{g.cards.length === 1 ? '' : 's'}{#if g.attentionCount > 0}
									· <span class="font-medium text-red-600 dark:text-red-400">{g.attentionCount} need attention</span>
								{/if}
							</span>
						</div>
						<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200" />
					</a>

<!-- Responsive grid of compact rollout cards. State column dropped
					     (redundant with the status circle); cards flow into columns so wide
					     screens are not one stretched row each. -->
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
						{#each g.cards as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
							{@const rolloutHref = rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name)}
							<!-- THE JOINED BUILD BADGE, AND IT IS NOW THE SAME COMPONENT AS
							     EVERY OTHER PAGE'S. This card used to hand-roll it: a
							     `rounded-md` box (a sixth radius against the legal two), a
							     10px bold uppercase label half with a FILL (`bg-gray-100`
							     / `bg-amber-100`), and an 11px mono value half. `/apps`,
							     `/apps/[name]`, `/` and `/versions` all draw the same two
							     facts with `Chip`, at `rounded` 4px, text-only, 11px.
							     Same object, sixth geometry — the exact defect the census
							     exists to catch.
							     The amber fill went with it. With production restored to
							     `#d97706`, an amber `−N` half sat in the same card as an
							     amber-inked `PROD` env chip; `rank` is red now (see
							     `Chip.svelte`) and this card no longer overrides it. -->
							<!-- ⛔ THE VALUE IN THIS BADGE WAS WRONG, AND ON ONE PAGE IT
							     CONTRADICTED ITSELF. (2026-08-30) It read `c.behind`, which
							     counted against the ROLLOUT'S OWN `availableReleases` and
							     returned `null` whenever it could not answer — and `null`
							     fell through to the word `newest` on the line above. On the
							     live hub `hello-world-app` runs the same build `991829b` in
							     dev and staging and this printed `dev −15 991829b` beside
							     `staging newest 991829b`. Same build, adjacent rows, one
							     page, two verdicts.

							     It reads `c.rank` now — `view-models/env-rank.ts`, the ONE
							     denominator, the same object `/apps` and `/environments`
							     print. `unknown` renders the `unranked` role and the WORD
							     `unknown`: DESIGN.md's rule is that an unresolvable
							     comparison never gets rendered as a definite claim, and
							     `newest` was the most definite claim available.

							     GEOMETRY UNCHANGED: same `Chip`, same joined badge, same
							     four roles. Only the number and, for `behind`, the spelling
							     (`−19` → `19 behind`, matching every other page). -->
							{@const verdict = cardVerdict(
								c,
								rankLabel(c.rank),
								rankTitle(c.rank, c.envDisplay || c.name)
							)}
							{@const stateMark = cardStateMark(c)}
							{@const rel =
								c.statusKey === 'pending'
									? { role: 'unranked' as const, txt: 'pending', tip: 'No deploy yet' }
									: {
											role: rankRole(c.rank),
											txt: verdict.label,
											tip: verdict.title
										}}
							<a
								href={rolloutHref}
								class="environment-theme-scope flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
								style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
							>
								<!-- Identity: status circle + metadata.name (+ title) + env badge -->
								<div class="flex items-center gap-2.5">
									<!-- ⛔ THE DISC CARRIES `rolled back` / `pinned` — see
									     `rollout-cards.ts`. It used to be the chip's label, which
									     evicted the rank number from the row entirely. The word may
									     not live in a badge on one list and inside a chip on the
									     other, so `/` does exactly this too. -->
									<span
										class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(c.bakeStatus)}"
										title={stateMark ? stateMark.title : undefined}
									>
										<BakeStatusIcon
											bakeStatus={c.bakeStatus}
											size="medium"
											state={stateMark?.kind ?? null}
											stateWord={stateMark?.word ?? ''}
										/>
									</span>
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-baseline gap-1.5">
											<span class="truncate font-mono text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
											{#if c.stuck}<StuckBadge reason={c.stuck} />{/if}
										</div>
										{#if c.title && c.title !== c.name}<span class="truncate text-[11px] text-gray-500 dark:text-gray-400">{c.title}</span>{/if}
									</div>
									{#if c.envDisplay}
										<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
									{/if}
								</div>
								<!-- Version tag + last change -->
								<div class="flex items-center justify-between gap-2">
									<span class="flex min-w-0 items-center gap-1.5">
										<!-- ⛔ A ROLLBACK USED TO BE INDISTINGUISHABLE FROM A DEPLOY
										     ON EVERY LIST SURFACE. A live UX critique rolled production
										     back to a one-hour-old build and this card drew it exactly
										     like a forward one.

										     THE WORD GOES IN THE CHIP, NOT BESIDE IT. `/`'s row is the
										     tight one — loose `ROLLED BACK` and `PINNED` marks there took
										     the app name's width to ZERO — and a fact spelled two ways on
										     two list surfaces is a fact nobody learns, so both pages state
										     it the same way through `cardVerdict`. That is also why
										     `PinBadge` is gone from HERE: this card had the room, but the
										     word `pinned` may not live in a badge on one list and inside
										     the chip on the other. -->
										<!-- `wide` LIFTS THE 12ch CAP, and it is REQUIRED by the
										     new label. `−19` fit; `19 BEHIND` at the chip's uppercase
										     tracking renders `19 BEHI…`, which is not a word. Same
										     opt-out `/environments` and `/envs/*` already use for
										     this exact string. -->
										<Chip
											role={rel.role}
											label={rel.txt}
											title={rel.tip}
											wide
											value={c.version ? shortenVersion(c.version) : '—'}
											valueTitle={c.version ?? 'no build'}
											valueDim={!c.version}
											class="min-w-0"
										/>
									</span>
									<span class="flex shrink-0 flex-col items-end leading-tight">
										{#if c.timestamp}
											<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400" title={formatDate(c.timestamp)}>{formatTimeAgoCompact(c.timestamp, $now)} ago</span>
											<span class="text-[9px] text-gray-500 dark:text-gray-400">{c.isRunning ? 'started' : 'updated'}</span>
										{:else}
											<span class="text-[10px] text-gray-500 dark:text-gray-400">no deploy</span>
										{/if}
									</span>
								</div>
							</a>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>
