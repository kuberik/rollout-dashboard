<svelte:options runes={true} />

<script lang="ts">
	import { isApplePlatform } from '$lib/shortcut-hint';
	/**
	 * THE SIDEBAR — the shell's one frame. (Design language, 2026-10-08,
	 * shell redesign.)
	 *
	 * ROLE: everything that is the same on every page lives here, from `sm` up:
	 * the brand, search (the command palette), the sections, and the viewer's
	 * own controls (GitHub account, time zone, theme, version, collapse). The
	 * top bar beside it then carries only the page's own location (the
	 * breadcrumb) — so the frame is one column of chrome plus one bar of
	 * context, the way Linear and Vercel draw theirs, instead of two bars that
	 * both held a bit of everything.
	 *
	 * Proportions: 232px expanded / 56px collapsed; a 52px brand row aligned
	 * with the 52px top bar; 32px items (`t-ui`, 6px radius, 8px icon gap);
	 * 12px horizontal inset. On the GROUND, separated by one `border-line`
	 * hairline: chrome never lifts — only content does.
	 *
	 * Below `sm` this component renders nothing: the phone has the top bar and
	 * `MobileTabBar`.
	 *
	 * ⛔ D-32 (2026-10-08) — ONE ICON PER MEANING: Changes is
	 * `CodePullRequestOutline` (the palette's glyph for a change), never the
	 * tag, which means a build.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { href, appPath } from '$lib/paths';
	import { NAV_ICON } from '$lib/nav-icons';
	import {
		SearchOutline,
		MoonOutline,
		SunOutline,
		ChevronDoubleLeftOutline,
		ChevronDoubleRightOutline
	} from 'flowbite-svelte-icons';
	// `?url`, not `?raw`: an inlined copy here would duplicate the gradient ids
	// the Navbar's inlined logo uses, and since this column is `display:none`
	// on a phone, the navbar's logo would resolve them against hidden defs and
	// render empty.
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?url';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?url';
	import { theme } from '$lib/stores/theme';
	import { setDisplayTimeZone, timeZonePreference } from '$lib/timezone.svelte';
	import { displayTimeZoneName } from '$lib/display-time';
	import GithubConnectButton from '$lib/components/GithubConnectButton.svelte';
	import { stars } from '$lib/stores/stars.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import { homeAskCount } from '$lib/components/new/home-page';

	const NAV = [
		{ key: 'control', href: '/', label: 'Home', icon: NAV_ICON['/'] },
		{ key: 'rollouts', href: '/rollouts', label: 'Rollouts', icon: NAV_ICON['/rollouts'] },
		{ key: 'changes', href: '/changes', label: 'Changes', icon: NAV_ICON['/changes'] },
		{ key: 'envs', href: '/environments', label: 'Environments', icon: NAV_ICON['/environments'] },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: NAV_ICON['/apps'] },
		{ key: 'activity', href: '/activity', label: 'Activity', icon: NAV_ICON['/activity'] }
	] as const;
	/* r39: the Starred block under the sections — the apps this browser starred (StarToggle's store), alphabetical */
	/* the Home item's badge: Home's Attention asks, from the live source only (null = no live source yet: no badge) */
	const homeAsks = $derived(homeAskCount());
	const starred = $derived([...stars.apps].sort((a, b) => a.localeCompare(b)));

	let collapsed = $state(false);
	let currentTheme = $state<'light' | 'dark'>('light');
	let isMac = $state(false);

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		try {
			if (localStorage.getItem('sidebar-collapsed') === '1') collapsed = true;
		} catch {
			// storage unavailable — stay expanded
		}
		isMac = isApplePlatform(navigator.platform);
	});

	function toggle() {
		collapsed = !collapsed;
		try {
			localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
		} catch {
			// storage unavailable — the toggle still works for this visit
		}
	}

	/** The palette's owner (`Navbar`) listens for ⌘K / Ctrl K on the window. */
	function openSearch() {
		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true })
		);
	}

	function isActive(navHref: string): boolean {
		const path = appPath(page.url.pathname);
		if (navHref === '/') return path === '/';
		if (navHref === '/rollouts')
			return path === '/rollouts' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (navHref === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === navHref || path.startsWith(navHref + '/');
	}

	const tzTitle = $derived(
		timeZonePreference.zone === 'utc'
			? 'Times shown in UTC. Switch to local time'
			: `Times shown in local time (${displayTimeZoneName()}). Switch to UTC`
	);
	const item = 't-ui flex h-9 items-center rounded-sm transition-colors';
</script>

<!-- `div`, not `aside`: the `nav` below is the landmark. -->
<div
	class="hidden shrink-0 flex-col border-r border-line bg-ground transition-[width] duration-150 [overscroll-behavior:contain] sm:flex {collapsed
		? 'w-14'
		: 'w-58'}"
>
	<!-- Brand row: 52px, the top bar's height, so the two frames share a line. -->
	<div class="flex h-[52px] shrink-0 items-center gap-2 {collapsed ? 'justify-center px-2' : 'px-4'}">
		<a href={href('/')} class="flex items-center gap-2" aria-label="kuberik home">
			<img src={currentTheme === 'dark' ? LogoDark : LogoLight} alt="" class="h-6 w-6 shrink-0" />
			{#if !collapsed}<span class="t-heading text-fg">kuberik</span>{/if}
		</a>
	</div>

	<div class="px-3 pb-2">
		<button
			type="button"
			onclick={openSearch}
			class="{item} w-full border border-line bg-surface text-fg-subtle hover:border-line-strong hover:text-fg-muted {collapsed
				? 'justify-center px-0'
				: 'gap-2 px-2'}"
			aria-label={isMac ? 'Search (⌘K)' : 'Search (Ctrl K)'}
			title={collapsed ? (isMac ? 'Search (⌘K)' : 'Search (Ctrl K)') : undefined}
		>
			<SearchOutline class="h-4 w-4 shrink-0" />
			{#if !collapsed}
				<span class="flex-1 text-left">Search</span>
				<kbd class="t-code-sm rounded-xs border border-line px-1 text-fg-subtle">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
			{/if}
		</button>
	</div>

	<nav id="sidebar-sections" class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2" aria-label="Sections">
		{#each NAV as n (n.key)}
			{@const active = isActive(n.href)}
			<a
				href={href(n.href)}
				aria-current={active ? 'page' : undefined}
				title={collapsed ? n.label : undefined}
				class="{item} {collapsed ? 'justify-center' : 'gap-2 px-2'} {active
					? 'bg-selected text-fg'
					: 'text-fg-muted hover:bg-hover hover:text-fg'}"
			>
				<n.icon class="h-4 w-4 shrink-0 {active ? 'text-fg' : 'text-fg-subtle'}" />
				{#if !collapsed}<span class="truncate">{n.label}</span>{#if n.key === 'control' && homeAsks}<span class="t-ui-sm ml-auto rounded-sm border border-line px-1.5 tabular-nums text-fg" data-nav-count aria-label="{homeAsks} waiting on you">{homeAsks}</span>{/if}{/if}
			</a>
		{/each}
		{#if starred.length}
			<!-- r39 Starred: the same 38px pitch, a 20px monogram instead of an icon; hidden collapsed to monograms only -->
			<div class="mt-4 flex flex-col gap-0.5" data-starred>
				{#if !collapsed}<p class="t-meta px-2 pb-1 text-fg-subtle">Starred</p>{/if}
				{#each starred as app (app)}
					{@const active = isActive('/apps/' + app)}
					<a href={href('/apps/' + app)} aria-current={active ? 'page' : undefined} title={app} class="{item} {collapsed ? 'justify-center' : 'gap-2 px-2'} {active ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'}">
						<AppGlyph name={app} size={20} class="shrink-0" />
						{#if !collapsed}<span class="truncate">{app}</span>{/if}
					</a>
				{/each}
			</div>
		{/if}
	</nav>

	<!-- The viewer's own controls: who you are, how times read, the theme. -->
	<div class="flex shrink-0 flex-col gap-1 border-t border-line px-3 py-3">
		{#if !collapsed}
			<div class="flex min-w-0 items-center"><GithubConnectButton /></div>
		{/if}
		<div class="flex items-center gap-1 {collapsed ? 'flex-col' : ''}">
			<button
				type="button"
				class="btn btn-ghost btn-xs tabular-nums"
				onclick={() => setDisplayTimeZone(timeZonePreference.zone === 'utc' ? 'local' : 'utc')}
				aria-label={tzTitle}
				title={tzTitle}
			>
				{timeZonePreference.zone === 'utc' ? 'UTC' : 'Local'}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-icon btn-xs"
				onclick={() => theme.toggle()}
				aria-label={currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				title={currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			>
				{#if currentTheme === 'dark'}<SunOutline />{:else}<MoonOutline />{/if}
			</button>
			{#if !collapsed && import.meta.env.VITE_APP_VERSION}
				<span class="t-code-sm ml-auto text-fg-subtle">{import.meta.env.VITE_APP_VERSION}</span>
			{/if}
			<button
				type="button"
				onclick={toggle}
				aria-controls="sidebar-sections"
				aria-expanded={!collapsed}
				class="btn btn-ghost btn-icon btn-xs {collapsed || !import.meta.env.VITE_APP_VERSION ? '' : ''}"
				title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			>
				{#if collapsed}<ChevronDoubleRightOutline />{:else}<ChevronDoubleLeftOutline />{/if}
			</button>
		</div>
	</div>
</div>
