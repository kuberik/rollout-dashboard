<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE REPO CARD (r39; kit parts/repocard.js `repoCard` / `repoList`): "a repo's changes on its environment row". Plays the
	 * role RepoLedgerCard / YourChangesCard rows played (those stay until a page moves). Anatomy: identity row (monogram 20 ·
	 * name 15/600 · rollup right, adverse in ink) over a FULL-WIDTH environment row — a neutral filled cell per tier (and a
	 * leading "merged" cell), the repo's changes as beads inside the cell they reached — and "N landed" at the row's end.
	 *
	 *   shell="card"  one bordered card per repo, for an EVEN grid (Changes: Your changes / Team)
	 *   shell="item"  a list item for `RepoList` (Home's ONE list card: the env row sits in the full main width, never wraps at 1440)
	 *
	 * Why not PromotionLane: its nodes are rollouts of one app; a repo's cells hold CHANGES (beads) and exist without a rollout.
	 * It borrows the lane's cell geometry (28px, 6px radius, --k-subtle fill, no border) and ChangeDot's bead. The model is
	 * view-models/repo-card.ts (unit-tested); nothing is decided here.
	 */
	import { hueInk } from '$lib/view-models/state-tone';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import RepoCells from '$lib/components/RepoCells.svelte';
	import type { RepoCardModel } from '$lib/view-models/repo-card';

	let { model, href, shell = 'card', team = false, class: className = '' }: { model: RepoCardModel; href: string; shell?: 'card' | 'item'; team?: boolean; class?: string } = $props();
	/** a repo that deploys several apps says which, once, quietly under the title: "deploys a, b +2" (two names, the full list in the title attribute); single-app repos print nothing */
	const deploys = $derived((model.apps?.length ?? 0) > 1 && shell === 'card' ? { text: `deploys ${model.apps!.slice(0, 2).join(', ')}${model.apps!.length > 2 ? ` +${model.apps!.length - 2}` : ''}`, full: model.apps!.join(', ') } : null);
</script>

<svelte:element this={shell === 'item' ? 'li' : 'article'} class="rc relative flex min-w-0 flex-col {shell === 'card' ? 'gap-2.5 rounded-lg border border-line bg-surface p-4' : 'gap-2 px-4 py-3 max-sm:px-3 hover:bg-hover'} {className}" data-repo={model.repo}>
	<a {href} class="absolute inset-0 z-0 {shell === 'card' ? 'rounded-lg' : ''}" aria-label={model.repo}></a>
	<header class="pointer-events-none relative z-[1] flex min-w-0 items-center gap-2">
		{#if !team}<AppGlyph name={model.repo} size={20} class="shrink-0" />{/if}
		<h3 class="min-w-0 truncate {team ? 't-ui font-medium' : 't-card-title'} text-fg">{model.repo}</h3>
		<span class="t-meta ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
			{#each model.rollup as p, i (p.text)}{#if i}<span class="text-fg-disabled" aria-hidden="true">·</span>{/if}<span class={hueInk(p.ink)}>{p.text}</span>{/each}
		</span>
	</header>
	{#if deploys}<p class="t-meta pointer-events-none relative z-[1] -mt-1 min-w-0 truncate text-fg-subtle {team ? '' : 'pl-7'}" title="deploys {deploys.full}" data-repo-apps>{deploys.text}</p>{/if}
	<div class="rc-row pointer-events-none relative z-[1] flex min-w-0 gap-1.5 {shell === 'item' ? 'items-center gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5' : 'flex-col'}">
		<RepoCells cells={model.cells} />
		{#if model.landed}<span class="t-meta pointer-events-auto shrink-0 whitespace-nowrap text-fg-subtle {shell === 'card' ? 'self-end' : 'max-sm:self-end'}" title={model.landedTitle}><b class="font-medium tabular-nums text-fg-muted">{model.landed}</b> landed</span>{/if}
	</div>
</svelte:element>
