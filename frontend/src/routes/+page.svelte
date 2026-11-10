<script lang="ts">
	/** r39 — Home on its real route. The scenario (?calm=1 / ?quiet=1) comes from the URL like every list page. */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { scenarioOf } from '$lib/components/new/scenario';
	import Home from '$lib/components/new/Home.svelte';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	const state = $derived(scenarioOf(page.url));
</script>

<svelte:head><title>{pageTitle()}</title></svelte:head>
<FleetGate><Home {state} /></FleetGate>
