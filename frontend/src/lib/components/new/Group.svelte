<script lang="ts">
	/**
	 * r34 — A STATE GROUP of a list page (Rollouts, Changes, Environments): the product's one titled
	 * panel (`Card`: 47px header, 16px icon, title 14/600, right-aligned 12px rollup) holding `py-3` rows
	 * separated by `divide-line-subtle`, each row starting with one 16px status column at the same x.
	 * Role: Linear's "In Review · 1" group header + rows, drawn in the rollout Overview's card grammar.
	 * Nothing new is invented here; it exists so every ledger on the five pages has one header shape.
	 * `rollup` = the count with its unit and the adverse count in its ink (`2 places · 1 yours`).
	 * r3-filters: `fold` = the section's own way to see more, in its header after the rollup ("Show all 8" /
	 * "Show fewer"), replacing the page-level state chips; a folded section opens in place. `id` anchors it.
	 */
	import type { Component, Snippet } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	let { icon, title, rollup, adverse = null, held = null, fold = null, id = undefined, class: className = '', children }: {
		icon: Component; title: string;
		/** the right-aligned rollup text; `adverse` (if given) is rendered first, in danger ink */
		rollup: string; adverse?: string | null;
		/** r4-change (additive): a held / waiting count, rendered in the HELD ink after the danger count (each state count in its own hue: "1 failing · 5 waiting · 9 places") */
		held?: string | null;
		/** the header's fold control: `n` = how many rows the section holds in all; shown only when it is folded or was opened */
		fold?: { n: number; open: boolean; toggle: () => void } | null;
		id?: string; class?: string; children: Snippet;
	} = $props();
</script>

<Card {icon} {title} {id} padded={false} class={className}>
	{#snippet rollup()}
		<span class="t-ui-sm flex items-center gap-3 tabular-nums"><span>{#if adverse}<span class="text-danger">{adverse}</span>{#if held || rollup}{' · '}{/if}{/if}{#if held}<span class="text-held">{held}</span>{#if rollup}{' · '}{/if}{/if}<span class="text-fg-subtle">{rollup}</span></span>{#if fold}<button type="button" class="group-fold t-ui-sm text-fg-muted hover:text-fg hover:underline" aria-expanded={fold.open} onclick={fold.toggle} data-show-all>{fold.open ? 'Show fewer' : `Show all ${fold.n}`}</button>{/if}</span>
	{/snippet}
	<ul class="divide-y divide-line-subtle">{@render children()}</ul>
</Card>

<style>
	/* the fold is a 12px word in a 47px header: its tap box is the header's height, never a 16px line */
	.group-fold { min-height: 28px; margin-block: -4px; }
	/* a phone thumb gets the header's full 44px (the header's own py-3 is the slack) */
	@media (max-width: 639.98px) { .group-fold { min-height: 44px; margin-block: -12px; } }
</style>
