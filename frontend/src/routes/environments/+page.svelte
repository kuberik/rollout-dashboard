<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { CheckCircleSolid, ExclamationCircleSolid, LayersSolid } from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Unique environment names, sorted by tier (dev → staging → prod)
	const envNames = $derived.by(() => {
		const names = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.environment;
			if (n) names.add(n);
		}
		return [...names].sort(compareEnvironmentNames);
	});

	// Theme per env column (first rollout with a matching theme wins)
	function getEnvThemeStyle(envName: string): string | undefined {
		for (const env of environments) {
			if (env.spec?.environment !== envName) continue;
			const r = rollouts.find(
				(r) =>
					r.metadata?.name === env.spec?.rolloutRef?.name &&
					r.metadata?.namespace === env.metadata?.namespace
			);
			if (!r) continue;
			const theme = getRolloutEnvironmentTheme(r, env);
			if (theme) return getEnvironmentThemeStyle(theme);
		}
		return undefined;
	}

	// Unique app names (rollout resource names that appear across envs)
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
				const envObj = environments.find(
					(e) => e.spec?.rolloutRef?.name === app && e.spec?.environment === envName
				);
				if (!envObj) { row.set(envName, null); continue; }
				const rollout = rollouts.find(
					(r) => r.metadata?.name === app && r.metadata?.namespace === envObj.metadata?.namespace
				);
				row.set(envName, rollout ? { rollout, env: envObj } : null);
			}
			result.set(app, row);
		}
		return result;
	});

	// Get display title for an app (first non-null rollout's title, fallback to name)
	function getAppTitle(appName: string): string {
		const row = matrix.get(appName);
		if (!row) return appName;
		for (const [, cell] of row) {
			if (cell?.rollout?.status?.title) return cell.rollout.status.title;
		}
		return appName;
	}

	// Status helpers
	const STATUS_DOT: Record<string, string> = {
		Succeeded:  'bg-green-500',
		Failed:     'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying:  'bg-blue-500',
		Cancelled:  'bg-gray-400',
		None:       'bg-gray-300 dark:bg-gray-600',
	};

	const STATUS_LABEL_CLASS: Record<string, string> = {
		Succeeded:  'text-green-700 dark:text-green-400',
		Failed:     'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying:  'text-blue-700 dark:text-blue-400',
		Cancelled:  'text-gray-500 dark:text-gray-500',
		None:       'text-gray-400 dark:text-gray-600',
	};

	const STATUS_LABEL: Record<string, string> = {
		Succeeded: 'Succeeded', Failed: 'Failed', InProgress: 'Baking',
		Deploying: 'Deploying', Cancelled: 'Cancelled', None: 'No deploy',
	};

	function bakeStatus(r: Rollout) { return r.status?.history?.[0]?.bakeStatus || 'None'; }
	function isRunning(s: string) { return s === 'InProgress' || s === 'Deploying'; }

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

	// For each (app, envName), check if the env immediately earlier in the tier
	// has a different succeeded version → this cell is "behind" that earlier env.
	function behindFor(appName: string, envName: string): { fromEnv: string; version: string } | null {
		const row = matrix.get(appName);
		if (!row) return null;
		const idx = envNames.indexOf(envName);
		if (idx <= 0) return null;
		const earlierEnvName = envNames[idx - 1];
		const earlier = row.get(earlierEnvName);
		const current = row.get(envName);
		if (!earlier?.rollout || !current?.rollout) return null;
		const earlierH = earlier.rollout.status?.history?.[0];
		if (!earlierH) return null;
		if (earlierH.bakeStatus !== 'Succeeded') return null;
		const earlierV = getDisplayVersion(earlierH.version);
		const currentH = current.rollout.status?.history?.[0];
		if (!currentH) return { fromEnv: earlierEnvName, version: earlierV };
		const currentV = getDisplayVersion(currentH.version);
		if (earlierV === currentV) return null;
		return { fromEnv: earlierEnvName, version: earlierV };
	}

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

	const sortedAppNames = $derived(
		[...appNames].sort((a, b) => {
			const d = appSeverity(b) - appSeverity(a);
			return d !== 0 ? d : a.localeCompare(b);
		})
	);

	// Counts from rollouts that appear in the matrix only
	const matrixRollouts = $derived.by(() => {
		const out: import('../../types').Rollout[] = [];
		for (const [, row] of matrix) {
			for (const [, cell] of row) {
				if (cell) out.push(cell.rollout);
			}
		}
		return out;
	});
	const failedCount = $derived(
		matrixRollouts.filter((r) => r.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		matrixRollouts.filter((r) => {
			const s = r.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
	// Number of (app, env) cells where the next-tier env is behind the previous
	// — surfaces fleet-wide promotion candidates.
	const pendingPromotionCount = $derived.by(() => {
		let n = 0;
		for (const app of appNames) {
			for (const envName of envNames) {
				if (behindFor(app, envName)) n++;
			}
		}
		return n;
	});

	// Column width: first col wider, env cols equal
	function gridCols(n: number) {
		return `minmax(200px,1.5fr) ${'minmax(150px,1fr) '.repeat(n).trim()}`;
	}
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold text-gray-900 dark:text-white">Environments</h1>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Cross-environment deployment status</p>
		</div>
		<div class="flex items-center gap-3">
			{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
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
				{#if pendingPromotionCount > 0}
					<span class="flex items-center gap-1 font-medium text-orange-600 dark:text-orange-400" title="At least one earlier-tier env has a different succeeded version">
						<span class="h-2 w-2 rounded-full bg-orange-500"></span>{pendingPromotionCount} pending
					</span>
				{/if}
				{#if failedCount === 0 && activeCount === 0 && pendingPromotionCount === 0 && rollouts.length > 0}
					<span class="flex items-center gap-1 text-green-600 dark:text-green-400">
						<CheckCircleSolid class="h-3.5 w-3.5" />All healthy
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if query.isLoading}
		<div class="space-y-3">
			{#each Array(5) as _}
				<div class="h-14 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load environments: {(query.error as Error).message}
		</div>
	{:else if envNames.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">No environments configured</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				Create <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">Environment</code> resources in your cluster to see cross-environment comparisons here.
			</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<div class="min-w-max overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<!-- Column headers -->
				<div
					class="grid border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
					style="grid-template-columns: {gridCols(envNames.length)}"
				>
					<div class="px-5 py-3">
						<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Application</span>
					</div>
					{#each envNames as envName}
						<a
							href="/envs/{envName}"
							class="environment-theme-scope border-l border-gray-200 px-5 py-3 transition-colors hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
							style={getEnvThemeStyle(envName)}
							title="See all apps in {envName}"
						>
							<span class="environment-theme-text text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200">{envName}</span>
						</a>
					{/each}
				</div>

				<!-- Rows -->
				<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each sortedAppNames as appName}
						{@const row = matrix.get(appName)}
						{@const drift = hasDrift(appName)}
						{@const sev = appSeverity(appName)}
						<div
							class="grid {sev === 3 ? 'bg-red-50/40 dark:bg-red-900/5' : ''}"
							style="grid-template-columns: {gridCols(envNames.length)}"
						>
							<!-- App name column -->
							<a
								href="/apps/{appName}"
								class="flex flex-col justify-center px-5 py-4 gap-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
								title="See {appName} across all environments"
							>
								<div class="flex items-center gap-2">
									{#if sev === 3}
										<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"></span>
									{:else if sev === 1}
										<span class="relative flex h-1.5 w-1.5 shrink-0">
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
											<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400"></span>
										</span>
									{:else}
										<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 dark:bg-green-500"></span>
									{/if}
									<span class="text-sm font-semibold text-gray-900 dark:text-white">{getAppTitle(appName)}</span>
								</div>
								<div class="flex items-center gap-2 pl-3.5">
									<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">{appName}</span>
									{#if drift}
										<span class="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-px text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">drift</span>
									{/if}
								</div>
							</a>

							<!-- Environment cells -->
							{#each envNames as envName}
								{@const cell = row?.get(envName)}
								<div class="border-l border-gray-100 p-3 dark:border-gray-700/60">
									{#if cell}
										{@const status = bakeStatus(cell.rollout)}
										{@const dotClass = STATUS_DOT[status] ?? STATUS_DOT['None']}
										{@const labelClass = STATUS_LABEL_CLASS[status] ?? STATUS_LABEL_CLASS['None']}
										{@const label = STATUS_LABEL[status] ?? status}
										{@const latest = cell.rollout.status?.history?.[0]}
										{@const behind = behindFor(appName, envName)}
										<a
											href="/rollouts/{cell.rollout.metadata?.namespace}/{cell.rollout.metadata?.name}"
											class="group block rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
										>
											<div class="flex items-center gap-2">
												<span class="relative flex h-2 w-2 shrink-0">
													{#if isRunning(status)}
														<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {dotClass}"></span>
													{/if}
													<span class="relative inline-flex h-2 w-2 rounded-full {dotClass}"></span>
												</span>
												<span class="truncate font-mono text-xs font-medium text-gray-800 dark:text-gray-200">
													{latest?.version ? getDisplayVersion(latest.version) : '—'}
												</span>
											</div>
											<div class="mt-1 flex items-center justify-between gap-1 pl-4">
												<span class="text-[11px] font-medium {labelClass}">{label}</span>
												{#if latest?.timestamp}
													<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
														{formatTimeAgoCompact(latest.timestamp, $now)}
													</span>
												{/if}
											</div>
											{#if behind}
												<div
													class="mt-1.5 flex items-center gap-1 truncate text-[10px] text-orange-700 dark:text-orange-300"
													title="behind {behind.version} on {behind.fromEnv}"
												>
													<span aria-hidden="true">←</span>
													<span class="font-mono">{behind.version}</span>
													<span class="text-orange-500/70 dark:text-orange-400/70">on {behind.fromEnv}</span>
												</div>
											{/if}
										</a>
									{:else}
										<div class="flex items-center justify-center py-4">
											<span class="text-xs text-gray-300 dark:text-gray-700">—</span>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>

		<p class="mt-3 text-center text-[11px] text-gray-400 dark:text-gray-600">
			{sortedAppNames.length} app{sortedAppNames.length === 1 ? '' : 's'} · {envNames.length} environment{envNames.length === 1 ? '' : 's'}
		</p>
	{/if}
</div>
