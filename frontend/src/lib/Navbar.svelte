<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { MoonSolid, SunSolid, ClockOutline, GridOutline, LayersSolid, RocketOutline, SearchOutline } from 'flowbite-svelte-icons';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?raw';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?raw';
	import { theme } from '$lib/stores/theme';
	import type { Rollout } from '../types';
	import { Badge, Popover } from 'flowbite-svelte';
	import { ChevronSortOutline, QuestionCircleOutline } from 'flowbite-svelte-icons';
	import { getRolloutStatus } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, rolloutQueryOptions } from '$lib/api/rollouts';
	import RolloutSwitcher from '$lib/RolloutSwitcher.svelte';
	import ResourceSwitcher from '$lib/ResourceSwitcher.svelte';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import type { Environment } from '../types';

	let currentTheme = $state<'light' | 'dark'>('light');
	let switcherOpen = $state(false);
	let resourceSwitcherOpen = $state(false);
	let isMac = $state(false);

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	});

	// Detect which detail page (if any) we're on so the navbar can show
	// a baked-in 'Section / Item' breadcrumb instead of pages providing
	// their own. Keeps navigation consistent across every detail view.
	const isRolloutPage = $derived(page.url.pathname.match(/^\/rollouts\/[^/]+\/[^/]+/) !== null);
	const appDetailMatch = $derived(page.url.pathname.match(/^\/apps\/([^/]+)/));
	const envDetailMatch = $derived(page.url.pathname.match(/^\/envs\/([^/]+)/));
	const nsDetailMatch = $derived(page.url.pathname.match(/^\/namespaces\/([^/]+)/));
	const detailContext = $derived.by(() => {
		if (appDetailMatch) return { section: 'Apps', sectionHref: '/apps', item: decodeURIComponent(appDetailMatch[1]), mono: true };
		if (envDetailMatch) return { section: 'Environments', sectionHref: '/environments', item: decodeURIComponent(envDetailMatch[1]), mono: false };
		if (nsDetailMatch) return { section: 'Namespaces', sectionHref: '/', item: decodeURIComponent(nsDetailMatch[1]), mono: true };
		return null;
	});
	const namespace = $derived(page.params.namespace as string | undefined);
	const name = $derived(page.params.name as string | undefined);

	// Query for rollout data when on rollout detail page
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace: namespace || '',
			name: name || '',
			options: {
				refetchInterval: 5000,
				enabled: isRolloutPage && !!namespace && !!name
			}
		})
	);

	// Query to fetch all rollouts for the switcher. Keep enabled site-wide so
	// the Ctrl+K palette is reachable from any page.
	const allRolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: 30000
			}
		})
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const allRollouts = $derived(allRolloutsQuery.data?.rollouts?.items || []);
	const allEnvironments = $derived<Environment[]>(allRolloutsQuery.data?.environments?.items || []);
	const rolloutTheme = $derived(
		rollout ? getRolloutEnvironmentTheme(rollout, rolloutQuery.data?.environment) : null
	);
	const rolloutThemeStyle = $derived(
		rolloutTheme ? getEnvironmentThemeStyle(rolloutTheme) : undefined
	);

	// Sibling-item lists for the in-navbar switcher on /apps/[name],
	// /envs/[name], /namespaces/[name]. Each entry is shaped for the
	// generic ResourceSwitcher (key, label, href, optional mono/subtext).
	const resourceItems = $derived.by(() => {
		if (appDetailMatch) {
			const names = new Set<string>();
			for (const env of allEnvironments) {
				const n = env.spec?.rolloutRef?.name;
				if (n) names.add(n);
			}
			return {
				title: 'Apps',
				currentKey: decodeURIComponent(appDetailMatch[1]),
				items: [...names]
					.sort((a, b) => a.localeCompare(b))
					.map((n) => ({ key: n, label: n, href: `/apps/${n}`, mono: true }))
			};
		}
		if (envDetailMatch) {
			const names = new Set<string>();
			for (const env of allEnvironments) {
				const n = env.spec?.environment;
				if (n) names.add(n);
			}
			return {
				title: 'Environments',
				currentKey: decodeURIComponent(envDetailMatch[1]),
				items: [...names]
					.sort((a, b) => a.localeCompare(b))
					.map((n) => ({ key: n, label: n, href: `/envs/${encodeURIComponent(n)}` }))
			};
		}
		if (nsDetailMatch) {
			const names = new Set<string>();
			for (const r of allRollouts) {
				const ns = r.metadata?.namespace;
				if (ns) names.add(ns);
			}
			return {
				title: 'Namespaces',
				currentKey: decodeURIComponent(nsDetailMatch[1]),
				items: [...names]
					.sort((a, b) => a.localeCompare(b))
					.map((n) => ({ key: n, label: n, href: `/namespaces/${encodeURIComponent(n)}`, mono: true }))
			};
		}
		return null;
	});

	// Global ⌘K / Ctrl+K shortcut — works on every page so users can jump
	// to any rollout from anywhere in the dashboard.
	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			switcherOpen = !switcherOpen;
		}
	}
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
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
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
				<div class="hidden h-6 w-px bg-gray-300 dark:bg-gray-600 sm:block"></div>
				<div class="flex flex-col">
					<span class="text-xl font-light dark:text-white sm:text-2xl {isRolloutPage || detailContext ? 'hidden sm:inline' : ''}">Rollouts</span>
				</div>
			</a>
			{#if !isRolloutPage && !detailContext}
				<!-- Main nav links — desktop only; mobile uses bottom tab bar -->
				<div class="hidden items-center sm:flex">
					<a
						href="/"
						aria-label="Rollouts"
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3
							{page.url.pathname === '/'
								? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white'}"
					>
						<GridOutline class="h-4 w-4" />
						<span class="hidden sm:inline">Rollouts</span>
					</a>
					<a
						href="/apps"
						aria-label="Apps"
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3
							{page.url.pathname === '/apps' || page.url.pathname.startsWith('/apps/')
								? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white'}"
					>
						<RocketOutline class="h-4 w-4" />
						<span class="hidden sm:inline">Apps</span>
					</a>
					<a
						href="/environments"
						aria-label="Environments"
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3
							{page.url.pathname === '/environments' || page.url.pathname.startsWith('/envs/')
								? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white'}"
					>
						<LayersSolid class="h-4 w-4" />
						<span class="hidden sm:inline">Environments</span>
					</a>
					<a
						href="/activity"
						aria-label="Activity"
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3
							{page.url.pathname === '/activity'
								? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white'}"
					>
						<ClockOutline class="h-4 w-4" />
						<span class="hidden sm:inline">Activity</span>
					</a>
				</div>
				<!-- Site-wide quick switch (⌘K) -->
				<button
					type="button"
					onclick={() => (switcherOpen = true)}
					aria-label="Quick switch rollout (⌘K)"
					title="Quick switch rollout (⌘K)"
					class="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-500 dark:hover:bg-gray-700/60 dark:hover:text-gray-300 sm:ml-2"
				>
					<SearchOutline class="h-3.5 w-3.5 shrink-0" />
					<kbd class="hidden shrink-0 font-mono text-[10px] lg:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
				</button>
			{/if}
			{#if isRolloutPage && rollout}
				<!-- Ghost breadcrumb switcher trigger -->
				<div class="flex min-w-0 items-center gap-1">
					<span class="select-none text-xl font-light text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
					<button
						type="button"
						onclick={() => (switcherOpen = true)}
						class="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/60"
						aria-label="Switch rollout (⌘K)"
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
				</div>
			{:else if detailContext}
				<!-- Generic detail-page breadcrumb: 'Section / Item ⇅'.
				     Section link → index; item button → ResourceSwitcher. -->
				<div class="flex min-w-0 items-center gap-1">
					<span class="select-none text-xl font-light text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
					<a
						href={detailContext.sectionHref}
						class="rounded-md px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white"
					>{detailContext.section}</a>
					<span class="select-none text-gray-300 dark:text-gray-600" aria-hidden="true">/</span>
					{#if resourceItems && resourceItems.items.length > 1}
						<button
							type="button"
							onclick={() => (resourceSwitcherOpen = true)}
							class="group flex min-w-0 items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/60"
							aria-label={`Switch ${detailContext.section.toLowerCase()}`}
						>
							<span class="truncate text-sm font-semibold text-gray-900 dark:text-white {detailContext.mono ? 'font-mono' : ''}" title={detailContext.item}>
								{detailContext.item}
							</span>
							<ChevronSortOutline class="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
						</button>
					{:else}
						<span class="truncate px-1 text-sm font-semibold text-gray-900 dark:text-white {detailContext.mono ? 'font-mono' : ''}" title={detailContext.item}>
							{detailContext.item}
						</span>
					{/if}
				</div>
				<!-- ⌘K switcher still reachable from these pages -->
				<button
					type="button"
					onclick={() => (switcherOpen = true)}
					aria-label="Quick switch rollout (⌘K)"
					title="Quick switch rollout (⌘K)"
					class="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-500 dark:hover:bg-gray-700/60 dark:hover:text-gray-300"
				>
					<SearchOutline class="h-3.5 w-3.5 shrink-0" />
					<kbd class="hidden shrink-0 font-mono text-[10px] lg:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
				</button>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2 sm:gap-2.5">
			{#if isRolloutPage && rollout}
				{@const status = getRolloutStatus(rollout)}
				{@const readyCondition = rollout.status?.conditions?.find((c) => c.type === 'Ready')}
				{@const errorMessage =
					status.color === 'red' && readyCondition?.message ? readyCondition.message : null}
				<Badge
					id="rollout-status-badge"
					color={status.color}
					size="small"
					class={`${errorMessage ? 'cursor-help' : ''}`}
				>
					{status.text}
					{#if errorMessage}
						<QuestionCircleOutline class="ml-1 h-3 w-3" />
					{/if}
				</Badge>
				{#if errorMessage}
					<Popover triggeredBy="#rollout-status-badge" class="max-w-sm text-sm" trigger="hover">
						<div class="p-3">
							<p class="text-sm text-gray-700 dark:text-gray-300">{errorMessage}</p>
						</div>
					</Popover>
				{/if}
			{/if}
			{#if import.meta.env.VITE_APP_VERSION}
				<Badge color="none" class="hidden bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 sm:inline-flex">{import.meta.env.VITE_APP_VERSION}</Badge>
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

<RolloutSwitcher
	bind:open={switcherOpen}
	rollouts={allRollouts}
	currentNamespace={namespace}
	currentName={name}
	loading={allRolloutsQuery.isLoading}
/>

{#if resourceItems}
	<ResourceSwitcher
		bind:open={resourceSwitcherOpen}
		title={resourceItems.title}
		items={resourceItems.items}
		currentKey={resourceItems.currentKey}
	/>
{/if}
