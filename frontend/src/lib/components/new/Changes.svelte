<svelte:options runes={true} />

<script lang="ts">
	/**
	 * CHANGES (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/changes.html, FINAL.md "Changes", LANGUAGE.md §1/§3/§4/§7).
	 * The operator's question: "which of my changes is failing or waiting on ME, where is each one on its way, and what landed".
	 * ONE page template, the same as Rollouts: the failure banner (the page's one AlertPanel, with the change line) -> Attention (title-led
	 * cards: change title focal, the change's own env row with beads) -> "Your changes" (an EVEN grid of RepoCards, then the At rest card of
	 * repos with nothing in flight) -> "Team" (the others' repos, the same cards one step quieter). No page title, no rail: the old Crossing,
	 * Needs you / On its way / Waiting / Landed groups, Team rail and Last 24 h retired with the old page (their facts live in the beads,
	 * the Attention cards and the repo cards; Last 24 h on Home / Environments).
	 * References: AlertPanel(change), SectionHeader(icon, rollup), AttentionBand/Card, RepoGrid/RepoCard/RepoCells, StrandRow(dense) for At rest, Card.
	 * All composition lives in changes-page.ts (unit-tested); this file draws. Anchor ids: #attention, #your-changes, #at-rest, #team.
	 */
	import { InboxOutline, CodeBranchOutline, UsersGroupOutline, UndoOutline } from 'flowbite-svelte-icons';
	import { pageTitle } from '$lib/page-title';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AttentionBand from '$lib/components/AttentionBand.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import RepoGrid from '$lib/components/RepoGrid.svelte';
	import RepoCard from '$lib/components/RepoCard.svelte';
	import RepoCells from '$lib/components/RepoCells.svelte';
		import ChangesPlumb from './ChangesPlumb.svelte';
	import { approvalTarget, truthAttrs } from './data';
	import { changesPage } from './changes-page';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { PageProps } from './pages';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import { githubAbsence } from './data';
	import ConnectGithubAction from '$lib/components/ConnectGithubAction.svelte';

	let { state: hs }: PageProps = $props();
	const ab = $derived(githubAbsence());

	/* the old Others view is the Team section now: a shared ?view=others link lands on it */
	$effect(() => {
		if (page.url.searchParams.get('view') === 'others') {
			const u = new URL(page.url);
			u.searchParams.delete('view');
			goto(u.pathname + u.search + '#team', { replaceState: true, noScroll: false });
		}
	});

	const P = $derived(changesPage(hs));
	const b = $derived(P.banner);
</script>

<svelte:head><title>{pageTitle('Changes')}</title></svelte:head>

<div class="w-full px-4 py-6 sm:px-6" data-page="changes" data-truth-page="changes">
	<h1 class="sr-only">Changes</h1>
	<div class="flex min-w-0 flex-col gap-8" data-changes-page>
		{#if b}
			<div class="contents" data-truth-kind="banner" data-truth-app={b.p.ride.app} data-truth-href={b.openHref} data-truth-group="failed" {...b.p.ride.row ? truthAttrs(b.p.ride.row) : {}}>
				<AlertPanel severity="error" title={b.title} class="" change={b.change}>
					{#snippet messageBody()}{#if b.check}<FailedCheckLine check={b.check} danger ink />{:else if b.line}<span class="t-body">{b.line}</span>{/if}{/snippet}
					{#snippet actions()}
						<a href={b.openHref} class="btn btn-secondary" data-action="open">Open rollout ›</a>
						{#if b.rollbackHref}<a href={b.rollbackHref} class="btn btn-primary" data-action="rollback"><UndoOutline class="h-4 w-4" aria-hidden="true" />Roll back</a>{/if}
					{/snippet}
				</AlertPanel>
			</div>
		{/if}

		{#if P.attention.length}
			<section id="attention" data-section="attention">
				<SectionHeader title="Attention" icon={InboxOutline} rollup={P.attentionRollup} />
				<AttentionBand count={P.attention.length} cols={2}>
					{#each P.attention as a (a.key)}
						{@const row = a.p.ride.row}
						<div class="contents" data-truth-kind="attention" data-truth-app={a.id.name} data-truth-href={a.href} data-truth-group={a.model.state === 'failed' ? 'failed' : 'approval'} {...row ? truthAttrs(row) : {}}>
							<AttentionCard model={a.model} href={a.href} id={a.id} rollbackHref={a.rollbackHref ?? undefined} openHref={a.openHref} openLabel="Open change"
								approve={a.yours && row ? approvalTarget(row, hs) : null} approveFallbackHref={a.yours ? a.openHref : undefined}>
								{#snippet drawing()}<RepoCells cells={a.card.cells} size="M" />{/snippet}
							</AttentionCard>
						</div>
					{/each}
				</AttentionBand>
			</section>
		{/if}

		<section id="your-changes" data-section="mine">
			<SectionHeader title="Your changes" icon={CodeBranchOutline} rollup={P.mineRollup} />
			{#if P.mine.length || P.rest.length}
				<div class="flex min-w-0 flex-col gap-3">
					<ChangesPlumb state={hs} />
					{#if P.mine.length}
						<details class="cr-fold" id="by-repo" data-group="By repo">
							<summary class="btn btn-secondary t-ui-sm">By repo <span class="tabular-nums text-fg-subtle">· {P.mine.length} {P.mine.length === 1 ? 'repo' : 'repos'}</span></summary>
							<div class="pt-3">
								<RepoGrid>
									{#each P.mine as r (r.repo)}<RepoCard model={r.card} href={r.href} />{/each}
								</RepoGrid>
							</div>
						</details>
					{/if}
				</div>
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
						<p class="t-ui text-fg">No changes of yours yet</p>
						<p class="t-meta text-fg-subtle">A change you merge shows up here while it moves toward prod.</p>
					{/if}
				</div>
			{/if}
		</section>

		{#if P.team.length}
			<section id="team" data-section="team">
				<SectionHeader title="Team" icon={UsersGroupOutline} rollup={P.teamRollup} />
				<RepoGrid team>
					{#each P.team as r (r.repo)}<RepoCard model={r.card} href={r.href} team />{/each}
				</RepoGrid>
			</section>
		{/if}
	</div>
</div>

<style>
	section { scroll-margin-top: 16px; }
	/* By repo: the repo-card grid folded under the line; the fold is the kit's secondary button */
	.cr-fold > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
	.cr-fold > summary::-webkit-details-marker { display: none; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
</style>
