<script lang="ts">
	/**
	 * r34 v2 AD — App detail on its real route (owner ruling 2026-11-01: built in place, no /lab/new path).
	 * The route owns only the param, the title and the scenario (?calm=1 / ?quiet=1); the page is new/app/AppDetail.svelte,
	 * drawn from the SAME objects the Apps list draws (new/data.ts, keyed by the route param).
	 * RETIRED ON THIS BRANCH: the old live-query page body (Direction B: Needs-you task blocks, Promotion pipeline, exposure
	 * bar, ~4,200 lines). It stays in git history; its three route-level tests tested that body and are retired with it.
	 */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { scenarioOf } from '$lib/components/new/scenario';
	import AppDetail from '$lib/components/new/app/AppDetail.svelte';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	const state = $derived(scenarioOf(page.url));
	const appName = $derived(page.params.name as string);
</script>

<svelte:head><title>{pageTitle(appName)}</title></svelte:head>
<FleetGate><AppDetail {state} name={appName} /></FleetGate>
