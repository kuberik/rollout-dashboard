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
	import { now } from '$lib/stores/time';
	import { tick, untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getScrollPosition, scrollMemoryKey } from '$lib/scroll-memory';
	import {
		CodePullRequestOutline,
		GithubSolid,
		FolderOutline,
		CheckCircleSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
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
	 * the list "Your changes" draws, unchanged otherwise; `mineNoRelease` is
	 * folded behind one muted footer line — "N commits produced no release
	 * ›" — that expands IN PLACE to the same compact rows, still
	 * newest-first among themselves (every one of them shares the same "no
	 * release" standing, so time is the only ordering left to make).
	 *
	 * ⭐ ROUND 3C, ITEM 2 (2026-09-10) — "Your changes" IS THE `Card` GRAMMAR,
	 * AND ITS OWN LIVE ROWS FOLD. `mineReleased` is already stuck-first
	 * (`orderHomeChangeRows`), so its `notEverywhere` rows (`deviations`) are
	 * a contiguous PREFIX and its `live everywhere` rows (`liveRun`) are a
	 * contiguous SUFFIX — one run, not several. Deviations always render (a
	 * held/queued/partial row is the reason the card exists); the live run
	 * folds behind one line, "K changes · all live everywhere ›", that
	 * expands IN PLACE — the same disclosure `mineNoRelease` already uses
	 * below it, so the card has one consistent "click to expand a settled
	 * group" idiom rather than two different ones.
	 */
	const mineRows = $derived(orderHomeChangeRows(filterChangeRows(allRows, currentUser, { mine: true, q: searchQuery })));
	const mineReleased = $derived(mineRows.filter((r) => !r.noRelease));
	const mineNoRelease = $derived(mineRows.filter((r) => r.noRelease));
	const notEverywhereMine = $derived(mineReleased.filter((r) => r.notEverywhere).length);
	const mineDeviations = $derived(mineReleased.filter((r) => r.notEverywhere));
	const mineLiveRun = $derived(mineReleased.filter((r) => !r.notEverywhere));
	// Deviations still page at the old cap — "always stay visible on top"
	// means never hidden behind the live-run fold, not that an unusually
	// large held/queued/partial set cannot itself paginate.
	const MINE_CAP = 20;
	/**
	 * ⭐ ROUND 3, ITEM 3 (2026-09-10 fix pass) — "SHOW N MORE"/"NO RELEASE"/
	 * THE LIVE-RUN FOLD SURVIVE BACK, THE SAME WAY `BuildLists.svelte`'s
	 * identical three-disclosure shape already does on the repository page
	 * (that component's own doc comment records the reasoning: `sessionStorage`
	 * keyed by pathname, read SYNCHRONOUSLY at component init via
	 * `$state(untrack(() => …))` rather than in an `onMount`/`$effect` —
	 * so the expansion is already correct on the FIRST render, before the
	 * scroll-restore effect below ever runs (which additionally waits for
	 * data to load) — "restore before scroll restore" falls out of the
	 * ordering for free rather than needing an explicit sequencing flag).
	 * This page has one stable pathname (`/changes`, no per-repo path
	 * segment), so one fixed key covers all three flags.
	 */
	const CHANGES_EXPAND_KEY = 'changes:expand:/changes';
	type ChangesExpandState = { deviations: boolean; live: boolean; noRelease: boolean };
	function readChangesExpand(): ChangesExpandState {
		const empty: ChangesExpandState = { deviations: false, live: false, noRelease: false };
		if (typeof sessionStorage === 'undefined') return empty;
		try {
			const raw = sessionStorage.getItem(CHANGES_EXPAND_KEY);
			if (!raw) return empty;
			const parsed = JSON.parse(raw);
			return { deviations: !!parsed.deviations, live: !!parsed.live, noRelease: !!parsed.noRelease };
		} catch {
			return empty;
		}
	}
	function writeChangesExpand(state: ChangesExpandState) {
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(CHANGES_EXPAND_KEY, JSON.stringify(state));
		} catch {
			/* storage full or disabled — expand state just does not persist */
		}
	}
	const initialExpand = untrack(() => readChangesExpand());
	let mineDeviationsExpanded = $state(initialExpand.deviations);
	const mineDeviationsShown = $derived(
		mineDeviationsExpanded ? mineDeviations : mineDeviations.slice(0, MINE_CAP)
	);
	const mineDeviationsHiddenCount = $derived(mineDeviations.length - mineDeviationsShown.length);
	let mineLiveExpanded = $state(initialExpand.live);
	let mineNoReleaseExpanded = $state(initialExpand.noRelease);
	$effect(() => {
		writeChangesExpand({
			deviations: mineDeviationsExpanded,
			live: mineLiveExpanded,
			noRelease: mineNoReleaseExpanded
		});
	});

	/** The Card's own header rollup — byte-identical to Home's
	 *  `YourChangesCard` (`See all changes` / `N of M not everywhere yet` /
	 *  `M all live`), so the same population never reads two different
	 *  sentences on two pages. */
	function mineRollupText(): string {
		if (mineReleased.length === 0) return 'See all changes';
		if (notEverywhereMine > 0) return `${notEverywhereMine} of ${mineReleased.length} not everywhere yet`;
		return `${mineReleased.length} all live`;
	}

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

	/**
	 * ⭐ COORDINATOR FIX (fourth operator walk, item 1 of the QA pass,
	 * 2026-09-10). The rail card is titled "How YOUR changes are going"
	 * (`HowChangesAreGoing.svelte`'s own hard-coded title) but used to read
	 * `changesSummary(filteredRows)` — the WHOLE fleet's feed, the same
	 * population the head band above summarizes. A live fleet's head band
	 * read "46 changes · 4 not everywhere yet" while the rail beside it,
	 * under a "your" header, read a completely different Merged/Typical/
	 * Held/No-release breakdown for every change on the cluster, not the
	 * viewer's own. Scoped to `mineReleased` — the SAME population "Your
	 * changes" (block 1) draws — so the title and the numbers under it
	 * finally agree with each other.
	 */
	const railSummary = $derived(changesSummary(mineReleased));

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
						<CardSkeleton titleWidth="w-28" rollupWidth="w-40" rows={skelMine} rowHeight={28} />
					</section>
					<section aria-hidden="true">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-200 dark:bg-gray-700"></span>
							<span class="skel-block h-3.5 w-32"></span>
							<span class="skel-block h-3 w-4"></span>
						</div>
						<div class="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]">
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
						<!-- ── BLOCK 1 — "Your changes" — ROUND 3C ITEM 2: THE `Card`
						     GRAMMAR. This is the PRIMARY list on the page and was the
						     one titled section with no 47px header, no icon and no
						     right-aligned rollup — every other titled panel in the
						     product (Home's own `YourChangesCard`, the rail's `How
						     your changes are going`, the `Repositories` cards below
						     it on THIS page) is a `Card`; this was the odd one out. -->
						<section class="mb-8">
							<Card icon={CodePullRequestOutline} title="Your changes" verdict={mineRollupText()} padded={false}>
								{#if mineReleased.length === 0 && mineNoRelease.length === 0}
									<p class="t-body p-4 text-gray-500 dark:text-gray-400">
										Nothing of yours merged in the last 30 days.
									</p>
								{:else}
									<!-- Deviations (held/queued/partial/failed) always render —
									     stuck-first ordering already puts them first; they are
									     the reason this card exists and never fold. -->
									{#if mineDeviations.length > 0}
										<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
											{#each mineDeviationsShown as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
												<ChangeLine {row} showRepo now={$now} />
											{/each}
										</ul>
										{#if !mineDeviationsExpanded && mineDeviationsHiddenCount > 0}
											<div class="px-4 py-2.5">
												<button
													type="button"
													class="nav-link"
													onclick={() => (mineDeviationsExpanded = true)}
													>Show {mineDeviationsHiddenCount} more ›</button
												>
											</div>
										{/if}
									{/if}
									{#if mineLiveRun.length > 0}
										<!-- ⭐ ROUND 3C ITEM 2 — THE LIVE-RUN FOLD. Every row
										     already `live everywhere` is one contiguous run at
										     the tail of the stuck-first order — folded behind
										     one line rather than repeating "live everywhere" N
										     times, and it expands IN PLACE, the same idiom the
										     no-release fold below already uses. -->
										<div class="flex items-center gap-2 px-4 py-2.5">
											<CheckCircleSolid class="tone-live h-4 w-4 shrink-0" aria-hidden="true" />
											<button
												type="button"
												class="nav-link"
												onclick={() => (mineLiveExpanded = !mineLiveExpanded)}
											>
												{mineLiveRun.length} change{mineLiveRun.length === 1 ? '' : 's'} · all live everywhere ›
											</button>
										</div>
										{#if mineLiveExpanded}
											<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
												{#each mineLiveRun as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
													<ChangeLine {row} showRepo now={$now} />
												{/each}
											</ul>
										{/if}
									{/if}
									{#if mineNoRelease.length > 0}
										<!-- ⭐ ROUND 3B — THE FOLD. A bare commit or PR with no
										     release anywhere is not deployable and must not
										     compete with the changes above; it is named once,
										     as a count, and expands IN PLACE to the same compact
										     rows on demand. -->
										<div class="px-4 py-2.5">
											<button
												type="button"
												class="nav-link"
												onclick={() => (mineNoReleaseExpanded = !mineNoReleaseExpanded)}
											>
												{mineNoRelease.length} commit{mineNoRelease.length === 1 ? '' : 's'} produced no release ›
											</button>
										</div>
										{#if mineNoReleaseExpanded}
											<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
												{#each mineNoRelease as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
													<ChangeLine {row} showRepo now={$now} />
												{/each}
											</ul>
										{/if}
									{/if}
								{/if}
							</Card>
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
									class="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
								>
									{#each repoList as repo (repo.repoKey)}
										{@const notEverywhere = recentByRepoMap.get(repo.repoKey) ?? []}
										{@const prog = repoProgress(filteredRows, repo.repoKey)}
										<Card
											icon={FolderOutline}
											title={repo.label}
											titleHref={repoHref(repo.repoKey)}
											verdict={repoRollupText(repo.repoKey)}
											padded={false}
										>
											<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
												<!-- ⛔ FIX PASS ITEM 12, 2026-09-11 — "Typical to prod" is dropped
												     from this card. The rail's `How your changes are going`
												     (`HowChangesAreGoing`) already prints that exact label; this
												     card restated it a second time on the same screen, scoped to
												     one repo instead of the viewer's own changes. The per-repo
												     rollup (`repoRollupText`, the card's own header verdict)
												     still names the count/deviation fact this card is for. -->
												<!-- ⭐ ROUND 3C FIX (2026-09-10) — "REPOSITORIES DUPLICATES YOUR
												     CHANGES". A repo card's own row list is ONLY its
												     `notEverywhere` changes (`recentByRepo` filters and orders
												     stuck-first, capped at 5) — never the live rows "Your
												     changes" already prints in full above, which a live fleet
												     measured as 10 of 10 href-identical rows across two repo
												     cards. When every one of this repo's changes is live, the
												     card says so in one line instead of repeating any row. -->
												{#if notEverywhere.length > 0}
													<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
														{#each notEverywhere as row (row.href)}
															<ChangeLine {row} now={$now} />
														{/each}
													</ul>
												{:else if prog.changes > 0}
													<div class="flex items-center gap-2 px-4 py-2.5">
														<CheckCircleSolid class="tone-live h-4 w-4 shrink-0" aria-hidden="true" />
														<span class="t-body text-gray-900 dark:text-white"
															>{prog.changes} change{prog.changes === 1 ? '' : 's'} · all live everywhere</span
														>
													</div>
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
						<HowChangesAreGoing summary={railSummary} notEverywhereCount={notEverywhereMine} />
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
