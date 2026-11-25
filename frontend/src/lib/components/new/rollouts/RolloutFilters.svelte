<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE /rollouts FILTER. ROLE: the page's adapter for the shared QueryBar (filter/QueryBar.svelte): this page's rows,
	 * properties and words. Values are plain text + count (owner 2026-11-22: no icons in filter values). Pure logic: rollouts-filter.ts.
	 */
	import QueryBar from '$lib/components/filter/QueryBar.svelte';
	import type { RolloutsPage } from '../rollouts-page';
	import { entries, entryText, rolloutDefs } from '../rollouts-filter';
	import type { FilterQuery } from '$lib/components/filter/filter-model';

	let { P, filter, onchange }: { P: Pick<RolloutsPage, 'groups' | 'rest'>; filter: FilterQuery; onchange: (f: FilterQuery) => void } = $props();
	const rows = $derived(entries(P));
	const defs = $derived(rolloutDefs(rows));
	/* state has four words and they are the vocabulary: list them all (the other properties show their busiest values) */
	const HINTS: Record<string, string> = { state: 'In flight, Waiting, Held, At rest' };
</script>

<QueryBar {rows} {defs} text={entryText} query={filter} {onchange} hints={HINTS} placeholder="Search rollouts, or filter by state, environment, namespace" placeholderShort="Search or filter" label="Search and filter rollouts" />
