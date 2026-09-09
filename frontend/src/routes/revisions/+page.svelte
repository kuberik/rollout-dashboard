<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { isEventStreamHealthy } from '$lib/api/events';
	import {
		buildRevisionLedger,
		leadRowsFor,
		matchesRevisionText,
		releaseLines,
		repoDeviation,
		sortByDeviation,
		type RepoLedger,
		type RevisionRow
	} from '$lib/view-models/revision-ledger';
	import { revisionCoverage, heldBehind } from '$lib/view-models/revision-coverage';
	import { revisionPath, repoSlug } from '$lib/version-utils';
	import { now } from '$lib/stores/time';
	import { TagOutline } from 'flowbite-svelte-icons';
	import RepoLedgerCard from '$lib/components/RepoLedgerCard.svelte';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';

	/**
	 * `/revisions` — THE INDEX. ROUND 11 (2026-09-09), lane 2.
	 *
	 * Full spec: `.agents-context/design/REVISIONS-2026-09-05.md`, "B. ONE
	 * PAGE PER REPOSITORY" — specifically B.2 (the index card), B.3 (the
	 * budget this buys), B.5 (`?q=` here), B.7 (one repository still
	 * renders), B.8/B.9 (skeleton/states).
	 *
	 * ⭐ THIS IS NO LONGER THE WHOLE PAGE. The hero, the held banner and the
	 * three build lists (`Also still running` / `No longer running
	 * anywhere` / `Never deployed`) all moved to `/revisions/<repoSlug>` —
	 * lane 3's route, built from the components this lane extracted
	 * (`RepoLedgerCard`, `BuildRow`, `BuildLists`, `HeldBanner`,
	 * `lib/components/`). This route renders ONLY the head band, the search
	 * field, and one `RepoLedgerCard` per repository. No bar, no hero, no
	 * build lists, no held banner (B.2's own closing rule) — round 7.6's
	 * "the repository header is the toggle" is overruled: there is no
	 * toggle, the chevron means "open the repository page".
	 */

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

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));

	const coarse = $derived($now);

	const repoHeadCoverage = $derived.by(() => {
		const m = new Map<string, ReturnType<typeof revisionCoverage> | null>();
		for (const repo of ledgers) {
			const head = repo.rows[0];
			m.set(repo.repoKey, head ? revisionCoverage(head, coarse) : null);
		}
		return m;
	});

	/** Deviation-first — the repo with something to say leads. Unchanged from round six. */
	const orderedLedgers = $derived(
		sortByDeviation(
			ledgers.map((repo) => ({
				repo,
				deviation: repoDeviation(repo, repoHeadCoverage.get(repo.repoKey) ?? null)
			}))
		).map((item) => item.repo)
	);

	/** `repo:host/owner/name` → its external URL, or `null` for the sourceless `app:` fallback. */
	function repoUrl(repoKey: string): string | null {
		if (!repoKey.startsWith('repo:')) return null;
		const body = repoKey.slice('repo:'.length);
		return body.includes('/') ? `https://${body}` : null;
	}

	/* ── SEARCH — §7(b)/B.5. Lives in the URL, same `?q=` pattern `/activity` uses. ── */

	let searchQuery = $state(page.url.searchParams.get('q') ?? '');
	const searchActive = $derived(searchQuery.trim().length > 0);
	const searchNeedle = $derived(searchQuery.trim().toLowerCase());

	$effect(() => {
		const trimmed = searchQuery.trim();
		if ((page.url.searchParams.get('q') ?? '') === trimmed) return;
		const params = new URLSearchParams(page.url.searchParams);
		if (trimmed) params.set('q', trimmed);
		else params.delete('q');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: true, noScroll: true, keepFocus: true });
	});

	/**
	 * ⭐ FINDING 1 FIX APPLIED AT THE HEAD BAND TOO — `matchesRevisionText`
	 * checks the label as well as the sha, the same predicate every
	 * `RepoLedgerCard` filters its own ledger with, so this count and each
	 * card's own count can never disagree the way the blocking finding
	 * described.
	 */
	const searchSummary = $derived.by(() => {
		if (!searchActive) return null;
		let matches = 0;
		let repos = 0;
		for (const repo of orderedLedgers) {
			const matchedRows = [...repo.rows, ...repo.pending].filter((r) =>
				matchesRevisionText(r, searchNeedle)
			);
			if (matchedRows.length === 0) continue;
			repos++;
			matches += new Set(matchedRows.map((r) => r.revision)).size;
		}
		return { matches, repos };
	});

	/** Exactly one build matched, fleet-wide — a direct route there. */
	const singleSearchMatch = $derived.by<{ repoKey: string; row: RevisionRow } | null>(() => {
		if (!searchActive) return null;
		let found: { repoKey: string; row: RevisionRow } | null = null;
		let foundKey: string | null = null;
		for (const repo of orderedLedgers) {
			for (const row of [...repo.rows, ...repo.pending]) {
				if (!matchesRevisionText(row, searchNeedle)) continue;
				const key = `${repo.repoKey}::${row.revision}`;
				if (foundKey && foundKey !== key) return null;
				if (!found) {
					found = { repoKey: repo.repoKey, row };
					foundKey = key;
				}
			}
		}
		return found;
	});

	/**
	 * ⭐ THE FLEET VERDICT — held/deploying/behind PLACES, summed across
	 * every repository's own release-line lead rows. Unchanged arithmetic
	 * from round six's head band; only the composition around it (bar,
	 * repo detail) moved away.
	 */
	const attention = $derived.by(() => {
		let held = 0;
		let deploying = 0;
		let behind = 0;
		for (const repo of orderedLedgers) {
			const lines = releaseLines(repo);
			for (const row of leadRowsFor(repo, lines)) {
				const cov = revisionCoverage(row, coarse);
				deploying += cov.buckets.find((b) => b.key === 'deploying')?.slots.length ?? 0;
				held += heldBehind(cov).filter((s) => s.blockingGates.length > 0).length;
				const notYet = cov.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
				behind += notYet.filter((s) => !s.slot.onRevision).length;
			}
		}
		return { held, deploying, behind, total: held + deploying + behind };
	});

	/**
	 * ⭐ CRAFT REVIEW (h) — DO NOT REPEAT THE LEADING FIGURE. The head band's
	 * big number IS `attention.total`; when exactly one bucket accounts for
	 * the whole total (the common case — one repo, one kind of trouble),
	 * restating that same count beside its word ("3" then "3 held") prints
	 * one fact twice. Multiple buckets keep their own counts — they differ
	 * from the total and from each other, so each one is new information.
	 */
	function attentionSentence(a: { held: number; deploying: number; behind: number; total: number }): string {
		if (a.total === 0) return 'every place is on its newest build';
		const parts: { n: number; w: string }[] = [];
		if (a.deploying > 0) parts.push({ n: a.deploying, w: 'deploying' });
		if (a.held > 0) parts.push({ n: a.held, w: 'held' });
		if (a.behind > 0) parts.push({ n: a.behind, w: 'behind' });
		const clause = parts.length === 1 ? parts[0].w : parts.map((p) => `${p.n} ${p.w}`).join(' · ');
		return `${clause} · every other place on its newest build`;
	}

	const streamHealthy = $derived(isEventStreamHealthy());

	/* ── SKELETON — B.8. `open` is deleted: nothing expands on the index. ── */
	const SHAPE_KEY = 'revisions';
	type Shape = { repos: number; services: string };
	const remembered = recallShape<Shape>(SHAPE_KEY);
	const skelRepoCount = remembered?.repos ?? 1;
	const skelServiceCounts = (remembered?.services ?? '3')
		.split(',')
		.map((n) => Number(n) || 3);

	$effect(() => {
		if (query.isLoading || query.isError || ledgers.length === 0) return;
		rememberShape(SHAPE_KEY, {
			repos: orderedLedgers.length,
			services: orderedLedgers.map((r) => Math.min(r.serviceCount, 6)).join(',')
		});
	});
</script>

<svelte:head>
	<title>kuberik | Revisions</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Revisions</h1>
		{#if query.isLoading}
			<span class="skel-block h-7 w-8" aria-hidden="true"></span>
			<span class="skel-block h-3.5 w-56" aria-hidden="true"></span>
		{:else if !query.isError && ledgers.length > 0}
			<span class="t-display text-gray-900 tabular-nums dark:text-white"
				>{searchActive && searchSummary ? searchSummary.matches : attention.total}</span
			>
			<p
				class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400"
				title="One commit, one build. Here is every build your services can deploy, and how far each one has got."
			>
				{#if searchActive && searchSummary}
					{searchSummary.matches} build{searchSummary.matches === 1 ? '' : 's'}
					{searchSummary.matches === 1 ? 'matches' : 'match'} “{searchQuery.trim()}”
					{#if searchSummary.repos > 0}
						in {searchSummary.repos} repositor{searchSummary.repos === 1 ? 'y' : 'ies'}
					{/if}
				{:else}
					{attentionSentence(attention)}{#if orderedLedgers.length !== 1}
						· {orderedLedgers.length}&nbsp;repositor{orderedLedgers.length === 1 ? 'y' : 'ies'}{/if}
					{#if streamHealthy}
						· live
					{:else if query.dataUpdatedAt}
						· updated
						<time
							datetime={new Date(query.dataUpdatedAt).toISOString()}
							title="Change stream disconnected; showing data fetched at {new Date(
								query.dataUpdatedAt
							).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"
							>{new Date(query.dataUpdatedAt).toLocaleTimeString([], {
								hour: '2-digit',
								minute: '2-digit'
							})}</time
						>, stream down
					{/if}
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

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-0 mb-0" />

		<div class="relative mt-1 w-full sm:max-w-sm" aria-hidden="true">
			<input
				type="text"
				disabled
				placeholder="Find a build or service"
				class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
			/>
		</div>

		{#each Array(skelRepoCount) as _, i (i)}
			{@const svcCount = skelServiceCounts[i] ?? 3}
			<div
				class="repo-ledger-card-skel {i === 0
					? 'mt-5'
					: 'mt-6'} flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
				aria-hidden="true"
			>
				<div
					class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<span class="skel-block h-4 w-4 shrink-0"></span>
						<span class="skel-block h-4 w-4 shrink-0"></span>
						<span class="skel-block h-3.5 w-40"></span>
					</div>
					<span class="skel-block h-4 w-24 shrink-0"></span>
				</div>
				<div class="flex flex-col gap-1.5 p-2">
					{#each Array(svcCount) as _, r (r)}
						<span class="skel-block h-[26px] w-full"></span>
					{/each}
				</div>
				<div class="skel-block h-[53px] w-full border-t border-gray-100 dark:border-gray-700/60"></div>
			</div>
		{/each}
	{:else if query.isError}
		<ErrorState
			error={query.error}
			subject="the revision list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-6"
		/>
	{:else if ledgers.length === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-semibold text-gray-900 dark:text-white">Nothing built yet</p>
			<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				A commit shows up here as soon as one of your services can deploy it.
			</p>
		</div>
	{:else}
		<RevisionSearch bind:value={searchQuery} />

		{#if singleSearchMatch}
			<a class="nav-link mt-1 inline-flex" href={revisionPath(singleSearchMatch.repoKey, singleSearchMatch.row.revision)}>
				Open build {singleSearchMatch.row.short}
			</a>
		{/if}

		{#each orderedLedgers as repo, i (repo.repoKey)}
			<div class={i === 0 ? 'mt-5' : 'mt-6'}>
				<RepoLedgerCard {repo} now={coarse} query={searchQuery} uncapped={orderedLedgers.length === 1} repoUrl={repoUrl(repo.repoKey)} />
			</div>
		{/each}
	{/if}
</div>
