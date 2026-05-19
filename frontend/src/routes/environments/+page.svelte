<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { LayersSolid, ChevronRightOutline } from 'flowbite-svelte-icons';
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
	function behindFor(
		appName: string,
		envName: string
	): { fromEnv: string; version: string; behindBy: number | null } | null {
		const row = matrix.get(appName);
		if (!row) return null;
		const idx = envNames.indexOf(envName);
		if (idx <= 0) return null;
		const earlierEnvName = envNames[idx - 1];
		const earlier = row.get(earlierEnvName);
		const current = row.get(envName);
		if (!earlier?.rollout || !current?.rollout) return null;
		// Pinned env is intentionally held — don't surface it as lagging.
		if (current.rollout.spec?.wantedVersion) return null;
		const earlierH = earlier.rollout.status?.history?.[0];
		if (!earlierH) return null;
		if (earlierH.bakeStatus !== 'Succeeded') return null;
		const earlierV = getDisplayVersion(earlierH.version);
		const currentH = current.rollout.status?.history?.[0];
		if (!currentH) return { fromEnv: earlierEnvName, version: earlierV, behindBy: null };
		const currentV = getDisplayVersion(currentH.version);
		if (earlierV === currentV) return null;
		// Count distinct versions in earlier env's history between current (inclusive) and latest.
		const earlierHistory = earlier.rollout.status?.history ?? [];
		const distinct: string[] = [];
		for (const h of earlierHistory) {
			const v = getDisplayVersion(h.version);
			if (distinct[distinct.length - 1] !== v) distinct.push(v);
			if (v === currentV) break;
		}
		const i = distinct.indexOf(currentV);
		const behindBy = i >= 0 ? i : null;
		return { fromEnv: earlierEnvName, version: earlierV, behindBy };
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
	<div class="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<div class="flex items-baseline gap-3">
			<h1 class="text-2xl font-light text-gray-900 dark:text-white">Environments</h1>
			{#if rollouts.length > 0}
				<span class="text-sm text-gray-500 dark:text-gray-400">
					{envNames.length} env{envNames.length === 1 ? '' : 's'} · {sortedAppNames.length} app{sortedAppNames.length === 1 ? '' : 's'}
					{#if failedCount > 0}<span class="ml-2 font-medium text-red-600 dark:text-red-400">· {failedCount} failed</span>{/if}
					{#if activeCount > 0}<span class="ml-2 font-medium text-yellow-700 dark:text-yellow-400">· {activeCount} deploying</span>{/if}
					{#if pendingPromotionCount > 0}<span class="ml-2 font-medium text-orange-700 dark:text-orange-400" title="At least one earlier-tier env has a different succeeded version">· {pendingPromotionCount} behind</span>{/if}
				</span>
			{/if}
		</div>
		{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
	</div>

	{#if query.isLoading}
		<!-- Mobile skeleton: env-grouped cards -->
		<div class="space-y-3 md:hidden">
			{#each Array(3) as _}
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
						<div class="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-3 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
					</div>
					<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each Array(2) as _}
							<div class="flex items-center justify-between gap-3 px-4 py-3">
								<div class="flex min-w-0 flex-1 flex-col gap-1.5">
									<div class="h-3.5 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-3 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
								</div>
								<div class="h-3 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<!-- Desktop skeleton: matrix-shaped grid -->
		<div class="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 md:block">
			<!-- Header row -->
			<div class="grid border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40" style="grid-template-columns: minmax(200px,1.5fr) repeat(3, minmax(150px,1fr))">
				<div class="px-5 py-3"><div class="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div></div>
				{#each Array(3) as _}
					<div class="border-l border-gray-200 px-5 py-3 dark:border-gray-700"><div class="h-3 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div></div>
				{/each}
			</div>
			<!-- Rows -->
			<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each Array(4) as _}
					<div class="grid" style="grid-template-columns: minmax(200px,1.5fr) repeat(3, minmax(150px,1fr))">
						<div class="flex flex-col gap-1.5 px-5 py-4">
							<div class="h-4 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							<div class="h-3 w-1/2 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
						</div>
						{#each Array(3) as _}
							<div class="border-l border-gray-100 p-3 dark:border-gray-700/60">
								<div class="space-y-1.5">
									<div class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-2.5 w-12 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
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
		<!-- Mobile: grouped by ENVIRONMENT (one card per env, app rows inside) -->
		<div class="space-y-4 md:hidden">
			{#each envNames as envName}
				{@const envApps = sortedAppNames
					.map((appName) => ({ appName, cell: matrix.get(appName)?.get(envName) ?? null }))
					.filter((x) => x.cell !== null)}
				{@const envFailedCount = envApps.filter((x) => x.cell && bakeStatus(x.cell.rollout) === 'Failed').length}
				{@const envActiveCount = envApps.filter((x) => x.cell && isRunning(bakeStatus(x.cell.rollout))).length}
				{@const envPendingCount = envApps.filter((x) => x.cell && behindFor(x.appName, envName)).length}
				<section
					class="environment-theme-scope overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
					style={getEnvThemeStyle(envName)}
				>
					<a
						href="/envs/{envName}"
						class="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/40"
					>
						<div class="flex min-w-0 items-center gap-2">
							<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider">{envName}</span>
							<span class="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{envApps.length} app{envApps.length === 1 ? '' : 's'}</span>
							{#if envFailedCount > 0}
								<span class="text-[11px] font-medium text-red-600 dark:text-red-400">· {envFailedCount} failed</span>
							{:else if envActiveCount > 0}
								<span class="text-[11px] font-medium text-yellow-700 dark:text-yellow-400">· {envActiveCount} deploying</span>
							{:else if envPendingCount > 0}
								<span class="text-[11px] font-medium text-orange-700 dark:text-orange-400">· {envPendingCount} behind</span>
							{/if}
						</div>
						<ChevronRightOutline class="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
					</a>
					{#if envApps.length === 0}
						<div class="px-4 py-3 text-[11px] text-gray-400 dark:text-gray-500">No apps deployed here.</div>
					{:else}
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each envApps as { appName, cell }}
								{#if cell}
									{@const status = bakeStatus(cell.rollout)}
									{@const dotClass = STATUS_DOT[status] ?? STATUS_DOT['None']}
									{@const labelClass = STATUS_LABEL_CLASS[status] ?? STATUS_LABEL_CLASS['None']}
									{@const label = STATUS_LABEL[status] ?? status}
									{@const latest = cell.rollout.status?.history?.[0]}
									{@const behind = behindFor(appName, envName)}
									{@const drift = hasDrift(appName)}
									<li>
										<a
											href="/rollouts/{cell.rollout.metadata?.namespace}/{cell.rollout.metadata?.name}"
											class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
										>
											<div class="flex min-w-0 flex-1 flex-col gap-0.5">
												<div class="flex min-w-0 items-center gap-2">
													<span class="relative flex h-2 w-2 shrink-0">
														{#if isRunning(status)}
															<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {dotClass}"></span>
														{/if}
														<span class="relative inline-flex h-2 w-2 rounded-full {dotClass}"></span>
													</span>
													<span class="truncate text-sm font-medium text-gray-900 dark:text-white">{getAppTitle(appName)}</span>
													{#if drift}
														<span class="shrink-0 rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">drift</span>
													{/if}
												</div>
												<div class="flex min-w-0 items-center gap-2 pl-4">
													<span class="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{latest?.version ? getDisplayVersion(latest.version) : '—'}</span>
													<span class="text-[10px] {labelClass}">{label}</span>
												</div>
												{#if behind}
													<span class="truncate pl-4 text-[10px] text-orange-700 dark:text-orange-300">
														← {#if behind.behindBy && behind.behindBy > 0}{behind.behindBy} {behind.behindBy === 1 ? 'version' : 'versions'} behind{:else}behind{/if}
														<span class="font-mono">{behind.version}</span> on {behind.fromEnv}
													</span>
												{/if}
											</div>
											<div class="flex shrink-0 flex-col items-end gap-1">
												{#if cell.rollout.spec?.wantedVersion}
													<span
														class="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
														title={`Pinned to ${cell.rollout.spec.wantedVersion}`}
													>pin</span>
												{/if}
												{#if latest?.timestamp}
													<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">{formatTimeAgoCompact(latest.timestamp, $now)}</span>
												{/if}
											</div>
										</a>
									</li>
								{/if}
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		</div>

		<!-- Desktop: matrix layout -->
		<div class="hidden overflow-x-auto md:block">
			<div class="min-w-max overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<!-- Column headers -->
				<div
					class="sticky top-0 z-10 grid border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
					style="grid-template-columns: {gridCols(envNames.length)}"
				>
					<div class="px-5 py-3">
						<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Application</span>
					</div>
					{#each envNames as envName}
						{@const envDeployedCount = sortedAppNames.filter((app) => matrix.get(app)?.get(envName)?.rollout?.status?.history?.[0]).length}
						<a
							href="/envs/{envName}"
							class="environment-theme-scope flex items-baseline justify-between gap-2 border-l border-gray-200 px-5 py-3 transition-colors hover:bg-white dark:border-gray-700 dark:hover:bg-gray-800"
							style={getEnvThemeStyle(envName)}
							title="See all apps in {envName}"
						>
							<span class="environment-theme-text text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200">{envName}</span>
							<span class="text-[10px] font-medium text-gray-400 dark:text-gray-500">{envDeployedCount}</span>
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
												<div class="flex items-center gap-1">
													{#if cell.rollout.spec?.wantedVersion}
														<span
															class="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
															title={`Pinned to ${cell.rollout.spec.wantedVersion}`}
														>pin</span>
													{/if}
													{#if latest?.timestamp}
														<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
															{formatTimeAgoCompact(latest.timestamp, $now)}
														</span>
													{/if}
												</div>
											</div>
											{#if behind}
												<div
													class="mt-1.5 flex flex-wrap items-center gap-x-1 truncate text-[10px] text-orange-700 dark:text-orange-300"
													title="behind {behind.version} on {behind.fromEnv}"
												>
													<span aria-hidden="true">←</span>
													{#if behind.behindBy && behind.behindBy > 0}
														<span class="font-semibold">{behind.behindBy}</span>
														<span>{behind.behindBy === 1 ? 'version' : 'versions'} behind</span>
													{:else}
														<span>behind</span>
													{/if}
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
	{/if}
</div>
