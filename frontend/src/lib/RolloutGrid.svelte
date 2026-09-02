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
	import { checkFailureTitle } from '$lib/view-models/health-witness';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { SearchOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import ClusterMark from '$lib/components/ClusterMark.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../types';
	import { rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

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

	// Derive the label for a rollout's cluster.
	//
	// ⛔ THE NAME FIRST, THE URL ONLY AS A FALLBACK. (2026-08-31)
	// `source-dashboard.ts` says it in its own header: the hub stamps the
	// cluster NAME "used for name-based routing" and the dashboard URL is
	// "legacy; kept for compatibility". This function read only the legacy one,
	// so a rollout carrying `source-cluster` and no `source-dashboard` produced
	// an EMPTY label — and `<ClusterMark>` then rendered the word `cluster`
	// with nothing after it, with a `title` reading `Cluster  — the Kubernetes
	// cluster these rollouts run on`. A label that names nothing is worse than
	// no label: it tells the reader the answer is on screen.
	//
	// `rolloutPath()` already routes on `c.sourceCluster`, so reading it here
	// also means the name in the header is the name in the URL.
	function clusterLabelForCard(c: RolloutCard): string {
		if (c.sourceCluster) return c.sourceCluster;
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
			//
			// ⛔ THE KEY IS THE CLUSTER'S IDENTITY, NOT ONE OF ITS TWO NAMES.
			// (2026-08-31) It was `sourceURL` alone — the LEGACY annotation — so
			// two rollouts with the same name in the same namespace on two
			// clusters, stamped with `source-cluster` and no `source-dashboard`,
			// collapsed into one group. The `{#each ... (key)}` below then threw
			// `each_key_duplicate` and `/rollouts` rendered nothing at all. The
			// hub/spoke topology is exactly where that pair of rollouts exists.
			const groupKey = (c.sourceCluster || c.sourceURL || '') + '|' + c.ns;
			let g = map.get(groupKey);
			if (!g) {
				const cURL = c.sourceURL || localClusterURL;
				const cLabel = clusterLabelForCard(c);
				g = { ns: c.ns, clusterURL: cURL, clusterLabel: cLabel, cards: [], attentionCount: 0 };
				map.set(groupKey, g);
			}
			g.cards.push(c);
			// ⛔ `isNeedsYou`, NOT A THIRD COPY OF IT. (2026-08-31) This counter and
			// the sort below each open-coded `failed || stuck`, so when the shared
			// predicate learned about failing health checks these two did not: the
			// `Attention` pill above would have said 1 while the group header
			// directly over the row still said `4 rollouts` with no `need
			// attention` clause, and the row would have sorted to the bottom of its
			// own namespace. One page, two answers — the exact shape
			// `fleet-groups.ts` was extracted to end.
			if (isNeedsYou(c)) g.attentionCount++;
		}
		for (const g of map.values()) {
			g.cards.sort((a, b) => {
				const as = isNeedsYou(a) ? 0 : 1;
				const bs = isNeedsYou(b) ? 0 : 1;
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

	// The head band's rollup — SCALE AND SPREAD, over the unfiltered set. It is
	// deliberately NOT the severity partition: `Attention 0 · In motion 0 ·
	// Pending 0 · Trailing 3 · Steady 12` is already drawn 20px below as the
	// filter pills, and a second object reading the same array is the thing
	// this page's own rules cut. The total and the number of namespaces and
	// clusters it spans appear nowhere else on the page.
	const nsSpread = $derived(
		new Set(cards.map((c) => (c.sourceCluster || c.sourceURL || '') + '|' + c.ns)).size
	);
	const clusterSpread = $derived(new Set(cards.map((c) => clusterLabelForCard(c))).size);


</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ THE HEAD BAND ════════════════════════════════════════════════════
	     ⛔ THE DRAWN `Rollouts` TITLE IS GONE. (2026-09-01, from the human:
	     *"environments and rollouts still have a heading"*, against the rule
	     already recorded for `/apps`, `/versions` and rollout detail's History
	     tab: **a page title that repeats the navbar is a duplicate, not a
	     heading.**) `Navbar.svelte` prints `Rollouts` at 17px twenty-five pixels
	     above this line, and the `h1` printed the same word again at 24px — the
	     largest type on the page spent on the thing the reader just clicked.

	     IT IS STILL AN `h1`, JUST NOT A DRAWN ONE. `sr-only` is a 1px clip, so
	     the skip link still lands on a level-1 heading and
	     `a11y.svelte.test.ts`'s heading-structure assertions still pass.

	     WHAT FILLS THE SLOT IS THE ROLLUP, AT THE 24px ROLE THE WORD HELD —
	     the shape `/activity` uses (`47` beside its sentence). Removing a title
	     without replacing its type role is what left `/apps` running 16 → 10
	     where the grammar asks for 24 → 10; this page keeps 24 → 9.

	     ⚠️ THE FILTER/COUNTER ROW BELOW IS UNTOUCHED AND STAYS AT y=72. It is
	     a control, not a heading: a search input and eleven chips at the top of
	     the page would not read as one, and it is the one row here that must be
	     free to wrap. Everything below y=72 on this page is byte-identical. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Rollouts</h1>
		{#if cards.length > 0}
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{cards.length}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				rollout{cards.length === 1 ? '' : 's'} in {nsSpread}
				namespace{nsSpread === 1 ? '' : 's'}{clusterSpread > 1
					? ` · ${clusterSpread} clusters`
					: ''}
			</p>
		{/if}
	</div>

	<!--
		⛔ THIS WAS A 12px AMBER ASIDE READING `<name> unreachable — <error>`, AND
		IT WAS THE ONLY THING ON THE PAGE SAYING THE COUNTS ABOVE COVER A SUBSET.
		The hub fails soft, so `/rollouts` can be partly true; a whisper next to a
		header that says `Attention 0` is not a correction, it is a footnote to a
		wrong number. `PartialDataNotice` is the same `AlertPanel` every other
		blocking fact in the product uses.
	-->
	<PartialDataNotice
		errors={clusterErrors}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

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
			<!--
				⛔ FIVE CHIPS WHOSE ACCESSIBLE NAMES WERE `prod`, `dev`, `dev`,
				`staging`, `prod`. (2026-08-31)

				Two families — clusters and environments — rendered adjacent with
				nothing but a 1px divider between them, so the SAME WORD appeared
				twice meaning two different things, and at 390 they wrapped into
				three mixed rows with an orphaned `PROD` on the last and the
				divider dangling at the end of a line.

				THE ROW IS THREE WRAP GROUPS NOW, not one run of eleven items.
				Each family is its own `flex-wrap` container separated by
				`gap-x-4`, so a family wraps INSIDE itself and can never leave one
				member stranded on a line belonging to another family. The two
				divider rules are gone with it: they were doing the separating,
				badly, and `<ClusterMark>` now says `cluster` in words.

				NO LABEL COLUMN, NO DROPDOWN, NO `All` PILL — the standing rules
				for this page hold. The label lives INSIDE the chip, which is the
				chip's own content, not a second column.
			-->
			<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
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
			</div>
			{#if isMultiCluster && allClusters.length > 0}
				<div class="flex flex-wrap items-center gap-1.5">
					{#each allClusters as cl}
						{@const sel = clusterFilters.includes(cl.url)}
						<button
							type="button"
							onclick={() => toggleCluster(cl.url)}
							aria-pressed={sel}
							class="inline-flex items-center rounded-full border px-2.5 py-1 transition-colors
								{sel
									? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
									: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
						>
							<ClusterMark name={cl.name} />
						</button>
					{/each}
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each knownEnvs as e}
					{@const sel = envFilters.includes(e.key)}
					<button
						type="button"
						onclick={() => toggleEnv(e.key)}
						aria-pressed={sel}
						aria-label={`Environment ${e.display}`}
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
		<StillTryingNotice failureCount={query.failureCount} />
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
		<!--
			⛔ THIS WAS `Failed to load rollouts: Request failed (503)` IN A 14px RED
			BOX AND THAT IS WHAT THE CRITIC SAW AS "a title and nothing else".
			A status code is not what happened; there was no retry, no way out, and
			nothing separating it from the page's own empty state. At 3am a bare
			`/rollouts` reads as *"the cluster has no rollouts"* — the product
			inventing an all-clear out of a failure. `ErrorState` is the product's
			one failed-request object and it guarantees all four parts.
		-->
		<ErrorState
			error={query.error}
			subject="the rollout list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
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
				<!-- ⛔ NOT A FILLED BUTTON. (2026-09-02) This was the darkest,
				     highest-contrast mark on the empty state and all it did was
				     open a README. A fill is reserved for a control that changes
				     what is running; nothing on a page with no rollouts does. -->
				<a
					href="https://github.com/kuberik/rollout-controller"
					target="_blank"
					rel="noopener noreferrer"
					class="nav-link mt-2"
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
			{#each grouped as g (g.clusterLabel + '|' + g.clusterURL + '|' + g.ns)}
				<section>
					<!--
						⛔ THE LEADING WORD IN THIS HEADER USED TO BE THE CLUSTER, AND IT
						WAS READ AS THE ENVIRONMENT. (2026-08-31)

						It rendered `<cluster> / <namespace>` — on the live hub that is
						`dev / hello-world-staging`, with every row inside it correctly
						marked **STAGING**. From the critique: *"An operator scanning at
						3am reads the header."* The two words genuinely differ here (the
						spoke cluster is named `dev` and hosts the staging namespaces),
						so this is not a naming bug to be fixed upstream; the DISPLAY has
						to say which is which.

						THREE CHANGES, and the first one is the fix:

						1. THE NAMESPACE LEADS. Groups are grouped and sorted by
						   namespace, so the namespace is this section's title and the
						   cluster is a qualifier on it. There is no longer a cluster
						   name in first position to be misread — and the sort key now
						   starts at the same x on every group, which it could not do
						   behind a variable-width prefix.
						2. The cluster is a `<ClusterMark>`: the word `cluster`, a server
						   glyph, lowercase — the SAME token the filter row uses, so the
						   two teach each other.
						3. The count moves to a RIGHT-ALIGNED ROLLUP beside the chevron,
						   which is `COMPOSITION-GRAMMAR.md` §1's shape for a titled
						   region and lets a reader take the group's answer without
						   reading a row of it.
					-->
					<a
						href={`/namespaces/${g.ns}`}
						class="group mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-2 dark:border-gray-700/60"
					>
						<div class="flex min-w-0 items-center gap-2">
							<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
							{#if isMultiCluster}
								<ClusterMark name={g.clusterLabel} class="shrink-0 text-gray-500 dark:text-gray-400" />
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span class="text-[11px] text-gray-500 dark:text-gray-400">
								{g.cards.length} rollout{g.cards.length === 1 ? '' : 's'}{#if g.attentionCount > 0}
									· <span class="font-medium text-red-600 dark:text-red-400">{g.attentionCount} need attention</span>
								{/if}
							</span>
							<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200" />
						</div>
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
											<!-- ⛔ THE ROW THAT SAID `deploy succeeded` WHILE THE SLO
											     WAS BLOWN. (2026-08-31) `statusKey` is the DEPLOY's
											     verdict and the deploy did succeed; the check failed
											     after it, and nothing on this card read it. Same slot
											     and same `alarm` Chip as `StuckBadge` — a failing
											     check is not a new severity and must not get a
											     second, weaker geometry. -->
											{#if c.checkFailure}<Chip
													role="alarm"
													label="unhealthy"
													title={checkFailureTitle(c.checkFailure)}
													wide
													class="shrink-0"
												/>{/if}
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
