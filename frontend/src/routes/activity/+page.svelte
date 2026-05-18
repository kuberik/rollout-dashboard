<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgo, getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { Badge, Spinner } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
	} from 'flowbite-svelte-icons';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived(rolloutsQuery.data?.rollouts?.items || []);

	type ActivityEntry = {
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		version: string;
		bakeStatus: string;
		timestamp: string;
		href: string;
		isRunning: boolean;
	};

	const activityFeed = $derived.by(() => {
		const entries: ActivityEntry[] = [];
		for (const rollout of rollouts) {
			const history = rollout.status?.history || [];
			const title = rollout.status?.title || rollout.metadata?.name || '';
			for (const h of history.slice(0, 8)) {
				if (!h.timestamp) continue;
				const bs = h.bakeStatus || 'None';
				entries.push({
					rolloutName: rollout.metadata?.name || '',
					rolloutNamespace: rollout.metadata?.namespace || '',
					displayName: title,
					version: getDisplayVersion(h.version),
					bakeStatus: bs,
					timestamp: h.timestamp,
					href: `/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}`,
					isRunning: bs === 'InProgress' || bs === 'Deploying',
				});
			}
		}
		return entries
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
			.slice(0, 60);
	});

	type DayGroup = { label: string; entries: ActivityEntry[] };

	const groupedByDay = $derived.by(() => {
		const groups: DayGroup[] = [];
		let currentLabel = '';
		for (const entry of activityFeed) {
			const d = new Date(entry.timestamp);
			const today = new Date();
			const yesterday = new Date();
			yesterday.setDate(today.getDate() - 1);
			let label: string;
			if (d.toDateString() === today.toDateString()) label = 'Today';
			else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
			else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

			if (label !== currentLabel) {
				groups.push({ label, entries: [] });
				currentLabel = label;
			}
			groups[groups.length - 1].entries.push(entry);
		}
		return groups;
	});

	const STATUS_CONFIG: Record<string, { dotClass: string; badgeColor: 'green' | 'red' | 'yellow' | 'blue' | 'gray'; label: string }> = {
		Succeeded: { dotClass: 'bg-green-500', badgeColor: 'green', label: 'Succeeded' },
		Failed:    { dotClass: 'bg-red-500',   badgeColor: 'red',   label: 'Failed' },
		InProgress:{ dotClass: 'bg-yellow-400',badgeColor: 'yellow', label: 'Baking' },
		Deploying: { dotClass: 'bg-blue-500',  badgeColor: 'blue',  label: 'Deploying' },
		Cancelled: { dotClass: 'bg-gray-400',  badgeColor: 'gray',  label: 'Cancelled' },
		None:      { dotClass: 'bg-gray-300 dark:bg-gray-600', badgeColor: 'gray', label: 'Idle' },
	};
</script>

<svelte:head>
	<title>kuberik | Activity</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy Activity</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Recent deployments across all rollouts</p>
		</div>
		{#if rolloutsQuery.isFetching}
			<Spinner size="5" color="gray" />
		{/if}
	</div>

	{#if rolloutsQuery.isLoading}
		<div class="space-y-3">
			{#each Array(8) as _}
				<div class="h-[3.75rem] w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if rolloutsQuery.isError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load activity: {(rolloutsQuery.error as Error).message}
		</div>
	{:else if activityFeed.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<ClockSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">No deploy history</p>
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Deploys will appear here once rollouts have history.</p>
		</div>
	{:else}
		<div class="space-y-8">
			{#each groupedByDay as dayGroup}
				<div>
					<!-- Day label -->
					<div class="mb-3 flex items-center gap-3">
						<span class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{dayGroup.label}</span>
						<div class="flex-1 border-t border-gray-100 dark:border-gray-800"></div>
					</div>

					<!-- Entries -->
					<div class="relative">
						<!-- Vertical timeline line -->
						<div class="absolute left-[7px] top-3 bottom-3 w-px bg-gray-200 dark:bg-gray-700/80"></div>

						<ul class="space-y-2">
							{#each dayGroup.entries as entry}
								{@const cfg = STATUS_CONFIG[entry.bakeStatus] ?? STATUS_CONFIG['None']}
								<li class="relative pl-7">
									<!-- Timeline dot -->
									<span class="absolute left-0 top-4 flex h-3.5 w-3.5 items-center justify-center">
										<span class="h-2.5 w-2.5 rounded-full {cfg.dotClass} ring-2 ring-white dark:ring-gray-900"></span>
									</span>

									<a
										href={entry.href}
										class="group flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
									>
										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
												<span class="text-sm font-semibold text-gray-900 dark:text-white">{entry.displayName}</span>
												<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">{entry.rolloutNamespace}</span>
											</div>
											<div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
												<span class="font-mono truncate">{entry.version}</span>
												<span class="shrink-0">·</span>
												<span class="shrink-0">{formatTimeAgo(entry.timestamp, $now)}</span>
											</div>
										</div>
										<Badge color={cfg.badgeColor} class="shrink-0 text-xs">{cfg.label}</Badge>
									</a>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
