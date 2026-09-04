<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		HomeOutline,
		GridOutline,
		RocketOutline,
		LayersSolid,
		ClockOutline,
		TagOutline,
		ChevronDoubleLeftOutline,
		ChevronDoubleRightOutline
	} from 'flowbite-svelte-icons';

	const NAV = [
		{ key: 'control', href: '/', label: 'Home', icon: HomeOutline },
		{ key: 'rollouts', href: '/rollouts', label: 'Rollouts', icon: GridOutline },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: RocketOutline },
		{ key: 'envs', href: '/environments', label: 'Environments', icon: LayersSolid },
		{ key: 'revisions', href: '/revisions', label: 'Revisions', icon: TagOutline },
		{ key: 'activity', href: '/activity', label: 'Activity', icon: ClockOutline }
	] as const;

	let collapsed = $state(false);

	onMount(() => {
		const stored = localStorage.getItem('sidebar-collapsed');
		if (stored === '1') collapsed = true;
	});

	function toggle() {
		collapsed = !collapsed;
		try {
			localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
		} catch {
			// localStorage unavailable; preference is non-critical
		}
	}

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/rollouts') return path === '/rollouts' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (href === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === href || path.startsWith(href + '/');
	}
</script>

<!-- `div`, not `aside`: a section rail is not complementary content, and the
     `aside` was publishing a second landmark named "Sections" wrapping a nav of
     the same name. The `nav` below is the landmark; this is just its box.

     ⛔ SUPERSEDED 2026-09-04 — the sidebar only exists from `sm` up, where the shell
     is the viewport again and this column is stretched to it by flex; `sticky`,
     `top-16` and the `max-height` are gone (see the root layout). What follows
     is the document-scroller reasoning it replaced.
     ⭐ `sticky top-16` + ITS OWN `max-height` + ITS OWN `overflow-y-auto`.
     (2026-09-03, scroll model rewrite) This used to lean on the OLD model's
     `h-screen` shell for its height — the content row was exactly the
     viewport tall, so `overflow-y-auto` here had a real bound to scroll
     within. Now that `<main>` is a plain block and the DOCUMENT scrolls
     (see `app.css`), that bound is gone unless this element makes its own:
     `top-16` (64px, the navbar's own height, same constant `Navbar.svelte`
     is built to) is where it sticks as the document scrolls past it, and
     `max-h-[calc(100dvh-4rem)]` is the same 64px subtracted from the
     viewport, so a sidebar with more sections than fit scrolls internally
     instead of pushing the page taller than the screen. `self-start` stops
     the flex row from stretching this to `<main>`'s (now unbounded) height
     before the cap even applies. -->
<div
	class="hidden shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white py-3 transition-[width] duration-150 [overscroll-behavior:contain] dark:border-gray-700 dark:bg-gray-800 sm:flex {collapsed ? 'w-12' : 'w-44'}"
>
	<nav id="sidebar-sections" class="flex flex-1 flex-col gap-0.5 px-2" aria-label="Sections">
		{#each NAV as n (n.key)}
			{@const active = isActive(n.href)}
			<a
				href={n.href}
				aria-current={active ? 'page' : undefined}
				title={collapsed ? n.label : undefined}
				class="group inline-flex items-center {collapsed ? 'justify-center' : 'gap-2.5'} rounded-md px-2 py-2 text-sm font-medium transition-colors
					{active
						? 'bg-gray-100 text-gray-900 dark:bg-gray-700/60 dark:text-white'
						: 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-white'}"
			>
				<n.icon class="h-4 w-4 shrink-0" />
				{#if !collapsed}<span class="truncate">{n.label}</span>{/if}
			</a>
		{/each}
	</nav>
	<!-- Collapse toggle pinned to bottom -->
	<div class="mt-2 px-2">
		<button
			type="button"
			onclick={toggle}
			aria-expanded={!collapsed}
			aria-controls="sidebar-sections"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="inline-flex w-full items-center {collapsed ? 'justify-center' : 'gap-2.5'} rounded-md px-2 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-gray-300"
		>
			{#if collapsed}
				<ChevronDoubleRightOutline class="h-3.5 w-3.5 shrink-0" />
			{:else}
				<ChevronDoubleLeftOutline class="h-3.5 w-3.5 shrink-0" />
				<span class="truncate">Collapse</span>
			{/if}
		</button>
	</div>
</div>
