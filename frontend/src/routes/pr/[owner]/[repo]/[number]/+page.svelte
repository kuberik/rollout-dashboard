<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE PR-CENTRIC VIEW: "is my PR in yet, why not, when" — per service.
	 * Design doc: `luka-polish-revisions-pass-6-design-20260910-092839.md`.
	 * Owned modules this route builds on (a prior lane): `pr-ref.ts`,
	 * `api/pulls.ts`, `stores/pr-meta.svelte.ts`,
	 * `view-models/pr-pipeline.ts`. This route and `PipelineCard.svelte`
	 * (+ `PipelineRow.svelte`) render what those compute; they invent none
	 * of it.
	 *
	 * ⛔ NO BREADCRUMB. (Explicit instruction, not an oversight.) "All
	 * rollouts" is not this page's parent — a PR is not a rollout, and the
	 * palette is how a reader got here and how they leave. The head band
	 * (title, `#N · owner/repo`, "View on GitHub ↗") is the page's only
	 * orientation.
	 *
	 * NO `max-w-*` ON THIS CONTAINER: `w-full` here is an application of the
	 * product's full-width rule (2026-09-10, human: "I would always like to
	 * use full width of the page."), not a deviation from `lib/CLAUDE.md`'s
	 * page-container recipe — see that file's own reconciliation note next
	 * to the "NO exceptions" line.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { GithubSolid, ClockOutline, CloseCircleOutline } from 'flowbite-svelte-icons';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { FetchPullError } from '$lib/api/pulls';
	import { ensurePrMeta, notifyRevisionSeen, prMetaKey } from '$lib/stores/pr-meta.svelte';
	import { connectGithub } from '$lib/api/github';
	import { buildPrPipeline, type PrPipelineMeta } from '$lib/view-models/pr-pipeline';
	import { repoKeyFromSource } from '$lib/version-utils';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	import Card from '$lib/components/Card.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import PipelineCard from '$lib/components/PipelineCard.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import type { Rollout, Environment } from '$lib/../types';

	const owner = $derived(page.params.owner as string);
	const repo = $derived(page.params.repo as string);
	const number = $derived(Number(page.params.number));

	// `ensurePrMeta` memoises by `owner/repo#n` — calling it again on a
	// param change (one PR tab navigated to another PR) is a cache lookup,
	// not a re-fetch, except for the genuinely new key.
	const prEntry = $derived(ensurePrMeta(owner, repo, number));
	const prData = $derived(prEntry.data);
	const prError = $derived(prEntry.error);
	const prLoading = $derived(prEntry.loading && !prData && !prError);
	const pullError = $derived(prError instanceof FetchPullError ? prError : null);

	// ── THE ROLLOUT LIST — ALREADY STREAMED, NEVER POLLED ON A TIMER OF ITS
	// OWN. Same query every other list-consuming route shares (one cache
	// entry keyed `['rollouts', 'all']`).
	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: staleTimeWhenHealthy(10000, 30000),
				refetchInterval: pollWhenHealthy(10000, 60000)
			}
		})
	);
	const rollouts = $derived<Rollout[]>(rolloutsQuery.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(rolloutsQuery.data?.environments?.items || []);
	const rolloutDependencies = $derived(rolloutsQuery.data?.rolloutDependencies ?? null);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	// A COARSE CLOCK, DELIBERATELY (matches `/revisions`' own reasoning) —
	// bake-left countdowns move in minutes, not milliseconds.
	let coarse = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (coarse = new Date()), 30_000);
		return () => clearInterval(id);
	});

	const meta = $derived<PrPipelineMeta | null>(
		prData && prData.state === 'merged'
			? {
					owner,
					repo,
					number,
					mergedAt: prData.mergedAt,
					mergeCommitSha: prData.mergeCommitSha,
					containedIn: prData.containedIn,
					containedInAll: prData.containedInAll
				}
			: null
	);

	const vm = $derived(
		meta ? buildPrPipeline(meta, rollouts, environments, rolloutDependencies, coarse) : null
	);

	/**
	 * ⭐ ITEM 4 (2026-09-10 fix pass). Services with a build carrying the PR
	 * first (adverse — a `failed` cell somewhere — before the rest), THEN
	 * the services with no build anywhere, each group alphabetical.
	 */
	const orderedServices = $derived.by(() => {
		if (!vm) return [];
		const hasBuild = (s: (typeof vm.services)[number]) => s.cells.some((c) => c.state !== 'not-built');
		return [...vm.services].sort((a, b) => {
			const aBuilt = hasBuild(a);
			const bBuilt = hasBuild(b);
			if (aBuilt !== bBuilt) return aBuilt ? -1 : 1;
			const aAdverse = a.cells.some((c) => c.state === 'failed');
			const bAdverse = b.cells.some((c) => c.state === 'failed');
			if (aAdverse !== bAdverse) return aAdverse ? -1 : 1;
			return a.appName.localeCompare(b.appName);
		});
	});

	/** ⭐ ITEM 4's secondary line — services with NO build anywhere, named
	 *  once beside the verdict rather than each earning their own headline
	 *  claim ("Not built yet for hello-api-app, hello-world-manifests"). */
	const notBuiltServiceNames = $derived.by(() => {
		if (!vm) return [];
		return vm.services
			.filter((s) => s.cells.every((c) => c.state === 'not-built'))
			.map((s) => s.appName)
			.sort((a, b) => a.localeCompare(b));
	});

	// ── STREAMING: NOTIFY THE PER-TAB STORE WHEN A MATCHING APP GAINS A
	// REVISION. `notifyRevisionSeen` is already debounced/idempotent
	// (`stores/pr-meta.svelte.ts`); this just has to report each NEW
	// revision once, not spam it on every 30s tick.
	//
	// ⭐ ITEM 10 (2026-09-10 fix pass). This used to notify for EVERY
	// revision already on screen the first time `prData` arrived — for a
	// service whose head is an unrelated ancestor build (never going to
	// join `containedIn`), that still armed `notifyRevisionSeen`'s 5s
	// debounce once, firing ONE extra `fetchPull()` (2 more upstream GitHub
	// calls) on a page that had only just finished its own first fetch.
	// Live measured: 4 upstream calls on first paint against the spec's
	// ≤2. The fix is a SNAPSHOT taken the first time this PR's meta AND the
	// rollout list have both settled — only a revision that was NOT in that
	// snapshot (i.e. appears on a LATER poll/stream tick, a build landing
	// while the page is open) ever calls `notifyRevisionSeen`.
	const expectedRepoKey = $derived(repoKeyFromSource(`github.com/${owner}/${repo}`, ''));
	const notifiedRevisions = new Set<string>();
	let snapshotKey = '';
	let snapshotRevisions = new Set<string>();
	let snapshotTaken = false;
	$effect(() => {
		if (!prData) return;
		if (!rolloutsQuery.data) return; // wait for the list's own first settle
		const key = prMetaKey(owner, repo, number);
		if (snapshotKey !== key) {
			// A fresh PR (first load, or this tab navigated to a different
			// PR) — reset and snapshot whatever is on screen right now
			// before any notification is allowed to fire.
			snapshotKey = key;
			snapshotRevisions = new Set<string>();
			snapshotTaken = false;
			notifiedRevisions.clear();
		}
		if (!snapshotTaken) {
			snapshotTaken = true;
			for (const rollout of rollouts) {
				if (repoKeyFromSource(rollout.status?.source, '') !== expectedRepoKey) continue;
				for (const rel of rollout.status?.availableReleases ?? []) {
					if (rel.revision) snapshotRevisions.add(rel.revision);
				}
			}
			return; // first settle: only snapshot, never notify
		}
		for (const rollout of rollouts) {
			if (repoKeyFromSource(rollout.status?.source, '') !== expectedRepoKey) continue;
			for (const rel of rollout.status?.availableReleases ?? []) {
				const rev = rel.revision;
				if (!rev || notifiedRevisions.has(rev) || snapshotRevisions.has(rev)) continue;
				notifiedRevisions.add(rev);
				notifyRevisionSeen(key, rev);
			}
		}
	});

	const pageTitle = $derived(
		prData ? `#${number} ${prData.title} · kuberik` : `#${number} · kuberik`
	);

	const mergedAgo = $derived(
		prData?.mergedAt ? `${formatTimeAgoCompact(prData.mergedAt, coarse)} ago` : null
	);

	/** Item 8 — an open PR's own facts, straight off `pulls/{n}`, no build state. */
	const openAge = $derived(prData?.openedAt ? formatTimeAgoCompact(prData.openedAt, coarse) : null);
	const openHeadShort = $derived(prData?.headSha ? prData.headSha.slice(0, 7) : null);
	const openFilesLabel = $derived(
		prData?.changedFiles != null
			? `${prData.changedFiles} file${prData.changedFiles === 1 ? '' : 's'}`
			: null
	);

	/**
	 * ⭐ ONE STRING, NOT A TEMPLATE BUILT ACROSS `{#if}` BRANCHES. Svelte
	 * trims the leading whitespace of a text node that OPENS a block branch
	 * (the newline + indentation before `· merged …` inside `{#if
	 * mergedAgo}`), which swallowed the space and rendered
	 * `kuberik-testing· merged …` with no gap before the dot — caught only
	 * by actually looking at the rendered text, not by reading the
	 * template. Composing the whole clause here means there is exactly one
	 * join point (a plain template-literal space) and no block boundary for
	 * whitespace to vanish across.
	 */
	const subtitleTail = $derived(
		prData
			? mergedAgo
				? `merged ${mergedAgo} by @${prData.author}`
				: prData.state === 'closed'
					? `closed by @${prData.author}`
					: `opened by @${prData.author}`
			: ''
	);

	/* ── SKELETON — remembers the last service-card count, like /revisions. */
	const SHAPE_KEY = 'pr/pipeline';
	const remembered = recallShape<{ services: number }>(SHAPE_KEY);
	const skelServices = remembered?.services ?? 2;
	$effect(() => {
		if (!vm) return;
		rememberShape(SHAPE_KEY, { services: Math.min(vm.services.length, 5) });
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="w-full px-4 py-6 sm:px-6">
	{#if prLoading}
		<!-- THE SKELETON KEEPS THE HEAD BAND'S SHAPE (CardSkeleton's own rule:
		     a placeholder is the whole composition, header included). -->
		<div class="mb-6 space-y-2" aria-hidden="true">
			<div class="h-7 w-2/3 max-w-xl animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-4 w-1/2 max-w-sm animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
		</div>
		<div class="space-y-4">
			{#each Array.from({ length: skelServices }, (_, i) => i) as i (i)}
				<CardSkeleton titleWidth="w-32" rollupWidth="w-40" rows={3} rowHeight={28} padded={false} />
			{/each}
		</div>
	{:else if pullError?.reason === 'not_connected'}
		<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
			#{number} · {owner}/{repo}
		</p>
		<h1 class="t-display text-gray-900 dark:text-white">Connect GitHub to see this pull request</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			This dashboard reads pull request details as you, through your own GitHub account — connect
			it to see #{number} on {owner}/{repo}.
		</p>
		<button type="button" class="btn btn-primary mt-4" onclick={() => connectGithub()}>
			<GithubSolid aria-hidden="true" />
			Connect GitHub
		</button>
	{:else if pullError?.reason === 'not_found' && pullError.scope === 'pr'}
		<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
			#{number} · {owner}/{repo}
		</p>
		<h1 class="t-display text-gray-900 dark:text-white">PR not found</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			PR #{number} not found in {owner}/{repo} (or you cannot see it). Check the number, or
			<a
				href={`https://github.com/${owner}/${repo}/pulls?q=is%3Apr`}
				target="_blank"
				rel="noopener noreferrer"
				class="nav-link">search {owner}/{repo}'s pull requests on GitHub ↗</a
			>. You can also press <kbd class="t-code-sm">⌘K</kbd> to look it up here.
		</p>
	{:else if pullError?.reason === 'not_found'}
		<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
			#{number} · {owner}/{repo}
		</p>
		<h1 class="t-display text-gray-900 dark:text-white">Not on this cluster</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			No service on this cluster deploys {owner}/{repo}.
		</p>
	{:else if prError}
		<ErrorState
			error={prError}
			subject="this pull request"
			backHref="/"
			backLabel="Back to the dashboard"
			isRetrying={prEntry.loading}
			onRetry={() => void prEntry.fetch()}
		/>
	{:else if prData}
		<!-- ══ HEAD BAND — THE PAGE'S ONLY ORIENTATION, NO BREADCRUMB ═══════ -->
		<header class="mb-6">
			<h1 class="t-display text-gray-900 dark:text-white">{prData.title}</h1>
			<p
				class="t-dense mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
			>
				<span>#{prData.number} · {owner}/{repo} · {subtitleTail}</span>
				<a
					href={prData.htmlUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="nav-link inline-flex items-center gap-1"
				>
					<GithubSolid class="h-3.5 w-3.5" aria-hidden="true" />
					View on GitHub
					<span aria-hidden="true">↗</span>
				</a>
			</p>
		</header>

		{#if prData.state === 'open'}
			<Card icon={ClockOutline} title="Not merged yet">
				<p class="t-body text-gray-600 dark:text-gray-300">
					This pull request has not merged yet — it targets <code class="t-code-sm">{prData.base}</code
					>. Once it merges, this page fills in per service.
				</p>
				<p class="t-dense mt-2 text-gray-500 dark:text-gray-400">
					{#if openAge}open {openAge} · {/if}{#if openFilesLabel}{openFilesLabel} · {/if}{#if openHeadShort}head
						<code class="t-code-sm">{openHeadShort}</code> · {/if}not built anywhere
				</p>
			</Card>
		{:else if prData.state === 'closed'}
			<Card icon={CloseCircleOutline} title="Closed without merging">
				<p class="t-body text-gray-600 dark:text-gray-300">
					This pull request was closed without merging, so no build ever contained it.
				</p>
			</Card>
		{:else if vm}
			<!-- ⭐ ITEM 4 (2026-09-10 fix pass): a real heading, not a styled
			     div — the page's one verdict claim. -->
			<h2 class="t-headline mb-1 text-gray-900 dark:text-white">{vm.verdict}</h2>
			{#if notBuiltServiceNames.length > 0 && notBuiltServiceNames.length < vm.services.length}
				<!-- Only when it's NEW information — a page whose verdict is
				     already "Not built yet" (every service) would restate itself. -->
				<p class="t-dense mb-4 text-gray-500 dark:text-gray-400">
					Not built yet for {notBuiltServiceNames.join(', ')}.
				</p>
			{/if}
			{#if orderedServices.length > 0}
				<div class="space-y-4">
					{#each orderedServices as service (service.appName)}
						<PipelineCard {service} {localClusterName} {environments} {rolloutDependencies} now={coarse} />
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
