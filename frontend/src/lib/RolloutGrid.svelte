<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact } from '$lib/utils';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		SearchOutline,
		ExclamationCircleSolid,
		CheckCircleSolid,
		ChevronRightOutline,
		ClockSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	function envForRollout(r: Rollout): Environment | undefined {
		return environments.find(
			(e) =>
				e.metadata?.namespace === r.metadata?.namespace &&
				e.spec?.rolloutRef?.name === r.metadata?.name
		);
	}

	type StatusKey = 'succeeded' | 'failed' | 'active' | 'pending';

	type Card = {
		ns: string;
		name: string;
		title: string;
		envKey: string; // normalized merge key (e.g. 'prod')
		envDisplay: string; // label to show on the card (e.g. 'PROD' or 'PRODUCTION')
		theme: ReturnType<typeof getRolloutEnvironmentTheme>;
		version: string | null;
		timestamp: string | null;
		bakeStatus: string;
		statusKey: StatusKey;
		isRunning: boolean;
		failedHCCount: number;
		bakeStatusMessage: string | null;
		pinnedVersion: string | null;
		rollout: Rollout;
	};

	const cards = $derived.by<Card[]>(() => {
		return rollouts.map((r) => {
			const latest = r.status?.history?.[0];
			const env = envForRollout(r);
			const theme = getRolloutEnvironmentTheme(r, env);
			const bakeStatus = latest?.bakeStatus || 'None';
			const isRunning = bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
			let statusKey: StatusKey;
			if (bakeStatus === 'Failed') statusKey = 'failed';
			else if (isRunning) statusKey = 'active';
			else if (!latest) statusKey = 'pending';
			else statusKey = 'succeeded';
			return {
				ns: r.metadata?.namespace || '',
				name: r.metadata?.name || '',
				title: r.status?.title || r.metadata?.name || '',
				envKey: theme?.name || '',
				envDisplay: theme?.environmentName || theme?.label || '',
				theme,
				version: latest?.version ? getDisplayVersion(latest.version) : null,
				timestamp: latest?.timestamp || null,
				bakeStatus,
				statusKey,
				isRunning,
				failedHCCount: latest?.failedHealthChecks?.length || 0,
				bakeStatusMessage: latest?.bakeStatusMessage || null,
				pinnedVersion: r.spec?.wantedVersion || null,
				rollout: r
			};
		});
	});

	// Filters
	let searchQuery = $state('');
	let statusFilters = $state<StatusKey[]>([]);
	let envFilters = $state<string[]>([]);

	const knownEnvs = $derived.by(() => {
		const map = new Map<string, { display: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> }>();
		for (const c of cards) {
			if (!c.envKey) continue;
			const existing = map.get(c.envKey);
			if (!existing) {
				map.set(c.envKey, { display: c.envDisplay, theme: c.theme });
			} else if (existing.display.length > c.envDisplay.length) {
				// prefer the shorter label (e.g. 'PROD' over 'PRODUCTION') for tighter chips
				existing.display = c.envDisplay;
				existing.theme = c.theme;
			}
		}
		return [...map.entries()]
			.map(([key, v]) => ({ key, display: v.display, theme: v.theme }))
			.sort((a, b) => compareEnvironmentNames(a.display, b.display));
	});

	function toggleStatus(k: StatusKey) {
		statusFilters = statusFilters.includes(k)
			? statusFilters.filter((x) => x !== k)
			: [...statusFilters, k];
	}
	function toggleEnv(name: string) {
		envFilters = envFilters.includes(name)
			? envFilters.filter((x) => x !== name)
			: [...envFilters, name];
	}
	function clearFilters() {
		statusFilters = [];
		envFilters = [];
		searchQuery = '';
	}

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return cards.filter((c) => {
			if (statusFilters.length > 0 && !statusFilters.includes(c.statusKey)) return false;
			if (envFilters.length > 0 && !envFilters.includes(c.envKey)) return false;
			if (q) {
				const hay = `${c.ns} ${c.name} ${c.title} ${c.envKey} ${c.envDisplay} ${c.version ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Severity-aware sort: failed → active → pending → healthy, then newest first
	const sorted = $derived.by(() => {
		const sevRank: Record<StatusKey, number> = {
			failed: 0,
			active: 1,
			pending: 2,
			succeeded: 3
		};
		return [...filtered].sort((a, b) => {
			const s = sevRank[a.statusKey] - sevRank[b.statusKey];
			if (s !== 0) return s;
			const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
			const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
			return bt - at;
		});
	});

	// Counters from full set (not filtered) for the header pills
	const counts = $derived.by(() => {
		const c = { succeeded: 0, failed: 0, active: 0, pending: 0 };
		for (const card of cards) c[card.statusKey]++;
		return c;
	});
	const newestDeploy = $derived.by<string | null>(() => {
		let t: string | null = null;
		for (const c of cards) {
			if (c.timestamp && (!t || new Date(c.timestamp) > new Date(t))) t = c.timestamp;
		}
		return t;
	});

	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	const STATUS_LABEL: Record<string, string> = {
		Succeeded: 'Succeeded',
		Failed: 'Failed',
		InProgress: 'Baking',
		Deploying: 'Deploying',
		Cancelled: 'Cancelled',
		None: 'No deploy'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600'
	};
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Header -->
	<div class="mb-5 flex flex-wrap items-baseline justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Rollouts</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{cards.length} rollouts across the cluster</p>
		</div>
		{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
	</div>

	<!-- Fleet summary banner -->
	{#if cards.length > 0}
		<section class="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<div class="flex items-baseline gap-1.5">
					<span class="text-3xl font-light {counts.failed > 0 ? 'text-red-600 dark:text-red-400' : counts.succeeded === cards.length ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}">{counts.succeeded}</span>
					<span class="text-sm text-gray-400 dark:text-gray-500">/ {cards.length} healthy</span>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					{#if counts.active > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{counts.active} deploying
						</span>
					{/if}
					{#if counts.pending > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
							<span class="h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-500"></span>
							{counts.pending} pending
						</span>
					{/if}
					{#if counts.failed > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
							<ExclamationCircleSolid class="h-3 w-3 text-red-500" />
							{counts.failed} failed
						</span>
					{/if}
					{#if counts.failed === 0 && counts.active === 0 && counts.pending === 0 && cards.length > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
							<CheckCircleSolid class="h-3 w-3" />All healthy
						</span>
					{/if}
					{#if newestDeploy}
						<span class="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 dark:text-gray-500" title={`Newest deploy ${formatTimeAgo(newestDeploy, $now)}`}>
							<ClockSolid class="h-3 w-3" />
							{formatTimeAgoCompact(newestDeploy, $now)}
						</span>
					{/if}
				</div>
			</div>
			<div class="mt-3 flex h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
				{#if counts.succeeded > 0}
					<span class="bg-green-500" style="width:{(counts.succeeded / cards.length) * 100}%"></span>
				{/if}
				{#if counts.active > 0}
					<span class="bg-yellow-400" style="width:{(counts.active / cards.length) * 100}%"></span>
				{/if}
				{#if counts.pending > 0}
					<span class="bg-gray-400 dark:bg-gray-500" style="width:{(counts.pending / cards.length) * 100}%"></span>
				{/if}
				{#if counts.failed > 0}
					<span class="bg-red-500" style="width:{(counts.failed / cards.length) * 100}%"></span>
				{/if}
			</div>
		</section>
	{/if}

	<!-- Filter bar -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<div class="relative min-w-0 flex-1 sm:max-w-sm">
			<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search rollouts…"
				class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
			/>
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			{#each [{key:'failed', label:'Failed', color:'red', dot:'bg-red-500'}, {key:'active', label:'Deploying', color:'yellow', dot:'bg-yellow-400'}, {key:'pending', label:'Pending', color:'gray', dot:'bg-gray-400'}, {key:'succeeded', label:'Healthy', color:'green', dot:'bg-green-500'}] as p}
				{@const k = p.key as StatusKey}
				{@const sel = statusFilters.includes(k)}
				{@const n = counts[k]}
				{#if n > 0}
					<button
						type="button"
						onclick={() => toggleStatus(k)}
						class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors
							{sel
								? p.color === 'red'    ? 'bg-red-500 text-white'
								: p.color === 'yellow' ? 'bg-yellow-400 text-gray-900'
								: p.color === 'gray'   ? 'bg-gray-500 text-white'
								:                        'bg-green-500 text-white'
								: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-700'}"
					>
						<span class="h-1.5 w-1.5 rounded-full {sel ? 'bg-white' : p.dot}"></span>
						{n} {p.label}
					</button>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Env chip row (only if multiple envs) -->
	{#if knownEnvs.length > 1}
		<div class="mb-5 flex flex-wrap items-center gap-1.5">
			<span class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">env</span>
			{#each knownEnvs as e}
				<button
					type="button"
					onclick={() => toggleEnv(e.key)}
					class="environment-theme-scope environment-theme-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity {envFilters.includes(e.key) ? 'ring-2 ring-gray-900/20 dark:ring-gray-100/20' : 'opacity-70 hover:opacity-100'}"
					style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
				>{e.display}</button>
			{/each}
			{#if envFilters.length > 0 || statusFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="ml-2 text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear all</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array(6) as _}
				<div class="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load rollouts: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<p class="text-sm font-medium text-gray-900 dark:text-white">No rollouts yet</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">Create a Rollout resource in your cluster to see it here.</p>
		</div>
	{:else if sorted.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No matches</p>
			<button
				type="button"
				onclick={clearFilters}
				class="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			>Clear filters</button>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each sorted as c (c.ns + '/' + c.name)}
				<a
					href={`/rollouts/${c.ns}/${c.name}`}
					class="environment-theme-scope group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
					style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="relative flex h-2 w-2 shrink-0">
									{#if c.isRunning}
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[c.bakeStatus]}"></span>
									{/if}
									<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[c.bakeStatus] ?? STATUS_DOT.None}"></span>
								</span>
								<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
							</div>
							<div class="mt-0.5 flex items-center gap-1.5 pl-4 font-mono text-[11px] text-gray-400 dark:text-gray-500">
								<span class="truncate">{c.ns}</span>
								{#if c.name !== c.ns && c.name !== c.title}
									<span class="text-gray-300 dark:text-gray-600">·</span>
									<span class="truncate">{c.name}</span>
								{/if}
							</div>
						</div>
						{#if c.envDisplay}
							<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{c.envDisplay}</span>
						{/if}
					</div>

					<div class="flex items-end justify-between gap-2">
						<div class="flex min-w-0 flex-col gap-0.5">
							<span class="truncate font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
								{c.version ?? '—'}
							</span>
							<span class="text-[11px] {STATUS_TEXT[c.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[c.bakeStatus]}</span>
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							{#if c.pinnedVersion}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
									title={`Pinned to ${c.pinnedVersion}`}
								>pinned</span>
							{/if}
							{#if c.timestamp}
								<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(c.timestamp, $now)}>
									{formatTimeAgoCompact(c.timestamp, $now)}
								</span>
							{/if}
						</div>
					</div>

					{#if c.statusKey === 'failed' && c.bakeStatusMessage}
						<div class="line-clamp-2 rounded-md border border-red-200 bg-red-50/70 px-2 py-1 text-[11px] text-red-700 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300">
							{c.bakeStatusMessage}
						</div>
					{/if}
				</a>
			{/each}
		</div>

		<p class="mt-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
			{sorted.length} of {cards.length}
		</p>
	{/if}
</div>
