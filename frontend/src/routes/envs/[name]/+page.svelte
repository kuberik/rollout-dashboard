<svelte:options runes={true} />

<script lang="ts">
	/**
	 * /envs/<name> — the single Environment page (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/env-detail.html).
	 * <name> is a tier (`dev`, `test`, `staging`, `prod` — the Environments list's tile links) or a production region (`prod-<region>` — its region
	 * cells). LIVE DATA: the page reads the same FleetSource Home / Apps / Changes / Environments read (FleetGate installs it from the fleet queries),
	 * so the lists and this page can never disagree. The old page's fixture-pinned computation in this script is retired.
	 */
	import { page } from '$app/state';
	import { pageTitle } from '$lib/page-title';
	import { href } from '$lib/paths';
	import NotFound from '$lib/components/NotFound.svelte';
	import { scenarioOf } from '$lib/components/new/scenario';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	import EnvPage from '$lib/components/new/env/EnvPage.svelte';
	import { envPage, suggestEnv } from '$lib/components/new/env/env-page';

	const envName = $derived(page.params.name as string);
	const state = $derived(scenarioOf(page.url));
</script>

<svelte:head><title>{pageTitle(envName)}</title></svelte:head>

<FleetGate subject="this environment">
	{@const P = envPage(state, envName)}
	{#if P}
		<EnvPage {state} {P} />
	{:else}
		{@const near = suggestEnv(envName, state)}
		<NotFound eyebrow="Environment" title={envName} headline="This environment does not exist" nextStep={near ? `Did you mean ${near}?` : 'Environments are dev, test, staging, production and its regions.'} backHref={near ? href(`/envs/${near}`) : href('/environments')} backLabel={near ? `Open ${near}` : 'Back to environments'} />
	{/if}
</FleetGate>
