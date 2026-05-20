<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatTimeAgo, getDisplayVersion } from '$lib/utils';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { ClockSolid } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
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
		actor: string;
		actorKind: 'User' | 'System';
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

	// Status class filter. "All" + "Deploys" (Succeeded/Deploying), "In progress" (InProgress/Deploying), "Failures" (Failed)
	type KindFilter = 'all' | 'deploys' | 'in_progress' | 'failures';
	let kindFilter = $state<KindFilter>('all');
	function matchesKind(bakeStatus: string): boolean {
		if (kindFilter === 'all') return true;
		if (kindFilter === 'failures') return bakeStatus === 'Failed';
		if (kindFilter === 'in_progress') return bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
		if (kindFilter === 'deploys') return bakeStatus === 'Succeeded' || bakeStatus === 'Deploying';
		return true;
	}

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
				const actorName = h.triggeredBy?.name || 'system';
				const actorKind: 'User' | 'System' = h.triggeredBy?.kind ?? 'System';
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
					actor: actorName,
					actorKind
				});
			}
		}
		return entries
			.filter((e) => !envFilter || e.envName === envFilter)
			.filter((e) => !appFilter || e.rolloutName === appFilter)
			.filter((e) => !nsFilter || e.rolloutNamespace === nsFilter)
			.filter((e) => matchesKind(e.bakeStatus))
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
			.slice(0, 60);
	});

	type DayGroup = { label: string; entries: ActivityEntry[] };

	// Cluster events by recency: "In the last hour" / "Today" / "Yesterday" /
	// weekday-name (within last 7 days) / "Older". Order is preserved by
	// scanning the already-sorted feed and starting a new group whenever the
	// label changes.
	function clusterLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const ageMs = refNow.getTime() - d.getTime();
		if (ageMs < 60 * 60 * 1000) return 'In the last hour';
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const yesterday = new Date(today.getTime() - 86_400_000);
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		if (dayStart.getTime() === today.getTime()) return 'Today';
		if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday';
		const daysAgo = Math.floor((today.getTime() - dayStart.getTime()) / 86_400_000);
		if (daysAgo < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return 'Older';
	}

	const groupedByDay = $derived.by(() => {
		const refNow = $now;
		const groups: DayGroup[] = [];
		let currentLabel = '';
		for (const entry of activityFeed) {
			const label = clusterLabel(entry.timestamp, refNow);
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

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<!-- Header — title + meta on left; last-24h sparkline + total on right. -->
	<div class="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<div class="flex items-baseline gap-3">
			<h1 class="text-2xl font-light text-gray-900 dark:text-white">Activity</h1>
			<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{activityFeed.length} events · last 7 days</span>
		</div>
		<div class="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
			<span class="font-mono uppercase tracking-wider">last 24h</span>
			<DeployVolumeSparkline rollouts={rollouts} hours={24} buckets={20} />
			<span class="font-mono tabular-nums">{activityFeed.filter((e) => (new Date(e.timestamp).getTime() > $now.getTime() - 24*60*60*1000)).length} deploys</span>
			
		</div>
	</div>

	<!-- Filter chips: status kind on left, env on right -->
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-wrap items-center gap-1.5">
			{#each [
				{ key: 'all' as KindFilter, label: 'All' },
				{ key: 'deploys' as KindFilter, label: 'Deploys' },
				{ key: 'in_progress' as KindFilter, label: 'In progress' },
				{ key: 'failures' as KindFilter, label: 'Failures' },
			] as f}
				<button
					type="button"
					onclick={() => (kindFilter = f.key)}
					class="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors
						{kindFilter === f.key
							? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
							: 'bg-transparent text-gray-500 border border-gray-200 hover:text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}"
				>{f.label}</button>
			{/each}
		</div>
		{#if knownEnvs.length > 0}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each knownEnvs as e}
					<button
						type="button"
						onclick={() => setEnvFilter(envFilter === e.name ? null : e.name)}
						class="environment-theme-scope inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-opacity
							{envFilter === e.name
								? 'environment-theme-badge ring-1 ring-gray-900/30 dark:ring-gray-100/30'
								: envFilter === null ? 'environment-theme-badge' : 'environment-theme-badge opacity-40 hover:opacity-100'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					>{shortEnvLabel(e.theme) || e.name}</button>
				{/each}
			</div>
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
		<div class="space-y-6">
			{#each groupedByDay as dayGroup}
				<div>
					<!-- Cluster header: label + count -->
					<div class="mb-2 flex items-baseline gap-2 border-b border-gray-100 pb-1 dark:border-gray-700/60">
						<span class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">{dayGroup.label}</span>
						<span class="flex-1"></span>
						<span class="font-mono text-[10px] tabular-nums text-gray-400 dark:text-gray-500">{dayGroup.entries.length}</span>
					</div>

					<!-- Cluster entries with vertical rail through dots. -->
					<ol class="relative overflow-hidden rounded-xl border border-gray-200 bg-white py-2 dark:border-gray-700 dark:bg-gray-800">
						{#each dayGroup.entries as entry, idx}
							{@const cfg = STATUS_CONFIG[entry.bakeStatus] ?? STATUS_CONFIG['None']}
							{@const isFirst = idx === 0}
							{@const isLast = idx === dayGroup.entries.length - 1}
							<li class="environment-theme-scope relative" style={entry.theme ? getEnvironmentThemeStyle(entry.theme) : undefined}>
								<!-- Vertical rail: continuous line through every row's status
								     circle. Circle column is locked to 28px so the line at
								     left: px-4 (16) + 14 = 30px sits exactly through the center. -->
								<span class="absolute left-[30px] w-px bg-gray-200 dark:bg-gray-700/60" style="top: {isFirst ? '50%' : '0'}; bottom: {isLast ? '50%' : '0'};" aria-hidden="true"></span>
								<a
									href={entry.href}
									class="grid w-full min-w-0 grid-cols-[28px_3rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
								>
									<!-- Status circle: 28px wide so the rail at 30px from row
									     edge passes through its center. The colored bg class
									     uses `/30` opacity in dark mode, which let the rail
									     line show through; cover the rail with an opaque
									     card-bg disc, then layer the colored bg on top. -->
									<span class="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-white dark:bg-gray-800 dark:ring-gray-800">
										<span class="absolute inset-0 rounded-full {getStatusCircleClass(entry.bakeStatus)}" aria-hidden="true"></span>
										{#if entry.isRunning}
											<span class="absolute inset-0 animate-ping rounded-full {getStatusPingClass(entry.bakeStatus)}"></span>
										{/if}
										<span class="relative">
											<BakeStatusIcon bakeStatus={entry.bakeStatus} size="small" />
										</span>
									</span>

									<!-- Time -->
									<span class="font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400" title={formatTimeAgo(entry.timestamp, $now)}>{formatTimeAgoCompact(entry.timestamp, $now)}</span>

									<!-- Inline message: [actor] [verb] [app] to [env] [version] · [msg] -->
									<div class="flex min-w-0 items-baseline gap-x-2 gap-y-1 text-[12.5px] flex-wrap">
										<span class="truncate font-medium text-gray-700 dark:text-gray-300">{entry.actor}</span>
										<span class="text-gray-400 dark:text-gray-500">
											{#if entry.bakeStatus === 'Failed'}failed{:else if entry.bakeStatus === 'InProgress'}is baking{:else if entry.bakeStatus === 'Deploying'}is deploying{:else if entry.bakeStatus === 'Cancelled'}cancelled{:else}deployed{/if}
										</span>
										<span class="truncate font-semibold text-gray-900 dark:text-white">{entry.displayName}</span>
										{#if entry.envName}
											<span class="text-gray-400 dark:text-gray-500">to</span>
											<span class="environment-theme-badge inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{shortEnvLabel(entry.theme) || entry.envName}</span>
										{/if}
										<span class="font-mono text-[11px] text-gray-600 dark:text-gray-300">{entry.version}</span>
										{#if entry.bakeStatus !== 'Succeeded'}
											<span class="font-mono text-[10px] text-gray-300 dark:text-gray-600">·</span>
											<span class="font-mono text-[11px] {cfg.textClass}">{cfg.label.toLowerCase()}</span>
										{/if}
									</div>

									<!-- "was vX" supplemental line on previous-version transitions -->
									<div class="hidden shrink-0 items-baseline justify-end sm:flex">
										{#if entry.previousVersion}
											<span class="font-mono text-[10px] text-gray-400/70 dark:text-gray-500/70">was <span class="line-through">{entry.previousVersion}</span></span>
										{/if}
									</div>
								</a>
							</li>
						{/each}
					</ol>
				</div>
			{/each}
		</div>
	{/if}
</div>
