<svelte:options runes={true} />

<script lang="ts">
	/**
	 * TEST-ONLY HARNESS for SkipRuleModal: owns the same three pieces of state the Gates page owns (open, target, rows) and exposes two
	 * buttons that reopen the dialog for the "other" rule, the way a second Skip once tile does. No route imports it.
	 */
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import SkipRuleModal from '$lib/components/SkipRuleModal.svelte';
	import type { SkipRow, SkipTarget } from '$lib/view-models/skip-rule';

	let {
		first,
		second,
		here
	}: {
		first: { target: SkipTarget; rows: SkipRow[] };
		second: { target: SkipTarget; rows: SkipRow[] };
		here: { cluster: string; namespace: string; name: string; env: string };
	} = $props();

	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
	let open = $state(false);
	let target = $state.raw<SkipTarget | null>(null);
	let rows = $state.raw<SkipRow[]>([]);
	function openWith(x: { target: SkipTarget; rows: SkipRow[] }) {
		target = x.target;
		rows = x.rows;
		open = true;
	}
</script>

<QueryClientProvider {client}>
	<button type="button" data-open-first onclick={() => openWith(first)}>open first</button>
	<button type="button" data-open-second onclick={() => openWith(second)}>open second</button>
	{#if target}<SkipRuleModal bind:open {target} {here} {rows} />{/if}
</QueryClientProvider>
