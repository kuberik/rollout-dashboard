<svelte:options runes={true} />

<script lang="ts">
	/** Headless: publishes the fleet's app names to the one monogram map (see app-monogram.svelte.ts). Mounted once in the root layout. */
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { staleTimeWhenHealthy } from '$lib/api/errors';
	import { expectFleetAppNames, publishFleetAppNames } from './app-monogram.svelte';

	const q = createQuery(() => rolloutsListQueryOptions({ options: { staleTime: staleTimeWhenHealthy(30000, 30000) } }));
	expectFleetAppNames(); /* synchronous, before any page below draws a glyph */
	$effect(() => {
		if (!q.data && !q.isError) return;
		publishFleetAppNames([...new Set((q.data?.rollouts?.items ?? []).map((r) => r.metadata?.name).filter((n): n is string => !!n))].sort());
	});
</script>
