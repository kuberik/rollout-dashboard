<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';

	let {
		namespace,
		name
	}: {
		namespace: string;
		name: string;
	} = $props();

	const base = $derived(`/rollouts/${namespace}/${name}`);
	const path = $derived(page.url.pathname);

	const tabs = $derived([
		{ key: 'overview', label: 'Overview', href: base },
		{ key: 'history', label: 'History', href: `${base}/history` },
		{ key: 'environments', label: 'Cross-env', href: `${base}/environments` },
		{ key: 'logs', label: 'Logs', href: `${base}/logs` }
	]);

	function isActive(href: string): boolean {
		if (href === base) return path === base;
		return path === href || path.startsWith(href + '/');
	}
</script>

<nav
	class="mb-5 flex flex-wrap items-center gap-1"
	aria-label="Rollout sections"
>
	{#each tabs as t (t.key)}
		{@const active = isActive(t.href)}
		<a
			href={t.href}
			aria-current={active ? 'page' : undefined}
			class="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors
				{active
					? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
					: 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-200'}"
		>
			{t.label}
		</a>
	{/each}
</nav>
