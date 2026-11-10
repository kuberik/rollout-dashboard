<script lang="ts">
	/** r34 — Changes on its real route (owner ruling 2026-11-01: the redesign replaces the page here; no /lab/new path). */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { scenarioOf } from '$lib/components/new/scenario';
	import Changes from '$lib/components/new/Changes.svelte';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	const state = $derived(scenarioOf(page.url));
</script>

<svelte:head><title>{pageTitle('Changes')}</title></svelte:head>
<FleetGate><Changes {state} /></FleetGate>
