<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/me` — THE UNCAPPED LIST BEHIND HOME'S "Your pull requests" CARD.
	 * Approach B, item B. Same data, same per-service summary
	 * (`my-pulls.ts`'s `myPullSummary`), same `MyPullListRow` — this route
	 * only removes the 5-row cap and groups Open / Merged instead of one
	 * flat list, per the design doc.
	 *
	 * ⛔ NOT IN THE SIDEBAR (explicit instruction, not an oversight — see the
	 * design doc's item B). Reached from Home's card ("See all ›") and the
	 * palette ("my pull requests" free-text match, `CommandPalette.svelte`'s
	 * `action` result kind — see the entry added below).
	 *
	 * NO `max-w-*` ON THIS CONTAINER (2026-09-10 full-width rule, from the
	 * human: "I would always like to use full width of the page.") — the
	 * SAME reasoning `/pr/[owner]/[repo]/[number]`'s own container comment
	 * already states: a list of dense rows has no natural reading measure to
	 * cap, so `w-full` here is an application of the rule, not an exception.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { myPullsQueryOptions } from '$lib/api/my-pulls';
	import type { MyPull } from '$lib/api/my-pulls';
	import { myPullSummary } from '$lib/view-models/my-pulls';
	import { now } from '$lib/stores/time';
	import { GithubSolid, CodePullRequestOutline } from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import MyPullListRow from '$lib/components/MyPullListRow.svelte';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import type { Rollout, Environment } from '../../types';

	// ── THE ROLLOUT LIST — ALREADY STREAMED, SAME CACHE KEY EVERY OTHER
	// LIST-CONSUMING ROUTE SHARES (`['rollouts', 'all']`). No new polling
	// introduced by this page: a route already open elsewhere (Home, `/apps`,
	// …) means this is a cache hit, not a second subscription.
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

	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const configured = $derived(githubStatus.data?.configured ?? false);
	const connected = $derived(githubStatus.data?.connected ?? false);

	const myPullsQuery = createQuery(() => myPullsQueryOptions({ days: 30, enabled: connected }));

	const pulls = $derived<MyPull[]>(
		(myPullsQuery.data?.pulls ?? []).filter((p) => p.state !== 'closed')
	);
	const repos = $derived<string[]>(myPullsQuery.data?.repos ?? []);
	const login = $derived(myPullsQuery.data?.user ?? '');

	const openPulls = $derived(
		[...pulls]
			.filter((p) => p.state === 'open')
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	);
	const mergedPulls = $derived(
		[...pulls]
			.filter((p) => p.state === 'merged')
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	);

	function summaryFor(pull: MyPull): string {
		return myPullSummary(pull, rollouts, environments, rolloutDependencies, $now);
	}
</script>

<svelte:head>
	<title>Your pull requests · kuberik</title>
</svelte:head>

<div class="w-full px-4 py-6 sm:px-6">
	{#if !configured}
		<h1 class="t-display text-gray-900 dark:text-white">Your pull requests</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			GitHub is not configured for this dashboard.
		</p>
	{:else if !connected}
		<h1 class="t-display text-gray-900 dark:text-white">Your pull requests</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			Connect GitHub to see your pull requests across the repos this cluster deploys.
		</p>
		<button type="button" class="btn btn-primary mt-4" onclick={() => connectGithub()}>
			<GithubSolid aria-hidden="true" />
			Connect GitHub
		</button>
	{:else}
		<!-- ⭐ THE HEAD BAND — "@login · N open · M merged in 30 days" (design
		     doc's own words, verbatim). `sr-only` would be wrong here: this IS
		     the page's only name (no navbar section names `/me` — it isn't in
		     the sidebar), so it stays a DRAWN `h1`, same rule `lib/CLAUDE.md`'s
		     "page title" section applies to every OTHER un-sectioned page. -->
		<header class="mb-6">
			<h1 class="t-display text-gray-900 dark:text-white">Your pull requests</h1>
			<p class="t-dense mt-1.5 text-gray-500 dark:text-gray-400">
				{#if login}@{login} · {/if}{openPulls.length} open · {mergedPulls.length} merged in 30 days
			</p>
		</header>

		{#if myPullsQuery.isLoading}
			<div class="space-y-4">
				{#each [0, 1] as i (i)}
					<div class="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
						<SkeletonBar width="w-32" height="h-4" />
						<SkeletonBar width="w-full" height="h-4" />
						<SkeletonBar width="w-full" height="h-4" />
					</div>
				{/each}
			</div>
		{:else if myPullsQuery.isError}
			<p class="text-sm text-gray-500 dark:text-gray-400">Could not load your pull requests.</p>
		{:else if pulls.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">
				No pull requests in the last 30 days{repos.length ? ` in ${repos.join(', ')}` : ''}.
			</p>
		{:else}
			<div class="space-y-4">
				<Card
					icon={CodePullRequestOutline}
					title="Open"
					verdict="{openPulls.length} pull request{openPulls.length === 1 ? '' : 's'}"
					padded={false}
				>
					{#if openPulls.length > 0}
						<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
							{#each openPulls as pull (`${pull.owner}/${pull.repo}#${pull.number}`)}
								<MyPullListRow {pull} summary={summaryFor(pull)} />
							{/each}
						</ul>
					{:else}
						<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
							No open pull requests in the last 30 days.
						</p>
					{/if}
				</Card>
				<Card
					icon={CodePullRequestOutline}
					title="Merged"
					verdict="{mergedPulls.length} pull request{mergedPulls.length === 1 ? '' : 's'}"
					padded={false}
				>
					{#if mergedPulls.length > 0}
						<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
							{#each mergedPulls as pull (`${pull.owner}/${pull.repo}#${pull.number}`)}
								<MyPullListRow {pull} summary={summaryFor(pull)} />
							{/each}
						</ul>
					{:else}
						<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
							No merged pull requests in the last 30 days.
						</p>
					{/if}
				</Card>
			</div>
		{/if}
	{/if}
</div>
