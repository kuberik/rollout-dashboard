<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE /rollouts RAIL (R4, R6; owner 2026-11-21): two cards beside the list, the tab Overview's main + rail split (Home.svelte's FleetCard is the reference card).
	 *  Recent deploys   the last 8 deploys, rollbacks and failures across every rollout, each linking to its rollout. ActivityRail is the feed (the same
	 *                   component /namespaces/<name> draws, the same ActivitySentence /activity prints); only the card around it is new.
	 *  Deploy cadence   per APP, a quiet 14-day sparkline and its count. NEW BY DESIGN: no card shows frequency per app. It is a rail card and not a mark on
	 *                   the rows because it is an app fact while rows are app x environment (hello-world-app has 6): in a row it would repeat 3 to 6 times
	 *                   and push every row past two facts and one mark. Proportions are FleetCard's rows (40px, 16px gutters, AppGlyph + name + figure);
	 *                   the bars are one quiet ink, no state colour (a deploy is not good or bad news), square like every bar in the product.
	 * Each app's bars are scaled to its own busiest day (the shape of its rhythm; the figure carries the volume). Order: busiest app first (the card answers "what ships often"), name breaks ties. Below `lg` the rail stacks under the list in the same order.
	 */
	import { ClockOutline, ChartOutline } from 'flowbite-svelte-icons';
	import { createQuery } from '@tanstack/svelte-query';
	import Card from '$lib/components/Card.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import { clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { now } from '$lib/stores/time';
	import { deployCadence } from '../rollouts-cadence';
	import type { Environment, Rollout } from '../../../../types';

	const SHOWN = 8;
	const DAYS = 14;
	let { rollouts, environments }: { rollouts: Rollout[]; environments: Environment[] } = $props();
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const cadence = $derived(deployCadence(rollouts, $now.getTime(), DAYS));
	let all = $state(false);
	const cap = $derived(cadence.length - SHOWN === 1 ? SHOWN + 1 : SHOWN);
	const rows = $derived(all ? cadence : cadence.slice(0, cap));
	/* the card header's right side: the newest day's real deploy count ("133 today"), so the feed itself carries no day bar */
	let day = $state<{ label: string; n: number } | null>(null);
	const dayWords = $derived(!day ? '' : `${day.n} ${day.label === 'Today' ? 'today' : day.label.toLowerCase()}`);
	/* never a one-row fold */
	const hidden = $derived(cadence.length - rows.length);
</script>

<div class="flex min-w-0 flex-col gap-6" data-rollouts-rail>
	<Card icon={ClockOutline} title="Recent deploys" padded={false} class="rail-deploys">
			{#snippet rollup()}{#if dayWords}<span class="t-meta tabular-nums text-fg-subtle" data-rail-today>{dayWords}</span>{/if}{/snippet}
		<div data-rail-deploys>
			<!-- the feed's content is capped (--rail-row-max) so a wide rail keeps each time beside its sentence instead of 1000px away -->
			<div class="rail-feed"><ActivityRail {rollouts} {environments} limit={SHOWN} maxEntries={SHOWN} dayHeaders={false} onday={(d) => (day = d)} localClusterName={clusterQuery.data?.name || ''} /></div>
			<div class="flex border-t border-line-subtle px-4 pb-4 pt-3"><a href="/activity" class="btn btn-secondary btn-sm max-sm:w-full" data-rail-all-activity>All activity</a></div>
		</div>
	</Card>

	{#if cadence.length}
		<Card icon={ChartOutline} title="Deploy cadence" padded={false} class="rail-cadence">
			{#snippet rollup()}<span class="t-meta text-fg-subtle">last {DAYS} days</span>{/snippet}
			<ul class="m-0 list-none p-0" data-rail-cadence>
				{#each rows as a (a.app)}
					<li class="tap-zone cad-row relative min-h-10 min-w-0 px-4 py-1 hover:bg-hover" data-cadence-app={a.app}>
						<AppGlyph name={a.app} size={20} />
						<a href="/apps/{encodeURIComponent(a.app)}" class="tap-link t-body min-w-0 truncate text-fg">{a.app}</a>
						<span class="cad-bars flex h-5 min-w-0 items-end gap-0.5" role="img" aria-label="{a.total} deploys in the last {DAYS} days">
							{#each a.counts as c, i (i)}
								<span class="flex-1 {c > 0 ? 'bg-fg-subtle' : 'bg-line-strong'}" style="height: {c === 0 ? '2px' : `${Math.max(30, (c / Math.max(...a.counts)) * 100)}%`}"></span>
							{/each}
						</span>
						<span class="t-meta w-6 text-right tabular-nums text-fg-muted">{a.total}</span>
					</li>
				{/each}
			</ul>
			{#if hidden > 0 || (all && cadence.length > cap)}
				<div class="flex border-t border-line-subtle px-4 pb-4 pt-3"><button type="button" class="btn btn-secondary btn-sm max-sm:w-full" onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show ${hidden} more`}</button></div>
			{/if}
		</Card>
	{/if}
</div>

<style>
	/* name column, then a sparkline track that grows with the rail (clamped so a bar never becomes a slab: 14 bars in <= 20rem), then the count.
	   The feed above is capped to the same ~38rem so both cards end their content at one x at any width. */
	.cad-row { display: grid; grid-template-columns: 20px minmax(0, 12rem) minmax(5.25rem, 20rem) 1.5rem; column-gap: 8px; align-items: center; }
	.rail-feed { max-width: 38rem; }
</style>
