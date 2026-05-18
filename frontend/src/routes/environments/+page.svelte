<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { Spinner, Badge } from 'flowbite-svelte';
	import { CheckCircleSolid, ExclamationCircleSolid, LayersSolid } from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Unique environment names, sorted
	const envNames = $derived.by(() => {
		const names = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.environment;
			if (n) names.add(n);
		}
		return [...names].sort();
	});

	// Unique app names (rollout names that appear across envs)
	const appNames = $derived.by(() => {
		const names = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.rolloutRef?.name;
			if (n) names.add(n);
		}
		return [...names].sort();
	});

	// Build matrix: appName → envName → { rollout, env } | null
	const matrix = $derived.by(() => {
		const result = new Map<string, Map<string, { rollout: Rollout; env: Environment } | null>>();
		for (const app of appNames) {
			const row = new Map<string, { rollout: Rollout; env: Environment } | null>();
			for (const envName of envNames) {
				// Find the Environment object for this app + envName
				const envObj = environments.find(
					(e) => e.spec?.rolloutRef?.name === app && e.spec?.environment === envName
				);
				if (!envObj) {
					row.set(envName, null);
					continue;
				}
				// Find the Rollout with the same name in the environment's namespace
				const rollout = rollouts.find(
					(r) =>
						r.metadata?.name === app &&
						r.metadata?.namespace === envObj.metadata?.namespace
				);
				row.set(envName, rollout ? { rollout, env: envObj } : null);
			}
			result.set(app, row);
		}
		return result;
	});

	// Get the rollout title/display name for an app
	function getAppTitle(appName: string): string {
		const row = matrix.get(appName);
		if (!row) return appName;
		for (const [, cell] of row) {
			if (cell?.rollout?.status?.title) return cell.rollout.status.title;
		}
		return appName;
	}

	// Status color helpers
	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600',
	};

	const STATUS_RING: Record<string, string> = {
		Succeeded: 'ring-green-200 dark:ring-green-800/50',
		Failed: 'ring-red-200 dark:ring-red-800/50',
		InProgress: 'ring-yellow-200 dark:ring-yellow-800/50',
		Deploying: 'ring-blue-200 dark:ring-blue-800/50',
		Cancelled: 'ring-gray-200 dark:ring-gray-700',
		None: 'ring-gray-200 dark:ring-gray-700',
	};

	const STATUS_BG: Record<string, string> = {
		Succeeded: 'bg-green-50 dark:bg-green-900/10',
		Failed: 'bg-red-50 dark:bg-red-900/15',
		InProgress: 'bg-yellow-50 dark:bg-yellow-900/10',
		Deploying: 'bg-blue-50 dark:bg-blue-900/10',
		Cancelled: 'bg-gray-50 dark:bg-gray-800/40',
		None: 'bg-gray-50 dark:bg-gray-800/40',
	};

	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600',
	};

	function bakeStatus(r: Rollout) {
		return r.status?.history?.[0]?.bakeStatus || 'None';
	}

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	// Check version drift: does this app have different versions across environments?
	function hasDrift(appName: string): boolean {
		const row = matrix.get(appName);
		if (!row) return false;
		const versions = new Set<string>();
		for (const [, cell] of row) {
			if (cell?.rollout) {
				const v = cell.rollout.status?.history?.[0]?.version?.tag ?? null;
				if (v) versions.add(v);
			}
		}
		return versions.size > 1;
	}

	// Overall rollout health for an app
	function appSeverity(appName: string): number {
		const row = matrix.get(appName);
		if (!row) return 0;
		let sev = 0;
		for (const [, cell] of row) {
			if (!cell) continue;
			const s = bakeStatus(cell.rollout);
			if (s === 'Failed') sev = Math.max(sev, 3);
			else if (s === 'InProgress' || s === 'Deploying') sev = Math.max(sev, 1);
		}
		return sev;
	}

	// Sort apps: failed first, then by name
	const sortedAppNames = $derived(
		[...appNames].sort((a, b) => {
			const sa = appSeverity(a);
			const sb = appSeverity(b);
			if (sb !== sa) return sb - sa;
			return a.localeCompare(b);
		})
	);

	// Global counts
	const totalRollouts = $derived(rollouts.length);
	const failedCount = $derived(
		rollouts.filter((r) => r.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		rollouts.filter((r) => {
			const s = r.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Environments</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
				Cross-environment deployment status
			</p>
		</div>
		<div class="flex items-center gap-3">
			{#if query.isFetching}
				<Spinner size="5" color="gray" />
			{/if}
			{#if totalRollouts > 0}
				<div class="flex items-center gap-2 text-xs">
					{#if failedCount > 0}
						<span class="flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
							<ExclamationCircleSolid class="h-3.5 w-3.5" />{failedCount} failed
						</span>
					{/if}
					{#if activeCount > 0}
						<span class="flex items-center gap-1 font-medium text-yellow-600 dark:text-yellow-400">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{activeCount} deploying
						</span>
					{/if}
					{#if failedCount === 0 && activeCount === 0}
						<span class="flex items-center gap-1 text-green-600 dark:text-green-400">
							<CheckCircleSolid class="h-3.5 w-3.5" />All healthy
						</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if query.isLoading}
		<div class="space-y-3">
			{#each Array(5) as _}
				<div class="h-16 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load environments: {(query.error as Error).message}
		</div>
	{:else if envNames.length === 0}
		<!-- No environment resources found — show all rollouts in a plain list -->
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">No environments configured</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				Create <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">Environment</code> resources in your cluster to see cross-environment comparisons here.
			</p>
		</div>
	{:else}
		<!-- Deployment matrix -->
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<!-- Column headers -->
			<div
				class="grid border-b border-gray-200 dark:border-gray-700"
				style="grid-template-columns: minmax(180px,1fr) {envNames.map(() => 'minmax(160px,1fr)').join(' ')}"
			>
				<div class="px-5 py-3">
					<span class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Application</span>
				</div>
				{#each envNames as envName}
					<div class="border-l border-gray-100 px-5 py-3 dark:border-gray-700/60">
						<span class="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">{envName}</span>
					</div>
				{/each}
			</div>

			<!-- Rows -->
			<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each sortedAppNames as appName}
					{@const row = matrix.get(appName)}
					{@const drift = hasDrift(appName)}
					{@const sev = appSeverity(appName)}
					<div
						class="grid transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-700/20
							{sev === 3 ? 'bg-red-50/30 dark:bg-red-900/5' : ''}"
						style="grid-template-columns: minmax(180px,1fr) {envNames.map(() => 'minmax(160px,1fr)').join(' ')}"
					>
						<!-- App name column -->
						<div class="flex items-center gap-2.5 px-5 py-3.5">
							{#if sev === 3}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"></span>
							{:else if sev === 1}
								<span class="relative flex h-1.5 w-1.5 shrink-0">
									<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
									<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400"></span>
								</span>
							{:else}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400"></span>
							{/if}
							<div class="min-w-0">
								<p class="truncate text-sm font-semibold text-gray-900 dark:text-white">{getAppTitle(appName)}</p>
								{#if drift}
									<p class="text-[10px] font-medium text-orange-500 dark:text-orange-400">version drift</p>
								{/if}
							</div>
						</div>

						<!-- Environment cells -->
						{#each envNames as envName}
							{@const cell = row?.get(envName)}
							<div class="border-l border-gray-100 px-4 py-3 dark:border-gray-700/60">
								{#if cell}
									{@const status = bakeStatus(cell.rollout)}
									{@const dotClass = STATUS_DOT[status] ?? STATUS_DOT['None']}
									{@const bgClass = STATUS_BG[status] ?? STATUS_BG['None']}
									{@const textClass = STATUS_TEXT[status] ?? STATUS_TEXT['None']}
									{@const latest = cell.rollout.status?.history?.[0]}
									<a
										href="/rollouts/{cell.rollout.metadata?.namespace}/{cell.rollout.metadata?.name}"
										class="group block rounded-lg p-2.5 transition-colors {bgClass} hover:brightness-95"
									>
										<div class="flex items-center gap-2">
											<span class="relative flex h-2 w-2 shrink-0">
												{#if isRunning(status)}
													<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {dotClass}"></span>
												{/if}
												<span class="relative inline-flex h-2 w-2 rounded-full {dotClass}"></span>
											</span>
											<span class="truncate font-mono text-xs font-semibold text-gray-900 dark:text-white">
												{latest?.version ? getDisplayVersion(latest.version) : '—'}
											</span>
										</div>
										<div class="mt-1 flex items-center justify-between gap-1">
											<span class="text-[10px] font-medium {textClass}">
												{status === 'None' ? 'Idle' : status === 'InProgress' ? 'Baking' : status}
											</span>
											{#if latest?.timestamp}
												<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
													{formatTimeAgo(latest.timestamp, $now)}
												</span>
											{/if}
										</div>
									</a>
								{:else}
									<div class="flex h-full items-center justify-center py-3">
										<span class="text-xs text-gray-300 dark:text-gray-700">—</span>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		<!-- Footer note -->
		<p class="mt-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
			{sortedAppNames.length} app{sortedAppNames.length === 1 ? '' : 's'} across {envNames.length} environment{envNames.length === 1 ? '' : 's'}
		</p>
	{/if}
</div>
