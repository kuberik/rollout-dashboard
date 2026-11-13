<script lang="ts">
	/**
	 * PIPELINE (app-pipeline r0; lineage: the Stages graph of change-stages r1-r2, 51c97714) — "how far has our newest release got: which sites run it, which one is moving now, what has it not reached yet?", drawn as one PIPELINE on the App page's Pipeline tab. The scope (change | app) lives in the model; this component only renders a `Stages`.
	 * r0 changes vs the Change page's drawing: a row's mark and each "Wave N" label's pie are the strip's own `WaveMark` (one vocabulary for a site, a wave and a tier), a RELEASE LINE (build · commit · author · built ago, a link to the change) opens the canvas, a tier's header is its chip and a hairline across all its waves, and every row links to its rollout.
	 * ROLE: the page's centrepiece, replacing the header tier strip and "Where it runs". REFERENCE: the Gates tab's dotted canvas
	 * (`.canvas-dots`), GitHub Actions' run graph (tiles in dependency columns, one connector between columns, a tile per matrix group),
	 * Vercel's deployment steps (one mark + word per step). Card grammar (47px header, 16px icon, right rollup) is `Card`.
	 * WHY NOT an existing component: EnvRow draws environments only (no waves, no regions); RolloutGrid rows are per app. This is the one
	 * object that crosses tiers, waves and apps. Columns, lanes and the order of places come from TOPOLOGY (`stagesOf`), never from state:
	 * a state change repaints a mark and a word, it never moves, adds or drops anything. Fixed row height (44) for every state.
	 * Horizontal while every column fits at >= 160px; otherwise the SAME stages as a vertical list. Decided by width and column count only.
	 */
	import { toneInk, hueInk } from '$lib/view-models/state-tone';
	import Card from '$lib/components/Card.svelte';
	import CauseText from '$lib/components/CauseText.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
		import WaveMark from '$lib/components/WaveMark.svelte';
	import { waveMark } from '$lib/view-models/wave-mark';
	import { page } from '$app/state';
	import { href as toHref } from '$lib/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarSrc } from '../data';
	import { ChevronDoubleRightOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import { envTheme } from '../rollout-view';
	import { columnWidth, MIN_TAIL, TAIL_BESIDE, SITE_MARK as SITE, type Stages, type StageState, type StagePlace, type StageColumn, type ReleaseLine, type RailItem } from './stages-model';

	let { stages, release = null, rail = null, class: className = '' }: { stages: Stages; /** the release line that opens the canvas (app scope) */ release?: ReleaseLine | null; /** the RELEASE RAIL's rows (app scope, oldest first); drawn only with 2+ in flight */ rail?: RailItem[] | null; class?: string } = $props();
	/* overflow cue: a fade on the end edge of the rail scroller, only while it is not scrolled to the end (mask only: no geometry) */
	let listEl = $state<HTMLElement | null>(null);
	let moreV = $state(false), moreH = $state(false);
	function measure() {
		const e = listEl;
		if (!e) return;
		moreV = e.scrollHeight - e.clientHeight > 1 && e.scrollTop + e.clientHeight < e.scrollHeight - 1;
		moreH = e.scrollWidth - e.clientWidth > 1 && e.scrollLeft + e.clientWidth < e.scrollWidth - 1;
	}
	$effect(() => {
		const e = listEl;
		if (!e) return;
		measure();
		e.addEventListener('scroll', measure, { passive: true });
		const ro = new ResizeObserver(measure);
		ro.observe(e);
		return () => { e.removeEventListener('scroll', measure); ro.disconnect(); };
	});
	/* THE SELECTED ROW IS ALWAYS IN VIEW: on load, on every selection change and when the form flips, the rail's OWN scroller is moved (scrollTop beside the canvas, scrollLeft above it) so the row is fully visible. Never the page, never animated. Runs after the DOM update and before paint. */
	const FADE = 24; /* the end-edge fade is 24px: keep the row clear of it (the browser clamps at the true end) */
	$effect(() => {
		const e = listEl, sel = stages.release;
		void side;
		if (!e || !sel) return;
		const row = e.querySelector<HTMLElement>(`[data-release-row="${CSS.escape(sel)}"]`);
		if (!row) return;
		const a = e.getBoundingClientRect(), b = row.getBoundingClientRect();
		const top = b.top - a.top + e.scrollTop, left = b.left - a.left + e.scrollLeft;
		if (top < e.scrollTop) e.scrollTop = top; else if (top + b.height + FADE > e.scrollTop + e.clientHeight) e.scrollTop = top + b.height + FADE - e.clientHeight;
		if (left < e.scrollLeft) e.scrollLeft = left; else if (left + b.width + FADE > e.scrollLeft + e.clientWidth) e.scrollLeft = left; /* a snap point (snap-align start; the browser clamps it to the end), so snapping cannot pull the row back out of view */
		measure();
	});
	const showRail = $derived(!!rail && rail.length >= 2);
	/* a visible rail row shows the selected release: decided by the rows, not by the layout */
	const inRail = $derived(showRail && !!rail?.some((it) => it.build === release?.build));
	/* a row's link keeps every other query param (calm=1 ...) and sets release */
	const railHref = (build: string) => { const sp = new URLSearchParams(page.url.search); sp.set('release', build); return page.url.pathname + '?' + sp.toString(); };

	const multiApp = $derived(stages.lanes.length > 1);
	const RAIL = 264, COMFY = 195, MIN = 148,  CAP = 280, GAP_TIER = 24, GAP_WAVE = 12, LABEL = 168;
	let w = $state(0);
	/* the card body's width (not the canvas's: the canvas depends on the form this decides) */
	let bw = $state(0);
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
	/* a tile that carries a build tail (app scope, decided by scope alone, never by state): at a tile of 192px or more the build sits beside the state word on line 2; below that EVERY app-scope row stacks it on its own line 3 (see `.stg-tail` below), so the widest unit of text is the build itself (~70px) and 150px columns show every word and build in full. Change scope keeps 148 */
	const minCol = $derived(stages.release ? MIN_TAIL : MIN);
	const gridCols = $derived((multiApp ? [LABEL, GAP_TIER].map(px).join(' ') + ' ' : '') + stages.columns.map((_, i) => (i ? px(gapBefore(i)) + ' ' : '') + 'minmax(' + [minCol, CAP].map(px).join(', ') + ')').join(' '));
	const needW = $derived(stages.columns.length * minCol + stages.columns.reduce((n, _, i) => n + gapBefore(i), 0) + (multiApp ? LABEL + GAP_TIER : 0) + 32);
	/* THE RAIL FORM, decided by width and column count only (never by state or selection): the side rail only when the canvas beside it keeps COMFORTABLE columns (195px, so a held cause never wraps); otherwise the stacked scroller above a full-width canvas. Before the first measure (bw 0) the stacked form: it can never widen the page. */
	const sideNeed = $derived(RAIL + stages.columns.length * COMFY + stages.columns.reduce((n, _, i) => n + gapBefore(i), 0) + (multiApp ? LABEL + GAP_TIER : 0) + 32);
	const side = $derived(bw > 0 && bw >= sideNeed);
	/* a roomier rail (336px) only when the canvas beside it still keeps columns of 220px or more; decided by width alone */
	const railW = $derived(side && bw >= sideNeed + (336 - RAIL) + stages.columns.length * (220 - COMFY) ? 336 : RAIL);
	const horizontal = $derived(w === 0 || w >= needW);
	/* THE TAIL STACK: the column width the graph will draw (the grid hands out equal tracks up to CAP), decided by width and column count alone; app scope only */
	const colW = $derived(columnWidth(w, stages.columns.length, stages.columns.reduce((n, _, i) => n + gapBefore(i), 0), multiApp ? LABEL + GAP_TIER : 0, CAP));
	const stackTail = $derived(!!stages.release && horizontal && w > 0 && colW < TAIL_BESIDE);
	const laneRow = (li: number) => 2 + (anyMulti ? 1 : 0) + li;
	const ATTR: Record<StageState, string> = { deployed: 'done', checking: 'checking', deploying: 'deploying', held: 'held', approval: 'waiting', failed: 'failed', notreached: 'not-reached', notaffected: 'not-affected', replaced: 'not-affected' };
	/* the pie of one wave column: every site of it, every lane */
	const waveOf = (i: number) => waveMark(stages.lanes.flatMap((l) => l.cells[i]?.places ?? []).map((p) => ({ state: SITE[p.state] })), `Wave ${stages.columns[i].wave}`);
	const colKey = (i: number) => `${stages.columns[i].tier}:${stages.columns[i].wave ?? 0}`;
	/* a lane's connector runs from its first tile to its last; an empty cell between two tiles lets it pass through */
	const passes = (cells: unknown[], i: number) => !cells[i] && cells.slice(0, i).some(Boolean) && cells.slice(i + 1).some(Boolean);
	const hasPrev = (cells: unknown[], i: number) => cells.slice(0, i).some(Boolean);
</script>

{#snippet tierHead(g: { tier: StageColumn['tier']; label: string; first: number; last: number })}
	<div class="stg-ch flex min-w-0 items-center" data-stage-col={g.tier}>
		<Chip role="env" theme={envTheme(g.tier)} label={g.label} />
		<span class="ml-3 h-px min-w-0 flex-1 bg-line" aria-hidden="true"></span>
	</div>
{/snippet}

{#snippet waveHead(i: number)}
	<span class="t-meta flex items-center gap-2 whitespace-nowrap text-fg-subtle" data-stage-col={colKey(i)}><WaveMark mark={waveOf(i)} />Wave {stages.columns[i].wave}</span>
{/snippet}

{#snippet row(p: StagePlace, sep: boolean, withApp: boolean)}
				<a href={toHref(p.href)} aria-current={p.here ? 'location' : undefined} class="stg-row {stages.release ? 'stg-tail' : ''} {p.here ? 'stg-here' : ''} {sep ? 'border-t border-line-subtle' : ''} flex min-h-11 min-w-0 items-center gap-2 px-2 py-1 hover:bg-hover" data-stage-row="{p.app}|{p.href}" data-stage-state={ATTR[p.state]}>
					<span class="stg-mark flex h-4 w-4 shrink-0 items-center justify-center"><WaveMark mark={waveMark([{ state: SITE[p.state] }])} /></span>
					<span class="stg-txt flex min-w-0 flex-col">
											<span class="stg-name t-body flex min-w-0 items-center gap-2 {p.state === 'notreached' ? 'text-fg-muted' : 'text-fg'}">{#if withApp}<AppGlyph name={p.app} size={16} class="shrink-0" /><span class="truncate">{p.app}</span>{#if p.name !== p.tier && p.name !== 'production'}<span class="t-meta truncate text-fg-subtle">{p.name}</span>{/if}{:else}<span class="truncate">{p.name}</span>{/if}</span>
							<!-- line 2: the state word / cause never shrinks (it wraps before it is cut); the tail sheds the build first, then the age or step -->
							<span class="stg-l2 t-meta flex min-w-0 gap-1 overflow-hidden {toneInk(p.state)}" title={p.ahead ? (p.state === 'checking' ? 'Checking ' : p.state === 'deploying' ? 'Deploying ' : p.state === 'failed' ? 'Failed ' : 'On ') + p.build : p.word}><span class="flex-none max-w-full whitespace-normal">{#if p.cause}<CauseText parts={p.cause} />{:else}{p.word}{/if}</span>{#if p.build && p.ahead}<span class="stg-build t-code-sm flex-none whitespace-nowrap {p.state === 'deployed' ? 'text-fg-muted' : 'text-fg-subtle'}">{p.build}</span>{:else if p.build}<span class="stg-build t-code-sm min-w-0 shrink-[100] truncate whitespace-nowrap text-fg-subtle"><span class="stg-dot">· </span>{p.build}</span>{/if}{#if p.progress}<span class="min-w-0 truncate whitespace-nowrap text-fg-subtle">· step {p.progress}</span>{:else if p.age}<span class="min-w-0 truncate whitespace-nowrap text-fg-subtle">· {p.age}</span>{/if}</span>
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

{#snippet parts(ps: Stages['rollup']['parts'])}{#each ps as part, i (part.text)}{#if i > 0}<span class="shrink-0 text-fg-disabled" aria-hidden="true">·</span>{/if}<span class="{hueInk(part.ink === 'muted' ? 'subtle' : part.ink)} {i === 0 ? 'stg-first min-w-0 truncate' : 'shrink-0'}" title={part.text}>{part.text}</span>{/each}{/snippet}

<Card icon={ChevronDoubleRightOutline} title="Progress" padded={false} class={className}>
	{#snippet rollup()}<span class="stg-rollup t-card-rollup flex min-w-0 flex-nowrap items-baseline justify-end gap-x-1 whitespace-nowrap tabular-nums" data-stages-rollup><span class="stg-long flex min-w-0 items-baseline gap-x-1">{@render parts(stages.rollup.parts)}</span><span class="stg-short min-w-0 items-baseline gap-x-1" data-stages-rollup-narrow>{@render parts((stages.narrow ?? stages.rollup).parts)}</span></span>{/snippet}
	<div class="stg-body" bind:clientWidth={bw} style="--n: {Math.min(rail?.length ?? 0, 4)}" data-stages-body>
	<div class="stg-split" class:has-rail={showRail} class:side={showRail && side} style:--rail="{railW}px">
		{#if showRail && rail}
			<!-- THE RELEASE RAIL: the releases on their way out, oldest first (the default); a row is one link, `?release=<build>` -->
			<div class="stg-rail">
				<div class="stg-list" bind:this={listEl} data-more-v={moreV ? '' : undefined} data-more-h={moreH ? '' : undefined} data-release-rail aria-label="Releases in flight" role="list">
					{#each rail as it (it.build)}
						{@const sel = it.build === stages.release}
						<a role="listitem" href={railHref(it.build)} data-sveltekit-noscroll data-sveltekit-replacestate data-sveltekit-keepfocus aria-current={sel ? 'true' : undefined} class="stg-rrow flex min-h-14 min-w-0 flex-col justify-center gap-1 px-4 py-2 {sel ? 'bg-selected' : 'hover:bg-hover'}" data-release-row={it.build} data-release-selected={sel ? '' : undefined}>
							<span class="flex min-w-0 items-center gap-2"><span class="t-code-sm min-w-0 truncate text-fg">{it.build}</span>{#if it.oldest}<span class="t-meta shrink-0 rounded border border-line px-1.5 text-fg-muted">oldest</span>{/if}<span class="ml-auto flex shrink-0 items-center gap-1.5">{#each it.tiers as t (t.tier)}<WaveMark mark={waveMark(t.sites.map((state) => ({ state })), t.tier)} />{/each}</span></span>
							<span class="flex min-w-0 items-center gap-2">{#if it.author}<Avatar name={it.author} src={avatarSrc(it.author)} size={16} class="shrink-0" />{/if}<span class="t-meta min-w-0 truncate text-fg-muted" title={it.title ?? ''}>{it.title ?? it.build}</span></span>
						</a>
					{/each}
				</div>
			</div>
		{/if}
	<div class="canvas-dots stg-canvas min-w-0 px-4 py-4" bind:clientWidth={w} data-stages data-stages-form={horizontal ? 'graph' : 'list'}>
		{#if release && (release.author || release.built || release.href || !inRail)}
			<!-- THE RELEASE LINE. A visible rail row already names the selected release (build, title): then the line carries only what it does not (who, how long ago, the way to the change page). With no row showing it (no rail, or a selection outside it) the line names the release itself: build and title first. Decided by the data (rail rows), never by what was measured. -->
			<div class="mb-4 flex min-h-5 min-w-0 items-center gap-3" data-stages-release>
				{#if !inRail}<span class="t-code-sm shrink-0 text-fg" data-release-build>{release.build}</span>{#if release.title}<span class="t-meta min-w-0 truncate text-fg-muted" title={release.title} data-release-title>{release.title}</span>{/if}{/if}
				{#if release.author}<span class="t-meta flex items-center gap-2 text-fg-muted {inRail ? 'min-w-0' : 'shrink-0 max-sm:min-w-0'}"><Avatar name={release.author} src={avatarSrc(release.author)} size={16} class="shrink-0" /><span class="truncate {inRail ? '' : 'max-sm:hidden'}">{release.author}</span></span>{/if}
				{#if release.built}<span class="t-meta shrink-0 whitespace-nowrap text-fg-subtle tabular-nums">{release.built}</span>{/if}
				{#if release.href}<a href={toHref(release.href)} class="nav-link -my-2 ml-auto shrink-0 max-sm:-my-3 max-sm:min-h-11" data-release-change>View change<ChevronRightOutline class="h-3.5 w-3.5" aria-hidden="true" /></a>{/if}
			</div>
		{/if}
		{#if horizontal}
			<!-- tiles top-aligned, never stretched to the lane (coordinator ruling: a one-place tile keeps its own height); the header rows and the tiles are placed on explicit tracks, with 12px between a tier's waves and 24px between tiers -->
			<div class="stg-graph grid w-full items-start gap-y-3" style="grid-template-columns: {gridCols}; --cy: {stackTail ? 14 : 22}px;" data-tail={stackTail ? 'stack' : undefined}>
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
	</div>
	</div>
</Card>

<style>
	/* the rail is a side column when `side` (the body fits it plus comfortable columns), else a horizontal scroller above the canvas */
	.stg-body { min-width: 0; }
	.stg-split { min-width: 0; }
	.stg-rail { min-width: 0; border-bottom: 1px solid var(--k-line); background: var(--k-surface); }
	.stg-list { display: flex; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-width: thin; }
	.stg-list[data-more-h] { mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); }
	.stg-rrow { flex: 0 0 264px; scroll-snap-align: start; border-right: 1px solid var(--k-line-subtle); box-shadow: none; }
	/* the scroller clips an outside ring: the focus ring is drawn INSIDE the row (both forms) */
	.stg-rrow:focus-visible { outline: 2px solid var(--focus-ring-color); outline-offset: -2px; }
	.stg-rrow[aria-current='true'] { box-shadow: inset 2px 0 0 var(--k-fg); }
	.stg-split.side { display: grid; grid-template-columns: var(--rail, 264px) minmax(0, 1fr); min-height: calc(var(--n) * 56px); }
	.stg-split.side .stg-rail { position: relative; border-bottom: 0; border-right: 1px solid var(--k-line); }
	/* never expands the card: the list is out of flow, the row height is the canvas's */
	.stg-split.side .stg-list { position: absolute; inset: 0; display: block; overflow-x: hidden; overflow-y: auto; scroll-snap-type: none; mask-image: none; }
	.stg-split.side .stg-list[data-more-v] { mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent); }
	.stg-split.side .stg-rrow { border-right: 0; border-bottom: 1px solid var(--k-line-subtle); }
	/* the rollup never wraps (the header stays 47px in every state): never wider than the card minus icon, title and padding; the muted count truncates first, the adverse parts never */
	.stg-rollup { max-width: calc(100cqw - 140px); overflow: hidden; }
	.stg-short { display: none; }
	.stg-short { gap: 4px; }
	@container (max-width: 559.98px) { .stg-long { display: none; } .stg-short { display: flex; } }
	/* graph group: start-aligned at the card padding; centred only past 2300 where the 280px column cap leaves space (the Gates canvas rule for very wide) */
	.stg-graph { justify-content: start; }
	@media (min-width: 2300px) { .stg-graph { justify-content: center; } }
	.stg-tile { position: relative; border-radius: 8px; container-type: inline-size; }
	/* a place the pipeline has not reached: quieter, no surface fill, dashed hairline (style only: same box, same rows) */
	.stg-tile.is-live { border-color: var(--k-active-line); box-shadow: var(--k-glow-active); }
	.stg-tile.stg-quiet { background: var(--k-ground); border-style: dashed; border-color: var(--k-line); }
	/* rollout scope: the place being viewed rests on the hover fill (same row size and position, no new hue) */
	.stg-row.stg-here { background: var(--k-hover); }
	/* TAIL STACK (app scope, container query on the tile): below a 192px column (`stackTail`, decided by width and column count only) EVERY row draws mark + name on line 1 and lets the state word (+ age / step) and the build run the full tile width beneath it (word on line 2, build on its own line 3; the "· " separator is dropped). Rows are one fixed height whatever they hold; the mark is centred on the name line and the connector follows it (`--cy`: 14px). */
	[data-tail='stack'] .stg-row.stg-tail { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; row-gap: 0; align-content: start; align-items: center; min-height: 66px; padding-left: 6px; padding-right: 6px; }
	[data-tail='stack'] .stg-tail .stg-txt { display: contents; }
	[data-tail='stack'] .stg-tail .stg-name { grid-column: 2; grid-row: 1; min-height: 20px; }
	[data-tail='stack'] .stg-tail .stg-l2 { grid-column: 1 / -1; grid-row: 2; display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 4px; }
	[data-tail='stack'] .stg-tail .stg-build { grid-column: 1 / -1; grid-row: 2; }
	[data-tail='stack'] .stg-tail .stg-dot { display: none; }
	/* the connector: one 1px line in line-strong at the first row's mark centre (row 44px: centre 22px), from the previous tile across the 24px gap */
	.stg-link::before, .stg-pass::before { content: ''; position: absolute; top: var(--cy, 22px); height: 1px; background: var(--k-line-strong); }
	.stg-tile.stg-link { overflow: visible; }
	.stg-tile.stg-link::before { left: calc(-1 * var(--g)); width: var(--g); }
	.stg-ph { position: relative; }
	.stg-pass::before { left: calc(-1 * var(--g)); right: calc(-1 * var(--gr)); }
	/* the tile clips its rows' hover fill to its radius without clipping the connector */
	.stg-tile > :global(a:first-child) { border-top-left-radius: 7px; border-top-right-radius: 7px; }
	.stg-tile > :global(a:last-child) { border-bottom-left-radius: 7px; border-bottom-right-radius: 7px; }
</style>
