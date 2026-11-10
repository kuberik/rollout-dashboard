<svelte:options runes={true} />

<script lang="ts">
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

	const DOT: Record<Tone, string> = {
		neutral: 'bg-fg-subtle',
		success: 'bg-success-solid',
		danger: 'bg-danger-solid',
		warning: 'bg-warning-solid',
		held: 'bg-held-solid',
		progress: 'bg-progress-solid',
		active: 'bg-active-solid'
	};
	const Icon = $derived(icon);
</script>

<div class="section-header {className}">
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
		<span class="t-meta ml-auto flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap tabular-nums text-fg-subtle" data-rollup>
			{#each rollup as part, i (i)}
				<!-- phone: a ZERO count before the last is hidden (`rollup-fold.ts`, QA2 #7); every non-zero count and every INKED part stays. A dot trails every part but the last. -->
				{@const last = i === rollup.length - 1}
				{@const text = typeof part === 'string' ? part : part.text}
				{@const ink = typeof part === 'string' ? undefined : part.ink}
				<span class="{last ? 'truncate' : foldsOnPhone(part) ? 'hidden sm:inline rp-dot' : 'rp-dot'} {ink === 'danger' ? 'font-medium text-danger' : ink === 'held' ? 'font-medium text-held' : ''}">{text}</span>
			{/each}
		</span>
	{/if}
	{#if action}
		<div class="flex shrink-0 items-center gap-2 {rollup && rollup.length ? '' : 'ml-auto'}">{@render action()}</div>
	{/if}
</div>

<style>
	/* the rollup's separator: a 3px dot after every part but the last (hidden together with its part on a phone) */
	.rp-dot::after { content: ''; display: inline-block; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.45; margin-left: 8px; vertical-align: middle; }
</style>
