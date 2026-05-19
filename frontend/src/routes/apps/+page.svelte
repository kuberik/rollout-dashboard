<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { LayersSolid, RocketOutline, ChevronRightOutline, ClockSolid } from 'flowbite-svelte-icons';
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
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Apps</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Each app and where it's deployed</p>
		</div>
		<div class="flex items-center gap-3">
			{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
		</div>
	</div>

	{#if apps.length > 0}
		<!-- Fleet summary banner -->
		<section class="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<div class="flex items-baseline gap-1.5">
					<span class="text-3xl font-light {fleetTotals.healthy === apps.length ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}">{fleetTotals.healthy}</span>
					<span class="text-sm text-gray-400 dark:text-gray-500">/ {apps.length} apps healthy</span>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					{#if fleetTotals.active > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{fleetTotals.active} deploying
						</span>
					{/if}
					{#if fleetTotals.drift > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-400">
							<span class="h-2 w-2 rounded-full bg-orange-500"></span>
							{fleetTotals.drift} drifting
						</span>
					{/if}
					{#if fleetTotals.pending > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
							<span class="h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-500"></span>
							{fleetTotals.pending} pending
						</span>
					{/if}
					{#if fleetTotals.failed > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
							<span class="h-2 w-2 rounded-full bg-red-500"></span>
							{fleetTotals.failed} failed
						</span>
					{/if}
					{#if fleetTotals.failed === 0 && fleetTotals.active === 0 && fleetTotals.drift === 0 && fleetTotals.pending === 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
							<span class="h-2 w-2 rounded-full bg-green-500"></span>
							All healthy
						</span>
					{/if}
					{#if fleetNewestDeploy}
						<span class="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 dark:text-gray-500" title="Newest deploy {formatTimeAgo(fleetNewestDeploy, $now)}">
							<ClockSolid class="h-3 w-3" />
							{formatTimeAgoCompact(fleetNewestDeploy, $now)}
						</span>
					{/if}
				</div>
			</div>
			<!-- Composition bar -->
			<div class="mt-3 flex h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
				{#if fleetTotals.healthy > 0}
					<span class="bg-green-500" style="width:{(fleetTotals.healthy / apps.length) * 100}%"></span>
				{/if}
				{#if fleetTotals.active > 0}
					<span class="bg-yellow-400" style="width:{(fleetTotals.active / apps.length) * 100}%"></span>
				{/if}
				{#if fleetTotals.drift > 0}
					<span class="bg-orange-500" style="width:{(fleetTotals.drift / apps.length) * 100}%"></span>
				{/if}
				{#if fleetTotals.pending > 0}
					<span class="bg-gray-400 dark:bg-gray-500" style="width:{(fleetTotals.pending / apps.length) * 100}%"></span>
				{/if}
				{#if fleetTotals.failed > 0}
					<span class="bg-red-500" style="width:{(fleetTotals.failed / apps.length) * 100}%"></span>
				{/if}
			</div>
		</section>
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
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each apps as app}
				{@const drift = app.currentVersions.length > 1}
				<a
					href="/apps/{app.name}"
					class="group flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								{#if app.failedCount > 0}
									<span class="h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
								{:else if app.activeCount > 0}
									<span class="relative flex h-2 w-2 shrink-0">
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
										<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
									</span>
								{:else}
									<span class="h-2 w-2 shrink-0 rounded-full bg-green-400 dark:bg-green-500"></span>
								{/if}
								<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{app.title}</span>
							</div>
							<div class="mt-0.5 flex items-center gap-2 pl-4 font-mono text-[11px] text-gray-400 dark:text-gray-500">
								<span class="truncate">{app.name}</span>
								{#if drift}
									<span class="shrink-0 rounded-full bg-orange-100 px-1.5 py-px text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">drift</span>
								{/if}
							</div>
						</div>
						<ChevronRightOutline class="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
					</div>
					<!-- Env strip: env badge + current version per env -->
					<div class="flex flex-wrap gap-x-2 gap-y-1.5">
						{#each app.cells as c}
							{@const latest = c.rollout?.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
							<div class="inline-flex items-center gap-1">
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
					{#if app.lastDeploy}
						<div class="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
							<span>last deploy</span>
							<span class="font-mono" title={formatTimeAgo(app.lastDeploy, $now)}>{formatTimeAgoCompact(app.lastDeploy, $now)}</span>
						</div>
					{/if}
				</a>
			{/each}
		</div>

		<p class="mt-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
			{apps.length} app{apps.length === 1 ? '' : 's'}
		</p>
	{/if}
</div>
