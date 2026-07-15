<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { ChartOutline, GridOutline, RocketOutline, LayersSolid, ClockOutline } from 'flowbite-svelte-icons';

	const tabs = [
		{ key: 'control', href: '/', label: 'Control', icon: ChartOutline },
		{ key: 'rollouts', href: '/rollouts', label: 'Rollouts', icon: GridOutline },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: RocketOutline },
		{ key: 'envs', href: '/environments', label: 'Envs', icon: LayersSolid },
		{ key: 'activity', href: '/activity', label: 'Activity', icon: ClockOutline }
	] as const;

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/rollouts') return path === '/rollouts' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (href === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === href || path.startsWith(href + '/');
	}
</script>

<nav
	class="safe-area-bottom sticky bottom-0 z-40 flex w-full shrink-0 items-stretch border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95 sm:hidden"
	aria-label="Main navigation"
>
	{#each tabs as t (t.key)}
		{@const active = isActive(t.href)}
		<a
			href={t.href}
			aria-current={active ? 'page' : undefined}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors
				{active
					? 'text-blue-600 dark:text-blue-400'
					: 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}"
		>
			<t.icon class="h-5 w-5" />
			<span>{t.label}</span>
		</a>
	{/each}
</nav>

<style>
	.safe-area-bottom {
		padding-bottom: env(safe-area-inset-bottom, 0);
	}
</style>
