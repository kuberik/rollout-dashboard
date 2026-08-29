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
		{ key: 'versions', href: '/versions', label: 'Revisions', icon: TagOutline },
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

<aside
	class="hidden shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white py-3 transition-[width] duration-150 dark:border-gray-700 dark:bg-gray-800 sm:flex {collapsed ? 'w-12' : 'w-44'}"
	aria-label="Sections"
>
	<nav class="flex flex-1 flex-col gap-0.5 px-2">
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
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="inline-flex w-full items-center {collapsed ? 'justify-center' : 'gap-2.5'} rounded-md px-2 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700/40 dark:hover:text-gray-300"
		>
			{#if collapsed}
				<ChevronDoubleRightOutline class="h-3.5 w-3.5 shrink-0" />
			{:else}
				<ChevronDoubleLeftOutline class="h-3.5 w-3.5 shrink-0" />
				<span class="truncate">Collapse</span>
			{/if}
		</button>
	</div>
</aside>
