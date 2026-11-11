<script lang="ts">
	/**
	 * APPS (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/apps.html, FINAL.md "Apps", LANGUAGE.md "Exceptions": Apps' attention items are
	 * APP TILES in their attention state, not the shared Attention card). The operator's question: "which app needs attention first, what runs where".
	 * Composition (the base's, owner 2026-11-08): section header on the PAGE SURFACE (no band card) "Attention" -> the LEAD tile (a framed Facia, the
	 * failure banner inside, only when an app fails) and the attention tiles in an even grid -> "In flight" -> "At rest" (grouped by STATE only; the
	 * "By repo" grouping was retired, owner 2026-11-08). Every app appears once; the old Starred / In motion / Quiet band cards are
	 * retired (stars live in the sidebar; state is on each tile). References: SectionHeader (icon, rollup), Facia (the tile), PromotionLane `fill`.
	 * All grouping lives in apps-page.ts (unit-tested); this file composes the data.
	 */
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { InboxOutline, ClockOutline, CheckOutline } from 'flowbite-svelte-icons';
	import { groupByState, attentionRollup } from './apps-page';
	import Facia from './Facia.svelte';
	import { maskLane as masked, nodeHref, NOISY } from './apps-lane';
	import { laneOf, approvalOf } from './Footprint.svelte';
	import { apps, changes, tabPill, fleetCounts, type TApp, type TRow } from './data';
	import { runwayRow, rowAction } from './rollout-view';
	import type { PageProps } from './pages';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy } from '$lib/api/errors';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import { buildLanes, type Lane, type LaneNode, type Tier } from '$lib/view-models/promotion-lanes';
	import { buildGateContext } from '$lib/view-models/blocking-story';
	import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import type { Rollout, Environment, RolloutDependency } from '../../../types';

	let { state: scenario }: PageProps = $props();

	const A = $derived(apps(scenario));
	/** each app's merged changes, newest first (the tile footer's last change and who ships to the app): data.ts changes(), nothing typed here */
	const changesOf = $derived.by(() => {
		const m = new Map<string, ReturnType<typeof changes>['items']>();
		for (const c of changes(scenario).items) for (const a of c.apps) m.set(a, [...(m.get(a) ?? []), c]);
		for (const [a, l] of m) m.set(a, [...l].sort((x, y) => y.mergedAt.localeCompare(x.mergedAt)));
		return m;
	});
	const built = $derived(new Map(A.items.map((a) => [a.app, laneOf(a, A.R.c.m as never, A.R.c.events as never)])));
	const byLast = (list: TApp[]) => [...list].sort((a, b) => (built.get(b.app)?.last ?? '').localeCompare(built.get(a.app)?.last ?? '') || a.app.localeCompare(b.app));
	/**
	 * G1/W4 — the needs band: data.ts's own needs group in its one urgency order (lead first), then every other app that
	 * waits for a person's approval anywhere (derived from Rollouts' Waiting-for-approval rows, oldest wait first).
	 * Attention = failing OR waiting for approval, as Rollouts' group counts it.
	 */
	/** C1 — the rows of Rollouts' Waiting-for-approval group for this state: the only source of an approval sentence, place words and age */
	const approvals = $derived((A.R.groups.find((g) => g.key === 'approval')?.rows ?? []) as TRow[]);
	const needs = $derived.by(() => {
		const base = (A.groups.find((g) => g.key === 'needs')?.rows ?? []) as TApp[];
		const have = new Set(base.map((a) => a.app));
		const extra = A.items.filter((a) => !have.has(a.app) && approvalOf(a, approvals)).sort((p, q) => (p.since ?? '').localeCompare(q.since ?? '') || p.app.localeCompare(q.app));
		const all = [...base, ...extra];
		/* C4 — one urgency rule: Rollouts' lead (its Runway's subject) leads the band when its app is in it … */
		const lead = runwayRow(A.R.rows)?.app;
		const i = all.findIndex((a) => a.app === lead);
		const ordered = i > 0 ? [all[i], ...all.slice(0, i), ...all.slice(i + 1)] : all;
		/* … L3 — one ordering rule: an item the viewer can act on (Approve, Roll back) leads before one they cannot (stable) */
		const can = (a: TApp) => !!a.row && !!rowAction(a.row) || !!approvalOf(a, approvals) && !!rowAction(approvalOf(a, approvals)!.row);
		const out = [...ordered.filter(can), ...ordered.filter((a) => !can(a))];
		/* apps-11 AS5 — ONE lead rule: the lead is the thing the rollup names. When nothing fails, the rollup says "N waiting for approval", so the lead is the first app that waits on a person
		   (its banner carries the ask + Review approval); an app whose place is only CHECKING leads solely when nothing waits on a person. */
		/* apps-12 AT2: an app is "waiting" ONLY when one of its cells says Waiting; the lead is the first failing app, else the first app a cell says is Waiting (one an actionable viewer can approve first), else the rest (Checking) */
		const rank = (a: TApp) => (worst(a) === 'failed' ? 0 : worst(a) === 'approval' ? 1 : 2);
		const mine = (a: TApp) => { const r = approvalOf(a, approvals)?.row ?? a.row; return !!r && !!rowAction(r); };
		return [...out].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? Number(mine(b)) - Number(mine(a)) : 0));
		return out;
	});
	/** each app counted ONCE by its worst state: failing, else waiting for approval, else its own group's kind */
	/* apps-12 AT2: 'approval' = a cell of the app says Waiting (its place is awaiting a person's approval); an approval queued behind a check is 'checking' */
	const waitsCell = (a: TApp) => a.placeList.some((p) => p.state === 'awaiting-approval');
	const worst = (a: TApp) => (a.glyph === 'failed' && a.group === 'needs' ? 'failed' : waitsCell(a) ? 'approval' : approvalOf(a, approvals) || a.group === 'needs' ? 'checking' : 'other');
	const failing = $derived(needs.filter((a) => worst(a) === 'failed').length);
	const waiting = $derived(needs.filter((a) => worst(a) === 'approval').length);
	/** r34 truth-5: the header's approval fact is PLACES, fleetCounts().places.approval, the one number /rollouts, /environments and /envs/prod print (a place that is checking AND gated counts here and is not a second "checking") */
	const waitingPlaces = $derived(fleetCounts(scenario).places.approval);
	const rowWordOf = (a: TApp) => { const r = approvalOf(a, approvals)?.row ?? a.row; return r ? tabPill({ href: r.href }).word : ''; };
	const checking = $derived(needs.filter((a) => worst(a) === 'checking' && rowWordOf(a) === 'CHECKING').length);
	const calm = $derived(scenario !== 'incident' && !failing);
	/** r6 P8 — the nav badge counts the places that need the VIEWER (Rollouts rows with needsYou); the band says how many of its apps those are, so the two numbers reconcile */
	const yours = $derived(new Set(A.R.rows.filter((r) => r.needsYou && needs.some((a) => a.app === r.app)).map((r) => r.app)).size);
	const claimed = $derived(new Set(needs.map((a) => a.app)));
	/** every app the Attention section does not claim, split by state: In flight, then At rest (newest activity first) */
	const rest = $derived(A.items.filter((a) => !claimed.has(a.app)));
	const byState = $derived(groupByState(byLast(rest)));
	/** the lead tile: the first failing app (its banner is the page's one alert); calm pages have none */
	const lead = $derived(needs.length && worst(needs[0]) === 'failed' ? needs[0] : null);
	const attn = $derived(lead ? needs.slice(1) : needs);
	const rollup = $derived(attentionRollup({ failing, approval: waiting, yours }));
	/**
	 * L1 — the strip IS the tab's: the same fleet list the rollout Overview reads (`rolloutsListQueryOptions`), the same
	 * `buildRolloutCards` (gate context + contract holds) and `buildLanes`, so a node's state and its "N builds behind"
	 * are the Overview's own. Until the list answers (or for an app it does not carry) the model-built lane stands in.
	 * TODO(truth): the Overview also folds the open rollout's own gates + schedules into the gate context; those are per-tab queries.
	 */
	const listQuery = createQuery(() => rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 300_000) } }));
	const realLanes = $derived.by(() => {
		const d = listQuery.data;
		if (!d?.rollouts?.items?.length) return new Map<string, Lane>();
		const rollouts = d.rollouts.items as Rollout[];
		const envs = (d.environments?.items ?? []) as Environment[];
		const gates = buildGateContext({ environments: d.environments ? { items: envs } : null, rolloutDependencies: d.rolloutDependencies ?? null, rollouts, rolloutGates: null });
		const net = buildRolloutGraph({
			rollouts, environments: envs, dependencies: (d.rolloutDependencies?.items ?? []) as RolloutDependency[],
			envOrder: [...new Set(envs.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(compareEnvironmentNames), gates
		});
		const cards = buildRolloutCards(rollouts, envs, $now, gates, (r) => contractHoldsForRollout(net, r));
		return new Map(buildLanes(cards).map((l) => [l.app, l]));
	});
	/**
	 * A1 — the strip's states are the SAME scenario-masked row states the pill uses (`TApp.placeList`, from rows(state)),
	 * never the raw health the list query carries: a node whose masked place is not failing/held/moving is drawn neutral
	 * (newest, or behind when it lags), a node whose masked place is in a state takes that state. The lead is re-picked.
	 */
	/**
	 * r6 P3 — ONE tinted cell per strip, and it is the focus place (the place the tile's state lives in: its approval row, else its
	 * worst row). PromotionLane tints only `lane.lead`, so the lead is handed the focus node; a focus in a prod SET has no node tint
	 * (the squares carry it) and a quiet app has none.
	 */
	const focusHref = (a: TApp, attention: boolean) => (attention && a.group !== 'needs' ? approvalOf(a, approvals)?.row : null)?.href ?? a.row?.href ?? null;
	function refocus(lane: Lane, href: string | null): Lane {
		const hit = href ? [...lane.stages, ...lane.prod].find((n) => nodeHref(n) === href) : null;
		const set = lane.prod.length > 1;
		/* every other cell keeps its state: outline + word (owner §6) */
		/* owner §6 (2026-11-02): every cell keeps its own state (the strip draws non-lead cells as outlines only, as the tab does) */
		const calmer = (n: LaneNode): LaneNode => n;
		const stages = lane.stages.map(calmer);
		const prod = set ? lane.prod : lane.prod.map(calmer);
		const byTier: Lane['byTier'] = {};
		for (const [t, ns] of Object.entries(lane.byTier)) byTier[t as Tier] = t === 'prod' ? prod : stages.filter((n) => n.tier === t);
		const lead = hit && NOISY.has(hit.state) && !(hit.tier === 'prod' && set) ? [...stages, ...prod].find((n) => nodeHref(n) === href) ?? null : null;
		return { ...lane, byTier, stages, prod, lead, state: lead?.state ?? lane.state };
	}
	const laneFor = (a: TApp, attention = false) => { const l = realLanes.get(a.app); return refocus(l ? masked(a, l) : built.get(a.app)!.lane, a.group === 'quiet' && !/^Ready to promote/.test(a.fact) ? null : focusHref(a, attention)); };
	/** the page's own width (the sidebar eats 232px from 640 up, so viewport breakpoints lie) */
	let W = $state(0);
	/** ONE column rule for every grid on the page (kit .apgrid): 1 on a phone, 2, 3 from a 1700px main, 4 from 2400px; a short last row stays short */
	const cols = $derived(W < 640 ? 1 : W < 1650 ? 2 : W < 2350 ? 3 : 4);
	/** apps-8 AP5: a band's last tile alone in its row (n % cols === 1, n > 1) spans the row, never a lone tile beside empty slots */
	/** r2 apps: a band's LAST tile takes the tracks its row leaves empty (n tiles in c columns: c − ((n − 1) mod c)), so no band ends beside a hole; 1 = no span */
	const leftover = (_i: number, _n: number, _c: number) => 1; // owner 2026-11-08: no tile spans a row; a short last row stays short
	const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
</script>

{#snippet mapLink()}<a href="/dependencies" class="nav-link" data-service-map-link aria-label="Service map"><span class="sm:hidden">Map</span><span class="hidden sm:inline">Service map</span> ›</a>{/snippet}

{#snippet tile(a: TApp, o: { lead?: boolean; attention?: boolean; span?: number } = {})}
	<Facia span={o.span ?? 1} framed={!!o.lead} recent={changesOf.get(a.app) ?? []} item={a} lane={laneFor(a, !!o.attention)} {approvals} {scenario} {calm} lead={!!o.lead} attention={!!o.attention} last={built.get(a.app)?.last ?? null} />
{/snippet}

<div class="w-full px-4 py-6 sm:px-6" style="container-type:inline-size" bind:clientWidth={W} data-page="apps" data-truth-page="apps">
	<h1 class="sr-only">Apps</h1>
	<div class="flex min-w-0 flex-col gap-8" data-apps-page>
		{#if needs.length}
			<section id="attention" data-section="attention" data-band="needs">
				<SectionHeader title="Attention" icon={InboxOutline} {rollup}>{#snippet action()}{@render mapLink()}{/snippet}</SectionHeader>
				<div class="ap-stack">
					{#if lead}<ul class="ap-lead">{@render tile(lead, { lead: true, attention: true })}</ul>{/if}
					{#if attn.length}<ul class="ap-grid" style="--cols:{cols}">
						{#each attn as a, i (a.app)}{@render tile(a, { attention: true, span: leftover(i, attn.length, cols) })}{/each}
					</ul>{/if}
				</div>
			</section>
		{:else}
			<p class="t-meta text-fg-subtle" data-band="calm">Nothing needs attention.</p>
		{/if}

		{#if byState.inFlight.length}
			<section id="in-flight" data-section="in-flight" data-band="in-flight">
				<SectionHeader title="In flight" icon={ClockOutline} rollup={[plural(byState.inFlight.length, 'app')]}>{#snippet action()}{#if !needs.length}{@render mapLink()}{/if}{/snippet}</SectionHeader>
				<ul class="ap-grid" style="--cols:{cols}">{#each byState.inFlight as a (a.app)}{@render tile(a)}{/each}</ul>
			</section>
		{/if}

		{#if byState.atRest.length}
			<section id="at-rest" data-section="at-rest" data-band="at-rest">
				<SectionHeader title="At rest" icon={CheckOutline} rollup={[plural(byState.atRest.length, 'app')]}>{#snippet action()}{#if !needs.length && !byState.inFlight.length}{@render mapLink()}{/if}{/snippet}</SectionHeader>
				<ul class="ap-grid" style="--cols:{cols}">{#each byState.atRest as a (a.app)}{@render tile(a)}{/each}</ul>
			</section>
		{/if}
	</div>
</div>

<style>
	section { scroll-margin-top: 16px; }
	/* kit .apstack / .apgrid: tiles are 16px apart everywhere (the page's card gap); repo groups are 8px further apart */
	.ap-stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
	.ap-lead { list-style: none; margin: 0; padding: 0; display: flex; min-width: 0; }
	.ap-lead > :global(li) { flex: 1 1 0; }
	.ap-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); grid-auto-rows: auto; align-items: start; min-width: 0; }
	@media (max-width: 639.98px) { .ap-grid { gap: 12px; } .ap-stack { gap: 12px; } }
</style>
