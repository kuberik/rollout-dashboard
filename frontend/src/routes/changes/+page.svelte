<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/changes` — THE INDEX. CHANGES-2026-09-10.md ROUND 3, RULING B ("TWO
	 * VIEWS, NOT ONE LIST").
	 *
	 * Round 2 was one mixed list, split into "Not everywhere yet" (a card
	 * grid) and "Live everywhere" (a flat line list), filtered by three chips
	 * (Mine / Pull requests / Not yet everywhere). The human, after seeing it
	 * ship: *"It's mainly to get an overview of how far his changes or
	 * changes of a certain repo went. It kinda sucks that you mixed up both
	 * of those into a single list."* and *"again too verbose showing every
	 * environment and service."*
	 *
	 * Round 3 is two blocks, no chips, no landing grid on this page at all
	 * (the grid lives on the change page only — `changes.ts`'s own
	 * `ChangeSections`/`ChangeCard` are the round-2 shape this ruling
	 * supersedes, kept for `/changes/<repo>`'s own use, not deleted):
	 *
	 *   1. **Your changes** — every merged change (PR or bare commit)
	 *      authored by the viewer, 30 days, stuck-first (`orderHomeChangeRows`),
	 *      compact `ChangeLine` rows, paginated at 20.
	 *   2. **Repositories** — one `Card` per repository: header is the repo
	 *      name plus `repoProgress`'s own rollup ("6 changes · 2 not
	 *      everywhere"), body is the `typicalToProdMs` dl line, the 5 most
	 *      recent changes (`recentByRepo`) as the same compact rows, and
	 *      "All changes in `<repo>` ›".
	 *
	 * The head band is the fleet grammar WITHOUT the held/not-built/live
	 * breakdown round 2 printed (that sentence also stuttered "live" twice —
	 * a `X live` clause followed by a stream-status `· live` — which no
	 * other head band in the product does; dropped rather than fixed twice):
	 * "59 changes · 47 not everywhere yet · 2 repositories".
	 *
	 * Search stays (`?q=`, over both blocks — a search scopes what "yours"
	 * and "repositories" both mean, same feed). The repo/pending/kind chips
	 * are gone: `Repositories` replaces the repo chip (browse instead of
	 * filter), and there is no mixed list left to narrow with "Not yet
	 * everywhere"/"Pull requests".
	 *
	 * ⭐ GITHUB NOT CONFIGURED OR NOT CONNECTED STILL RENDERS A USEFUL INDEX —
	 * unchanged from round 2, see `buildLedgerChangeRows`'s own doc.
	 *
	 * `w-full px-4 py-6 sm:px-6` — full width is the product rule
	 * (`lib/CLAUDE.md`, "THE PAGE CONTAINER"): no `max-w-*` on a route
	 * container.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { changesQueryOptions } from '$lib/api/changes';
	import {
		buildChangeRows,
		buildLedgerChangeRows,
		filterChangeRows,
		orderHomeChangeRows,
		repoChipOptions,
		recentByRepo,
		repoProgress,
		groupByDay,
		summarizeChangeRows,
		changesSummary,
		type ChangeRowVM,
		type LedgerChangeRow
	} from '$lib/view-models/changes';
	import { compactSpan } from '$lib/view-models/lead-time';
	import { now } from '$lib/stores/time';
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getScrollPosition, scrollMemoryKey } from '$lib/scroll-memory';
	import { CodePullRequestOutline, GithubSolid, FolderOutline, HourglassOutline } from 'flowbite-svelte-icons';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import ChangeLine from '$lib/components/ChangeLine.svelte';
	import Card from '$lib/components/Card.svelte';
	import HowChangesAreGoing from '$lib/components/HowChangesAreGoing.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import HeadBandSkeleton from '$lib/components/skeleton/HeadBandSkeleton.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
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

	/* ── SEARCH — THE ONE URL-BACKED FILTER LEFT (ROUND 3 RULING B) ── */

	let searchQuery = $state(page.url.searchParams.get('q') ?? '');

	$effect(() => {
		const original = page.url.searchParams.toString();
		const params = new URLSearchParams(page.url.searchParams);
		const trimmedQ = searchQuery.trim();
		if (trimmedQ) params.set('q', trimmedQ);
		else params.delete('q');
		const qs = params.toString();
		if (qs === original) return;
		goto(qs ? `?${qs}` : '?', { replaceState: true, noScroll: true, keepFocus: true });
	});

	/** Every change matching the search box — the one population BOTH blocks
	 *  below scope themselves to, so a search narrows "yours" and
	 *  "repositories" together rather than two independently-filtered
	 *  views. */
	const filteredRows = $derived(filterChangeRows(allRows, currentUser, { q: searchQuery }));
	const anyFilterActive = $derived(searchQuery.trim().length > 0);

	/**
	 * ⭐ ROUND 3 RULING B, BLOCK 1 — "YOUR CHANGES". Every merged change
	 * authored by the viewer, stuck-first (`orderHomeChangeRows` — the same
	 * ordering Home's own card uses), paginated at 20.
	 *
	 * ⭐ ROUND 3B (2026-09-10) — "NO RELEASE MEANS NOT AFFECTED, AND MUST NOT
	 * COMPETE". A live fleet measured 43 of 61 rows here as bare commits with
	 * no release anywhere ("Initial commit" ×5, "Add patchN"…), interleaved
	 * BY TIME with the four PRs that actually matter — `orderHomeChangeRows`
	 * treats every non-`live` row as equally "stuck", so a commit nothing
	 * ever built sorted right next to a genuinely held PR. `mineRows` is
	 * split in two: `mineReleased` (has at least one affected service) is
	 * the list that competes for the cap/pagination above, unchanged
	 * otherwise; `mineNoRelease` is folded behind one muted footer line —
	 * "N commits produced no release ›" — that expands IN PLACE to the same
	 * compact rows, still newest-first among themselves (every one of them
	 * shares the same "no release" standing, so time is the only ordering
	 * left to make).
	 */
	const MINE_CAP = 20;
	const mineRows = $derived(orderHomeChangeRows(filterChangeRows(allRows, currentUser, { mine: true, q: searchQuery })));
	const mineReleased = $derived(mineRows.filter((r) => !r.noRelease));
	const mineNoRelease = $derived(mineRows.filter((r) => r.noRelease));
	let mineExpanded = $state(false);
	const mineShown = $derived(mineExpanded ? mineReleased : mineReleased.slice(0, MINE_CAP));
	const mineHiddenCount = $derived(mineReleased.length - mineShown.length);
	const mineAlert = $derived(mineReleased.some((r) => r.verdictTone === 'held' || r.verdictTone === 'failed'));
	let mineNoReleaseExpanded = $state(false);

	/**
	 * ⭐ ROUND 3 RULING B, BLOCK 2 — "REPOSITORIES". One card per repo seen in
	 * the (search-filtered) feed — `repoChipOptions`'s own alphabetical list,
	 * reused here as the repo roster rather than a filter chip row.
	 * `repoProgress`/`recentByRepo` (`changes.ts`) are read against the SAME
	 * `filteredRows`, so a search narrows every card's own count and recent
	 * list too.
	 */
	const repoList = $derived(repoChipOptions(filteredRows));
	const recentByRepoMap = $derived(recentByRepo(filteredRows, 5));

	function repoHref(repoKey: string): string {
		return `/changes/github.com/${repoKey}`;
	}

	function repoRollupText(repoKey: string): string {
		const p = repoProgress(filteredRows, repoKey);
		const notEverywhere = p.notEverywhere > 0 ? ` · ${p.notEverywhere} not everywhere` : '';
		return `${p.changes} change${p.changes === 1 ? '' : 's'}${notEverywhere}`;
	}

	const ledgerDayGroups = $derived(groupByDay(ledgerRows, (r) => r.createdAt, $now));

	/**
	 * ⭐ THE HEAD BAND — THE FLEET GRAMMAR, NO STUTTER. `summarizeChangeRows`
	 * is the ONE population every clause below reads
	 * (`count`/`notEverywhereCount`/`repoCount`), computed on `filteredRows`
	 * so a narrowed search narrows the head band too. Dropped from round 2:
	 * the held/not-built/live breakdown (verbose — "too verbose showing
	 * every environment and service" was the human's own complaint about the
	 * OLD page, and this sentence was the index's version of it) and the
	 * stream-status `· live`/`· updated` tail, which stuttered "live" twice
	 * whenever the change stream was healthy AND said "N live" — no other
	 * head band in the product prints a stream-liveness word at all, so it
	 * is dropped rather than fixed a second time.
	 */
	const summary = $derived(summarizeChangeRows(filteredRows));

	/** The rail's own summary — `changes.ts`'s `changesSummary`, read off the
	 *  SAME filtered feed the head band and both blocks use. */
	const railSummary = $derived(changesSummary(filteredRows));

	/* ── SKELETON SHAPE ── */
	const SHAPE_KEY = 'changes';
	type Shape = { mine: number; repos: number; hasRail: boolean };
	const remembered = recallShape<Shape>(SHAPE_KEY);
	const skelMine = remembered?.mine ?? 3;
	const skelRepos = remembered?.repos ?? 2;
	const skelHasRail = remembered?.hasRail ?? true;

	$effect(() => {
		if (query.isLoading || query.isError) return;
		if (connected && changesQuery.isLoading) return;
		rememberShape(SHAPE_KEY, {
			mine: Math.min(mineRows.length, 5),
			repos: Math.min(repoList.length, 4),
			hasRail: configured && connected
		});
	});

	const isLoading = $derived(
		query.isLoading || githubStatus.isLoading || (connected && changesQuery.isLoading)
	);

	/* ── SCROLL RESTORE — unchanged from round 1/2 ── */
	let pendingScrollRestore = $state<number | null>(null);

	afterNavigate((nav) => {
		if (nav.type !== 'popstate') return;
		pendingScrollRestore = getScrollPosition(scrollMemoryKey(page.url)) ?? null;
	});

	$effect(() => {
		if (pendingScrollRestore == null || isLoading) return;
		// ⭐ ROUND 3, ITEM 10 (2026-09-10) — WAIT FOR THE ROWS TO ACTUALLY
		// EXIST, NOT JUST FOR `isLoading` TO CLEAR. `isLoading` (above) is
		// `query.isLoading`/`githubStatus.isLoading`/`changesQuery.isLoading` —
		// all three can flip to `false` a frame before `mineRows`/`repoList`
		// (and the DOM they drive) have actually re-rendered with real data,
		// which is exactly the gap that made a restore to y=3000 land back at
		// 288: the shell restored against a `<main>` that still measured its
		// EMPTY-state height. Gating on the rows existing too means the
		// restore fires only once there is something to scroll to.
		if (connected && mineRows.length === 0 && repoList.length === 0 && !anyFilterActive) return;
		const target = pendingScrollRestore;
		pendingScrollRestore = null;
		const main = document.querySelector('main');
		if (!main) return;
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
			<HeadBandSkeleton leadWidth="w-8" rollupWidth="w-64" />
		{:else if !configured || !connected}
			<!-- ⭐ THE LEDGER FALLBACK GETS THE FIGURE TOO (round 1 printed the
			     sentence alone). Every other list page on this product opens on
			     a `t-display` count; the degraded path is honest about there
			     being no GitHub data, not about there being no data at all. -->
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{ledgerRows.length}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				revision{ledgerRows.length === 1 ? '' : 's'} ·
				{#if configured}
					GitHub is not connected — showing what this cluster has actually deployed instead.
				{:else}
					GitHub is not configured for this dashboard — showing what this cluster has actually
					deployed instead.
				{/if}
			</p>
		{:else}
			<!-- ⭐ ROUND 3 RULING B: THE FLEET GRAMMAR, NO STUTTER — "59 changes ·
			     47 not everywhere yet · 2 repositories". Zero clauses are
			     omitted (`not everywhere` prints only when non-zero, matching
			     Home's own "0 need you" omission rule); `repositories` is never
			     guarded, same as Home's reassurance figure. -->
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{summary.count}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				change{summary.count === 1 ? '' : 's'}
				{#if summary.notEverywhereCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200"
						>{summary.notEverywhereCount} not everywhere yet</span
					>
				{/if}
				· {summary.repoCount} repositor{summary.repoCount === 1 ? 'y' : 'ies'}
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
		<div class="rail-wrap mt-5">
			<div class="rail-grid">
				<div class="rail-main min-w-0">
					<section class="mb-8" aria-hidden="true">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-200 dark:bg-gray-700"></span>
							<span class="skel-block h-3.5 w-28"></span>
							<span class="skel-block h-3 w-4"></span>
						</div>
						<ul class="space-y-2">
							{#each Array(skelMine) as _, i (i)}
								<li class="skel-block h-7 w-full rounded"></li>
							{/each}
						</ul>
					</section>
					<section aria-hidden="true">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-200 dark:bg-gray-700"></span>
							<span class="skel-block h-3.5 w-32"></span>
							<span class="skel-block h-3 w-4"></span>
						</div>
						<div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]">
							{#each Array(skelRepos) as _, i (i)}
								<div class="skel-block h-40 w-full rounded-lg"></div>
							{/each}
						</div>
					</section>
				</div>
				{#if skelHasRail}
					<div class="rail-side min-w-0 space-y-4" aria-hidden="true">
						<CardSkeleton titleWidth="w-40" rollupWidth="w-20" rows={4} rowHeight={20} />
					</div>
				{/if}
			</div>
		</div>
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
		<!-- ⭐ THE LEDGER FALLBACK — round 1's shape, untouched. No search: there
		     is no title/author/PR number to search over, only a revision and a
		     sha. -->
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

		{#if filteredRows.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<CodePullRequestOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
				<p class="t-body font-semibold text-gray-900 dark:text-white">
					{anyFilterActive ? 'Nothing matches' : 'Nothing merged in the last 30 days'}
				</p>
				{#if anyFilterActive}
					<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
						Try clearing the search box above.
					</p>
				{/if}
			</div>
		{:else}
			<!-- ══ TWO BLOCKS + THE RAIL — ROUND 3 RULING B ═══════════════════
			     `.rail-wrap`/`.rail-grid`/`.rail-main`/`.rail-side` (`app.css`).
			     Blocks are ALWAYS FIRST in document order. -->
			<div class="rail-wrap mt-5">
				<div class="rail-grid">
					<div class="rail-main min-w-0">
						<!-- ── BLOCK 1 — "Your changes" ── -->
						<section class="mb-8">
							<div class="mb-3 flex items-center gap-2">
								<span
									class="h-[5px] w-[5px] shrink-0 rounded {mineAlert ? 'bg-amber-500' : 'bg-gray-400'}"
									aria-hidden="true"
								></span>
								<h2 class="text-base font-semibold text-gray-900 dark:text-white">Your changes</h2>
								<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{mineReleased.length}</span>
							</div>
							{#if mineReleased.length === 0 && mineNoRelease.length === 0}
								<p class="t-body text-gray-500 dark:text-gray-400">
									Nothing of yours merged in the last 30 days.
								</p>
							{:else}
								{#if mineReleased.length > 0}
									<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each mineShown as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
											<ChangeLine {row} showRepo now={$now} />
										{/each}
									</ul>
									{#if !mineExpanded && mineHiddenCount > 0}
										<button
											type="button"
											class="t-micro mt-4 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
											onclick={() => (mineExpanded = true)}>Show {mineHiddenCount} more ›</button
										>
									{/if}
								{/if}
								{#if mineNoRelease.length > 0}
									<!-- ⭐ ROUND 3B — THE FOLD. A bare commit or PR with no
									     release anywhere is not deployable and must not
									     compete with the changes above; it is named once,
									     as a count, and expands IN PLACE to the same compact
									     rows on demand. -->
									<button
										type="button"
										class="t-micro mt-4 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
										onclick={() => (mineNoReleaseExpanded = !mineNoReleaseExpanded)}
									>
										{mineNoRelease.length} commit{mineNoRelease.length === 1 ? '' : 's'} produced no release ›
									</button>
									{#if mineNoReleaseExpanded}
										<ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-700/60">
											{#each mineNoRelease as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
												<ChangeLine {row} showRepo now={$now} />
											{/each}
										</ul>
									{/if}
								{/if}
							{/if}
						</section>

						<!-- ── BLOCK 2 — "Repositories" ── -->
						<section>
							<div class="mb-3 flex items-center gap-2">
								<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-400" aria-hidden="true"></span>
								<h2 class="text-base font-semibold text-gray-900 dark:text-white">Repositories</h2>
								<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{repoList.length}</span>
							</div>
							{#if repoList.length === 0}
								<p class="t-body text-gray-500 dark:text-gray-400">No repository matches.</p>
							{:else}
								<div
									class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
								>
									{#each repoList as repo (repo.repoKey)}
										{@const recent = recentByRepoMap.get(repo.repoKey) ?? []}
										{@const prog = repoProgress(filteredRows, repo.repoKey)}
										<Card
											icon={FolderOutline}
											title={repo.label}
											titleHref={repoHref(repo.repoKey)}
											verdict={repoRollupText(repo.repoKey)}
											padded={false}
										>
											<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
												<div class="px-4 py-2.5">
													<dl class="flex items-baseline justify-between gap-3">
														<dt
															class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400"
														>
															<HourglassOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical
															to prod
														</dt>
														<dd class="t-figure tabular-nums text-gray-900 dark:text-white">
															{#if prog.typicalToProdMs == null}
																<span class="t-micro text-gray-500 dark:text-gray-400"
																	>no measured trip yet</span
																>
															{:else}
																{compactSpan(prog.typicalToProdMs)}
															{/if}
														</dd>
													</dl>
												</div>
												{#if recent.length > 0}
													<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
														{#each recent as row (row.href)}
															<ChangeLine {row} now={$now} />
														{/each}
													</ul>
												{/if}
												<div class="px-4 py-2.5">
													<a href={repoHref(repo.repoKey)} class="nav-link"
														>All changes in {repo.label} ›</a
													>
												</div>
											</div>
										</Card>
									{/each}
								</div>
							{/if}
						</section>
					</div>

					<!-- ── THE RAIL — only when GitHub is connected. -->
					<div class="rail-side min-w-0 space-y-4">
						<HowChangesAreGoing summary={railSummary} notEverywhereCount={summary.notEverywhereCount} />
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
