<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { Spinner } from 'flowbite-svelte';
	import { RocketOutline, SearchOutline } from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type AppCell = {
		envName: string;
		rollout: Rollout | null;
		env: Environment;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	type AppSummary = {
		name: string;
		title: string;
		cells: AppCell[];
		failedCount: number;
		activeCount: number;
		envCount: number;
		deployedCount: number;
		currentVersions: string[];
		lastDeploy: string | null;
	};

	const apps = $derived.by<AppSummary[]>(() => {
		const map = new Map<string, AppSummary>();
		for (const env of environments) {
			const name = env.spec?.rolloutRef?.name;
			if (!name) continue;
			const rollout =
				rollouts.find(
					(r) =>
						r.metadata?.name === name && r.metadata?.namespace === env.metadata?.namespace
				) || null;
			const theme = rollout ? getRolloutEnvironmentTheme(rollout, env) : null;
			const envName = env.spec?.environment || '';
			const cell: AppCell = { envName, rollout, env, theme };
			if (!map.has(name)) {
				map.set(name, {
					name,
					title: name,
					cells: [],
					failedCount: 0,
					activeCount: 0,
					envCount: 0,
					deployedCount: 0,
					currentVersions: [],
					lastDeploy: null
				});
			}
			const summary = map.get(name)!;
			summary.cells.push(cell);
		}
		for (const summary of map.values()) {
			summary.cells.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
			const versions = new Set<string>();
			let latestTs: string | null = null;
			for (const c of summary.cells) {
				const h = c.rollout?.status?.history?.[0];
				const v = h?.version;
				if (v) versions.add(getDisplayVersion(v));
				if (h) summary.deployedCount++;
				const status = h?.bakeStatus;
				if (status === 'Failed') summary.failedCount++;
				if (status === 'InProgress' || status === 'Deploying') summary.activeCount++;
				const t = h?.timestamp;
				if (t && (!latestTs || new Date(t) > new Date(latestTs))) latestTs = t;
				if (c.rollout?.status?.title) summary.title = c.rollout.status.title;
			}
			summary.currentVersions = [...versions];
			summary.envCount = summary.cells.length;
			summary.lastDeploy = latestTs;
		}
		return [...map.values()].sort((a, b) => {
			// Failed first, then active, then alphabetical
			const sa = a.failedCount > 0 ? 3 : a.activeCount > 0 ? 1 : 0;
			const sb = b.failedCount > 0 ? 3 : b.activeCount > 0 ? 1 : 0;
			if (sa !== sb) return sb - sa;
			return a.title.localeCompare(b.title);
		});
	});

	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	// Fleet roll-up
	const fleetTotals = $derived.by(() => {
		let failed = 0, active = 0, drift = 0, pending = 0, healthy = 0;
		for (const a of apps) {
			if (a.failedCount > 0) failed++;
			else if (a.activeCount > 0) active++;
			else if (a.currentVersions.length > 1) drift++;
			else if (a.deployedCount < a.envCount) pending++;
			else healthy++;
		}
		return { failed, active, drift, pending, healthy };
	});
	const fleetNewestDeploy = $derived.by<string | null>(() => {
		let t: string | null = null;
		for (const a of apps) {
			if (a.lastDeploy && (!t || new Date(a.lastDeploy) > new Date(t))) t = a.lastDeploy;
		}
		return t;
	});

	// Classify an app for filter purposes — same priority as fleetTotals so the
	// header counts match the chip behaviour.
	type AppStatus = 'failed' | 'active' | 'drifting' | 'pending' | 'healthy';
	function appStatusKey(a: AppSummary): AppStatus {
		if (a.failedCount > 0) return 'failed';
		if (a.activeCount > 0) return 'active';
		if (a.currentVersions.length > 1) return 'drifting';
		if (a.deployedCount < a.envCount) return 'pending';
		return 'healthy';
	}

	let statusFilters = $state<AppStatus[]>([]);
	let searchQuery = $state('');

	function toggleStatus(k: AppStatus) {
		statusFilters = statusFilters.includes(k)
			? statusFilters.filter((x) => x !== k)
			: [...statusFilters, k];
	}
	function clearFilters() {
		statusFilters = [];
		searchQuery = '';
	}

	const filteredApps = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return apps.filter((a) => {
			if (statusFilters.length > 0 && !statusFilters.includes(appStatusKey(a))) return false;
			if (q) {
				const hay = `${a.name} ${a.title}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="text-2xl font-light text-gray-900 dark:text-white">Apps</h1>
			{#if apps.length > 0}
				<span class="text-sm text-gray-500 dark:text-gray-400">
					<span class="tabular-nums {fleetTotals.healthy === apps.length ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}">{fleetTotals.healthy}</span>
					<span>of {apps.length} healthy</span>
					{#if fleetTotals.failed > 0}<span class="ml-2 font-medium text-red-600 dark:text-red-400">· {fleetTotals.failed} failed</span>{/if}
					{#if fleetTotals.active > 0}<span class="ml-2 font-medium text-yellow-700 dark:text-yellow-400">· {fleetTotals.active} deploying</span>{/if}
					{#if fleetTotals.drift > 0}<span class="ml-2 font-medium text-orange-700 dark:text-orange-400">· {fleetTotals.drift} drifting</span>{/if}
					{#if fleetTotals.pending > 0}<span class="ml-2 text-gray-500 dark:text-gray-400">· {fleetTotals.pending} pending</span>{/if}
				</span>
				{#if fleetNewestDeploy}
					<span class="text-xs text-gray-400 dark:text-gray-500" title={`Newest deploy ${formatTimeAgo(fleetNewestDeploy, $now)}`}>
						last deploy {formatTimeAgoCompact(fleetNewestDeploy, $now)}
					</span>
				{/if}
			{/if}
		</div>
		{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
	</div>

	{#if apps.length > 0 && !query.isLoading}
		<div class="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search apps…"
					class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				{#each [{key:'failed', label:'Failed', dot:'bg-red-500'}, {key:'active', label:'Deploying', dot:'bg-yellow-400'}, {key:'drifting', label:'Drifting', dot:'bg-orange-500'}, {key:'pending', label:'Pending', dot:'bg-gray-400'}, {key:'healthy', label:'Healthy', dot:'bg-green-500'}] as p}
					{@const k = p.key as AppStatus}
					{@const sel = statusFilters.includes(k)}
					{@const n = fleetTotals[k === 'drifting' ? 'drift' : k]}
					{#if n > 0}
						<button
							type="button"
							onclick={() => toggleStatus(k)}
							class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors
								{sel
									? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
									: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/60'}"
						>
							<span class="h-1.5 w-1.5 rounded-full {p.dot}"></span>
							{n} {p.label}
						</button>
					{/if}
				{/each}
			</div>
			{#if statusFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-3">
			{#each Array(5) as _}
				<div class="h-20 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if apps.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<RocketOutline class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">No apps yet</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				Create
				<code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">Environment</code>
				resources that reference rollouts to see consolidated app views.
			</p>
		</div>
	{:else if filteredApps.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No apps match</p>
			<button
				type="button"
				onclick={clearFilters}
				class="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			>Clear filters</button>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each filteredApps as app}
				{@const drift = app.currentVersions.length > 1}
				{@const sk = appStatusKey(app)}
				<a
					href="/apps/{app.name}"
					class="flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800
						{sk === 'failed' ? 'card-failed' : ''}
						{sk === 'active' ? 'card-active' : ''}"
				>
					<!-- Title row: status circle + title/name + drift pill -->
					<div class="flex min-w-0 items-start justify-between gap-3">
						<div class="flex min-w-0 items-center gap-3">
							<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {sk === 'failed' ? 'bg-red-100 dark:bg-red-900/30' : sk === 'active' ? 'bg-yellow-100 dark:bg-yellow-900/30' : sk === 'drifting' ? 'bg-orange-100 dark:bg-orange-900/30' : sk === 'pending' ? 'bg-gray-100 dark:bg-gray-700/60' : 'bg-green-100 dark:bg-green-900/30'}">
								{#if sk === 'active'}
									<span class="absolute inset-0 animate-ping rounded-full bg-yellow-400/30"></span>
								{/if}
								<span class="relative inline-flex h-2.5 w-2.5 rounded-full {sk === 'failed' ? 'bg-red-500' : sk === 'active' ? 'bg-yellow-400' : sk === 'drifting' ? 'bg-orange-500' : sk === 'pending' ? 'bg-gray-400' : 'bg-green-500'}"></span>
							</span>
							<div class="flex min-w-0 flex-col">
								<span class="truncate text-base font-bold text-gray-900 dark:text-white">{app.title}</span>
								<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{app.name}</span>
							</div>
						</div>
						{#if drift}
							<span class="shrink-0 self-start rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" title={`Live versions: ${app.currentVersions.join(', ')}`}>drift</span>
						{/if}
					</div>
					<!-- Env strip: env badge + version per env -->
					<div class="flex flex-wrap gap-x-2 gap-y-1.5 pl-12">
						{#each app.cells as c}
							{@const latest = c.rollout?.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
							<div class="inline-flex items-baseline gap-1">
								<span
									class="environment-theme-scope environment-theme-badge inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
									style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
								>
									<span class="relative flex h-1.5 w-1.5">
										{#if isRunning(status)}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[status]}"></span>
										{/if}
										<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[status] ?? STATUS_DOT.None}"></span>
									</span>
									<span>{shortEnvLabel(c.theme) || c.envName || '—'}</span>
								</span>
								<span class="max-w-[8rem] truncate font-mono text-[10px] text-gray-500 dark:text-gray-400" title={ver ?? ''}>{ver ?? '—'}</span>
							</div>
						{/each}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
