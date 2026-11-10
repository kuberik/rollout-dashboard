<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ROLLOUTS (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/rollouts.html, FINAL.md "Rollouts", LANGUAGE.md §1/§5/§7).
	 * The operator's question: "what failed, what needs me, what is moving, what is waiting".
	 * ONE page template, three bands: the failure banner (the page's one AlertPanel) -> Attention (kit compact cards) -> "All rollouts"
	 * (one list card: In flight / Waiting / Held groups of strand rows, then the At rest group of quiet rows). No page title, no header facts,
	 * no rail: the old Find box, In flight drawing, Last 24 h and Recent deploys retired with the old page (their facts live on Home / Changes /
	 * Environments). References: AlertPanel (the tab's banner, `change` line), SectionHeader (icon · 16/600 · rollup), AttentionBand/Card, the
	 * StrandRow list card (kit `.lc` / `.lr`). A rollout in the banner or in Attention is not repeated in the groups; the header counts say so.
	 * All composition lives in rollouts-page.ts (unit-tested); this file draws.
	 */
	import { InboxOutline, GridOutline, UndoOutline, ListOutline } from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AttentionBand from '$lib/components/AttentionBand.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import StrandRow from './StrandRow.svelte';
	import ListCard from './ListCard.svelte';
	import { approvalTarget, truthAttrs, heldCauses } from './data';
	import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
	import { heldChain, fleetGraph } from './held-chain';
	import { actionHref, rowAction } from './rollout-view';
	import { rolloutsPage } from './rollouts-page';
	import type { PageProps } from './pages';

	let { state: hs }: PageProps = $props();
	const P = $derived(rolloutsPage(hs));
	/* An old /rollouts?state=held link redirects to /rollouts#held, but the sections render once the fleet has answered, after the browser
	   already tried the anchor and found nothing: scroll to the section the hash names as soon as it exists (once per hash, so a person who
	   scrolls away is not pulled back by the next fleet update). */
	let scrolledTo = '';
	$effect(() => {
		void P.groups.length; void P.rest.length; void P.attention.length;
		const id = typeof location === 'undefined' ? '' : decodeURIComponent(location.hash.slice(1));
		if (!id || id === scrolledTo) return;
		const el = document.getElementById(id);
		if (!el) return;
		scrolledTo = id;
		el.scrollIntoView({ block: 'start' });
	});
	const attRollup = $derived([
		...(P.failing ? [{ text: `${P.failing} failing`, ink: 'danger' as const }] : []),
		...(P.toApprove ? [{ text: `${P.toApprove} to approve`, ink: 'held' as const }] : [])
	]);
	const allRollup = $derived([
		`${P.counts.moving} moving`,
		...(P.counts.waiting ? [`${P.counts.waiting} waiting`] : []),
		...(P.counts.held ? [`${P.counts.held} held`] : []),
		`${P.counts.rest} at rest`
	]);
	const b = $derived(P.banner);
	/** a holder that is itself held (dependency chain): one quiet line under the Held group; none when there is no chain */
	const chain = $derived(heldChain(heldCauses(hs), fleetGraph(liveSource())));
</script>

<div class="w-full px-4 py-6 sm:px-6">
	<div class="flex min-w-0 flex-col gap-8" data-rollouts-page>
		{#if b}
			<div class="contents" data-truth-kind="banner" data-truth-app={b.row.app} data-truth-href={b.row.href} data-truth-group={b.row.group} {...truthAttrs(b.row)}>
			<AlertPanel severity="error" title={b.title} class="" change={b.change ?? undefined}>
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
				<SectionHeader title="Attention" icon={InboxOutline} rollup={attRollup} />
				<AttentionBand count={P.attention.length} cols={3}>
					{#each P.attention as a (a.key)}
						{@const act = a.yours ? rowAction(a.row) : null}
						<div class="contents" data-truth-kind="attention" data-truth-app={a.app} data-truth-href={a.href} data-truth-group={a.row.group} {...truthAttrs(a.row)}>
						<AttentionCard model={a.model} compact href={a.href} id={{ name: a.app }} rollbackHref={a.rollbackHref ?? undefined} openHref={a.openHref}
							approve={a.yours ? approvalTarget(a.row, hs) : null} approveFallbackHref={act ? actionHref(act) : undefined} />
						</div>
					{/each}
				</AttentionBand>
			</section>
		{/if}

		<section id="all-rollouts" data-section="all" data-rollout-list>
			<SectionHeader title="All rollouts" icon={GridOutline} rollup={allRollup} />
			{#if P.groups.length || P.rest.length}
				<ListCard>
					{#each P.groups as g (g.key)}
						<section class="lc-g" id={g.key === 'moving' ? 'in-flight' : g.key} data-group={g.word}>
							<div class="lc-gh"><span class="lc-gt">{g.word}</span><span class="lc-gn">{g.rows.length}</span></div>
							<ul class="lc-rows">{#each g.rows as r (r.key)}<StrandRow row={r} />{/each}</ul>
							{#if g.key === 'held' && chain.length}
								<div class="chain" data-held-chain>
									{#each chain as c (c.text)}
										<p class="t-meta text-fg-subtle">{c.provider} is itself waiting on {#if c.href}<a href={c.href} class="chain-a">{c.upstream}</a>{:else}{c.upstream}{/if}</p>
									{/each}
								</div>
							{/if}
						</section>
					{/each}
					{#if P.rest.length}
						<section class="lc-g" id="at-rest" data-group="At rest">
							<div class="lc-gh"><span class="lc-gt">At rest</span><span class="lc-gn">{P.rest.length}</span><span class="lc-gr">{P.restApps} apps</span></div>
							<ul class="lc-rows">{#each P.rest as r (r.key)}<StrandRow rest={r} />{/each}</ul>
						</section>
					{/if}
				</ListCard>
			{:else}
				<div class="empty" data-list-empty>
					<ListOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
					<p class="t-ui text-fg">No rollouts yet</p>
					<p class="t-meta text-fg-subtle">Rollouts appear here as soon as one is deployed.</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	section { scroll-margin-top: 16px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
	.chain { padding: 8px 16px 12px; border-top: 1px solid var(--k-line); }
	.chain p { margin: 0; }
	.chain-a { color: var(--k-fg-muted); text-decoration: underline; text-underline-offset: 2px; }
	.chain-a:hover { color: var(--k-fg); }
	@container (max-width: 600px) { .chain { padding: 8px 12px 12px; } }
</style>
