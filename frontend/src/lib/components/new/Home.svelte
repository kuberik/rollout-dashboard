<svelte:options runes={true} />

<script lang="ts">
	/**
	 * HOME (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/home.html, FINAL.md "Home", LANGUAGE.md §1/§4/§7). Route "/".
	 * The operator's question: "what needs me, and where are my changes". Replaces the old Needs-you Inbox.
	 * MAIN: Attention (figure-led cards when data supports a figure, else title-led; the lead spans an odd row; Roll back outline, Approve the
	 * one blue; the card is the link) -> "Your changes" (ONE list card: a RepoCard `shell="item"` per repo, identity row over a full-width env
	 * row with beads, "N landed" at the row's end). SIDE (the tab's 3fr / minmax(22rem, 2fr) split from lg): the Fleet card. No banner, no page
	 * title, no counts under the bar. Calm (nothing needs you) drops the Attention band and keeps the rest; it is never a hero.
	 * References: SectionHeader(icon, rollup), AttentionBand/Card, RepoList/RepoCard, Card (FleetCard). Composition lives in home-page.ts (tested).
	 */
	import { InboxOutline, CodeBranchOutline } from 'flowbite-svelte-icons';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AttentionBand from '$lib/components/AttentionBand.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import RepoList from '$lib/components/RepoList.svelte';
	import RepoCard from '$lib/components/RepoCard.svelte';
	import FleetCard from '$lib/components/FleetCard.svelte';
	import { bandSpec } from '$lib/view-models/attention';
	import { apps, approvalTarget, truthAttrs } from './data';
	import { homePage } from './home-page';
	import type { PageProps } from './pages';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import { githubAbsence } from './data';
	import ConnectGithubAction from '$lib/components/ConnectGithubAction.svelte';

	let { state: hs }: PageProps = $props();
	const ab = $derived(githubAbsence());
	const P = $derived(homePage(hs));
	const A = $derived(apps(hs));
	const span = $derived(false); // owner 2026-11-08: no card spans a row
</script>


<div class="w-full px-4 py-6 max-sm:pt-4 sm:px-6" data-page="home" data-truth-page="home">
	<h1 class="sr-only">Home</h1>
	<div class="hm flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] lg:items-start lg:gap-x-6" data-home-page data-calm={P.calm ? '' : undefined}>
		<div class="flex min-w-0 flex-col gap-8" data-home-main>
			{#if P.asks.length}
				<section id="attention" data-section="attention">
					<SectionHeader title="Attention" icon={InboxOutline} rollup={P.asksRollup} />
					<AttentionBand count={P.asks.length} cols={2}>
						{#each P.asks as a, i (a.key)}
							{@const act = a.failed ? null : a.href}
							<div class="contents" data-truth-kind="attention" data-truth-app={a.app} data-truth-href={a.href} data-truth-group={a.failed ? 'failed' : 'approval'} {...truthAttrs(a.row)}>
								<AttentionCard model={a.model} href={a.href} id={a.id} lead={span && i === 0} rollbackHref={a.rollbackHref ?? undefined}
									approve={a.failed ? null : approvalTarget(a.row, hs)} approveFallbackHref={act ?? undefined}>
								</AttentionCard>
							</div>
						{/each}
					</AttentionBand>
				</section>
			{/if}

			<section id="your-changes" data-section="mine">
				<SectionHeader title="Your changes" icon={CodeBranchOutline}>
					{#snippet action()}{#if P.landedToday}<a href={P.landedToday.href} class="t-meta tabular-nums text-fg-subtle hover:text-fg hover:underline" title={P.landedToday.title} data-landed-today>{P.landedToday.count} landed today ›</a>{/if}{/snippet}
				</SectionHeader>
				{#if P.repos.length}
					<RepoList>
						{#each P.repos as r (r.repo)}<RepoCard model={r.card} href={r.href} shell="item" />{/each}
					</RepoList>
				{:else}
					<div class="empty" data-list-empty data-github-absence={ab?.kind}>
						<CodeBranchOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
						{#if ab?.kind === 'loading'}
							<SkeletonBar width="w-40" height="h-4" /><SkeletonBar width="w-64" height="h-3.5" />
						{:else if ab}
							<p class="t-ui text-fg">{ab.title}</p>
							<p class="t-meta text-fg-subtle">{ab.sentence}</p>
							{#if ab.connect}<ConnectGithubAction class="mt-3" />{/if}
						{:else}
							<p class="t-ui text-fg">Nothing of yours in flight</p>
							<p class="t-meta text-fg-subtle">Your changes show up here once released, until they reach prod.</p>
						{/if}
					</div>
				{/if}
			</section>
		</div>
		<aside class="min-w-0 lg:sticky lg:top-6" aria-label="Fleet" data-home-side><FleetCard trouble={P.fleet.trouble} deploys={P.fleet.deploys} /></aside>
	</div>
</div>

<style>
	section { scroll-margin-top: 16px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
</style>
