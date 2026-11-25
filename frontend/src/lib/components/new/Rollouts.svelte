<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ROLLOUTS (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/rollouts.html, FINAL.md "Rollouts", LANGUAGE.md §1/§5/§7).
	 * The operator's question: "what failed, what needs me, what is moving, what is waiting".
	 * ONE page template, three bands: the failure banner (the page's one StatementBanner) -> Attention (kit compact cards) -> "All rollouts"
	 * (one list card: In flight / Waiting / Held groups of strand rows, then the At rest group of quiet rows). No page title, no header facts.
	 * 2026-11-21 (owner, R1-R7): from `lg` the list sits in the tab Overview's split (3fr main | 22rem+ rail): main = "All rollouts" header, the filter bar
	 * (ONE query bar, filter/QueryBar.svelte: key:value tokens + free words, rollouts-filter.ts, URL-held) and ONE list card (never two columns, at any width); the rail =
	 * Recent deploys + Deploy cadence (RolloutsRail). The banner and Attention stay full width ABOVE the split and are never filtered away; the filter
	 * narrows the list only. Below `lg` the rail stacks under the list. Every row, At rest included, draws its step strand. References: StatementBanner via FailureBanner (the tab's banner, `change` line), SectionHeader (icon · 16/600 · rollup), AttentionBand/Card, the
	 * StrandRow list card (kit `.lc` / `.lr`). A rollout in the banner or in Attention is not repeated in the groups; the header counts say so.
	 * All composition lives in rollouts-page.ts (unit-tested); this file draws.
	 */
	import { InboxOutline, GridOutline, ListOutline } from 'flowbite-svelte-icons';
	import FailureBanner from './FailureBanner.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AttentionBand from '$lib/components/AttentionBand.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import StrandRow from './StrandRow.svelte';
	import ListCard from './ListCard.svelte';
	import { approvalTarget, truthAttrs, heldCauses } from './data';
	import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
	import { heldChain, fleetGraph } from './held-chain';
	import { actionHref, rowAction } from './rollout-view';
	import { rolloutsPage, attentionRollup } from './rollouts-page';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import RolloutFilters from './rollouts/RolloutFilters.svelte';
	import RolloutsRail from './rollouts/RolloutsRail.svelte';
	import { parseFilter, filterParams, filterList, EMPTY_QUERY } from './rollouts-filter';
	import type { FilterQuery } from '$lib/components/filter/filter-model';
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
	const attRollup = $derived(attentionRollup(P));
	/* the filter lives in the URL (?q=&state=&env=&ns=). `f` is what the page reads; typing updates it at once and the URL follows (replaceState, focus kept).
	   An address that changes from outside (a palette link, back/forward) is adopted, but never the echo of the address this page just wrote itself. */
	let f = $state<FilterQuery>(parseFilter(page.url.searchParams));
	let written = page.url.search;
	function setFilter(next: FilterQuery) {
		f = next;
		const qs = filterParams(page.url.searchParams, next).toString();
		written = qs ? `?${qs}` : '';
		void goto(`${page.url.pathname}${written}${page.url.hash}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
	$effect(() => {
		const cur = page.url.search;
		if (cur === written) return;
		written = cur;
		f = parseFilter(page.url.searchParams);
	});
	const F = $derived(filterList(P, f));
	/* zero terms are dropped everywhere; a rollup is never empty ("0 rollouts" when nothing matches) */
	const allRollup = $derived.by(() => {
		/* waiting and held fold on a phone (the group headers below repeat them), so "38 at rest" never wraps alone onto a second line */
		const parts: (string | { text: string; fold?: boolean })[] = [
			...(F.counts.moving ? [`${F.counts.moving} moving`] : []),
			...(F.counts.waiting ? [{ text: `${F.counts.waiting} waiting`, fold: true }] : []),
			...(F.counts.held ? [{ text: `${F.counts.held} held`, fold: true }] : []),
			...(F.counts.rest ? [`${F.counts.rest} at rest`] : [])
		];
		return parts.length ? parts : ['0 rollouts'];
	});
	const src = $derived(liveSource());
	const b = $derived(P.banner);
	/** a holder that is itself held (dependency chain): one quiet line under the Held group; none when there is no chain */
	const chain = $derived(heldChain(heldCauses(hs), fleetGraph(liveSource())));
</script>

<div class="w-full px-4 py-6 sm:px-6">
	<div class="flex min-w-0 flex-col gap-8" data-rollouts-page>
		{#if b}
			<div class="contents" data-truth-kind="banner" data-truth-app={b.row.app} data-truth-href={b.row.href} data-truth-group={b.row.group} {...truthAttrs(b.row)}>
			<FailureBanner {b} />
			</div>
		{/if}

		{#if P.attention.length}
			<section id="attention" data-section="attention">
				<SectionHeader title="Attention" icon={InboxOutline} rollup={attRollup} />
				<AttentionBand count={P.attention.length} cols={3}>
					{#each P.attention as a (a.key)}
						{@const act = a.yours ? rowAction(a.row) : null}
						<div class="contents" data-truth-kind="attention" data-truth-app={a.app} data-truth-href={a.href} data-truth-group={a.row.group} {...truthAttrs(a.row)}>
						<AttentionCard model={a.model} compact href={a.href} id={{ name: a.app }} rollbackHref={a.rollbackHref ?? undefined} retryHref={a.href} openHref={a.openHref}
							approve={a.yours ? approvalTarget(a.row, hs) : null} approveFallbackHref={act ? actionHref(act) : undefined} />
						</div>
					{/each}
				</AttentionBand>
			</section>
		{/if}

		<div class="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] lg:items-start lg:gap-x-4" data-rollouts-split>
		<section id="all-rollouts" class="min-w-0" data-section="all" data-rollout-list>
			<SectionHeader title="All rollouts" icon={GridOutline} rollup={allRollup} />
			{#if P.groups.length || P.rest.length}
				<div class="mb-4"><RolloutFilters {P} filter={f} onchange={setFilter} /></div>
			{/if}
			{#if F.groups.length || F.rest.length}
				<ListCard columns={1}>
					{#each F.groups as g (g.key)}
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
					{#if F.rest.length}
						<section class="lc-g" id="at-rest" data-group="At rest">
							<div class="lc-gh"><span class="lc-gt">At rest</span><span class="lc-gn">{F.rest.length}</span><span class="lc-gr">{F.restApps} app{F.restApps === 1 ? "" : "s"}</span></div>
							<ul class="lc-rows">{#each F.rest as r (r.key)}<StrandRow rest={r} />{/each}</ul>
						</section>
					{/if}
				</ListCard>
			{:else if P.groups.length || P.rest.length}
				<div class="empty" data-list-empty data-filter-empty>
					<ListOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
					<p class="t-ui text-fg">No rollouts match</p>
					<p class="t-meta text-fg-subtle">Nothing in the list fits this search and these filters.</p>
					<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={() => setFilter(EMPTY_QUERY)}>Clear filters</button>
				</div>
			{:else}
				<div class="empty" data-list-empty>
					<ListOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
					<p class="t-ui text-fg">No rollouts yet</p>
					<p class="t-meta text-fg-subtle">Rollouts appear here as soon as one is deployed.</p>
				</div>
			{/if}
		</section>
		{#if src}<aside class="rail-side min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto" aria-label="Recent deploys and cadence" data-rollouts-side><RolloutsRail rollouts={src.rollouts} environments={src.environments} /></aside>{/if}
		</div>
	</div>
</div>

<style>
	/* the rail is sticky at every height it exists (lg+; 6.5rem = the 53px top bar + 24px above and below): taller than the viewport it scrolls inside itself, with a quiet scrollbar, so the right track is never empty beside the list */
	.rail-side { scrollbar-width: thin; scrollbar-color: var(--k-line) transparent; overscroll-behavior: contain; }
	section { scroll-margin-top: 16px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
	.chain { padding: 8px 16px 12px; border-top: 1px solid var(--k-line); }
	.chain p { margin: 0; }
	.chain-a { color: var(--k-fg-muted); text-decoration: underline; text-underline-offset: 2px; }
	.chain-a:hover { color: var(--k-fg); }
	@container (max-width: 600px) { .chain { padding: 8px 12px 12px; } }
</style>
