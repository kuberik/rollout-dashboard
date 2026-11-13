<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ENVIRONMENT PAGE (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/env-detail.html, LANGUAGE.md "Additions (env-detail…)", AD
	 * round 3 SIGNED). Route `/envs/<name>`: one environment (a tier), or one production region (`prod-<region>`).
	 * The operator's question: "what is running here, what is stuck or failing here and why, what arrives next?"
	 * Composition, top to bottom (every band is a shared component, the same one the reference page draws):
	 *   object header     PageHeader's object form: the tier chip + the environment's name, its counts, then the Environments tile's own state
	 *                     line and bar (EnvStateBar). An object page may have a title; the top bar says "Environments / prod".
	 *   banner            the lead failure here (FailureBanner, as /rollouts)
	 *   Attention         the other failures here + the approvals the viewer can give: FIGURE-led AttentionCards, as Home (no tier chip: the page is one tier)
	 *   Held              body concept B "Gangway" (owner-approved 2026-11-08): one GangwayTile per app with something waiting to enter THIS
	 *                     environment and held (its unlanded changes as beads in the environments before this one, then this box with the gate's word)
	 *   Ready to promote  the same tile, nothing holding it
	 *   Behind            apps here on an older build with nothing inbound: the same line, each with its "N behind"
	 *   In step           apps already on their newest build: one quiet line of monograms + names
	 *   Today in <env>    the deploys that reached this environment today (DayRow in a ListCard), folding at 8 rows
	 * New by design: GangwayTile and DayRow (see their comments). The sites-and-waves drawing and At rest / Arriving next are retired from this page. Composition lives in env-page.ts (unit-tested); this file draws.
	 */
	import { InboxOutline, GridOutline, ClockOutline, ArrowDownOutline, CheckOutline, PauseOutline, ArrowRightOutline } from 'flowbite-svelte-icons';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import FailureBanner from '../FailureBanner.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AttentionBand from '$lib/components/AttentionBand.svelte';
	import AttentionCard from '$lib/components/AttentionCard.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import EnvStateBar from '../EnvStateBar.svelte';
	import GangwayTile from './GangwayTile.svelte';
	import DayRow from './DayRow.svelte';
	import ListCard from '../ListCard.svelte';
	import { approvalTarget, truthAttrs } from '../data';
	import { plural } from '../envs-model';
	import { envTheme } from '../rollout-view';
	import type { HomeState } from '../data';
	import { newerNote, type EnvPage as Model } from './env-page';

	import { createQueries } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { publishHeldHere, heldKeyOfHref } from '$lib/view-models/held-here.svelte';
	import { heldHereOfDetail } from '$lib/view-models/held-here';
	import { publishGatePretty } from '$lib/view-models/gate-pretty.svelte';
	import { prettyMapOf } from '$lib/view-models/gate-pretty';
	let { state: hs, P }: { state: HomeState; /** the page's model (env-page.ts `envPage`), built inside FleetGate so it reads the live source */ P: Model } = $props();
	const b = $derived(P.banner);
	const G = $derived(P.gangway);
	/** the day list folds at 8 rows: the newest first, "Show N earlier" for the rest */
	const FOLD = 8;
	let open = $state(false);
	const shown = $derived(open ? G.today : G.today.slice(0, FOLD));
	const hidden = $derived(G.today.length - shown.length);
	/** the page's own width (the sidebar eats 232px from 640 up, so viewport breakpoints lie): the grid steps with the page, as Apps */
	let W = $state(0);
	const cols = $derived(W < 640 ? 1 : W < 1100 ? 2 : W < 1700 ? 3 : 4);
	/* round 2 B5: the held tiles' rollout details (the Gates tab's query key) give the builds each hold refuses HERE */
	const heldQueries = createQueries(() => ({
		queries: P.gangway.held.filter((t) => t.rolloutHref).map((t) => { const [, , cluster, ns, nm] = (t.rolloutHref as string).split('/'); return rolloutQueryOptions({ namespace: ns, name: nm, cluster, options: { staleTime: 15000, retry: false } }); })
	}));
	$effect(() => { heldQueries.forEach((q, i) => { const h = P.gangway.held.filter((t) => t.rolloutHref)[i]?.rolloutHref ?? null; const key = h ? heldKeyOfHref(h) : null; if (!q.data || !key) return; const [, , cluster, ns] = (h as string).split('/'); publishGatePretty(cluster, ns, prettyMapOf(q.data.rolloutGates)); publishHeldHere(key, heldHereOfDetail(q.data as never)); }); });
</script>

<div class="w-full px-4 py-6 sm:px-6" style="container-type:inline-size" bind:clientWidth={W} data-page="env" data-truth-page="env" data-truth-env={P.name}>
	<div class="flex min-w-0 flex-col gap-8" data-env-page>
		<PageHeader title={P.title} class="-mb-3">
			{#snippet leading()}<Chip role="env" theme={envTheme(P.tierKey)} label={P.tierKey} wide />{/snippet}
			{#snippet actions()}<span class="t-meta tabular-nums text-fg-subtle" data-env-counts>{P.meta}</span>{/snippet}
			{#snippet below()}<div class="mt-3 flex flex-col gap-3" data-env-state><EnvStateBar tile={P.tile} /></div>{/snippet}
		</PageHeader>

		{#if b}
			<div class="contents" data-truth-kind="banner" data-truth-app={b.row.app} data-truth-href={b.row.href} data-truth-group={b.row.group} {...truthAttrs(b.row)}>
				<FailureBanner {b}>
					{#snippet extra()}{#if b.newer}<span class="t-meta block text-fg-subtle" data-note>{newerNote(b.newer)}</span>{/if}{/snippet}
				</FailureBanner>
			</div>
		{/if}

		{#if P.attention.length}
			<section id="attention" data-section="attention">
				<SectionHeader title="Attention" icon={InboxOutline} rollup={P.attentionRollup} />
				<AttentionBand count={P.attention.length} cols={3}>
					{#each P.attention as a (a.key)}
						{@const act = a.failed ? null : a.href}
						<div class="contents" data-truth-kind="attention" data-truth-app={a.app} data-truth-href={a.href} data-truth-group={a.failed ? 'failed' : 'approval'} {...truthAttrs(a.row)}>
							<AttentionCard model={a.model} href={a.href} id={a.id} rollbackHref={a.rollbackHref ?? undefined} approve={a.failed ? null : approvalTarget(a.row, hs)} approveFallbackHref={act ?? undefined} note={a.newer ? newerNote(a.newer) : undefined} />
						</div>
					{/each}
				</AttentionBand>
			</section>
		{/if}

		{#if G.held.length}
			<section id="held" data-section="held">
				<SectionHeader title="Held" icon={PauseOutline} rollup={G.heldRollup} />
				<ul class="ap-grid" style="--cols:{cols}">{#each G.held as t (t.app)}<GangwayTile tile={t} />{/each}</ul>
			</section>
		{/if}

		{#if G.ready.length}
			<section id="ready" data-section="ready">
				<SectionHeader title="Ready to promote" icon={ArrowRightOutline} rollup={[plural(G.ready.length, 'app')]} />
				<ul class="ap-grid" style="--cols:{cols}">{#each G.ready as t (t.app)}<GangwayTile tile={t} />{/each}</ul>
			</section>
		{/if}

		{#if G.behind.length}
			<section id="behind" data-section="behind">
				<SectionHeader title="Behind" icon={ArrowDownOutline} rollup={[`${plural(G.behind.length, 'app')} on an older build`]} />
				<div class="instep" data-instep-behind>
					{#each G.behind as a (a.app)}<a href={a.href} class="instep-a instep-behind"><AppGlyph name={a.app} size={20} /><span class="whitespace-nowrap">{a.app}</span><span class="instep-why t-body text-fg-subtle tabular-nums">{a.place ? `${a.place} · ` : ''}{a.n} behind · {a.why}</span></a>{/each}
				</div>
			</section>
		{/if}

		{#if G.inStep.length}
			<section id="in-step" data-section="in-step">
				<SectionHeader title="In step" icon={CheckOutline} rollup={[`${plural(G.inStep.length, 'app')} on their newest build`]} />
				<div class="instep" data-instep>
					{#each G.inStep as a (a.app)}<a href={a.href} class="instep-a"><AppGlyph name={a.app} size={20} /><span>{a.app}</span></a>{/each}
				</div>
			</section>
		{/if}

		{#if G.today.length}
			<section id="today" data-section="today">
				<SectionHeader title="Today in {P.title}" icon={ClockOutline} rollup={G.todayRollup} />
				<ListCard>
					<ul class="lc-rows">{#each shown as r (r.key)}<DayRow row={r} />{/each}</ul>
					{#if hidden > 0}<button type="button" class="more btn btn-secondary" onclick={() => (open = true)} data-show-earlier>Show {hidden} earlier</button>{/if}
				</ListCard>
			</section>
		{/if}

		{#if P.empty}
			<div class="empty" data-list-empty>
				<GridOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
				<p class="t-ui text-fg">Nothing runs here yet</p>
				<p class="t-meta text-fg-subtle">A rollout deployed to this environment shows up here.</p>
			</div>
		{/if}
	</div>
</div>

<style>
	section { scroll-margin-top: 16px; }
	.ap-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); grid-auto-rows: auto; align-items: start; min-width: 0; }
	@media (max-width: 639.98px) { .ap-grid { gap: 12px; } }
	.instep { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 16px; border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); }
	.instep-a { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--k-fg-muted); }
	.instep-a:hover { color: var(--k-fg); }
	/* a Behind row carries a reason: on a phone it drops under the name (indented past the glyph) instead of squeezing the name onto two lines */
	.instep-behind { flex-wrap: wrap; }
	.instep-why { flex-basis: 100%; padding-left: 28px; }
	@media (min-width: 640px) { .instep-why { flex-basis: auto; padding-left: 0; } }
	.more { display: block; width: calc(100% - 32px); margin: 8px 16px 16px; }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
</style>
