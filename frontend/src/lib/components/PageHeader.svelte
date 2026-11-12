<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE PAGE HEADER. Two forms, one component, fixed slots.
	 *
	 *   list    [title] [count] — [summary …………………………]        [actions]
	 *           "Rollouts 51 — 3 in motion · 3 held · 34 behind"
	 *   object  [eyebrow]
	 *           [title] [identity …]   [meta ………]                [actions]
	 *           "ROLLOUT / checkout-worker [STAGING] ↗ across envs"
	 *
	 * `leading` (optional): the object's identity MARK before its name (an
	 * AppGlyph at 32, CRAFT-STUDY P5), vertically centred on the title line.
	 * `identity` stays the chip AFTER the name. Pages that pass neither render
	 * exactly as before.
	 *
	 * ROLE: the first thing in `<main>` on every route. Replaces the four
	 * compositions the audit found (Montserrat 24/300 count + sentence, mono
	 * 24/500 object name, a Montserrat sentence as a title, a 20/700 404).
	 *
	 * Title is `t-title` (24/32, 600, sans) in BOTH forms — an object name is a
	 * name, and names are set in the UI face. A build sha as a page title passes
	 * `mono` and gets `t-code-lg` instead. The count is the title's figure in the
	 * subtle ink at the same size, so "51" never out-shouts "Rollouts".
	 * Summary/meta are `t-body` in the muted ink. 24px below the header.
	 * A slot wrapper whose snippet rendered nothing is `empty:hidden`: an empty flex item still costs a row gap
	 * (4px in the title row, 12px between the header's own rows) when it wraps onto a line of its own at 390.
	 */
	import type { Snippet } from 'svelte';

	let {
		title,
		count = null,
		eyebrow = null,
		mono = false,
		srOnlyTitle = false,
		summaryBelow = false,
		summary,
		titleAfter,
		identity,
		leading,
		meta,
		below,
		actions,
		metaSeparated = false,
		class: className = ''
	}: {
		title: string;
		/** List form: the figure printed beside the title. */
		count?: number | string | null;
		/** Object form: the KIND, as a tiny label above the title ("Rollout"). */
		eyebrow?: string | null;
		/** The title is an identifier (a sha), not a name. */
		mono?: boolean;
		/** The page's h1 exists for structure but the count/summary carry it. */
		srOnlyTitle?: boolean;
		/** The summary takes its own line under the title at every width. */
		summaryBelow?: boolean;
		summary?: Snippet;
		/** Object form: on the title's baseline, after it (`/ a1b2c3d`). */
		titleAfter?: Snippet;
		identity?: Snippet;
		leading?: Snippet;
		meta?: Snippet;
		/** Object form: a strip under the meta row (the rollout's promotion lane). */
		below?: Snippet;
		actions?: Snippet;
		/**
		 * The meta row's items are joined by a "·" drawn in CSS, never as a
		 * text node, so a wrapped line never starts or ends with an orphaned
		 * separator (design review 4, 2026-10-08). Each direct child is one
		 * item. Off by default: the Overview's meta row uses plain gaps.
		 */
		metaSeparated?: boolean;
		class?: string;
	} = $props();
</script>

<header class="page-header {className}" data-bare-title={srOnlyTitle ? "" : undefined}>
	<!-- On a phone the title owns its line and the actions wrap under it;
	     side by side from `sm`. -->
	<div class="min-w-0 flex-1 basis-full sm:basis-0">
		{#if eyebrow}
			<p class="t-label mb-1 text-fg-subtle">{eyebrow}</p>
		{/if}
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
			{#if leading}
				<div class="flex shrink-0 self-center">{@render leading()}</div>
			{/if}
			<h1
				class="{mono ? 't-code-lg' : 't-title'} min-w-0 break-words text-fg {srOnlyTitle
					? 'sr-only'
					: ''}"
			>
				{title}
			</h1>
			{#if count !== null && count !== undefined}
				<span class="t-title tabular-nums text-fg-subtle">{count}</span>
			{/if}
			{#if titleAfter}{@render titleAfter()}{/if}
			{#if identity}
				<div class="flex shrink-0 items-center gap-2 self-center empty:hidden" data-ph-identity>{@render identity()}</div>
			{/if}
			{#if summary}
				<div data-ph-summary class="t-body min-w-0 basis-full text-fg-muted empty:hidden {summaryBelow ? '' : 'sm:basis-auto sm:flex-1'}">
					{@render summary()}
				</div>
			{/if}
		</div>
		{#if meta}
			{#if metaSeparated}
				<div class="dot-list min-w-0">
					<div class="dot-list-row t-body flex min-w-0 flex-wrap items-center gap-y-1 text-fg-muted">
						{@render meta()}
					</div>
				</div>
			{:else}
				<div class="t-body mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-fg-muted">
					{@render meta()}
				</div>
			{/if}
		{/if}
	</div>
	{#if actions}
		<!-- On a phone the actions wrap within the page width (AD round 3: three
		     buttons ran 164px off a 390 screen); side by side from `sm`. -->
		<div data-ph-actions class="flex min-w-0 max-w-full flex-wrap items-center gap-2 empty:hidden sm:shrink-0 {eyebrow || titleAfter ? 'self-start' : ''}">{@render actions()}</div>
	{/if}
	{#if below}
		<!-- Full width under the title row and its actions. -->
		<div class="min-w-0 basis-full empty:hidden" data-ph-below>{@render below()}</div>
	{/if}
</header>

