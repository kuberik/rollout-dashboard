<svelte:options runes={true} />

<script lang="ts">
	/**
	 * HOME'S "Your changes" CARD — CHANGES-2026-09-10.md ROUND 2, §R2.1.
	 *
	 * Round 1 drew the landing grid, the author and the repo five times over
	 * inside a 320px rail slot and stood at 1400px+ tall at 390 (the human:
	 * "changes on the homepage are a bit too verbose"). Round 2 is a RAIL
	 * CARD in the same grammar as its sibling `How it's going`: a 47px
	 * header, and a body that is either ONE line (all live, empty,
	 * disconnected, failed) or up to five ONE-LINE `ChangeLine` rows — never
	 * the landing grid, never `by @who` (every row here shares one author),
	 * never the repo (two shown rows can collide on `#n`; it is in the
	 * row's own `title`, drawn in full on `/changes`, which spans repos).
	 *
	 * ── SAME CACHE, NO NEW NETWORK COST ────────────────────────────────────
	 *
	 * `changesQueryOptions` is the SAME unfiltered `/github/changes` fetch
	 * the `/changes` index reads — TanStack dedupes by key, so mounting this
	 * card on `/` is a cache hit whenever the index has already been open in
	 * the tab, and vice versa. Filtering to "mine" happens here, client-side,
	 * against the response's own `user` field.
	 *
	 * ── THE HEADER ROLLUP IS THE CARD'S OWN ANSWER, NEVER THE FLEET'S ──────
	 *
	 * §R2.1's own table: any of mine not everywhere yet → `N of M not
	 * everywhere yet ›`; all of mine live → `M all live ›`; none in window →
	 * `See all changes ›`. ⛔ NOT `myChangesCount` alone printed as `N
	 * changes ›` — that was the whole cluster's count sitting under a card
	 * titled *Your* changes, wrong as well as loud.
	 *
	 * ── THE FOLD ────────────────────────────────────────────────────────────
	 *
	 * Up to five rows, stuck-first (`orderHomeChangeRows`) — UNLESS every one
	 * of MINE (not just the shown five) is `live everywhere`, in which case
	 * the whole card body is one line: "N changes · all live everywhere".
	 *
	 * ── FIVE STATES, NEVER A BROKEN CARD, NEVER A LATE POP-IN ─────────────
	 *
	 *   `githubStatus.isLoading`→ the card's own skeleton, reserving the
	 *                             header + 5 rows AT THE REAL 28px PITCH so
	 *                             nothing shifts once the query settles.
	 *   `configured === false`  → the card does not render at all.
	 *   `connected === false`   → the connect prompt renders INLINE, ONE
	 *                             `t-dense` line (not the old two-line 14px
	 *                             paragraph).
	 *   `connected === true`    → the list, the all-live fold, the "nothing
	 *                             merged" empty shape, or a load failure's
	 *                             own line.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { changesQueryOptions } from '$lib/api/changes';
	import { now } from '$lib/stores/time';
	import {
		CodePullRequestOutline,
		GithubSolid,
		ChevronRightOutline,
		CheckCircleSolid
	} from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import ChangeLine from './ChangeLine.svelte';
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
	 * `myChangesCount`/`orderHomeChangeRows`, `changes.ts`'s own shared
	 * functions (ruling 5), not a local filter this card computes by hand —
	 * so the palette's Browse tile count and this card's own rollup can
	 * never drift apart by counting "mine" two different ways.
	 */
	const currentUser = $derived(changesQuery.data?.user ?? '');
	const mine = $derived(
		(changesQuery.data?.changes ?? []).filter((c) => c.author.toLowerCase() === currentUser.toLowerCase())
	);

	const ROW_CAP = 5;
	// ⭐ ROUND 3B (2026-09-10, "NO RELEASE MEANS NOT AFFECTED, AND MUST NOT
	// COMPETE"). A bare commit or merged PR with no release anywhere is not
	// deployable and never appears on this card — not even folded behind a
	// "N commits produced no release" line (that fold exists on `/changes`
	// and the repository page, which have room for it; this card does not,
	// and the whole point of a rail card is that every row is a real
	// answer). Filtered here, once, so every count below (`myCount`,
	// `notEverywhereMine`, `allLive`) is already scoped to released changes.
	const rows = $derived(
		buildChangeRows(mine, rollouts, environments, rolloutDependencies, $now).filter((r) => !r.noRelease)
	);
	// The rollup counts read off every row THIS card built (before the ≤5
	// cap), never `shown.length` — a stray divergence between this card's own
	// filter and the shared function's would fail loudly (a count mismatch)
	// instead of silently agreeing by construction.
	const myCount = $derived(myChangesCount(rows, currentUser));
	const notEverywhereMine = $derived(rows.filter((r) => r.notEverywhere).length);
	// Stuck-first, §R2.1's own fold ordering — a card that showed five
	// settled rows above one stuck one would bury the reason the card exists
	// to answer.
	const shown = $derived(orderHomeChangeRows(rows).slice(0, ROW_CAP));
	// ⭐ THE ALL-LIVE FOLD READS THE FULL POPULATION, NOT THE SHOWN FIVE. Five
	// settled rows above a sixth stuck one must never fold to "all live" —
	// `notEverywhereMine` is computed over every one of `rows`, matching the
	// header rollup's own predicate exactly (one population, read twice).
	const allLive = $derived(myCount > 0 && notEverywhereMine === 0);
</script>

{#snippet skeletonRows()}
	<ul class="px-2 py-1" aria-hidden="true">
		{#each [0, 1, 2, 3, 4] as i (i)}
			<li class="flex h-7 items-center px-2 py-1">
				<SkeletonBar width="w-full" height="h-3.5" />
			</li>
		{/each}
	</ul>
{/snippet}

{#if githubStatus.isLoading}
	<!--
		RESERVE THE SHAPE WHILE `githubStatus` IS STILL IN FLIGHT. `configured`
		defaults to `false` before the query resolves, so an `{#if configured}`
		guard alone hid this whole card for the ~200ms-1.3s `githubStatus`
		takes on a direct load, then popped it in once `configured` turned true
		— a layout jump. Render the card's own skeleton, AT THE REAL 28px
		ROW PITCH (not the old 3-row/16px placeholder that jumped 90px when
		data landed).
	-->
	<Card icon={CodePullRequestOutline} title="Your changes" padded={false}>
		{@render skeletonRows()}
	</Card>
{:else if configured}
	<Card icon={CodePullRequestOutline} title="Your changes" padded={false}>
		{#snippet rollup()}
			<a href="/changes?mine" class="nav-link shrink-0" aria-label="See all your changes">
				{#if myCount === 0}
					See all changes
				{:else if notEverywhereMine > 0}
					{notEverywhereMine} of {myCount} not everywhere yet
				{:else}
					{myCount} all live
				{/if}
				<ChevronRightOutline class="h-3.5 w-3.5" />
			</a>
		{/snippet}
		{#if !connected}
			<div class="p-4">
				<p class="t-dense text-gray-600 dark:text-gray-300">
					See where your merged changes have landed.
				</p>
				<button type="button" class="btn btn-primary mt-3" onclick={() => connectGithub()}>
					<GithubSolid aria-hidden="true" />
					Connect GitHub
				</button>
			</div>
		{:else if changesQuery.isLoading}
			{@render skeletonRows()}
		{:else if changesQuery.isError}
			<div class="flex items-center justify-between gap-2 p-4">
				<span class="t-dense text-gray-500 dark:text-gray-400">Could not load your changes.</span>
				<button type="button" class="nav-link shrink-0" onclick={() => changesQuery.refetch()}
					>Retry</button
				>
			</div>
		{:else if myCount === 0}
			<!-- `ActivityRail`'s own empty shape, restated: a centred 40px disc
			     holding a 14px glyph, a `t-dense` line, a `t-micro` hint — ≈120px
			     so the rail does not collapse. -->
			<div class="flex flex-col items-center px-4 py-6 text-center">
				<div
					class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
				>
					<CodePullRequestOutline class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
				</div>
				<p class="t-dense text-gray-700 dark:text-gray-300">Nothing of yours merged in 30 days</p>
				<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
					Merged pull requests and commits show up here.
				</p>
			</div>
		{:else if allLive}
			<div class="flex items-center gap-2 px-4 py-2.5">
				<CheckCircleSolid class="tone-live h-4 w-4 shrink-0" aria-hidden="true" />
				<span class="t-body text-gray-900 dark:text-white"
					>{myCount} change{myCount === 1 ? '' : 's'} · all live everywhere</span
				>
			</div>
		{:else}
			<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
				{#each shown as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
					<ChangeLine {row} now={$now} />
				{/each}
			</ul>
		{/if}
	</Card>
{/if}
