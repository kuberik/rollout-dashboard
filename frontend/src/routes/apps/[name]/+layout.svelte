<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE APP PAGE'S TAB STRIP (app-pipeline r0): Overview and Pipeline, drawn by the SAME `SectionTabs` as the rollout tabs and published
	 * into the shell chrome the same way (see the rollout layout's `tabStripSnippet` for why it lives in the shell, not in <main>). Two tabs,
	 * always both: nothing here is conditional, so the strip never changes width while the fleet loads.
	 * No strip over the NotFound body: an app the fleet does not know draws "This app does not exist" without two links to pages that do not
	 * exist. "Known" needs the live source (FleetGate installs it): until it is installed the strip shows, as the rollout layout's does.
	 */
	import { page } from '$app/state';
	import { ObjectsColumnOutline, ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import { getShellChrome } from '$lib/shell-chrome.svelte';
	import { appPath } from '$lib/paths';
	import { scenarioOf } from '$lib/components/new/scenario';
	import { apps } from '$lib/components/new/data';
	import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
	import SectionTabs from '$lib/components/SectionTabs.svelte';

	let { children }: { children: Snippet } = $props();

	const name = $derived(page.params.name as string);
	const activeUrl = $derived(appPath(page.url.pathname));
	const base = $derived(`/apps/${encodeURIComponent(name)}`);
	const notFound = $derived(!!liveSource() && !apps(scenarioOf(page.url)).items.some((a) => a.app === name));

	const tabs = $derived([
		{ label: 'Overview', href: base, icon: ObjectsColumnOutline, state: 'active' as const },
		{ label: 'Pipeline', href: `${base}/pipeline`, icon: ChevronDoubleRightOutline, state: 'active' as const }
	]);
	const isActive = (href: string) => (href === base ? activeUrl === href || activeUrl === `${href}/` : activeUrl.startsWith(href));

	let tabStripEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		void activeUrl;
		tabStripEl?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
	});

	const shellChrome = getShellChrome();
	$effect(() => {
		shellChrome.tabStrip = notFound ? null : tabStripSnippet;
		return () => {
			if (shellChrome.tabStrip === tabStripSnippet) shellChrome.tabStrip = null;
		};
	});
</script>

{@render children()}

{#snippet tabStripSnippet()}
	<SectionTabs {tabs} label="App sections" {isActive} inset="sm:px-6" bind:el={tabStripEl} />
{/snippet}
