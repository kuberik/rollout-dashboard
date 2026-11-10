<script lang="ts">
	/** r34 — Environments on its real route (owner ruling 2026-11-01: the redesign replaces the page here; no /lab/new path). */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { scenarioOf } from '$lib/components/new/scenario';
	import Environments from '$lib/components/new/Environments.svelte';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	const state = $derived(scenarioOf(page.url));
</script>

<svelte:head><title>{pageTitle('Environments')}</title></svelte:head>
<FleetGate><Environments {state} /></FleetGate>
