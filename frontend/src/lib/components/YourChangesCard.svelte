<svelte:options runes={true} />

<script lang="ts">
	/**
	 * HOME'S "Your changes" CARD — CHANGES-2026-09-10.md §4. Replaces
	 * `YourPullRequestsCard`/`MyPullListRow` outright (both deleted with this
	 * change), not a rename: **merged only** (open PRs are gone — the human:
	 * "it also doesn't make sense to show open PRs"), and a bare commit with
	 * no PR now counts as a change too.
	 *
	 * ── SAME CACHE, NO NEW NETWORK COST ────────────────────────────────────
	 *
	 * `changesQueryOptions` is the SAME unfiltered `/github/changes` fetch
	 * the `/changes` index reads — TanStack dedupes by key, so mounting this
	 * card on `/` is a cache hit whenever the index has already been open in
	 * the tab, and vice versa. Filtering to "mine" happens here, client-side,
	 * against the response's own `user` field — exactly the pattern
	 * `api/my-pulls.ts`'s own re-export now uses for the palette.
	 *
	 * ── THE FOLD, §4's OWN RULE ─────────────────────────────────────────────
	 *
	 * Five rows of the compact form (`ChangeRow`), worst/verdict word first —
	 * UNLESS every one of the shown changes is `live everywhere`, in which
	 * case the whole card body is one line: "N changes · all live
	 * everywhere". Marking the norm five times over is the exact thing this
	 * card is being redesigned away from (§2's own "mark the deviation, never
	 * the norm").
	 *
	 * ── FOUR GITHUB STATES, NEVER A BROKEN CARD, NEVER A LATE POP-IN ──────
	 *
	 *   `githubStatus.isLoading`→ the card's own skeleton, reserving the
	 *                             header + 3 rows so nothing shifts once the
	 *                             query settles (fix pass, 2026-09-10, item 1).
	 *   `configured === false`  → the card does not render at all.
	 *   `connected === false`   → the connect prompt renders INLINE, in the
	 *                             card's own body.
	 *   `connected === true`    → the list, the all-live fold, the empty
	 *                             sentence, or a load failure's own line.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { changesQueryOptions } from '$lib/api/changes';
	import { now } from '$lib/stores/time';
	import { CodePullRequestOutline, GithubSolid, ChevronRightOutline } from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import ChangeRow from './ChangeRow.svelte';
	import SkeletonBar from './skeleton/SkeletonBar.svelte';
	import type { Rollout, Environment, RolloutDependency } from '../../types';
	import { buildChangeRows, myChangesCount, orderHomeChangeRows } from '$lib/view-models/changes';

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

	const changesQuery = createQuery(() => changesQueryOptions({ days: 30, enabled: connected }));

	/**
	 * ⛔ FIX PASS ITEM 6, 2026-09-10 — `myChangesCount`/`orderHomeChangeRows`,
	 * `changes.ts`'s own shared functions (ruling 5), not a local filter this
	 * card computed by hand. Ruling 5's whole point: the palette's Browse
	 * tile (`CommandPalette.svelte`) reads `myChangesCount` off the SAME
	 * cache this card does, so the two counts can never drift by counting
	 * "mine" two different ways.
	 */
	const currentUser = $derived(changesQuery.data?.user ?? '');
	const mine = $derived(
		(changesQuery.data?.changes ?? []).filter((c) => c.author.toLowerCase() === currentUser.toLowerCase())
	);

	const ROW_CAP = 5;
	const rows = $derived(buildChangeRows(mine, rollouts, environments, rolloutDependencies, $now));
	// The rollup NUMBER reads `myChangesCount` directly (off every row this
	// card built, before the ≤5 cap) rather than `rows.length`, so a stray
	// divergence between this card's own filter and the shared function's
	// would fail loudly (a count mismatch) instead of silently agreeing by
	// construction.
	const myCount = $derived(myChangesCount(rows, currentUser));
	// Stuck-first, §4's own fold ordering (ruling 5) — a card that showed
	// five settled rows above one stuck one would bury the reason the card
	// exists to answer.
	const shown = $derived(orderHomeChangeRows(rows).slice(0, ROW_CAP));
	const allLive = $derived(shown.length > 0 && shown.every((r) => r.verdictTone === 'live'));
</script>

{#if githubStatus.isLoading}
	<!--
		⛔ FIX PASS ITEM 1, 2026-09-10 — RESERVE THE SHAPE WHILE `githubStatus`
		IS STILL IN FLIGHT. `configured` defaults to `false` before the query
		resolves, so an `{#if configured}` guard alone hid this whole card for
		the ~200ms-1.3s `githubStatus` takes on a direct load, then popped it
		in once `configured` turned true on a cluster where GitHub really is
		configured — a layout jump, the exact "no late pop-in without a
		reserved placeholder" defect `feedback_navigation_and_loading_states.md`
		names. Render the card's own skeleton instead so nothing shifts under
		the fleet once the query settles.
	-->
	<Card icon={CodePullRequestOutline} title="Your changes" padded={false}>
		<ul class="space-y-2 p-3" aria-hidden="true">
			{#each [0, 1, 2] as i (i)}
				<li><SkeletonBar width="w-full" height="h-4" /></li>
			{/each}
		</ul>
	</Card>
{:else if configured}
	<Card icon={CodePullRequestOutline} title="Your changes" padded={false}>
		{#snippet rollup()}
			<a href="/changes?mine" class="nav-link shrink-0" aria-label="See all your changes">
				{myCount} change{myCount === 1 ? '' : 's'}
				<ChevronRightOutline class="h-3.5 w-3.5" />
			</a>
		{/snippet}
		{#if !connected}
			<div class="p-4">
				<p class="t-body text-gray-600 dark:text-gray-300">
					Connect GitHub to see if your changes have landed, service by service, environment by
					environment.
				</p>
				<button type="button" class="btn btn-primary mt-3" onclick={() => connectGithub()}>
					<GithubSolid aria-hidden="true" />
					Connect GitHub
				</button>
			</div>
		{:else if changesQuery.isLoading}
			<ul class="space-y-2 p-3" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<li><SkeletonBar width="w-full" height="h-4" /></li>
				{/each}
			</ul>
		{:else if changesQuery.isError}
			<p class="p-4 text-sm text-gray-500 dark:text-gray-400">Could not load your changes.</p>
		{:else if shown.length === 0}
			<p class="p-4 text-sm text-gray-500 dark:text-gray-400">Nothing of yours merged in the last 30 days.</p>
		{:else if allLive}
			<p class="p-4 text-sm text-gray-600 dark:text-gray-300">
				{myCount} change{myCount === 1 ? '' : 's'} · all live everywhere
			</p>
		{:else}
			<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
				{#each shown as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
					<ChangeRow {row} dense now={$now} />
				{/each}
			</ul>
		{/if}
	</Card>
{/if}
