<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { GithubSolid, CodeBranchSolid } from 'flowbite-svelte-icons';
	import {
		fetchCommits,
		commitsQueryKey,
		connectGithub,
		FetchCommitsError,
		type CommitsError,
		type CommitInfo
	} from '$lib/api/github';

	interface Props {
		namespace: string;
		name: string;
		// Commit range to summarize (oldest → newest). When base === head or
		// either is missing, the component renders nothing.
		base?: string | null;
		head?: string | null;
		cluster?: string;
		// 'forward' = commits deployed, 'rollback' = commits reverted. Affects
		// wording + dot color only.
		direction?: 'forward' | 'rollback';
		// Override the wording after the count (e.g. "behind staging"). Defaults
		// to "deployed"/"reverted" based on direction.
		verb?: string;
		// Show a stacked cluster of unique contributor avatars.
		showAvatars?: boolean;
		// Show the +additions / −deletions stat.
		showStats?: boolean;
		// Optional link target; when set the summary line becomes a link.
		href?: string;
		// Muted "nothing to show" states can be hidden entirely (e.g. inline in a
		// dense list where an empty row would be noise).
		hideWhenEmpty?: boolean;
		class?: string;
	}

	let {
		namespace,
		name,
		base = null,
		head = null,
		cluster,
		direction = 'forward',
		verb,
		showAvatars = false,
		showStats = true,
		href,
		hideWhenEmpty = false,
		class: className = ''
	}: Props = $props();

	const enabled = $derived(!!namespace && !!name && !!base && !!head && base !== head);

	const query = createQuery(() => ({
		queryKey: commitsQueryKey(namespace, name, base ?? '', head ?? '', cluster),
		queryFn: () => fetchCommits(namespace, name, base!, head!, cluster),
		enabled,
		staleTime: 60_000
	}));

	const errReason = $derived<CommitsError | null>(
		query.error instanceof FetchCommitsError ? query.error.reason : null
	);

	const data = $derived(query.data);
	const count = $derived(data?.commits.length ?? 0);
	// The server infers direction from the range, so rollbacks read as "reverted"
	// on every surface without the caller knowing. `direction`/`verb` props are
	// only fallbacks / overrides (e.g. #4's "behind staging").
	const effectiveDirection = $derived(data?.direction ?? direction);
	const verbText = $derived(verb ?? (effectiveDirection === 'rollback' ? 'reverted' : 'deployed'));
	const dotClass = $derived(effectiveDirection === 'rollback' ? 'bg-amber-500' : 'bg-green-500');

	// Unique contributors, most-recent-first, capped for display.
	const contributors = $derived.by(() => {
		const seen = new Set<string>();
		const out: CommitInfo[] = [];
		for (const c of data?.commits ?? []) {
			const key = c.author || c.sha;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		return out;
	});
</script>

{#if enabled}
	{#if query.isLoading}
		<span class="text-xs text-gray-400 dark:text-gray-500 {className}">Loading changes…</span>
	{:else if errReason === 'not_connected'}
		<button
			type="button"
			onclick={() => connectGithub()}
			class="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 {className}"
			title="Connect your GitHub account to see deployed changes"
		>
			<GithubSolid class="h-3 w-3" />
			Connect GitHub to see changes
		</button>
	{:else if errReason === 'no_access'}
		{#if !hideWhenEmpty}
			<span class="text-xs text-gray-400 dark:text-gray-500 {className}">No GitHub access</span>
		{/if}
	{:else if query.isError}
		{#if !hideWhenEmpty}
			<span class="text-xs text-gray-400 dark:text-gray-500 {className}">Changes unavailable</span>
		{/if}
	{:else if count === 0}
		{#if !hideWhenEmpty}
			<span class="text-xs text-gray-400 dark:text-gray-500 {className}">No commit changes</span>
		{/if}
	{:else}
		{@const inner = `${count} commit${count !== 1 ? 's' : ''} ${verbText}`}
		<span class="inline-flex flex-wrap items-center gap-2 {className}">
			<svelte:element
				this={href ? 'a' : 'span'}
				{href}
				class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 {href
					? 'hover:text-blue-600 dark:hover:text-blue-400'
					: ''}"
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full {dotClass}"></span>
				<CodeBranchSolid class="h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500" />
				{inner}
			</svelte:element>

			{#if showStats && data}
				<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">
					<span class="text-green-600 dark:text-green-400">+{data.additions}</span>
					<span class="text-red-500 dark:text-red-400">−{data.deletions}</span>
					<span class="text-gray-300 dark:text-gray-600">·</span>
					{data.changedFiles} file{data.changedFiles !== 1 ? 's' : ''}
				</span>
			{/if}

			{#if showAvatars && contributors.length > 0}
				<span class="flex items-center -space-x-1.5">
					{#each contributors.slice(0, 4) as c (c.author || c.sha)}
						{#if c.avatarUrl}
							<img
								src={c.avatarUrl}
								alt={c.author}
								title={c.author}
								class="h-5 w-5 rounded-full ring-2 ring-white dark:ring-gray-800"
							/>
						{/if}
					{/each}
					{#if contributors.length > 4}
						<span
							class="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[9px] font-medium text-gray-500 ring-2 ring-white dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-800"
						>
							+{contributors.length - 4}
						</span>
					{/if}
				</span>
			{/if}
		</span>
	{/if}
{/if}
