<svelte:options runes={true} />

<script lang="ts" module>
	export type KpiDelta = { text: string; tone: 'adverse' | 'good' | 'neutral'; title?: string; dir?: 'up' | 'down' };
</script>

<script lang="ts">
	/**
	 * THE KPI TILE — one figure that leads, its change, one caption. (Home v2,
	 * CRAFT-STUDY P2 "numbers lead"; shared with /changes and /activity.)
	 *
	 * ROLE: a page's supporting figure under its heavy object: "how many / how
	 * long / how often", against the previous period. Anatomy: a `.tile` shell
	 * (Card without its header bar), a 16px outline icon and a `t-ui-sm`
	 * label; ONE `t-stat` figure (32px, one per tile) whose units are 60% of
	 * the figure in the muted ink; the delta beside it, hue only when the
	 * direction is a verdict (adverse red, good green, neutral subtle); one
	 * `t-meta` caption that wraps between facts, never inside a value.
	 * Proportions: Linear's cycle header (value then delta), Railway's usage
	 * tiles.
	 *
	 * A duration figure passes `parts` ([{v:'3',u:'h'},{v:'18',u:'m'}]) so each
	 * unit is drawn small; a count passes `value` (+ optional `unit`).
	 * `href` makes the whole tile a door (`.tile-link`, `.tap-zone`).
	 */
	import type { Component, Snippet } from 'svelte';
	import { ArrowUpOutline, ArrowDownOutline } from 'flowbite-svelte-icons';

	let {
		icon = undefined,
		iconClass = 'text-fg-subtle',
		glyph = undefined,
		label,
		value = undefined,
		unit = undefined,
		parts = undefined,
		valueClass = 'text-fg',
		delta = null,
		sub = undefined,
		href = undefined,
		resolved = false
	}: {
		icon?: Component;
		iconClass?: string;
		/** A custom 16px mark in place of `icon` (e.g. HeldGlyph). */
		glyph?: Snippet;
		label: string;
		value?: string | number;
		unit?: string;
		parts?: { v: string; u: string }[];
		/** The figure's ink; `text-danger` only for a count of failures. */
		valueClass?: string;
		delta?: KpiDelta | null;
		/** The caption: a string, or a snippet when a fact inside it takes its state ink. */
		sub?: string | Snippet;
		href?: string;
		/** A count of past failures that are all resolved: history, not alarm.
		 *  The figure drops its alarm ink and reads "· resolved" (coordinator
		 *  ruling 2026-10-10: red only while a failure is the current state). */
		resolved?: boolean;
	} = $props();
	const figureInk = $derived(resolved ? 'text-fg' : valueClass);
	const deltaInk = $derived(
		delta?.tone === 'adverse' ? 'text-danger' : delta?.tone === 'good' ? 'text-success' : 'text-fg-subtle'
	);
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="tile kpi flex min-w-0 flex-col p-4 {href ? 'tile-link tap-zone' : ''}"
>
	<span class="t-ui-sm flex items-center gap-2 text-fg-muted">
		{#if glyph}{@render glyph()}{:else if icon}{@const I = icon}<I class="h-4 w-4 {iconClass}" aria-hidden="true" />{/if}
		{label}
	</span>
	<span class="mt-2 flex items-baseline gap-2">
		<span class="t-stat whitespace-nowrap {figureInk}">
			{#if parts && parts.length}
				{#each parts as p, i (i)}{#if i > 0}{' '}{/if}{p.v}<span class="kpi-unit">{p.u}</span>{/each}
			{:else}
				{value ?? '—'}{#if unit}<span class="kpi-unit">{unit}</span>{/if}
			{/if}
		</span>
		{#if resolved}
			<span class="t-ui-sm text-fg-subtle">resolved</span>
		{:else if delta}
			<span class="t-ui-sm inline-flex items-center gap-0.5 tabular-nums {deltaInk}" title={delta.title}>
				{#if delta.dir === 'up'}<ArrowUpOutline class="h-3 w-3" aria-hidden="true" />{:else if delta.dir === 'down'}<ArrowDownOutline class="h-3 w-3" aria-hidden="true" />{/if}{delta.text}
			</span>
		{/if}
	</span>
	{#if sub}
		<span class="t-meta mt-1 text-fg-subtle">
			{#if typeof sub === 'string'}{sub}{:else}{@render sub()}{/if}
		</span>
	{/if}
</svelte:element>

<style>
	/* The unit is part of the figure but quieter: 60% of its size, same weight. */
	.kpi-unit {
		font-size: 0.6em;
		line-height: 0; /* a smaller inline unit must not grow the figure line box (QA round 2 C6: the sub-line sat 4px lower under "2m") */
		margin-left: 1px;
		color: var(--k-fg-muted);
		letter-spacing: 0;
	}
</style>
