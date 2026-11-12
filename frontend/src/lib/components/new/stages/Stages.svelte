<script lang="ts">
	/**
	 * STAGES (change-stages r1; shared in cs3: Change page, App view, Rollout overview all mount THIS) — "where is my change / release right now, and what is next?", drawn as one PIPELINE. The scope (change | app | rollout) lives in the model; this component only renders a `Stages`.
	 * ROLE: the page's centrepiece, replacing the header tier strip and "Where it runs". REFERENCE: the Gates tab's dotted canvas
	 * (`.canvas-dots`), GitHub Actions' run graph (tiles in dependency columns, one connector between columns, a tile per matrix group),
	 * Vercel's deployment steps (one mark + word per step). Card grammar (47px header, 16px icon, right rollup) is `Card`.
	 * WHY NOT an existing component: EnvRow draws environments only (no waves, no regions); RolloutGrid rows are per app. This is the one
	 * object that crosses tiers, waves and apps. Columns, lanes and the order of places come from TOPOLOGY (`stagesOf`), never from state:
	 * a state change repaints a mark and a word, it never moves, adds or drops anything. Fixed row height (44) for every state.
	 * Horizontal while every column fits at >= 160px; otherwise the SAME stages as a vertical list. Decided by width and column count only.
	 */
	import Card from '$lib/components/Card.svelte';
	import CauseText from '$lib/components/CauseText.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import EmptyGlyph from '$lib/components/EmptyGlyph.svelte';
	import { ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import { envTheme } from '../rollout-view';
	import type { Stages, StageState, StagePlace, StageColumn } from './stages-model';

	let { stages, class: className = '' }: { stages: Stages; class?: string } = $props();

	const multiApp = $derived(stages.lanes.length > 1);
	const MIN = 160, CAP = 280, GAP_TIER = 24, GAP_WAVE = 12, LABEL = 168;
	let w = $state(0);
	/* tier groups: one env chip spans all of a tier's wave columns; "Wave N" sub-labels sit over each wave column of a multi-wave tier */
	const groups = $derived.by(() => {
		const out: { tier: StageColumn['tier']; label: string; first: number; last: number; multi: boolean }[] = [];
		stages.columns.forEach((c, i) => {
			const g = out[out.length - 1];
			if (g && g.tier === c.tier) g.last = i;
			else out.push({ tier: c.tier, label: c.label, first: i, last: i, multi: c.multi });
		});
		return out;
	});
	const anyMulti = $derived(groups.some((g) => g.multi));
	/* the gap before column i: 12px inside a tier's waves, 24px between tiers (the connector spans it) */
	const gapBefore = (i: number) => (i > 0 && stages.columns[i - 1].tier === stages.columns[i].tier ? GAP_WAVE : i > 0 ? GAP_TIER : 0);
	const px = (n: number) => n + 'px';
	const base = $derived(multiApp ? 3 : 1);
	const track = (i: number) => base + 2 * i;
	const gridCols = $derived((multiApp ? [LABEL, GAP_TIER].map(px).join(' ') + ' ' : '') + stages.columns.map((_, i) => (i ? px(gapBefore(i)) + ' ' : '') + 'minmax(' + [MIN, CAP].map(px).join(', ') + ')').join(' '));
	const needW = $derived(stages.columns.length * MIN + stages.columns.reduce((n, _, i) => n + gapBefore(i), 0) + (multiApp ? LABEL + GAP_TIER : 0) + 32);
	const horizontal = $derived(w === 0 || w >= needW);
	const laneRow = (li: number) => 2 + (anyMulti ? 1 : 0) + li;
	const INK: Record<StageState, string> = { deployed: 'text-fg-muted', checking: 'text-progress', deploying: 'text-active', held: 'text-held', approval: 'text-held', failed: 'text-danger', notreached: 'text-fg-subtle', notaffected: 'text-fg-muted', replaced: 'text-fg-muted' };
	const ATTR: Record<StageState, string> = { deployed: 'done', checking: 'checking', deploying: 'deploying', held: 'held', approval: 'waiting', failed: 'failed', notreached: 'not-reached', notaffected: 'not-affected', replaced: 'not-affected' };
	const RUP: Record<string, string> = { danger: 'text-danger', held: 'text-held', progress: 'text-progress', active: 'text-active', muted: 'text-fg-subtle', fg: 'text-fg' };
	const colKey = (i: number) => `${stages.columns[i].tier}:${stages.columns[i].wave ?? 0}`;
	/* a lane's connector runs from its first tile to its last; an empty cell between two tiles lets it pass through */
	const passes = (cells: unknown[], i: number) => !cells[i] && cells.slice(0, i).some(Boolean) && cells.slice(i + 1).some(Boolean);
	const hasPrev = (cells: unknown[], i: number) => cells.slice(0, i).some(Boolean);
	/* the tile's place name only when it says something the column does not (the tier, "production": the state word takes line 1) */
	const echoes = (p: StagePlace) => p.name === p.tier || p.name === 'production';
</script>

{#snippet tierHead(g: { tier: StageColumn['tier']; label: string; first: number; last: number })}
	<div class="stg-ch flex min-w-0 items-center" data-stage-col={g.tier}>
		<Chip role="env" theme={envTheme(g.tier)} label={g.label} />
	</div>
{/snippet}

{#snippet waveHead(i: number)}
	<span class="t-meta whitespace-nowrap text-fg-subtle" data-stage-col={colKey(i)}>Wave {stages.columns[i].wave}</span>
{/snippet}

{#snippet mark(s: StageState)}
	{#if s === 'deployed'}<span class="h-1.5 w-1.5 rounded-full bg-fg-disabled" aria-hidden="true"></span>
	{:else if s === 'notreached'}<EmptyGlyph class="h-4 w-4" />
	{:else if s === 'notaffected' || s === 'replaced'}<span class="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true"></span>
	{:else}<StatusMark state={(s === 'approval' ? 'held' : s) as never} />{/if}
{/snippet}

{#snippet row(p: StagePlace, sep: boolean, withApp: boolean)}
	{@const echo = !withApp && echoes(p)}
	{@const tail = [p.build, p.progress ? `step ${p.progress}` : p.age].filter(Boolean)}
				<a href={p.href} aria-current={p.here ? 'location' : undefined} class="stg-row {p.here ? 'stg-here' : ''} {sep ? 'border-t border-line-subtle' : ''} flex h-11 min-w-0 items-center gap-2 px-3 hover:bg-hover" data-stage-row="{p.app}|{p.href}" data-stage-state={ATTR[p.state]}>
					<span class="flex h-4 w-4 shrink-0 items-center justify-center">{@render mark(p.state)}</span>
					<span class="flex min-w-0 flex-col">
						{#if echo}
							<!-- the place is the tier itself: line 1 is the state word, line 2 the build / step / age -->
							<span class="t-body flex min-w-0 items-center truncate {INK[p.state]}" title={p.word}>{#if p.cause}<CauseText parts={p.cause} />{:else}{p.word}{/if}</span>
							<span class="t-meta flex min-w-0 gap-1 whitespace-nowrap text-fg-subtle">{#each tail as t, ti (ti)}{#if ti > 0}<span aria-hidden="true">·</span>{/if}<span class="{ti === 0 && p.build ? 't-code ' : ''}truncate">{t}</span>{/each}{#if !tail.length}{'\u00a0'}{/if}</span>
						{:else}
							<span class="t-body flex min-w-0 items-center gap-2 {p.state === 'notreached' ? 'text-fg-muted' : 'text-fg'}">{#if withApp}<AppGlyph name={p.app} size={16} class="shrink-0" /><span class="truncate">{p.app}</span>{#if p.name !== p.tier && p.name !== 'production'}<span class="t-meta truncate text-fg-subtle">{p.name}</span>{/if}{:else}<span class="truncate">{p.name}</span>{/if}</span>
							<span class="t-meta flex min-w-0 gap-1 whitespace-nowrap {INK[p.state]}" title={p.word}><span class="flex min-w-0 items-center truncate">{#if p.cause}<CauseText parts={p.cause} />{:else}{p.word}{/if}</span>{#if p.build}<span class="t-code shrink-0 text-fg-subtle">· {p.build}</span>{/if}{#if p.progress}<span class="shrink-0 text-fg-subtle">· step {p.progress}</span>{:else if p.age}<span class="shrink-0 text-fg-subtle">· {p.age}</span>{/if}</span>
						{/if}
					</span>
				</a>
{/snippet}

{#snippet tile(li: number, ci: number)}
	{@const cell = stages.lanes[li].cells[ci]}
	{#if cell}
		<div class="stg-tile {horizontal && hasPrev(stages.lanes[li].cells, ci) ? 'stg-link' : ''} {cell.places.some((p) => p.live) ? 'is-live' : ''} {cell.places.every((p) => p.state === 'notreached') ? 'stg-quiet' : ''} min-w-0 border border-line bg-surface" style="--g: {gapBefore(ci)}px" data-stage-tile="{stages.lanes[li].app}|{colKey(ci)}" style:grid-column={horizontal ? track(ci) : undefined} style:grid-row={horizontal ? laneRow(li) : undefined}>
			{#each cell.places as p, pi (p.href)}
				{@render row(p, pi > 0, false)}
			{/each}
		</div>
	{:else}
		<div class="stg-ph {passes(stages.lanes[li].cells, ci) ? 'stg-link stg-pass' : ''}" style="--g: {gapBefore(ci)}px; --gr: {gapBefore(ci + 1)}px" style:grid-column={horizontal ? track(ci) : undefined} style:grid-row={horizontal ? laneRow(li) : undefined} aria-hidden="true"></div>
	{/if}
{/snippet}

{#snippet lanelabel(li: number)}
	<div class="flex min-w-0 items-start gap-2 pt-[14px]" style:grid-column="1" style:grid-row={laneRow(li)}><AppGlyph name={stages.lanes[li].app} size={16} class="shrink-0" /><span class="t-card-title truncate text-fg" title={stages.lanes[li].app}>{stages.lanes[li].app}</span></div>
{/snippet}

<Card icon={ChevronDoubleRightOutline} title="Stages" padded={false} class={className}>
	{#snippet rollup()}<span class="stg-rollup t-card-rollup flex min-w-0 flex-nowrap items-baseline justify-end gap-x-1 whitespace-nowrap tabular-nums" data-stages-rollup>{#each stages.rollup.parts as part, i (part.text)}{#if i > 0}<span class="shrink-0 text-fg-disabled" aria-hidden="true">·</span>{/if}<span class="{RUP[part.ink]} {i === 0 ? 'stg-first min-w-0 truncate' : 'shrink-0'}" title={part.text}>{#if part.short}<span class="stg-long">{part.text}</span><span class="stg-short">{part.short}</span>{:else}{part.text}{/if}</span>{/each}</span>{/snippet}
	<div class="canvas-dots stg-canvas px-4 py-4" bind:clientWidth={w} data-stages data-stages-form={horizontal ? 'graph' : 'list'}>
		{#if horizontal}
			<!-- tiles top-aligned, never stretched to the lane (coordinator ruling: a one-place tile keeps its own height); the header rows and the tiles are placed on explicit tracks, with 12px between a tier's waves and 24px between tiers -->
			<div class="stg-graph grid w-full items-start gap-y-3" style="grid-template-columns: {gridCols};">
				{#each groups as g (g.tier)}
					<div class="min-w-0 self-start" style="grid-column: {track(g.first)} / {track(g.last) + 1}; grid-row: 1;">{@render tierHead(g)}</div>
					{#if g.multi}{#each stages.columns as _, i (i)}{#if i >= g.first && i <= g.last}<div class="min-w-0 self-start" style="grid-column: {track(i)}; grid-row: 2;">{@render waveHead(i)}</div>{/if}{/each}{/if}
				{/each}
				{#each stages.lanes as lane, li (lane.app)}
					{#if multiApp}{@render lanelabel(li)}{/if}
					{#each lane.cells as _, ci (ci)}{@render tile(li, ci)}{/each}
				{/each}
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#each groups as g (g.tier)}
					<div class="flex flex-col gap-2">
						{@render tierHead(g)}
						{#each stages.columns as _, i (i)}{#if i >= g.first && i <= g.last}
							{#if g.multi}{@render waveHead(i)}{/if}
							{#if multiApp}
								<!-- one tile per stage on a phone: every app's places of this stage as rows, the app named on each (the lane labels of the graph) -->
								<div class="stg-tile {stages.lanes.some((l) => l.cells[i]?.places.some((p) => p.live)) ? 'is-live' : ''} {stages.lanes.every((l) => (l.cells[i]?.places ?? []).every((p) => p.state === 'notreached')) ? 'stg-quiet' : ''} border border-line bg-surface" data-stage-tile="*|{colKey(i)}">
									{#each stages.lanes as lane (lane.app)}{#each lane.cells[i]?.places ?? [] as p, pi (p.href)}
										{@render row(p, pi > 0 || lane !== stages.lanes.find((l) => l.cells[i]), true)}
									{/each}{/each}
								</div>
							{:else}
								{@render tile(0, i)}
							{/if}
						{/if}{/each}
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
	/* graph group: start-aligned at the card padding; centred only past 2300 where the 280px column cap leaves space (the Gates canvas rule for very wide) */
	.stg-graph { justify-content: start; }
	@media (min-width: 2300px) { .stg-graph { justify-content: center; } }
	.stg-tile { position: relative; border-radius: 8px; }
	/* a place the pipeline has not reached: quieter, no surface fill, dashed hairline (style only: same box, same rows) */
	.stg-tile.is-live { border-color: var(--k-active-line); box-shadow: var(--k-glow-active); }
	.stg-tile.stg-quiet { background: var(--k-ground); border-style: dashed; border-color: var(--k-line); }
	/* rollout scope: the place being viewed rests on the hover fill (same row size and position, no new hue) */
	.stg-row.stg-here { background: var(--k-hover); }
	/* the connector: one 1px line in line-strong at the first row's mark centre (row 44px: centre 22px), from the previous tile across the 24px gap */
	.stg-link::before, .stg-pass::before { content: ''; position: absolute; top: 22px; height: 1px; background: var(--k-line-strong); }
	.stg-tile.stg-link { overflow: visible; }
	.stg-tile.stg-link::before { left: calc(-1 * var(--g)); width: var(--g); }
	.stg-ph { position: relative; }
	.stg-pass::before { left: calc(-1 * var(--g)); right: calc(-1 * var(--gr)); }
	/* the tile clips its rows' hover fill to its radius without clipping the connector */
	.stg-tile > :global(a:first-child) { border-top-left-radius: 7px; border-top-right-radius: 7px; }
	.stg-tile > :global(a:last-child) { border-bottom-left-radius: 7px; border-bottom-right-radius: 7px; }
</style>
