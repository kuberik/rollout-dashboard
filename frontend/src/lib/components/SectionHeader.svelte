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
	/** a rollup may wrap at phone width: the row then aligns to its top and every part centres on the title's first line (16px down), not on the whole block */
	const rolled = $derived(!!(rollup && rollup.length));
</script>

<div class="section-header {rolled ? 'section-header-rolled' : ''} {className}">
	{#if Icon}
		<Icon class="h-4 w-4 shrink-0 text-fg-muted {rolled ? 'mt-2' : ''}" aria-hidden="true" />
	{:else}
		<span class="section-dot {DOT[tone]} {rolled ? 'mt-[13px]' : ''}" aria-hidden="true"></span>
	{/if}
	<svelte:element this={level === 3 ? 'h3' : 'h2'} {id} data-tour={dataTour} class="t-heading text-fg {rolled ? 'mt-1 whitespace-nowrap' : ''}">
		{title}
	</svelte:element>
	{#if count !== null && count !== undefined}
		<span class="t-meta tabular-nums text-fg-subtle">{count}</span>
	{/if}
	{#if description}
		<span class="t-meta hidden min-w-0 truncate text-fg-subtle sm:inline">{description}</span>
	{/if}
	{#if rollup && rollup.length}
		<!-- the shared dot list (language.css): a wrapped rollup never starts or ends a line with its separator; a ZERO count before the last is hidden on a phone (`rollup-fold.ts`); every non-zero count and every INKED part stays -->
		<div class="dot-list t-meta ml-auto mt-1 min-w-0 tabular-nums text-fg-subtle">
			<div class="dot-list-row flex flex-wrap items-center gap-y-0.5" data-rollup>
				{#each rollup as part, i (i)}
					{@const last = i === rollup.length - 1}
					{@const text = typeof part === 'string' ? part : part.text}
					{@const ink = typeof part === 'string' ? undefined : part.ink}
					<span class="whitespace-nowrap {!last && foldsOnPhone(part) ? 'hidden sm:block' : ''} {ink ? `font-medium ${hueInk(ink)}` : ''}">{text}</span>
				{/each}
			</div>
		</div>
	{/if}
	{#if action}
		<div class="flex shrink-0 items-center gap-2 {rolled ? 'h-8' : 'ml-auto'}">{@render action()}</div>
	{/if}
</div>

