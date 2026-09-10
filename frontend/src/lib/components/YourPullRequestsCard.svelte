<svelte:options runes={true} />

<script lang="ts">
	/**
	 * HOME'S "Your pull requests" CARD — Approach B, item A.
	 *
	 * ── WHERE ON HOME, AND WHY ─────────────────────────────────────────────
	 *
	 * `/` has no "for you" band — its main column is the four fleet-wide
	 * severity groups (`HomeRail.svelte`'s own doc comment: "*is anything on
	 * fire · what needs me, in what order · what can I resolve right now*",
	 * all FLEET-scoped, none about the viewing operator's own work). So this
	 * lands FIRST in the rail, ahead of "Recent activity" and "How it's
	 * going" — the task's own fallback rule ("otherwise first in the rail").
	 * It is the one card in that stack that is about the PERSON rather than
	 * the fleet, which is also why it does not try to merge into either
	 * existing rail card rather than adding a third.
	 *
	 * ── GITHUB STATE, THREE WAYS, NEVER A BROKEN CARD ────────────────────
	 *
	 *   `configured === false`  → the card does not render at all (nothing to
	 *                             connect to on this cluster; the whole
	 *                             PR-centric premise assumes the GitHub App
	 *                             is set up, same premise `/pr/…` depends on).
	 *   `connected === false`   → the CONNECT PROMPT renders INLINE, in the
	 *                             card's own body — never a broken/empty card
	 *                             (design doc, item A).
	 *   `connected === true`    → the list, or the empty sentence, or (rare)
	 *                             a load failure's own line.
	 *
	 * ⛔ NO NEW NETWORK COST. `myPullsQueryOptions` is the SAME query key
	 * `/me` and the palette's title-matching (`Navbar.svelte`) already read —
	 * TanStack Query dedupes by key, so mounting this card is a cache hit,
	 * not a second `/mine` fetch, on any page where the navbar's own copy has
	 * already settled.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { myPullsQueryOptions } from '$lib/api/my-pulls';
	import type { MyPull } from '$lib/api/my-pulls';
	import { myPullSummary } from '$lib/view-models/my-pulls';
	import { now } from '$lib/stores/time';
	import { CodePullRequestOutline, GithubSolid, ChevronRightOutline } from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import MyPullListRow from './MyPullListRow.svelte';
	import SkeletonBar from './skeleton/SkeletonBar.svelte';
	import type { Rollout, Environment, RolloutDependency } from '../../types';

	let {
		rollouts,
		environments,
		rolloutDependencies
	}: {
		rollouts: Rollout[];
		environments: Environment[];
		rolloutDependencies: { items?: RolloutDependency[] } | null;
	} = $props();

	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const configured = $derived(githubStatus.data?.configured ?? false);
	const connected = $derived(githubStatus.data?.connected ?? false);

	const myPullsQuery = createQuery(() => myPullsQueryOptions({ days: 30, enabled: connected }));

	/** Open + merged, last 30 days — the design doc's own scope; `closed`
	 *  rows are excluded here so neither the count nor the list ever has to
	 *  filter twice. */
	const pulls = $derived<MyPull[]>(
		(myPullsQuery.data?.pulls ?? []).filter((p) => p.state !== 'closed')
	);
	const repos = $derived<string[]>(myPullsQuery.data?.repos ?? []);

	const ROW_CAP = 5;
	const shown = $derived(pulls.slice(0, ROW_CAP));

	function summaryFor(pull: MyPull): string {
		return myPullSummary(pull, rollouts, environments, rolloutDependencies, $now);
	}
</script>

{#if configured}
	<Card icon={CodePullRequestOutline} title="Your pull requests" padded={false}>
		{#snippet rollup()}
			<!-- ⭐ ONE CONTROL, NOT TWO RACING CHILDREN. `HomeRail.svelte`'s
			     "Recent activity" card (this card's own sibling, same rail)
			     found that a bare count plus a separate "See all ›" link wrap
			     onto two lines in a ~320px rail column and blow past the
			     header's 47px floor — its own long comment records the
			     measurement. That card folds count-into-link ONLY below a
			     640px card width and keeps a wider two-piece form above it,
			     because it is also reused at full column width elsewhere; THIS
			     card only ever renders in the rail (never full-width), so the
			     folded form is simply correct here, unconditionally — no
			     second form to keep in a container query nobody will ever
			     trigger. -->
			<a href="/me" class="nav-link shrink-0" aria-label="See all your pull requests">
				{pulls.length} pull request{pulls.length === 1 ? '' : 's'}
				<ChevronRightOutline class="h-3.5 w-3.5" />
			</a>
		{/snippet}
		{#if !connected}
			<div class="p-4">
				<p class="t-body text-gray-600 dark:text-gray-300">
					Connect GitHub to see your pull requests across the repos this cluster deploys.
				</p>
				<button type="button" class="btn btn-primary mt-3" onclick={() => connectGithub()}>
					<GithubSolid aria-hidden="true" />
					Connect GitHub
				</button>
			</div>
		{:else if myPullsQuery.isLoading}
			<ul class="space-y-2 p-3" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<li><SkeletonBar width="w-full" height="h-4" /></li>
				{/each}
			</ul>
		{:else if myPullsQuery.isError}
			<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
				Could not load your pull requests.
			</p>
		{:else if shown.length === 0}
			<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
				No pull requests in the last 30 days{repos.length ? ` in ${repos.join(', ')}` : ''}.
			</p>
		{:else}
			<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
				{#each shown as pull (`${pull.owner}/${pull.repo}#${pull.number}`)}
					<MyPullListRow {pull} summary={summaryFor(pull)} />
				{/each}
			</ul>
		{/if}
	</Card>
{/if}
