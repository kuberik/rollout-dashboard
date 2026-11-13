<svelte:options runes={true} />

<script lang="ts">
	import { HUE_SOLID, hueInk } from '$lib/view-models/state-tone';
	/**
	 * THE SECTION HEADER. One dialect for every page: dot · title · count ·
	 * description …… action.
	 *
	 * ROLE: names a group of cards or tiles that are NOT inside one Card (Home's
	 * Needs you / In motion / Held / Trailing / Steady). A group that IS one
	 * Card uses the Card's own 47px header instead, never this.
	 *
	 * WHY A COMPONENT: the audit found five dialects (dot·16/600·count, a 10px
	 * Montserrat eyebrow, a mono namespace over a hairline, a floating 17px
	 * sentence, a hand-built non-Card header). Proportions are Home's dot
	 * header, the one the owner calls well designed: 6px dot, 16/600 title,
	 * count and description at 12px in the subtle ink, 32px row, 12px below.
	 *
	 * The dot's colour is the section's STATE (`danger` for "needs you",
	 * `active` for "in motion", `held`, `success` for "steady"), or the subtle
	 * ink for a neutral group. It is the only colour the header spends.
	 */
	import type { Component, Snippet } from 'svelte';
	import { foldsOnPhone } from '$lib/view-models/rollup-fold';

	type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'held' | 'progress' | 'active';

	let {
		title,
		count = null,
		description = null,
		tone = 'neutral',
		level = 2,
		id = undefined,
		dataTour = undefined,
		icon = undefined,
		rollup = undefined,
		action,
		class: className = ''
	}: {
		title: string;
		count?: number | string | null;
		description?: string | null;
		tone?: Tone;
		level?: 2 | 3;
		id?: string;
		dataTour?: string;
		/** r39 (kit `section()`): a 16px leading icon in place of the dot — the dialect on the page SURFACE (icon · 16/600 title …… rollup). */
		icon?: Component;
		/** r39: the rollup, right-aligned, 12px subtle, tabular. Parts are joined with a gap; `ink` marks an adverse count (500 weight, in its ink). Wins over `count`/`description` placement only in position (right). */
		rollup?: (string | { text: string; ink?: 'danger' | 'held' })[];
		action?: Snippet;
		/** LAYOUT ONLY. */
		class?: string;
	} = $props();

	const DOT: Record<Tone, string> = { ...HUE_SOLID, neutral: HUE_SOLID.subtle };
	const Icon = $derived(icon);
</script>

<div class="section-header max-sm:flex-wrap max-sm:gap-y-0 {className}">
	{#if Icon}
		<Icon class="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
	{:else}
		<span class="section-dot {DOT[tone]}" aria-hidden="true"></span>
	{/if}
	<svelte:element this={level === 3 ? 'h3' : 'h2'} {id} data-tour={dataTour} class="t-heading text-fg {rollup && rollup.length ? 'whitespace-nowrap' : ''}">
		{title}
	</svelte:element>
	{#if count !== null && count !== undefined}
		<span class="t-meta tabular-nums text-fg-subtle">{count}</span>
	{/if}
	{#if description}
		<span class="t-meta hidden min-w-0 truncate text-fg-subtle sm:inline">{description}</span>
	{/if}
	{#if rollup && rollup.length}
		<!-- visual audit #11: below sm the rollup never ellipsizes a count ("3 yours" was 15/43px, "38 at rest" 33/55 at
		     390). It stays hard-right; when it does not fit beside the title the header wraps and the rollup takes the next
		     line whole (and, wider than the row, wraps between parts, never inside one). With a VISIBLE action it always
		     takes that line, so the action keeps the title row (`.section-header:has(...)` in language.css). From sm up it is
		     unchanged: one line, the last part truncates. -->
		<span
			class="rp-row t-meta ml-auto flex min-w-0 items-center overflow-hidden tabular-nums text-fg-subtle max-sm:flex-wrap max-sm:justify-end sm:whitespace-nowrap"
			data-rollup
		>
			{#each rollup as part, i (i)}
				<!-- phone: a ZERO count before the last is hidden (`rollup-fold.ts`, QA2 #7); every non-zero count and every INKED part stays. A dot LEADS every part but the first, hung in the gap (see `.rp-sep`). -->
				{@const last = i === rollup.length - 1}
				{@const text = typeof part === 'string' ? part : part.text}
				{@const ink = typeof part === 'string' ? undefined : part.ink}
				<!-- the last part truncates on an INNER span, so the clip never takes its own leading dot --><span class="whitespace-nowrap {last ? 'flex min-w-0' : foldsOnPhone(part) ? 'hidden sm:inline' : ''} {i > 0 ? 'rp-sep' : ''} {ink ? `font-medium ${hueInk(ink)}` : ''}">{#if last}<span class="sm:truncate">{text}</span>{:else}{text}{/if}</span>
			{/each}
		</span>
	{/if}
	{#if action}
		<div class="sh-action flex shrink-0 items-center gap-2 {rollup && rollup.length ? 'max-sm:ml-auto' : 'ml-auto'}">{@render action()}</div>
	{/if}
</div>

<style>
	/* the rollup's separator: a 3px dot BEFORE every part but the first, hung in the 19px gap (8 · 3 · 8, the old spacing)
	   instead of in the flow, in the neutral ink whatever the part's own ink. A part that wraps to a line start, or follows a part folded away on a phone, puts its dot
	   left of the rollup's edge, where `overflow-hidden` clips it: a line never starts or ends on a dangling dot. */
	.rp-row { column-gap: 19px; }
	.rp-sep { position: relative; }
	.rp-sep::before { content: ''; position: absolute; left: -11px; top: 50%; width: 3px; height: 3px; margin-top: -1.5px; border-radius: 50%; background: var(--k-fg-subtle); opacity: 0.45; }
</style>
