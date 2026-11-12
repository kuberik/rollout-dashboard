<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ENVIRONMENT ROW: one app's (or one repo's) environment ORDER, drawn ONE way on every page. (r39 follow-up, owner 2026-11-08:
	 * "Environment boxes seem like they're not the same component across pages … I also don't like that they're stretched".)
	 *
	 * ROLE: dev -> test -> staging -> prod as filled neutral boxes joined by a hairline. Drawn by the rollout tab's header lane,
	 * the Apps tiles, the app page header, the Home Attention cards, the Home / Changes repo cards and the Changes Attention cards:
	 * PromotionLane, RepoCells and AskCells only MAP their data to `EnvCell`s; none draws a box of its own any more.
	 *
	 * ANATOMY (one box): [state mark] name [state word] [region] [fact | beads]. 6px radius, 1px transparent border, `t-ui-sm` name.
	 * A healthy box says only its name and its fact (the lag); the box that needs reading adds the mark and the word in the state's
	 * ink. Only `current` (the rollout tab, "you are here") takes the tier fill, its border and a bold name; everywhere else it is neutral.
	 *
	 * SIZE STEP (the only thing that differs): `L` 28px (the tab, a lead tile, a repo card), `M` 24px with a lighter fill (a tile,
	 * an ask). Same radius, same type, same bead, same connector.
	 *
	 * NEVER STRETCHED: a box is its content plus padding (with a small floor), left-aligned, joined to its neighbour by the connector
	 * that sits in the gap. The row wraps when it must; it never grows a box to fill the row, so a wide display shows the same
	 * boxes a narrow one does. Reference: the rollout tab's lane, which is where this anatomy was signed.
	 */
	import StatusMark from '$lib/components/StatusMark.svelte';
	import ChangeDot from '$lib/components/ChangeDot.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import SiteMark, { type SiteState } from '$lib/components/SiteMark.svelte';
	import EnvSitePicker from '$lib/components/EnvSitePicker.svelte';
	import type { Bead } from '$lib/view-models/bead';

	/**
	 * change-strip r1 (owner 2026-11-12: "using the environment progression mini boxes strip we already had. it just didn't have
	 * waves. it also had a shortcoming that on prod box we couldn't select exact site"). A PROGRESSION box (opt-in: `sites`) draws
	 * its sites inside itself after the name: one 16px mark per site in topology order (wave, leader, name), a 1px divider between
	 * waves. Never ordered by state, so a state change repaints a mark and moves nothing. One site: the box links to it. Several:
	 * the box is a button that opens the SITE PICKER (EnvSitePicker), every site a link to its own rollout.
	 */
	export type EnvSite = {
		key: string;
		name: string;
		/** null / 0 = the tier has no waves */
		wave: number | null;
		state: SiteState;
		/** the state word (picker row, title) */
		word: string;
		wordInk?: string;
		/** the second clause of the state ("3 builds behind", "1 of 2 steps"), t-meta muted after the word */
		detail?: string;
		/** the build the site runs now, mono */
		build?: string;
		/** the age, t-meta subtle */
		aside?: string;
		href?: string;
		/** the rollout this page is about (rollout overview): a ring round its mark, "This rollout" in the picker */
		here?: boolean;
	};
	export type EnvLane = { key: string; label: string; app?: string; cells: (EnvCell | null)[] };

	export type EnvCell = {
		key: string;
		label: string;
		/** a link box (the tab); tiles and cards are links themselves, so their boxes are not */
		href?: string;
		/** the rollout tab only: "this is the page's environment" */
		current?: boolean;
		title?: string;
		/** `getEnvironmentThemeStyle(theme)` for the tab's current fill */
		style?: string;
		/** r42 `progress` (opt-in, /design/atoms): the act's 0..1, drawn as StatusMark's progress pie */
		mark?: { state: 'failed' | 'stuck' | 'held' | 'deploying' | 'checking' | 'approval'; tone?: 'held' | 'neutral'; progress?: number | null };
		word?: string;
		/** the state-words `compact` form ("Waiting" for "Needs your approval"), printed instead of `word` below 380px */
		wordShort?: string;
		/** ink class for the word (state ink) */
		wordInk?: string;
		region?: string;
		/** the lag ("2 behind") or a detail ("1 of 3 regions"): trailing, subtle, tabular */
		fact?: string;
		/** `lag` words may be shortened by lagFit; a `detail` never is */
		factKind?: 'lag' | 'detail';
		beads?: Bead[];
		/** the name reads in full ink (the cell the ask is about) */
		hot?: boolean;
		/** a line UNDER the box (12px subtle): who leads a wave and who follows ("eu-west" bold, then " leads · 2 follow"). Draws on /envs/<name> only. */
		hang?: { lead?: string; text: string };
		/** change-strip r1: the tier's sites (a progression box). Set it on every cell of a row, or on none. */
		sites?: EnvSite[];
	};

	let {
		cells = [],
		lanes = undefined,
		lane = 'row',
		size = 'L',
		class: className = ''
	}: {
		cells?: EnvCell[];
		/** several apps (a change shipping 4 apps): one row per app on a shared grid, so a tier's boxes line up in one column */
		lanes?: EnvLane[];
		/** the row's key for data-stage-* hooks (single row) */
		lane?: string;
		size?: 'L' | 'M';
		class?: string;
	} = $props();

	let openKey = $state<string | null>(null);
	let anchors = $state<Record<string, HTMLElement | undefined>>({});
	const cols = $derived(lanes ? Math.max(0, ...lanes.map((l) => l.cells.length)) : 0);
	const wavesOf = (ss: EnvSite[]) => {
		const out: EnvSite[][] = [];
		for (const x of ss) {
			const g = out[out.length - 1];
			if (g && (g[0].wave ?? 0) === (x.wave ?? 0)) g.push(x);
			else out.push([x]);
		}
		return out;
	};
	const siteLine = (x: EnvSite, multi: boolean) => [multi && x.wave ? 'wave ' + x.wave : '', x.name + ': ' + x.word, x.detail ?? '', x.build ?? '', x.aside ?? ''].filter(Boolean).join(' · ');
	const siteTitle = (c: EnvCell) => c.title ?? [c.label, ...(c.sites ?? []).map((x) => siteLine(x, wavesOf(c.sites ?? []).length > 1))].join('\n');
	const pickerSub = (ss: EnvSite[]) => {
		const w = wavesOf(ss).length;
		return [ss.length + ' sites', w > 1 ? w + ' waves' : ''].filter(Boolean).join(' · ');
	};
</script>

{#snippet sitesOf(c: EnvCell, lk: string)}
	<span class="env-sites" data-env-sites>
		{#each wavesOf(c.sites ?? []) as g, gi (gi)}
			{#if gi > 0}<span class="env-wave-div" aria-hidden="true"></span>{/if}
			<span class="env-wave">
				{#each g as x (x.key)}
					<span class="env-site" class:env-site--here={x.here} data-stage-row="{lk}|{x.key}" data-stage-state={x.state}><SiteMark state={x.state} /></span>
				{/each}
			</span>
		{/each}
	</span>
{/snippet}

{#snippet boxOf(c: EnvCell, lk: string)}
	{@const ss = c.sites ?? []}
	{@const pk = `${lk}|${c.key}`}
	{@const many = ss.length > 1}
	{@const link = c.href ?? (ss.length === 1 ? ss[0].href : undefined)}
	{#if ss.length}
		<svelte:element
			this={many ? 'button' : link ? 'a' : 'div'}
			type={many ? 'button' : undefined}
			href={many ? undefined : link}
			bind:this={anchors[pk]}
			class="env-box env-box--sites environment-theme-scope"
			class:env-box--current={c.current}
			class:env-box--link={many || !!link}
			style={c.style}
			title={siteTitle(c)}
			aria-label={many ? `${c.label}: ${ss.length} sites, pick one` : undefined}
			aria-haspopup={many ? 'dialog' : undefined}
			aria-expanded={many ? openKey === pk : undefined}
			aria-current={c.current && !many ? 'page' : undefined}
			onclick={many ? () => (openKey = openKey === pk ? null : pk) : undefined}
			data-env-box
			data-stage-tile={pk}
			data-current={c.current ? '' : undefined}
		>
			<span class="env-name t-ui-sm {c.hot || c.current ? 'text-fg' : 'text-fg-muted'}">{c.label}</span>
			{@render sitesOf(c, lk)}
			{#if c.word}<span class="env-word t-ui-sm {c.wordInk ?? 'text-fg-muted'}" data-word-short={c.wordShort ?? undefined}>{#if c.wordShort}<span class="env-word-full">{c.word}</span><span class="env-word-short">{c.wordShort}</span>{:else}{c.word}{/if}</span>{/if}
			{#if c.fact}<span class="env-fact {c.factKind === 'detail' ? 'env-detail' : 'env-lag'} t-meta tabular-nums text-fg-subtle">{c.fact}</span>{/if}
		</svelte:element>
		{#if many}<EnvSitePicker sites={ss} title={c.label} sub={pickerSub(ss)} anchor={anchors[pk]} id="sp-{pk}" bind:open={() => openKey === pk, (v) => (openKey = v ? pk : openKey === pk ? null : openKey)} />{/if}
	{:else}
		<svelte:element
			this={c.href ? 'a' : 'div'}
			href={c.href}
			class="env-box environment-theme-scope"
			class:env-box--current={c.current}
			class:env-box--link={!!c.href}
			style={c.style}
			title={c.title}
			data-env-box
			data-current={c.current ? '' : undefined}
		>
			{#if c.mark}<span class="env-mk"><StatusMark state={c.mark.state} tone={c.mark.tone} progress={c.mark.progress ?? null} /></span>{/if}
			<span class="env-name t-ui-sm {c.hot ? 'text-fg' : 'text-fg-muted'}">{c.label}</span>
			{#if c.word}<span class="env-word t-ui-sm {c.wordInk ?? 'text-fg-muted'}" data-word-short={c.wordShort ?? undefined}>{#if c.wordShort}<span class="env-word-full">{c.word}</span><span class="env-word-short">{c.wordShort}</span>{:else}{c.word}{/if}</span>{/if}
			{#if c.region}<span class="env-region t-meta text-fg-subtle">{c.region}</span>{/if}
			{#if c.beads?.length}
				<span class="pointer-events-auto flex min-w-0 items-center gap-1 pl-1">{#each c.beads as b (b.state + b.refs.join() + b.count)}<ChangeDot bead={b} />{/each}</span>
			{:else if c.fact}
				<span class="env-fact {c.factKind === 'detail' ? 'env-detail' : 'env-lag'} t-meta tabular-nums text-fg-subtle">{c.fact}</span>
			{/if}
		</svelte:element>
	{/if}
{/snippet}

<div class="env-cq min-w-0 {className}" data-env-row data-size={size}>
	{#if lanes}
		<div class="env-row env-row--{size.toLowerCase()} env-grid" style="--env-cols: {cols}">
			{#each lanes as l (l.key)}
				<div class="env-lane-label" title={l.label} data-env-lane={l.key}>
					{#if l.app}<AppGlyph name={l.app} size={16} />{/if}
					<span class="env-lane-name t-ui-sm text-fg-muted">{l.label}</span>
				</div>
				{#each l.cells as c, i (i)}
					{#if c}
						<div class="env-cell" data-tier={c.key} data-stage-col="{l.key}|{c.key}">{@render boxOf(c, l.key)}</div>
					{:else}
						<div class="env-cell env-cell--empty" aria-hidden="true"></div>
					{/if}
				{/each}
			{/each}
		</div>
	{:else}
		<div class="env-row env-row--{size.toLowerCase()}">
			{#each cells as c (c.key)}
				<div class="env-cell env-cell--flow" class:env-cell--hang={!!c.hang} data-tier={c.key} data-stage-col={c.sites ? `${lane}|${c.key}` : undefined}>
					{@render boxOf(c, lane)}
					{#if c.hang}<span class="env-hang t-meta text-fg-subtle">{#if c.hang.lead}<b class="font-medium text-fg-muted">{c.hang.lead}</b>{/if}{c.hang.text}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.env-cq {
		container-type: inline-size;
		width: 100%;
	}
	.env-row {
		--env-h: 28px;
		--env-pad: 8px;
		--env-gap: 12px;
		--env-min: 72px;
		--env-fill: var(--k-subtle);
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: flex-start;
		gap: 8px var(--env-gap);
		min-width: 0;
	}
	:global(.dark) .env-row--l {
		--env-fill: color-mix(in srgb, var(--k-subtle) 80%, var(--k-surface));
	}
	/* M: one fill step lighter (a tile sits on a card; owner 2026-11-08) */
	.env-row--m {
		--env-h: 24px;
		--env-pad: 6px;
		--env-gap: 8px;
		--env-min: 64px;
		--env-fill: color-mix(in srgb, var(--k-subtle) 55%, var(--k-surface));
		row-gap: 6px;
	}
	:global(.dark) .env-row--m {
		--env-fill: color-mix(in srgb, var(--k-subtle) 50%, var(--k-surface));
	}
	.env-cell {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		flex: 0 0 auto;
		min-width: 0;
		max-width: 100%;
	}
	.env-hang { min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px; }
	/* the connector lives in the gap, drawn by the cell after it, so it can never cross a box */
	.env-cell--flow + .env-cell--flow::before {
		content: '';
		position: absolute;
		top: calc(var(--env-h) / 2);
		right: 100%;
		width: var(--env-gap);
		height: 1px;
		background-color: var(--k-line);
	}
	@container (max-width: 559.98px) {
		.env-cell--flow + .env-cell--flow::before { display: none; }
		.env-region { display: none; }
	}
	/* PHONE (2026-11-10, landing found "prod" wrapping alone onto its own line at 350-390): the ORDER is the statement, so below 380px the
	   boxes keep name + state mark + state word and drop the trailing facts (lag, "k of N regions"; both stay in the box's title and on
	   the page's own rows), lose their 72px floor and pull the gaps in. The row wraps only when the names and words alone do not fit. */
	@container (max-width: 379.98px) {
		.env-row { --env-min: 0px; --env-gap: 6px; column-gap: 6px; }
		.env-row--l { --env-pad: 6px; }
		.env-fact { display: none; }
		.env-word-full { display: none; }
	}
	.env-word-short { display: none; }
	@container (max-width: 379.98px) { .env-word-short { display: inline; } }
	/* a 269px tile (a 350px phone) cannot hold three boxes AND a word: the mark carries the state, the tile's own sentence names it */
	/* four boxes with words do not fit 330px either (a 309px tile at 390, a 303px lane at 350) */
	@container (max-width: 330px) {
		.env-row:has(.env-cell:nth-child(4)) .env-word { display: none; }
	}
	@container (max-width: 300px) {
		.env-word { display: none; }
	}
	.env-box {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: calc(var(--env-pad) - 2px);
		box-sizing: border-box;
		min-width: var(--env-min);
		max-width: 100%;
		height: var(--env-h);
		padding: 0 var(--env-pad);
		border: 1px solid transparent;
		border-radius: 6px;
		background-color: var(--env-fill);
		white-space: nowrap;
		transition:
			border-color var(--k-dur) var(--ease-out),
			background-color var(--k-dur) var(--ease-out);
	}
	a.env-box:not(.env-box--current):hover {
		background-color: var(--k-hover);
	}
	.env-mk {
		display: inline-flex;
		flex: none;
		height: 16px;
		align-items: center;
	}
	.env-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.env-word,
	.env-region,
	.env-fact {
		flex: none;
	}
	/* "you are here" (the rollout tab only): the tier fill, its border, a bold name in full ink */
	.env-box--current {
		background-color: var(--rollout-theme-surface, var(--k-surface));
		border-color: var(--rollout-theme-border, var(--k-line-strong));
	}
	:global(.dark) .env-box--current {
		background-color: color-mix(in srgb, var(--rollout-theme-dark-surface, transparent) 75%, transparent);
		border-color: var(--rollout-theme-dark-border, var(--k-line-strong));
	}
	.env-box--current .env-name {
		color: var(--k-fg);
		font-weight: 600;
	}
	.env-box--current .env-region {
		color: var(--k-fg);
	}
	/* change-strip r1: the progression box's sites, the lanes grid, the phone hit area */
	.env-sites {
		display: inline-flex;
		flex: none;
		align-items: center;
		margin-left: 2px;
	}
	.env-wave {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.env-wave-div {
		width: 1px;
		height: 12px;
		margin: 0 4px;
		background-color: var(--k-line-strong);
	}
	.env-site {
		display: inline-flex;
		width: 16px;
		height: 16px;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
	}
	.env-site--here {
		box-shadow: 0 0 0 1px var(--k-fg-muted);
	}
	button.env-box {
		font: inherit;
		cursor: pointer;
	}
	button.env-box:not(.env-box--current):hover,
	button.env-box[aria-expanded='true']:not(.env-box--current) {
		background-color: var(--k-hover);
	}
	.env-box--sites:focus-visible {
		outline: 2px solid var(--k-focus, var(--k-line-strong));
		outline-offset: 1px;
	}
	.env-grid {
		display: grid;
		grid-template-columns: auto repeat(var(--env-cols), max-content);
		column-gap: var(--env-gap);
		row-gap: 8px;
		align-items: center;
	}
	.env-lane-label {
		display: flex;
		min-width: 0;
		height: var(--env-h);
		align-items: center;
		gap: 8px;
		padding-right: 4px;
		white-space: nowrap;
	}
	.env-lane-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@container (max-width: 559.98px) {
		.env-lane-name { display: none; }
		.env-grid { row-gap: 16px; }
	}
	/* a phone: a sites box drops its word (its marks carry the state, the picker says it), so the order stays on one line */
	@container (max-width: 379.98px) {
		.env-box--sites .env-word { display: none; }
	}
	@media (max-width: 639.98px) {
		.env-box--link::after {
			content: '';
			position: absolute;
			/* measured from the padding box: -9 = 8px past the 1px border, a 44px reach */
			inset: -9px -1px;
		}
	}
</style>
