<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/changes` — THE INDEX. CHANGES-2026-09-10.md ROUND 2, §R2.2.
	 *
	 * Round 1 was a bare day-grouped list — no card, no section, no rail, one
	 * icon on the whole page (the human: "that changes page is way
	 * underdeveloped compared to what revisions page set looked like").
	 * Round 2 reads it as the same page KIND as `/` and `/rollouts`: a head
	 * band in the fleet grammar, two dot-headed sections (Home's own
	 * section-header shape), and a real rail.
	 *
	 * ── THE CORRECTIVE RULE, APPLIED TWICE ────────────────────────────────
	 *
	 * A change is either an ANSWER or a NORM. An answer gets a card
	 * (`ChangeCard`, "Not everywhere yet" — this section IS the page's
	 * subject, no cap). A norm gets a line (`ChangeLine`, "Live everywhere" —
	 * no box, no card, `/activity`'s own day-grouped flat shape, paginated at
	 * 20 rows).
	 *
	 * ⭐ GITHUB NOT CONFIGURED OR NOT CONNECTED STILL RENDERS A USEFUL INDEX
	 * (§3's own "honest degrade, not an empty page"). `buildLedgerChangeRows`
	 * falls back to the ledger's own truth — one row per revision this
	 * cluster's services actually deployed, no author, no PR link, no
	 * landing grid — and the head band says so once, WITH its own figure
	 * (round 1 printed the sentence alone; every other list page on this
	 * product opens on a `t-display` count). No filters, no search, no rail
	 * on that path: there is no title/author/PR number to filter over, and
	 * no GitHub data to spend two rail cards summarising.
	 *
	 * `w-full px-4 py-6 sm:px-6` — full width is the product rule
	 * (`lib/CLAUDE.md`, "THE PAGE CONTAINER"): no `max-w-*` on a route
	 * container, no line-length argument on a page of cards and figures.
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
		changesSummary,
		perRepoCounts,
		splitChangeSections,
		type ChangeRowVM,
		type LedgerChangeRow
	} from '$lib/view-models/changes';
	import { now } from '$lib/stores/time';
	import { tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getScrollPosition, scrollMemoryKey } from '$lib/scroll-memory';
	import { CodePullRequestOutline, GithubSolid, ClockSolid, CalendarMonthSolid } from 'flowbite-svelte-icons';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import ChangeLine from '$lib/components/ChangeLine.svelte';
	import ChangeCard from '$lib/components/ChangeCard.svelte';
	import HowChangesAreGoing from '$lib/components/HowChangesAreGoing.svelte';
	import RepositoriesCard from '$lib/components/RepositoriesCard.svelte';
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

	/* ── FILTERS — ALL URL-BACKED, THE `/activity`/`/revisions` PATTERN ── */

	let mine = $state(page.url.searchParams.has('mine'));
	let pendingOnly = $state(page.url.searchParams.has('pending'));
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

	/**
	 * ⭐ ROUND 2's TWO SECTIONS — `changes.ts`'s own `splitChangeSections`
	 * (ruling: one function, so the section bodies and their own counts can
	 * never disagree with the filter/search that produced `filteredRows`).
	 */
	const sections = $derived(splitChangeSections(filteredRows));
	const notEverywhere = $derived(sections.notEverywhere);
	const liveEverywhere = $derived(sections.liveEverywhere);

	/**
	 * ⭐ SECTION 1's DOT IS AMBER ONLY WHEN SOMETHING IN IT IS GENUINELY
	 * STUCK (R2.5(b)'s own distinction — a gate waiting its own clock, or a
	 * change merely mid-promotion, is not an alarm; `held`/`failed` are).
	 * A section of changes moving normally through a pipeline is not one.
	 */
	const notEverywhereAlert = $derived(
		notEverywhere.some((r) => r.verdictTone === 'held' || r.verdictTone === 'failed')
	);

	/* ── LIVE-EVERYWHERE PAGINATION, §R2.2 ("collapsed by default above 20
	   rows, then `Show N more changes ›`") ── */
	const LIVE_CAP = 20;
	let liveExpanded = $state(false);
	const liveShown = $derived(liveExpanded ? liveEverywhere : liveEverywhere.slice(0, LIVE_CAP));
	const liveHiddenCount = $derived(liveEverywhere.length - liveShown.length);
	const liveDayGroups = $derived(groupByDay(liveShown, (r) => r.mergedAt, $now));
	const ledgerDayGroups = $derived(groupByDay(ledgerRows, (r) => r.createdAt, $now));

	/**
	 * ⭐ THE HEAD BAND'S OWN THREE SUB-COUNTS. Read directly off
	 * `filteredRows`'s per-row `verdictTone` (`pr-pipeline.ts`'s canonical
	 * five: `live`/`held`/`failed`/`active`/`not-built`) rather than adding a
	 * sixth shared function for three field reads — `held` folds `failed` in
	 * too (both are the section-1 "needs a person" half of the fleet; the
	 * section body and each row's own coloured glyph still tell them apart).
	 * `live` is the exact arithmetic remainder (`summary.count` minus the two
	 * named clauses), which folds an in-flight `active` change (deploying,
	 * baking, promoting) in with it — the SAME call `splitChangeSections`'s
	 * own `notEverywhere` predicate already makes (an `active` cell is not
	 * flagged pending), so the head band's "N live" can never disagree with
	 * which section a change actually lands in.
	 */
	const summary = $derived(summarizeChangeRows(filteredRows));
	const headHeldCount = $derived(
		filteredRows.filter((r) => r.verdictTone === 'held' || r.verdictTone === 'failed').length
	);
	const headNotBuiltCount = $derived(filteredRows.filter((r) => r.verdictTone === 'not-built').length);
	const headLiveCount = $derived(summary.count - headHeldCount - headNotBuiltCount);
	const repoCount = $derived(summary.repoCount);
	const streamHealthy = $derived(isEventStreamHealthy());

	/** The rail's own summary — `changes.ts`'s `changesSummary`/`perRepoCounts`,
	 *  read off the SAME filtered feed the sections and head band use. */
	const railSummary = $derived(changesSummary(filteredRows));
	const repoCounts = $derived(perRepoCounts(filteredRows));

	const anyFilterActive = $derived(
		mine || pendingOnly || prOnly || selectedRepos.length > 0 || searchQuery.trim().length > 0
	);

	/* ── SKELETON SHAPE ── */
	const SHAPE_KEY = 'changes';
	type Shape = { notEverywhere: number; live: number; hasRail: boolean };
	const remembered = recallShape<Shape>(SHAPE_KEY);
	const skelNotEverywhere = remembered?.notEverywhere ?? 2;
	const skelLive = remembered?.live ?? 3;
	const skelHasRail = remembered?.hasRail ?? true;

	$effect(() => {
		if (query.isLoading || query.isError) return;
		if (connected && changesQuery.isLoading) return;
		rememberShape(SHAPE_KEY, {
			notEverywhere: Math.min(notEverywhere.length, 6),
			live: Math.min(liveEverywhere.length, 6),
			hasRail: configured && connected
		});
	});

	const isLoading = $derived(
		query.isLoading || githubStatus.isLoading || (connected && changesQuery.isLoading)
	);

	/* ── SCROLL RESTORE — unchanged from round 1 ── */
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
			<!-- ⭐ THE FLEET GRAMMAR, §R2.2: "59 changes · 5 held · 3 not built ·
			     51 live". Zero clauses are omitted, exactly as Home omits
			     "0 need you" — `held`/`not built` print only when non-zero;
			     `live` (the reassurance number, parallel to Home's `steady`) is
			     never guarded. -->
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{summary.count}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				change{summary.count === 1 ? '' : 's'}
				{#if headHeldCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200">{headHeldCount} held</span>
				{/if}
				{#if headNotBuiltCount > 0}
					· {headNotBuiltCount} not built
				{/if}
				· {headLiveCount} live
				{#if streamHealthy}
					· live
				{:else if changesQuery.dataUpdatedAt}
					· updated
					<time
						datetime={new Date(changesQuery.dataUpdatedAt).toISOString()}
						title="Change stream disconnected; showing data fetched at {new Date(
							changesQuery.dataUpdatedAt
						).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"
						>{new Date(changesQuery.dataUpdatedAt).toLocaleTimeString([], {
							hour: '2-digit',
							minute: '2-digit'
						})}</time
					>, stream down
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
		<div class="rail-wrap mt-5">
			<div class="rail-grid">
				<div class="rail-main min-w-0">
					<section class="mb-8" aria-hidden="true">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-200 dark:bg-gray-700"></span>
							<span class="skel-block h-3.5 w-40"></span>
							<span class="skel-block h-3 w-4"></span>
						</div>
						<div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]">
							{#each Array(skelNotEverywhere) as _, i (i)}
								<div class="skel-block h-40 w-full rounded-lg"></div>
							{/each}
						</div>
					</section>
					<section aria-hidden="true">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-[5px] w-[5px] shrink-0 rounded bg-gray-200 dark:bg-gray-700"></span>
							<span class="skel-block h-3.5 w-32"></span>
							<span class="skel-block h-3 w-4"></span>
						</div>
						<ul class="space-y-2">
							{#each Array(skelLive) as _, i (i)}
								<li class="skel-block h-7 w-full rounded"></li>
							{/each}
						</ul>
					</section>
				</div>
				{#if skelHasRail}
					<div class="rail-side min-w-0 space-y-4" aria-hidden="true">
						<CardSkeleton titleWidth="w-40" rollupWidth="w-20" rows={4} rowHeight={20} />
						<CardSkeleton titleWidth="w-28" rollupWidth="w-16" rows={4} rowHeight={20} padded={false} />
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
		<!-- ⭐ THE LEDGER FALLBACK — round 1's shape, untouched. No filters, no
		     search: there is no title/author/PR number to filter or search
		     over, only a revision and a sha. -->
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
			<!-- ══ THE TWO SECTIONS + THE RAIL — Home's own shell, extracted.
			     `.rail-wrap`/`.rail-grid`/`.rail-main`/`.rail-side` (`app.css`).
			     Sections are ALWAYS FIRST in document order; there is no
			     `order` anywhere on this page, unlike Home's `.cc-changes`
			     (which needs one for its own, different, reason). -->
			<div class="rail-wrap mt-5">
				<div class="rail-grid">
					<div class="rail-main min-w-0">
						<!-- ── SECTION 1 — "Not everywhere yet". An ANSWER gets a
						     card: no cap, this section IS the page's subject. ── -->
						<section class="mb-8">
							<div class="mb-3 flex items-center gap-2">
								<span
									class="h-[5px] w-[5px] shrink-0 rounded {notEverywhereAlert
										? 'bg-amber-500'
										: 'bg-gray-400'}"
								></span>
								<h2 class="text-base font-semibold text-gray-900 dark:text-white">Not everywhere yet</h2>
								<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{notEverywhere.length}</span>
								<span class="text-xs text-gray-500 dark:text-gray-400">held, building, or still moving</span>
							</div>
							{#if notEverywhere.length === 0}
								<p class="t-body text-gray-500 dark:text-gray-400">
									Every change in view has landed everywhere.
								</p>
							{:else}
								<div
									class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
								>
									{#each notEverywhere as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
										<ChangeCard {row} now={$now} />
									{/each}
								</div>
							{/if}
						</section>

						<!-- ── SECTION 2 — "Live everywhere". A NORM gets a line: no
						     box, no card, `/activity`'s own day-grouped flat list. ── -->
						<section>
							<div class="mb-3 flex items-center gap-2">
								<span class="h-[5px] w-[5px] shrink-0 rounded bg-green-700 dark:bg-green-400"></span>
								<h2 class="text-base font-semibold text-gray-900 dark:text-white">Live everywhere</h2>
								<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{liveEverywhere.length}</span>
								<span class="text-xs text-gray-500 dark:text-gray-400">nothing left to do</span>
							</div>
							{#if liveEverywhere.length === 0}
								<p class="t-body text-gray-500 dark:text-gray-400">Nothing has landed everywhere yet.</p>
							{:else}
								{#each liveDayGroups as group, gi (group.label)}
									<div class={gi > 0 ? 'mt-5' : ''}>
										<div class="mb-3 flex items-center gap-2">
											{#if group.label === 'Today'}
												<ClockSolid class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
											{:else}
												<CalendarMonthSolid class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
											{/if}
											<span class="t-label text-gray-500 dark:text-gray-400">{group.label}</span>
											<span
												class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"
											></span>
											<span class="t-code-sm text-gray-500 dark:text-gray-400">{group.rows.length}</span>
										</div>
										<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
											{#each group.rows as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
												<ChangeLine {row} showRepo now={$now} />
											{/each}
										</ul>
									</div>
								{/each}
								{#if !liveExpanded && liveHiddenCount > 0}
									<button
										type="button"
										class="t-micro mt-4 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
										onclick={() => (liveExpanded = true)}>Show {liveHiddenCount} more changes ›</button
									>
								{/if}
							{/if}
						</section>
					</div>

					<!-- ── THE RAIL — only when GitHub is connected (the ledger
					     fallback branch above never reaches here at all). ── -->
					<div class="rail-side min-w-0 space-y-4">
						<HowChangesAreGoing summary={railSummary} notEverywhereCount={notEverywhere.length} />
						<RepositoriesCard repos={repoCounts} />
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
