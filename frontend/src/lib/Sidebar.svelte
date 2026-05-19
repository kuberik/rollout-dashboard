<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { GridOutline, RocketOutline, LayersSolid, ClockOutline } from 'flowbite-svelte-icons';

	const NAV = [
		{ key: 'rollouts', href: '/', label: 'Rollouts', icon: GridOutline },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: RocketOutline },
		{ key: 'envs', href: '/environments', label: 'Environments', icon: LayersSolid },
		{ key: 'activity', href: '/activity', label: 'Activity', icon: ClockOutline }
	] as const;

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (href === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === href || path.startsWith(href + '/');
	}
</script>

<aside
	class="hidden w-44 shrink-0 overflow-y-auto border-r border-gray-200 bg-white py-3 dark:border-gray-700 dark:bg-gray-800 sm:flex sm:flex-col"
	aria-label="Sections"
>
	<nav class="flex flex-col gap-0.5 px-2">
		{#each NAV as n (n.key)}
			{@const active = isActive(n.href)}
			<a
				href={n.href}
				aria-current={active ? 'page' : undefined}
				class="group inline-flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors
					{active
						? 'bg-gray-100 text-gray-900 dark:bg-gray-700/60 dark:text-white'
						: 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-white'}"
			>
				<n.icon class="h-4 w-4 shrink-0" />
				<span>{n.label}</span>
			</a>
		{/each}
	</nav>
</aside>
