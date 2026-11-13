<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE REPO LIST'S PLACEHOLDER (visual audit #18, 2026-11-13): `RepoList` + `RepoCard shell="item"` drawn in grey while the
	 * changes are on their way, so the flip moves nothing (lib/CLAUDE.md "Loading states": the placeholder is the thing, not a
	 * centred icon over two bars). Home's "Your changes" grew 168 -> 369px when the list landed and pushed the Fleet card down on
	 * phones.
	 *
	 * WHY a new part: `CardSkeleton` draws a Card (47px header + rows); the repo list has no header of its own (the SectionHeader
	 * above it is real from frame one) and its rows are two-line items, so a CardSkeleton row is the wrong shape. Proportions are
	 * RepoCard's item shell, measured: `px-4 py-3` (`max-sm:px-3`), `gap-2`, a 20px header (20px AppGlyph square r6, the
	 * `t-card-title` name, the rollup at the right), then the EnvRow L lane (28px cells, r6, 12px gap) — 80px a row plus the
	 * 1px divider, as the loaded list.
	 */
	import SkeletonBar from './SkeletonBar.svelte';

	let { rows = 3, class: className = '' }: { rows?: number; class?: string } = $props();
	const items = $derived(Array.from({ length: Math.max(1, rows) }, (_, i) => i));
	/* names and lanes of a few lengths, so the column reads as a list rather than a repeated stamp */
	const NAME = ['w-28', 'w-40', 'w-32', 'w-36'];
	const LANE = [['w-24', 'w-20', 'w-24'], ['w-20', 'w-24'], ['w-20', 'w-24', 'w-20'], ['w-24', 'w-20']];
</script>

<ul class="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line bg-surface {className}" aria-busy="true" aria-label="Loading your changes" data-repo-list-skeleton>
	{#each items as i (i)}
		<li class="flex min-w-0 flex-col gap-2 px-4 py-3 max-sm:px-3">
			<div class="flex h-5 min-w-0 items-center gap-2">
				<SkeletonBar width="w-5" height="h-5" class="shrink-0 !rounded-md" />
				<SkeletonBar width={NAME[i % NAME.length]} height="h-4" />
				<SkeletonBar width="w-16" height="h-3" class="ml-auto" />
			</div>
			<div class="flex min-w-0 items-center gap-3">
				{#each LANE[i % LANE.length] as w, j (j)}<SkeletonBar width={w} height="h-7" class="shrink-0 !rounded-md" />{/each}
			</div>
		</li>
	{/each}
</ul>
