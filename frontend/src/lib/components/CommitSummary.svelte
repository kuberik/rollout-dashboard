<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import {
		CodeBranchSolid,
		ChevronDownOutline,
		ChevronUpOutline
	} from 'flowbite-svelte-icons';
	import {
		fetchCommits,
		commitsQueryKey,
		formatCommitMessage,
		FetchCommitsError,
		type CommitInfo
	} from '$lib/api/github';
	import { rolloutQueryOptions } from '$lib/api/rollouts';

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
		// Render each commit's message as a list below the summary line.
		showMessages?: boolean;
		// Make the summary line a toggle that expands the message list inline
		// (instead of linking away). Overrides `href`.
		expandable?: boolean;
		// When provided, only include commits whose sha matches one of these
		// available-release revisions — filtering out intermediate commits that
		// never became a release.
		releaseShas?: string[];
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
		showMessages = false,
		expandable = false,
		releaseShas,
		class: className = ''
	}: Props = $props();

	let open = $state(false);

	const enabled = $derived(!!namespace && !!name && !!base && !!head && base !== head);

	// CORRECTNESS, not polish. This query inherits the app-wide defaults
	// (`refetchInterval: 5000`, `retry: 3`). On a page with one of these per
	// row, an unauthenticated user produced roughly 140 failed /commits
	// requests a minute — over GitHub's entire authenticated budget — and
	// every one of those rows rendered "Loading changes…" forever, because
	// the unauthenticated state was being drawn as a loading state.
	//
	// An auth failure is not transient: it cannot be retried into success
	// and it cannot be polled into success. So it is neither retried nor
	// polled, and the commit range itself is immutable, so there is nothing
	// to poll for even on success.
	const query = createQuery(() => ({
		queryKey: commitsQueryKey(namespace, name, base ?? '', head ?? '', cluster),
		queryFn: () => fetchCommits(namespace, name, base!, head!, cluster),
		enabled,
		staleTime: 5 * 60_000,
		refetchInterval: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchCommitsError) return false;
			return failureCount < 1;
		}
	}));

	// Available-release revisions for this rollout, fetched here so every commit
	// display filters to release commits automatically (DRY) — callers don't
	// thread the list. Cached by TanStack, so it's typically free on pages that
	// already loaded the rollout. An explicit `releaseShas` prop overrides it.
	const rolloutQuery = createQuery(() => ({
		...rolloutQueryOptions({ namespace, name, cluster }),
		enabled,
		// Available releases change on the order of minutes; a 5s poll per
		// visible row is pure waste. Other observers of the same key (the
		// rollout detail page) keep their own faster interval.
		staleTime: 60_000,
		refetchInterval: false as const
	}));
	const releaseShasEffective = $derived<string[]>(
		releaseShas ??
			((rolloutQuery.data?.rollout?.status?.availableReleases ?? [])
				.map((r) => r.revision)
				.filter((s): s is string => !!s) as string[])
	);

	const data = $derived(query.data);

	// When `releaseShas` is provided, keep only commits that are themselves an
	// available release (match by sha prefix, since a release revision may be
	// stored short). Otherwise show every commit in the range.
	const commits = $derived.by<CommitInfo[]>(() => {
		const all = data?.commits ?? [];
		if (!releaseShasEffective || releaseShasEffective.length === 0) return all;
		const rels = releaseShasEffective.filter(Boolean).map((s) => s.toLowerCase());
		return all.filter((c) => {
			const sha = (c.sha ?? '').toLowerCase();
			return rels.some((r) => sha.startsWith(r) || r.startsWith(sha));
		});
	});
	const count = $derived(commits.length);
	// The server infers direction from the range, so rollbacks read as "reverted"
	// on every surface without the caller knowing. `direction`/`verb` props are
	// only fallbacks / overrides (e.g. #4's "behind staging").
	const effectiveDirection = $derived(data?.direction ?? direction);
	const verbText = $derived(verb ?? (effectiveDirection === 'rollback' ? 'reverted' : 'deployed'));
	// The ONE green. `green-500` was a second one in a product allowed exactly one.
	const dotClass = $derived(effectiveDirection === 'rollback' ? 'bg-amber-500' : 'bg-green-700 dark:bg-green-400');

	// Unique contributors, most-recent-first, capped for display.
	const contributors = $derived.by(() => {
		const seen = new Set<string>();
		const out: CommitInfo[] = [];
		for (const c of commits) {
			const key = c.author || c.sha;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		return out;
	});
</script>

<!-- Three states, and only three:
       loading  -> a skeleton bar, so it reads as "not here yet" instead of
                   as a sentence the operator has to parse and dismiss;
       error    -> NOTHING. Never a per-row status string. Whatever went
                   wrong went wrong identically for every row, and saying
                   it N times is how a page comes to look broken on
                   arrival. `GithubConnectButton` already lives in the
                   navbar, and a page that renders many of these should
                   surface ONE panel-level "Connect GitHub" row;
       empty    -> nothing. -->
{#if enabled}
	{#if query.isLoading}
		<span
			class="inline-block h-3 w-32 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700 {className}"
			aria-hidden="true"
		></span>
	{:else if query.isError}
		<!-- deliberately empty -->
	{:else if count === 0}
		{#if !hideWhenEmpty}
			<span class="text-xs text-gray-400 dark:text-gray-500 {className}">No commit changes</span>
		{/if}
	{:else}
		{@const inner = `${count} commit${count !== 1 ? 's' : ''} ${verbText}`}
		<span class="inline-flex flex-wrap items-center gap-2 {className}">
			{#if expandable}
				<button
					type="button"
					onclick={() => (open = !open)}
					aria-expanded={open}
					class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full {dotClass}"></span>
					<CodeBranchSolid class="h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500" />
					{inner}
					{#if open}
						<ChevronUpOutline class="h-3 w-3 shrink-0" />
					{:else}
						<ChevronDownOutline class="h-3 w-3 shrink-0" />
					{/if}
				</button>
			{:else}
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
			{/if}

			{#if showStats && data}
				<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">
					<span class="text-green-700 dark:text-green-400">+{data.additions}</span>
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
		{#if (showMessages || (expandable && open)) && commits.length > 0}
			<ul class="mt-1.5 space-y-1">
				{#each commits as c (c.sha)}
					<li class="flex items-baseline gap-2 text-xs">
						<a
							href={c.url}
							target="_blank"
							rel="noopener noreferrer"
							class="shrink-0 font-mono text-[10px] text-blue-600 hover:underline dark:text-blue-400"
							>{(c.sha ?? '').slice(0, 7)}</a
						>
						<span class="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300"
							>{formatCommitMessage(c.message)}</span
						>
						{#if c.author}
							<span class="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{c.author}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
{/if}
