<svelte:options runes={true} />

<script lang="ts">
	/**
	 * FilterChip — the ONE filter chip (owner decision 5, detail pass 2026-11-08). Any list page that filters (Activity's Failed / In flight
	 * and env filters; a future Changes / Apps filter row) draws its chips with this component instead of a hand-written `<button class="pill">`.
	 *
	 * Role: a multi-select toggle (none selected = everything; no "All" pill, no dropdowns — CLAUDE.md list rules). REFERENCE: the kit's `.pill`
	 * (language.css) — 28px, 6px radius, 12px/500 type, hairline border on the surface token. This component adds no geometry of its own: it
	 * fixes the CONTENT ORDER (optional state dot · label · count in tabular figures · optional remove x) so every page prints the same chip.
	 * Selected = the neutral filled wash + strong hairline + fg ink (`aria-pressed="true"`, language.css `.pill[aria-pressed]`): gray, never
	 * blue (CLAUDE.md toggle rule — state hue belongs to the dot only, and only where something needs a person).
	 *
	 * Props: `dot` is a Tailwind bg class for the 6px state dot; `count` is printed in `tabular-nums text-fg-subtle`; `removable` draws the
	 * trailing x of an active scope chip ("Showing only: env prod x") and then the chip is pressed by definition.
	 */
	import type { Snippet } from 'svelte';
	let { label, count = null, dot = null, selected = false, removable = false, title, onclick, disabled = false, children }: {
		label?: string;
		count?: number | string | null;
		dot?: string | null;
		selected?: boolean;
		removable?: boolean;
		title?: string;
		onclick?: () => void;
		disabled?: boolean;
		children?: Snippet;
	} = $props();
</script>

<button type="button" class="pill" aria-pressed={removable ? true : selected} {title} {disabled} {onclick} data-filter-chip>
	{#if dot}<span class="h-1.5 w-1.5 shrink-0 rounded-full {dot}" aria-hidden="true"></span>{/if}
	{#if children}{@render children()}{:else}{label}{/if}
	{#if count !== null && count !== undefined}<span class="tabular-nums text-fg-subtle" data-filter-count>{count}</span>{/if}
	{#if removable}<span aria-hidden="true">×</span>{/if}
</button>
