<svelte:options runes={true} />

<script lang="ts">
	import { GithubSolid } from 'flowbite-svelte-icons';
	import { Dropdown, DropdownItem } from 'flowbite-svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import {
		fetchGithubStatus,
		githubStatusQueryKey,
		connectGithub,
		disconnectGithub
	} from '$lib/api/github';

	const queryClient = useQueryClient();

	const statusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const
	}));

	const status = $derived(statusQuery.data);
	const menuId = 'github-account-menu';

	async function handleDisconnect() {
		await disconnectGithub();
		await queryClient.invalidateQueries({ queryKey: githubStatusQueryKey });
		// Commit queries are now unauthorized — refresh them too.
		await queryClient.invalidateQueries({ queryKey: ['rollout-commits'] });
	}
</script>

<!-- Hidden entirely when the server has no GitHub App configured. -->
{#if status?.configured}
	{#if status.connected}
		<button
			type="button"
			id={menuId}
			class="flex items-center gap-1.5 rounded-lg bg-gray-100 p-1 pr-2 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
			aria-label="GitHub account"
			title={`Connected as ${status.login}`}
		>
			{#if status.avatarUrl}
				<img src={status.avatarUrl} alt={status.login} class="h-6 w-6 rounded-full" />
			{:else}
				<GithubSolid class="h-4 w-4" />
			{/if}
			<span class="hidden max-w-24 truncate text-xs font-medium sm:inline">{status.login}</span>
		</button>
		<Dropdown triggeredBy={`#${menuId}`} simple class="w-44">
			<DropdownItem class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
				<GithubSolid class="h-3.5 w-3.5" />
				Connected as {status.login}
			</DropdownItem>
			<DropdownItem onclick={handleDisconnect} class="text-sm">Disconnect GitHub</DropdownItem>
		</Dropdown>
	{:else}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
			onclick={() => connectGithub()}
			title="Connect your GitHub account to see deployed changes"
		>
			<GithubSolid class="h-4 w-4" />
			<span class="hidden sm:inline">Connect GitHub</span>
		</button>
	{/if}
{/if}
