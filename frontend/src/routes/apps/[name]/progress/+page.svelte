<script lang="ts">
	/**
	 * App page, Progress tab (app-pipeline r0): the same AppDetail as the Overview with `tab="progress"`: the same header and statement
	 * banners, then the Pipeline card at full width. The route owns only the param, the title and the scenario.
	 */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { scenarioOf } from '$lib/components/new/scenario';
	import AppDetail from '$lib/components/new/app/AppDetail.svelte';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	const state = $derived(scenarioOf(page.url));
	const appName = $derived(page.params.name as string);
</script>

<svelte:head><title>{pageTitle(`${appName} · Progress`)}</title></svelte:head>
<FleetGate><AppDetail {state} name={appName} tab="progress" release={page.url.searchParams.get('release')} /></FleetGate>
