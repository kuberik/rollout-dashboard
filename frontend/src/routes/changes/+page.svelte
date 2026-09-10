<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/changes` — THE INDEX. CHANGES-2026-09-10.md §3.
	 *
	 * Merged changes, newest first, across every repo this cluster deploys,
	 * by everyone — a merged pull request or a bare commit on the base
	 * branch. Filters are multi-select chips, no dropdown, no "All" pill
	 * (standing rule): `Mine` · one chip per repo · `Not yet everywhere`.
	 * `?q=` searches title, `#n` and sha. All four live in the URL (`?mine`,
	 * `?repo=`, `?pending`, `?q=`), the pattern `/activity` and `/revisions`
	 * already use.
	 *
	 * ⭐ GITHUB NOT CONFIGURED OR NOT CONNECTED STILL RENDERS A USEFUL INDEX
	 * (§3's own "honest degrade, not an empty page"). The live demo cluster
	 * is in exactly that state: `buildLedgerChangeRows` falls back to the
	 * ledger's own truth — one row per revision this cluster's services
	 * actually deployed, no author, no PR link, no landing grid (there is no
	 * GitHub metadata here to build either from) — and the head band says so
	 * once. No filters, no search on that path: there is no title/author/PR
	 * number to filter or search over yet, only a revision and a sha.
	 *
	 * `w-full px-4 py-6 sm:px-6` — full width is the product rule (lib/CLAUDE.md
	 * "Pages use the full width"); no `max-w-*` on a route container.
*/
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { isEventStreamHealthy } from '$lib/api/events';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { changesQueryOptions } from '$lib/api/changes';
	import {
		buildChangeRows,
		buildLedgerChangeRows,
		filterChangeRows,
		repoChipOptions,
		groupByDay,
		summarizeChangeRows,
		type ChangeRowVM,
		type LedgerChangeRow
	} from '$lib/view-models/changes';
	import { now } from '$lib/stores/time';
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getScrollPosition, scrollMemoryKey } from '$lib/scroll-memory';
	import { CodePullRequestOutline, GithubSolid } from 'flowbite-svelte-icons';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import ChangeRow from '$lib/components/ChangeRow.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: staleTimeWhenHealthy(10000, 30000),
				refetchInterval: pollWhenHealthy(10000, 60000)
			}
		})
	);
	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const rolloutDependencies = $derived(query.data?.rolloutDependencies ?? null);

	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const configured = $derived(githubStatus.data?.configured ?? false);
	const connected = $derived(githubStatus.data?.connected ?? false);

	const changesQuery = createQuery(() => changesQueryOptions({ days: 30, enabled: connected }));

	const allRows = $derived<ChangeRowVM[]>(
		connected
			? buildChangeRows(changesQuery.data?.changes ?? [], rollouts, environments, rolloutDependencies, $now)
			: []
	);
	const currentUser = $derived(changesQuery.data?.user ?? '');

	const ledgerRows = $derived<LedgerChangeRow[]>(
		!configured || !connected ? buildLedgerChangeRows(rollouts, environments) : []
	);

	/* ── FILTERS — ALL URL-BACKED, THE `/activity`/`/revisions` PATTERN ── */

	let mine = $state(page.url.searchParams.has('mine'));
	let pendingOnly = $state(page.url.searchParams.has('pending'));
	// ⛔ FIX PASS ITEM 5, 2026-09-10 — "Pull requests", `changes.ts`'s own
	// `ChangesFilter.kind`. `?pr` in the URL, the same "unset = no chip
	// selected" convention every other multi-select filter here uses.
	let prOnly = $state(page.url.searchParams.has('pr'));
	let selectedRepos = $state<string[]>(
		(page.url.searchParams.get('repo') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);
	let searchQuery = $state(page.url.searchParams.get('q') ?? '');

	$effect(() => {
		const original = page.url.searchParams.toString();
		const params = new URLSearchParams(page.url.searchParams);
		mine ? params.set('mine', '') : params.delete('mine');
		pendingOnly ? params.set('pending', '') : params.delete('pending');
		prOnly ? params.set('pr', '') : params.delete('pr');
		if (selectedRepos.length > 0) params.set('repo', selectedRepos.join(','));
		else params.delete('repo');
		const trimmedQ = searchQuery.trim();
		if (trimmedQ) params.set('q', trimmedQ);
		else params.delete('q');
		const qs = params.toString();
		if (qs === original) return;
		goto(qs ? `?${qs}` : '?', { replaceState: true, noScroll: true, keepFocus: true });
	});

	function toggleMine() {
		mine = !mine;
	}
	function togglePending() {
		pendingOnly = !pendingOnly;
	}
	function togglePrOnly() {
		prOnly = !prOnly;
	}
	function toggleRepo(repoKey: string) {
		selectedRepos = selectedRepos.includes(repoKey)
			? selectedRepos.filter((r) => r !== repoKey)
			: [...selectedRepos, repoKey];
	}

	const repoOptions = $derived(repoChipOptions(allRows));

	const filteredRows = $derived(
		filterChangeRows(allRows, currentUser, {
			mine,
			repos: selectedRepos,
			pendingOnly,
			kind: prOnly ? 'pr' : undefined,
			q: searchQuery
		})
	);

	const dayGroups = $derived(groupByDay(filteredRows, (r) => r.mergedAt, $now));
	const ledgerDayGroups = $derived(groupByDay(ledgerRows, (r) => r.createdAt, $now));

	/**
	 * ⛔ FIX PASS ITEM 5, 2026-09-10 — THE HEAD BAND READS THE FILTERED
	 * SUMMARY (`summarizeChangeRows`, ruling 5), not `allRows`. A reader who
	 * has narrowed to one repo's chip should see THAT repo's own "N not
	 * everywhere yet · M repositories" count, not the whole cluster's —
	 * otherwise the repo count in the sentence never matches the number of
	 * repo chips actually selected.
	 */
	const summary = $derived(summarizeChangeRows(filteredRows));
	const notEverywhereCount = $derived(summary.notEverywhereCount);
	const repoCount = $derived(summary.repoCount);
	const streamHealthy = $derived(isEventStreamHealthy());

	const anyFilterActive = $derived(
		mine || pendingOnly || prOnly || selectedRepos.length > 0 || searchQuery.trim().length > 0
	);

	/* ── SKELETON SHAPE ── */
	const SHAPE_KEY = 'changes';
	type Shape = { rows: number };
	const remembered = recallShape<Shape>(SHAPE_KEY);
	const skelRowCount = remembered?.rows ?? 5;

	$effect(() => {
		if (query.isLoading || query.isError) return;
		if (connected && changesQuery.isLoading) return;
		rememberShape(SHAPE_KEY, { rows: Math.min(allRows.length || ledgerRows.length, 20) });
	});

	/**
	 * ⛔ `githubStatus.isLoading` IS UNCONDITIONAL — NOT GATED ON `configured`.
	 * `configured` DEFAULTS TO `false` (`githubStatus.data?.configured ?? false`)
	 * before the query has ever resolved, so a `configured && githubStatus.isLoading`
	 * guard is false from the very first render — the "not configured" branch
	 * below renders immediately, for the ~200ms the status query is actually
	 * in flight, then the real content replaces it. Fixed 2026-09-10 (fix
	 * pass, item 1): wait on `githubStatus.isLoading` itself, regardless of
	 * what `configured` currently defaults to.
	 *
	 * ⛔ MUST ALSO WAIT ON `changesQuery`, NOT JUST `query`/`githubStatus`.
	 * `changesQuery` only turns `enabled` once `connected` resolves `true`,
	 * so there is a real window — `githubStatus` settled, `changesQuery`
	 * has not even started fetching yet — where `configured && connected`
	 * is true and `allRows` is still `[]`. Without this, the page rendered
	 * "every change has landed everywhere" for a moment before the real 47
	 * held/pending changes arrived: an empty state flashing ahead of data,
	 * the exact class of bug `feedback_navigation_and_loading_states.md`
	 * names ("no late pop-in without a reserved placeholder").
	 */
	const isLoading = $derived(
		query.isLoading || githubStatus.isLoading || (connected && changesQuery.isLoading)
	);

	/**
	 * ⛔ FIX PASS ITEM 5, 2026-09-10 — BACK TO `/changes` RESTORES SCROLL.
	 * The root layout's own `scroll-memory.ts` already retries
	 * `main.scrollTop = target` for ~500ms on a `popstate` arrival — long
	 * enough for most pages, whose list is already in the DOM (even if
	 * still fetching fresh data). This page's own list MOUNTS AFTER TWO
	 * SEQUENTIAL QUERIES SETTLE (`githubStatus`, then `changesQuery` once
	 * `connected` resolves — see `isLoading`'s own doc comment above), which
	 * on a cold cache can outlast that 500ms window: the skeleton's
	 * `recallShape` reserves roughly the right ROW COUNT, but `<main>` is
	 * still short while `isLoading` is `true`, so the layout's retry gives
	 * up before there is anything to scroll into. This is the same defect
	 * class the layout's own comment names ("a popstate arrival can land
	 * here before the new page's own data has loaded") — this page's own
	 * fix, gated on ITS OWN `isLoading` settling rather than a fixed clock,
	 * so it succeeds regardless of how long the two queries take.
	 */
	let pendingScrollRestore = $state<number | null>(null);

	afterNavigate((nav) => {
		if (nav.type !== 'popstate') return;
		pendingScrollRestore = getScrollPosition(scrollMemoryKey(page.url)) ?? null;
	});

	$effect(() => {
		if (pendingScrollRestore == null || isLoading) return;
		const target = pendingScrollRestore;
		pendingScrollRestore = null;
		const main = document.querySelector('main');
		if (!main) return;
		// One more tick past the query settling so the just-rendered list (not
		// the skeleton) has its final height before the scrollTop is set.
		tick().then(() => {
			main.scrollTop = target;
		});
	});
</script>

<svelte:head>
	<title>kuberik | Changes</title>
</svelte:head>

<div class="w-full px-4 py-6 sm:px-6">
	<h1 class="sr-only">Changes</h1>

	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		{#if isLoading}
			<span class="skel-block h-7 w-8" aria-hidden="true"></span>
			<span class="skel-block h-3.5 w-56" aria-hidden="true"></span>
		{:else if configured && !connected}
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				GitHub is not connected — showing what this cluster has actually deployed instead.
			</p>
		{:else if !configured}
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				GitHub is not configured for this dashboard — showing what this cluster has actually
				deployed instead.
			</p>
		{:else if notEverywhereCount > 0}
			<!-- ⭐ FIX PASS ITEM 6 (2026-09-10). "N changes · M not everywhere
			     yet · R repositories" — N (`summary.count`) is the FILTERED
			     total, M (`notEverywhereCount`) the subset of it that is not
			     everywhere yet, both from the SAME `summarizeChangeRows`
			     call above (never a bare "N … are not everywhere yet" whose
			     one number is ambiguous about which count it names). -->
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{summary.count}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				change{summary.count === 1 ? '' : 's'} · {notEverywhereCount} not everywhere yet
				· {repoCount} repositor{repoCount === 1 ? 'y' : 'ies'}
				{#if streamHealthy}
					· live
				{/if}
			</p>
		{:else}
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{summary.count}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				change{summary.count === 1 ? '' : 's'} · all landed everywhere
				· {repoCount} repositor{repoCount === 1 ? 'y' : 'ies'}
				{#if streamHealthy}
					· live
				{/if}
			</p>
		{/if}
	</div>

	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-0 mb-0" />
		<div class="relative mt-1 w-full sm:max-w-sm" aria-hidden="true">
			<input
				type="text"
				disabled
				placeholder="Find a change by title, #n or sha"
				class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
			/>
		</div>
		<ul class="mt-5 space-y-2" aria-hidden="true">
			{#each Array(skelRowCount) as _, i (i)}
				<li class="skel-block h-16 w-full rounded-lg"></li>
			{/each}
		</ul>
	{:else if query.isError}
		<ErrorState
			error={query.error}
			subject="the change list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-6"
		/>
	{:else if !configured || !connected}
		<!-- ⭐ THE LEDGER FALLBACK — no filters, no search: there is no
		     title/author/PR number to filter or search over, only a revision
		     and a sha. The connect prompt sits in the SAME head-band slot the
		     spec asks for, never a broken card. -->
		{#if configured}
			<button type="button" class="btn btn-primary mt-1" onclick={() => connectGithub()}>
				<GithubSolid aria-hidden="true" />
				Connect GitHub
			</button>
		{/if}
		{#if ledgerRows.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<CodePullRequestOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
				<p class="t-body font-semibold text-gray-900 dark:text-white">Nothing built yet</p>
				<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
					A revision shows up here as soon as one of your services deploys it.
				</p>
			</div>
		{:else}
			{#each ledgerDayGroups as group, gi (group.label)}
				<h2 class="{gi === 0 ? 'mt-5' : 'mt-6'} mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
					{group.label}
				</h2>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each group.rows as row (`${row.repoKey}:${row.revision}`)}
						<li class="environment-theme-scope">
							<div class="tap-zone -mx-2 block rounded px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
								<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
									<a href={row.href} class="tap-link min-w-0 truncate font-mono text-sm text-gray-900 dark:text-white"
										>{row.short}</a
									>
									<span class="text-[11px] text-gray-500 dark:text-gray-400">{row.repoLabel}</span>
									<span class="ml-auto shrink-0 text-[11px] text-gray-500 dark:text-gray-400"
										>{row.liveSlots} of {row.totalSlots} live</span
									>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/each}
		{/if}
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<RevisionSearch
				bind:value={searchQuery}
				placeholder="Find a change by title, #n or sha"
				ariaLabel="Find a change by title, PR number or sha"
			/>
		</div>

		<div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
			<button
				type="button"
				aria-pressed={mine}
				title={mine ? 'Stop showing only your changes' : 'Show only your changes'}
				onclick={toggleMine}
				class="pill-btn t-label rounded border px-3 py-[5px] transition-colors
					{mine
					? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
					: 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'}"
			>
				Mine
			</button>
			{#each repoOptions as opt (opt.repoKey)}
				<button
					type="button"
					aria-pressed={selectedRepos.includes(opt.repoKey)}
					title={selectedRepos.includes(opt.repoKey) ? `Stop showing only ${opt.label}` : `Show only ${opt.label}`}
					onclick={() => toggleRepo(opt.repoKey)}
					class="pill-btn t-label rounded border px-3 py-[5px] transition-colors
						{selectedRepos.includes(opt.repoKey)
						? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
						: 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'}"
				>
					{opt.label}
				</button>
			{/each}
			<!-- ⛔ FIX PASS ITEM 5, 2026-09-10 — "Pull requests", lane A's
			     `ChangesFilter.kind: 'pr'`. -->
			<button
				type="button"
				aria-pressed={prOnly}
				title={prOnly ? 'Show every change' : 'Show only changes that came through a pull request'}
				onclick={togglePrOnly}
				class="pill-btn t-label rounded border px-3 py-[5px] transition-colors
					{prOnly
					? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
					: 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'}"
			>
				Pull requests
			</button>
			<button
				type="button"
				aria-pressed={pendingOnly}
				title={pendingOnly ? 'Show every change' : 'Show only changes not yet everywhere'}
				onclick={togglePending}
				class="pill-btn t-label rounded border px-3 py-[5px] transition-colors
					{pendingOnly
					? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
					: 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'}"
			>
				Not yet everywhere
			</button>
		</div>

		{#if filteredRows.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<CodePullRequestOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
				<p class="t-body font-semibold text-gray-900 dark:text-white">
					{anyFilterActive ? 'Nothing matches' : 'Nothing merged in the last 30 days'}
				</p>
				{#if anyFilterActive}
					<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
						Try clearing a filter or the search box above.
					</p>
				{/if}
			</div>
		{:else}
			{#each dayGroups as group, gi (group.label)}
				<h2 class="{gi === 0 ? 'mt-5' : 'mt-6'} mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
					{group.label}
				</h2>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each group.rows as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
						<ChangeRow {row} now={$now} />
					{/each}
				</ul>
			{/each}
		{/if}
	{/if}
</div>
