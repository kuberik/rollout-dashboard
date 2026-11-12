<script lang="ts">
	/**
	 * STAGES (change-stages r1) — "where is my change right now, and what is next?", drawn as the change's PIPELINE.
	 * ROLE: the page's centrepiece, replacing the header tier strip and "Where it runs". REFERENCE: the Gates tab's dotted canvas
	 * (`.canvas-dots`), GitHub Actions' run graph (tiles in dependency columns, one connector between columns, a tile per matrix group),
	 * Vercel's deployment steps (one mark + word per step). Card grammar (47px header, 16px icon, right rollup) is `Card`.
	 * WHY NOT an existing component: EnvRow draws environments only (no waves, no regions); RolloutGrid rows are per app. This is the one
	 * object that crosses tiers, waves and apps. Columns, lanes and the order of places come from TOPOLOGY (`stagesOf`), never from state:
	 * a state change repaints a mark and a word, it never moves, adds or drops anything. Fixed row height (44) for every state.
	 * Horizontal while every column fits at >= 160px; otherwise the SAME stages as a vertical list. Decided by width and column count only.
	 */
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import EmptyGlyph from '$lib/components/EmptyGlyph.svelte';
	import { ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import { envTheme } from '../rollout-view';
	import type { Stages, StageState, StagePlace } from './stages-model';

	let { stages, class: className = '' }: { stages: Stages; class?: string } = $props();

	const multiApp = $derived(stages.lanes.length > 1);
	const MIN = 160, CAP = 360, GAP = 24, LABEL = 168;
	let w = $state(0);
	const need = $derived(stages.columns.length * MIN + (stages.columns.length - 1) * GAP + (multiApp ? LABEL + GAP : 0) + 32);
	const horizontal = $derived(w === 0 || w >= need);
	const INK: Record<StageState, string> = { deployed: 'text-fg-muted', checking: 'text-progress', deploying: 'text-active', held: 'text-held', approval: 'text-held', failed: 'text-danger', notreached: 'text-fg-subtle', notaffected: 'text-fg-muted', replaced: 'text-fg-muted' };
	const ATTR: Record<StageState, string> = { deployed: 'done', checking: 'checking', deploying: 'deploying', held: 'held', approval: 'waiting', failed: 'failed', notreached: 'not-reached', notaffected: 'not-affected', replaced: 'not-affected' };
	const RUP: Record<string, string> = { danger: 'text-danger', held: 'text-held', progress: 'text-progress', active: 'text-active', muted: 'text-fg-subtle', fg: 'text-fg' };
	const colKey = (i: number) => `${stages.columns[i].tier}:${stages.columns[i].wave ?? 0}`;
	/* a lane's connector runs from its first tile to its last; an empty cell between two tiles lets it pass through */
	const passes = (cells: unknown[], i: number) => !cells[i] && cells.slice(0, i).some(Boolean) && cells.slice(i + 1).some(Boolean);
	const hasPrev = (cells: unknown[], i: number) => cells.slice(0, i).some(Boolean);
</script>

{#snippet colHead(i: number)}
	<div class="stg-ch flex min-w-0 items-center gap-2" data-stage-col={colKey(i)}>
		<Chip role="env" theme={envTheme(stages.columns[i].tier)} label={stages.columns[i].label} />
		{#if stages.columns[i].multi && stages.columns[i].wave}<span class="t-meta whitespace-nowrap text-fg-subtle">Wave {stages.columns[i].wave}</span>{/if}
	</div>
{/snippet}

{#snippet mark(s: StageState)}
	{#if s === 'deployed'}<span class="h-1.5 w-1.5 rounded-full bg-fg-disabled" aria-hidden="true"></span>
	{:else if s === 'notreached'}<EmptyGlyph class="h-4 w-4" />
	{:else if s === 'notaffected' || s === 'replaced'}<span class="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true"></span>
	{:else}<StatusMark state={(s === 'approval' ? 'held' : s) as never} />{/if}
{/snippet}

{#snippet row(p: StagePlace, sep: boolean, withApp: boolean)}
				<a href={p.href} class="stg-row {sep ? 'border-t border-line-subtle' : ''} flex h-11 min-w-0 items-center gap-2 px-3 hover:bg-hover" data-stage-row="{p.app}|{p.href}" data-stage-state={ATTR[p.state]}>
					<span class="flex h-4 w-4 shrink-0 items-center justify-center">{@render mark(p.state)}</span>
					<span class="flex min-w-0 flex-col">
						<span class="t-body flex min-w-0 items-center gap-2 text-fg">{#if withApp}<AppGlyph name={p.app} size={16} class="shrink-0" /><span class="truncate">{p.app}</span>{#if p.name !== p.tier && p.name !== 'production'}<span class="t-meta truncate text-fg-subtle">{p.name}</span>{/if}{:else}<span class="truncate">{p.name}</span>{/if}</span>
						<span class="t-meta flex min-w-0 gap-1 whitespace-nowrap {INK[p.state]}" title={p.word}><span class="truncate">{p.word}</span>{#if p.progress}<span class="shrink-0 text-fg-subtle">· step {p.progress}</span>{:else if p.age}<span class="shrink-0 text-fg-subtle">· {p.age}</span>{/if}</span>
					</span>
				</a>
{/snippet}

{#snippet tile(li: number, ci: number)}
	{@const cell = stages.lanes[li].cells[ci]}
	{#if cell}
		<div class="stg-tile {horizontal && hasPrev(stages.lanes[li].cells, ci) ? 'stg-link' : ''} min-w-0 rounded-lg border border-line bg-surface" data-stage-tile="{stages.lanes[li].app}|{colKey(ci)}">
			{#each cell.places as p, pi (p.href)}
				{@render row(p, pi > 0, false)}
			{/each}
		</div>
	{:else}
		<div class="stg-ph {passes(stages.lanes[li].cells, ci) ? 'stg-link stg-pass' : ''}" aria-hidden="true"></div>
	{/if}
{/snippet}

{#snippet lanelabel(li: number)}
	<div class="flex min-w-0 items-start gap-2 pt-[14px]"><AppGlyph name={stages.lanes[li].app} size={16} class="shrink-0" /><span class="t-card-title truncate text-fg" title={stages.lanes[li].app}>{stages.lanes[li].app}</span></div>
{/snippet}

<Card icon={ChevronDoubleRightOutline} title="Stages" padded={false} class={className}>
	{#snippet rollup()}<span class="stg-rollup t-card-rollup flex min-w-0 flex-nowrap items-baseline justify-end gap-x-1 whitespace-nowrap tabular-nums" data-stages-rollup>{#each stages.rollup.parts as part, i (part.text)}{#if i > 0}<span class="shrink-0 text-fg-disabled" aria-hidden="true">·</span>{/if}<span class="{RUP[part.ink]} {i === 0 ? 'stg-first min-w-0 truncate' : 'shrink-0'}" title={part.text}>{#if part.short}<span class="stg-long">{part.text}</span><span class="stg-short">{part.short}</span>{:else}{part.text}{/if}</span>{/each}</span>{/snippet}
	<div class="canvas-dots stg-canvas px-4 py-4" bind:clientWidth={w} data-stages data-stages-form={horizontal ? 'graph' : 'list'}>
		{#if horizontal}
			<div class="stg-graph grid w-full items-start gap-x-6 gap-y-3" style="justify-content: center; grid-template-columns: {multiApp ? '168px ' : ''}repeat({stages.columns.length}, minmax({MIN}px, {CAP}px));">
				{#if multiApp}<div></div>{/if}
				{#each stages.columns as _, i (i)}{@render colHead(i)}{/each}
				{#each stages.lanes as lane, li (lane.app)}
					{#if multiApp}{@render lanelabel(li)}{/if}
					{#each lane.cells as _, ci (ci)}{@render tile(li, ci)}{/each}
				{/each}
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#each stages.columns as _, i (i)}
					<div class="flex flex-col gap-2">
						{@render colHead(i)}
						{#if multiApp}
							<!-- one tile per stage on a phone: every app's places of this stage as rows, the app named on each (the lane labels of the graph) -->
							<div class="stg-tile min-w-0 rounded-lg border border-line bg-surface" data-stage-tile="*|{colKey(i)}">
								{#each stages.lanes as lane (lane.app)}{#each lane.cells[i]?.places ?? [] as p, pi (p.href)}
									{@render row(p, pi > 0 || lane !== stages.lanes.find((l) => l.cells[i]), true)}
								{/each}{/each}
							</div>
						{:else}
							{@render tile(0, i)}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Card>

<style>
	/* the rollup never wraps (the header stays 47px in every state): never wider than the card minus icon, title and padding; the muted count truncates first, the adverse parts never */
	.stg-rollup { max-width: calc(100cqw - 140px); overflow: hidden; }
	.stg-short { display: none; }
	@container (max-width: 559.98px) { .stg-long { display: none; } .stg-short { display: inline; } }
	.stg-tile { position: relative; }
	/* the connector: one 1px line in line-strong at the first row's mark centre (row 44px: centre 22px), from the previous tile across the 24px gap */
	.stg-link::before, .stg-pass::before { content: ''; position: absolute; top: 22px; height: 1px; background: var(--k-line-strong); }
	.stg-tile.stg-link { overflow: visible; }
	.stg-tile.stg-link::before { left: -24px; width: 24px; }
	.stg-ph { position: relative; }
	.stg-pass::before { left: -24px; right: -24px; }
	/* the tile clips its rows' hover fill to its radius without clipping the connector */
	.stg-tile > :global(a:first-child) { border-top-left-radius: 7px; border-top-right-radius: 7px; }
	.stg-tile > :global(a:last-child) { border-bottom-left-radius: 7px; border-bottom-right-radius: 7px; }
</style>
