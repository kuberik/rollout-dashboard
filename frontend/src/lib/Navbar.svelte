<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { MoonSolid, SunSolid, SearchOutline } from 'flowbite-svelte-icons';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?raw';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?raw';
	import { theme } from '$lib/stores/theme';
	import type { Rollout } from '../types';
	import { Badge } from 'flowbite-svelte';
	import { ChevronSortOutline } from 'flowbite-svelte-icons';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, rolloutQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import type { Environment } from '../types';

	let currentTheme = $state<'light' | 'dark'>('light');
	let switcherOpen = $state(false);
	let isMac = $state(false);

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	});

	const isRolloutPage = $derived(page.url.pathname.match(/^\/rollouts\/[^/]+\/[^/]+/) !== null);
	const appDetailMatch = $derived(page.url.pathname.match(/^\/apps\/([^/]+)/));
	const envDetailMatch = $derived(page.url.pathname.match(/^\/envs\/([^/]+)/));
	const nsDetailMatch = $derived(page.url.pathname.match(/^\/namespaces\/([^/]+)/));

	// Section breadcrumb: every page belongs to a section. Render as a
	// plain static link (no dropdown) — sidebar is the section switcher.
	type Section = { key: string; label: string; href: string };
	const SECTIONS: readonly Section[] = [
		{ key: 'rollouts', label: 'Rollouts', href: '/' },
		{ key: 'apps', label: 'Apps', href: '/apps' },
		{ key: 'environments', label: 'Environments', href: '/environments' },
		{ key: 'activity', label: 'Activity', href: '/activity' }
	];
	const currentSection = $derived.by<Section>(() => {
		const p = page.url.pathname;
		if (p.startsWith('/apps')) return SECTIONS[1];
		if (p.startsWith('/environments') || p.startsWith('/envs/')) return SECTIONS[2];
		if (p.startsWith('/activity')) return SECTIONS[3];
		return SECTIONS[0];
	});

	// Palette scope for the item ⇅ button — rollouts / apps / envs / namespaces.
	type PaletteScope = 'rollout' | 'app' | 'env' | 'namespace';
	let paletteScope = $state<PaletteScope | null>(null);

	// Detail context: rendered as breadcrumb 'Item ⇅' on detail pages.
	const detailContext = $derived.by(() => {
		if (isRolloutPage) return { kind: 'rollout' as const };
		if (appDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(appDetailMatch[1]), mono: false };
		if (envDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(envDetailMatch[1]), mono: false };
		if (nsDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(nsDetailMatch[1]), mono: false };
		return null;
	});

	const namespace = $derived(page.params.namespace as string | undefined);
	const name = $derived(page.params.name as string | undefined);
	const dashboard = $derived(page.url.searchParams.get('dashboard') || undefined);

	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace: namespace || '',
			name: name || '',
			dashboard,
			options: {
				refetchInterval: 5000,
				enabled: isRolloutPage && !!namespace && !!name
			}
		})
	);

	const allRolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: 30000
			}
		})
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterURL = $derived<string>(clusterQuery.data?.url || '');

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const allRollouts = $derived(allRolloutsQuery.data?.rollouts?.items || []);
	const allEnvironments = $derived<Environment[]>(allRolloutsQuery.data?.environments?.items || []);
	const rolloutTheme = $derived(
		rollout ? getRolloutEnvironmentTheme(rollout, rolloutQuery.data?.environment) : null
	);
	const rolloutThemeStyle = $derived(
		rolloutTheme ? getEnvironmentThemeStyle(rolloutTheme) : undefined
	);


	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (!switcherOpen) {
				paletteScope = null; // global scope by default on ⌘K
				switcherOpen = true;
			} else {
				switcherOpen = false;
			}
		}
	}

	$effect(() => {
		// When the palette closes, reset its scope so the next open is clean.
		if (!switcherOpen) paletteScope = null;
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<nav
	class="environment-theme-scope sticky top-0 z-50 w-full border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
	style={rolloutThemeStyle}
>
	{#if rolloutTheme}
		<div class="h-1 w-full environment-theme-accent" aria-hidden="true"></div>
	{/if}
	<div class="flex w-full flex-wrap items-center justify-between px-2 py-2 sm:px-4">
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
			<a href="/" class="flex shrink-0 items-center space-x-2 sm:space-x-3 rtl:space-x-reverse">
				<div class="flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">
					<div
						class="h-full w-full [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
					>
						{@html currentTheme === 'dark' ? LogoDark : LogoLight}
					</div>
				</div>
				<span class="hidden font-montserrat text-xl font-thin text-gray-600 dark:text-gray-400 sm:inline"
					>kuberik</span
				>
			</a>

			<!-- Section breadcrumb: section name LINK navigates to the list
			     page; item chevron opens the unified CommandPalette scoped
			     to that kind. Same palette everywhere. -->
			<div class="flex min-w-0 items-center gap-1">
				<span class="hidden h-5 w-px bg-gray-300 dark:bg-gray-600 sm:block"></span>
				<a
					href={currentSection.href}
					class="truncate rounded-md px-2 py-1 text-base font-light text-gray-900 transition-colors hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700/60 sm:text-lg"
				>{currentSection.label}</a>

				{#if detailContext?.kind === 'rollout' && rollout}
					<span class="select-none text-base text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
					<button
						type="button"
						onclick={() => { paletteScope = 'rollout'; switcherOpen = true; }}
						class="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/60"
						aria-label="Switch rollout (⌘K)"
						title={isMac ? 'Switch rollout (⌘K)' : 'Switch rollout (Ctrl K)'}
					>
						<span class="flex min-w-0 items-baseline gap-1.5">
							<span class="hidden truncate text-sm text-gray-500 dark:text-gray-400 sm:inline">
								{rollout.metadata?.namespace}
							</span>
							<span class="hidden text-gray-300 dark:text-gray-600 sm:inline">/</span>
							<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">
								{rollout.metadata?.name}
							</span>
							{#if rolloutTheme}
								<Badge
									color="gray"
									size="small"
									class="environment-theme-badge hidden shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-flex"
								>
									{rolloutTheme.label}
								</Badge>
							{/if}
						</span>
						<kbd class="hidden shrink-0 font-mono text-[10px] font-normal text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400 md:inline-block">
							{isMac ? '⌘K' : 'Ctrl K'}
						</kbd>
						<ChevronSortOutline class="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
					</button>
				{:else if detailContext?.kind === 'item'}
					<span class="select-none text-base text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
					{@const itemScope = appDetailMatch ? 'app' : envDetailMatch ? 'env' : nsDetailMatch ? 'namespace' : null}
					<button
						type="button"
						onclick={() => { if (itemScope) { paletteScope = itemScope; switcherOpen = true; } }}
						disabled={!itemScope}
						class="group flex min-w-0 items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-700/60 dark:disabled:hover:bg-transparent"
						aria-label={`Switch ${currentSection.label.toLowerCase()}`}
					>
						<span class="truncate text-sm font-semibold text-gray-900 dark:text-white {detailContext.mono ? 'font-mono' : ''}" title={detailContext.item}>
							{detailContext.item}
						</span>
						{#if itemScope}
							<ChevronSortOutline class="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
						{/if}
					</button>
				{/if}
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-2 sm:gap-2.5">
			{#if import.meta.env.VITE_APP_VERSION}
				<Badge color="gray" class="hidden bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 sm:inline-flex">{import.meta.env.VITE_APP_VERSION}</Badge>
			{/if}
			<button
				class="rounded-lg bg-gray-100 p-1.5 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 sm:p-2"
				onclick={() => theme.toggle()}
				aria-label="Toggle dark mode"
			>
				{#if currentTheme === 'dark'}
					<SunSolid class="h-4 w-4 sm:h-5 sm:w-5" />
				{:else}
					<MoonSolid class="h-4 w-4 sm:h-5 sm:w-5" />
				{/if}
			</button>
		</div>
	</div>
</nav>

<CommandPalette
	bind:open={switcherOpen}
	bind:scope={paletteScope}
	rollouts={allRollouts}
	environments={allEnvironments}
	{localClusterURL}
	currentNamespace={namespace}
	currentName={name}
	loading={allRolloutsQuery.isLoading}
/>

