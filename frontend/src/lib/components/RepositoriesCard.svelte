<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/changes`' RAIL CARD 2 — CHANGES-2026-09-10.md ROUND 2, §R2.2. A
	 * per-repository count list; nothing similar exists in the product (§R2.6:
	 * "a per-repo count list; nothing similar exists").
	 */
	import Card from './Card.svelte';
	import { FolderOutline } from 'flowbite-svelte-icons';
	import type { RepoChangeCount } from '$lib/view-models/changes';

	let {
		repos
	}: {
		repos: readonly RepoChangeCount[];
	} = $props();

	const CAP = 6;
	const shown = $derived(repos.slice(0, CAP));
	const hiddenCount = $derived(repos.length - shown.length);
	let expanded = $state(false);
	const visible = $derived(expanded ? repos : shown);

	/** `owner/repo` (lower-cased, `RepoChangeCount.repoKey`'s own shape) is
	 *  already the exact join `changePath` (`pr-ref.ts`) uses for its own
	 *  `github.com/<owner>/<repo>` slug — GitHub's own routes are
	 *  case-insensitive, so the lower-cased key needs no re-casing to link. */
	function repoHref(repoKey: string): string {
		return `/changes/github.com/${repoKey}`;
	}
</script>

<Card icon={FolderOutline} title="Repositories" verdict="{repos.length} repositor{repos.length === 1 ? 'y' : 'ies'}" padded={false}>
	<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
		{#each visible as repo (repo.repoKey)}
			<li class="flex items-baseline justify-between gap-3 px-4 py-2.5">
				<a href={repoHref(repo.repoKey)} class="t-body min-w-0 truncate text-gray-900 dark:text-white"
					>{repo.label}</a
				>
				<span class="t-dense shrink-0 text-gray-500 dark:text-gray-400">
					{repo.count} change{repo.count === 1 ? '' : 's'}{#if repo.heldCount > 0}
						· <span class="text-orange-700 dark:text-orange-300"
							>{repo.heldCount} held</span
						>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
	{#if !expanded && hiddenCount > 0}
		<div class="px-4 py-2.5">
			<button
				type="button"
				class="t-micro text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
				onclick={() => (expanded = true)}>Show {hiddenCount} more ›</button
			>
		</div>
	{/if}
</Card>
