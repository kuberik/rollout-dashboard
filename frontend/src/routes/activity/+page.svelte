<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatTimeAgo, getDisplayVersion } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { ClockSolid, RocketOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Environment } from '../../types';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived(rolloutsQuery.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(rolloutsQuery.data?.environments?.items || []);

	type ActivityEntry = {
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		previousVersion: string | null;
		bakeStatus: string;
		timestamp: string;
		href: string;
		isRunning: boolean;
	};

	// Optional env / app filters (clicking an env pill scopes the feed).
	// Synced with ?env=<name>&app=<name> in the URL so filters are deeplinkable.
	const envFilter = $derived(page.url.searchParams.get('env'));
	const appFilter = $derived(page.url.searchParams.get('app'));
	const nsFilter = $derived(page.url.searchParams.get('ns'));

	function setEnvFilter(next: string | null) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next) params.set('env', next);
		else params.delete('env');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	function clearAppFilter() {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('app');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	function clearNsFilter() {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('ns');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	function clearAllFilters() {
		goto('?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const activeFilterCount = $derived(
		(envFilter ? 1 : 0) + (appFilter ? 1 : 0) + (nsFilter ? 1 : 0)
	);

	const knownEnvs = $derived.by(() => {
		const map = new Map<string, ReturnType<typeof getRolloutEnvironmentTheme>>();
		for (const env of environments) {
			const name = env.spec?.environment;
			if (!name) continue;
			if (!map.has(name)) {
				const r = rollouts.find(
					(r) =>
						r.metadata?.name === env.spec?.rolloutRef?.name &&
						r.metadata?.namespace === env.metadata?.namespace
				);
				if (r) map.set(name, getRolloutEnvironmentTheme(r, env));
				else map.set(name, null);
			}
		}
		return [...map.entries()].map(([name, theme]) => ({ name, theme }));
	});

	const activityFeed = $derived.by(() => {
		const entries: ActivityEntry[] = [];
		for (const rollout of rollouts) {
			const history = rollout.status?.history || [];
			const title = rollout.status?.title || rollout.metadata?.name || '';
			const env = environments.find(
				(e) =>
					e.metadata?.namespace === rollout.metadata?.namespace &&
					e.spec?.rolloutRef?.name === rollout.metadata?.name
			);
			const envName = env?.spec?.environment || '';
			const theme = env ? getRolloutEnvironmentTheme(rollout, env) : getRolloutEnvironmentTheme(rollout);
			const limited = history.slice(0, 8);
			for (let i = 0; i < limited.length; i++) {
				const h = limited[i];
				if (!h.timestamp) continue;
				const bs = h.bakeStatus || 'None';
				const currentV = getDisplayVersion(h.version);
				// Find the previous *different* version in this rollout's history.
				let previousVersion: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== currentV) { previousVersion = v; break; }
				}
				entries.push({
					rolloutName: rollout.metadata?.name || '',
					rolloutNamespace: rollout.metadata?.namespace || '',
					displayName: title,
					envName,
					theme,
					version: currentV,
					previousVersion,
					bakeStatus: bs,
					timestamp: h.timestamp,
					href: `/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}`,
					isRunning: bs === 'InProgress' || bs === 'Deploying',
				});
			}
		}
		return entries
			.filter((e) => !envFilter || e.envName === envFilter)
			.filter((e) => !appFilter || e.rolloutName === appFilter)
			.filter((e) => !nsFilter || e.rolloutNamespace === nsFilter)
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

	const STATUS_CONFIG: Record<string, { dotClass: string; textClass: string; label: string }> = {
		Succeeded: { dotClass: 'bg-green-500', textClass: 'text-green-700 dark:text-green-400', label: 'Succeeded' },
		Failed:    { dotClass: 'bg-red-500',   textClass: 'text-red-700 dark:text-red-400',     label: 'Failed' },
		InProgress:{ dotClass: 'bg-yellow-400',textClass: 'text-yellow-700 dark:text-yellow-400', label: 'Baking' },
		Deploying: { dotClass: 'bg-blue-500',  textClass: 'text-blue-700 dark:text-blue-400',   label: 'Deploying' },
		Cancelled: { dotClass: 'bg-gray-400',  textClass: 'text-gray-500 dark:text-gray-500',   label: 'Cancelled' },
		None:      { dotClass: 'bg-gray-300 dark:bg-gray-600', textClass: 'text-gray-400 dark:text-gray-600', label: 'Idle' },
	};
</script>

<svelte:head>
	<title>kuberik | Activity</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy Activity</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Recent deployments across all rollouts</p>
		</div>
		{#if rolloutsQuery.isFetching}
			<Spinner size="5" color="gray" />
		{/if}
	</div>

	{#if appFilter || nsFilter}
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<span class="text-[11px] text-gray-500 dark:text-gray-400">Showing only:</span>
			{#if appFilter}
				<button
					type="button"
					onclick={clearAppFilter}
					class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
					title="Clear app filter"
				>
					<span class="text-[9px] text-blue-500/70 dark:text-blue-400/70">app</span>
					<span class="font-mono normal-case">{appFilter}</span>
					<span aria-hidden="true">×</span>
				</button>
			{/if}
			{#if nsFilter}
				<button
					type="button"
					onclick={clearNsFilter}
					class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-700"
					title="Clear namespace filter"
				>
					<span class="text-[9px] text-gray-500/70 dark:text-gray-400/70">ns</span>
					<span class="font-mono normal-case">{nsFilter}</span>
					<span aria-hidden="true">×</span>
				</button>
			{/if}
			{#if activeFilterCount >= 2}
				<button
					type="button"
					onclick={clearAllFilters}
					class="ml-1 text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear all</button>
			{/if}
		</div>
	{/if}

	{#if knownEnvs.length > 0}
		<div class="mb-5 flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				onclick={() => setEnvFilter(null)}
				class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors
					{envFilter === null
						? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-400 dark:hover:bg-gray-700'}"
			>All</button>
			{#each knownEnvs as e}
				<button
					type="button"
					onclick={() => setEnvFilter(envFilter === e.name ? null : e.name)}
					class="environment-theme-scope inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors
						{envFilter === e.name
							? 'ring-2 ring-gray-900/20 dark:ring-gray-100/20 environment-theme-badge'
							: 'environment-theme-badge opacity-70 hover:opacity-100'}"
					style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
				>{shortEnvLabel(e.theme) || e.name}</button>
			{/each}
		</div>
	{/if}

	{#if rolloutsQuery.isLoading}
		<div class="space-y-3">
			{#each Array(8) as _}
				<div class="h-[3.75rem] w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if rolloutsQuery.isError}
		<div class="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load activity: {(rolloutsQuery.error as Error).message}
		</div>
	{:else if activityFeed.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<ClockSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			{#if activeFilterCount > 0 || envFilter}
				<p class="text-sm font-medium text-gray-900 dark:text-white">No deploys match these filters</p>
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Try widening the scope or resetting.</p>
				<button
					type="button"
					onclick={clearAllFilters}
					class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
				>Clear filters</button>
			{:else}
				<p class="text-sm font-medium text-gray-900 dark:text-white">No deploy history</p>
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Deploys will appear here once rollouts have history.</p>
			{/if}
		</div>
	{:else}
		{@const maxDayCount = Math.max(1, ...groupedByDay.map((g) => g.entries.length))}
		<div class="space-y-6">
			{#each groupedByDay as dayGroup}
				{@const failed = dayGroup.entries.filter((e) => e.bakeStatus === 'Failed').length}
				{@const active = dayGroup.entries.filter((e) => e.isRunning).length}
				{@const succeeded = dayGroup.entries.filter((e) => e.bakeStatus === 'Succeeded').length}
				<div>
					<!-- Day header: label + count + proportional volume bar with status mix -->
					<div class="mb-2 flex items-center gap-3">
						<span class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{dayGroup.label}</span>
						<span class="font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{dayGroup.entries.length}</span>
						<!-- Volume bar: width proportional to busiest day in view; segments by status -->
						<div class="flex h-1.5 max-w-[18rem] flex-1 overflow-hidden rounded-full bg-transparent" title={`${dayGroup.entries.length} deploys (${succeeded} succeeded, ${active} deploying, ${failed} failed)`}>
							<div class="flex h-full rounded-full bg-gray-100 dark:bg-gray-800" style="width: {(dayGroup.entries.length / maxDayCount) * 100}%">
								{#if succeeded > 0}<span class="bg-green-400 dark:bg-green-500" style="width:{(succeeded / dayGroup.entries.length) * 100}%"></span>{/if}
								{#if active > 0}<span class="bg-yellow-400" style="width:{(active / dayGroup.entries.length) * 100}%"></span>{/if}
								{#if failed > 0}<span class="bg-red-400 dark:bg-red-500" style="width:{(failed / dayGroup.entries.length) * 100}%"></span>{/if}
								{#if dayGroup.entries.length - succeeded - active - failed > 0}<span class="bg-gray-300 dark:bg-gray-600" style="width:{((dayGroup.entries.length - succeeded - active - failed) / dayGroup.entries.length) * 100}%"></span>{/if}
							</div>
						</div>
					</div>

					<!-- Entries: rich rows with status circle + env tint -->
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
						{#each dayGroup.entries as entry, idx}
							{@const cfg = STATUS_CONFIG[entry.bakeStatus] ?? STATUS_CONFIG['None']}
							<a
								href={entry.href}
								class="environment-theme-scope {entry.theme ? 'environment-theme-edge' : ''} flex w-full min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40
									{entry.bakeStatus === 'Failed' ? 'card-failed' : ''}
									{entry.isRunning ? 'card-active' : ''}
									{idx > 0 ? 'border-t border-gray-100 dark:border-gray-700/60' : ''}"
								style={entry.theme ? getEnvironmentThemeStyle(entry.theme) : undefined}
							>
								<!-- Status circle -->
								<span class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {entry.bakeStatus === 'Failed' ? 'bg-red-100 dark:bg-red-900/30' : entry.bakeStatus === 'Succeeded' ? 'bg-green-100 dark:bg-green-900/30' : entry.isRunning ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-gray-100 dark:bg-gray-700/60'}">
									{#if entry.isRunning}
										<span class="absolute inset-0 animate-ping rounded-full bg-yellow-400/30"></span>
									{/if}
									<BakeStatusIcon bakeStatus={entry.bakeStatus} size="small" />
								</span>

								<!-- Env badge -->
								{#if entry.envName || entry.theme}
									<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{shortEnvLabel(entry.theme) || entry.envName || entry.theme?.label}</span>
								{/if}

								<!-- Name + namespace + version transition -->
								<div class="min-w-0 flex-1">
									<div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
										<span class="truncate text-sm font-bold text-gray-900 dark:text-white">{entry.displayName}</span>
										<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{entry.rolloutNamespace}</span>
									</div>
									<div class="flex min-w-0 items-baseline gap-x-1.5">
										{#if entry.rolloutName !== entry.displayName}
											<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{entry.rolloutName}</span>
											<span class="shrink-0 text-[10px] text-gray-300 dark:text-gray-700">·</span>
										{/if}
										{#if entry.previousVersion}
											<span class="shrink-0 font-mono text-[11px] text-gray-400/70 line-through dark:text-gray-500/70">{entry.previousVersion}</span>
											<span class="shrink-0 text-[10px] text-gray-300 dark:text-gray-600">→</span>
										{/if}
										<span class="truncate font-mono text-[11px] font-medium text-gray-700 dark:text-gray-300">{entry.version}</span>
									</div>
								</div>

								<!-- Right: status text + time -->
								<div class="flex shrink-0 items-center gap-3">
									<span class="hidden text-[11px] font-medium sm:inline {cfg.textClass}">{cfg.label}</span>
									<span class="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(entry.timestamp, $now)}>{formatTimeAgoCompact(entry.timestamp, $now)}</span>
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
