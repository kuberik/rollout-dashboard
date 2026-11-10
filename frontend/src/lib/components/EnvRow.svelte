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
	import type { Bead } from '$lib/view-models/bead';

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
	};

	let { cells, size = 'L', class: className = '' }: { cells: EnvCell[]; size?: 'L' | 'M'; class?: string } = $props();
</script>

<div class="env-cq min-w-0 {className}" data-env-row data-size={size}>
	<div class="env-row env-row--{size.toLowerCase()}">
		{#each cells as c (c.key)}
			<div class="env-cell" class:env-cell--hang={!!c.hang} data-tier={c.key}>
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
					{#if c.word}<span class="env-word t-ui-sm {c.wordInk ?? 'text-fg-muted'}">{c.word}</span>{/if}
					{#if c.region}<span class="env-region t-meta text-fg-subtle">{c.region}</span>{/if}
					{#if c.beads?.length}
						<span class="pointer-events-auto flex min-w-0 items-center gap-1 pl-1">{#each c.beads as b (b.state + b.refs.join() + b.count)}<ChangeDot bead={b} />{/each}</span>
					{:else if c.fact}
						<span class="env-fact {c.factKind === 'detail' ? 'env-detail' : 'env-lag'} t-meta tabular-nums text-fg-subtle">{c.fact}</span>
					{/if}
				</svelte:element>
				{#if c.hang}<span class="env-hang t-meta text-fg-subtle">{#if c.hang.lead}<b class="font-medium text-fg-muted">{c.hang.lead}</b>{/if}{c.hang.text}</span>{/if}
			</div>
		{/each}
	</div>
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
	.env-cell + .env-cell::before {
		content: '';
		position: absolute;
		top: calc(var(--env-h) / 2);
		right: 100%;
		width: var(--env-gap);
		height: 1px;
		background-color: var(--k-line);
	}
	@container (max-width: 559.98px) {
		.env-cell + .env-cell::before { display: none; }
		.env-region { display: none; }
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
</style>
