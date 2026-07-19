<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceClusterName, rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup } from '$lib/version-utils';
	import { buildMatrix } from '$lib/view-models/matrix';
	import type { MatrixCellVM } from '$lib/view-models/matrix';
	import { formatTimeAgoCompact, formatTimeAgo } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import MatrixCell from '$lib/components/MatrixCell.svelte';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// `groups` gives us the raw per-cell rollout (for the detail-page link and
	// age), `matrix` gives us the sorted env-tier columns + per-cell
	// version/statusKey/behindBy (Task 4's `buildMatrix`, already
	// unit-tested). Combining both here is presentation-only glue — the
	// grouping/lag derivations themselves aren't duplicated.
	const groups = $derived.by<Map<string, AppGroup>>(() => groupRolloutsByApp(rollouts, environments));
	const matrix = $derived.by(() => buildMatrix(rollouts, environments));

	// One representative theme per env tier, so the column header badge
	// matches whatever `environment-theme-*` annotation (or preset-by-name
	// fallback) the first app bound to that tier resolves to — same source
	// the old per-env sections used, just picked once per column instead of
	// once per app.
	const envThemeByTier = $derived.by<Map<string, EnvironmentTheme | null>>(() => {
		const map = new Map<string, EnvironmentTheme | null>();
		for (const tier of matrix.envTiers) {
			let theme: EnvironmentTheme | null = null;
			for (const env of environments) {
				if (env.spec?.environment !== tier) continue;
				const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
				theme = getRolloutEnvironmentTheme(r ?? null, env);
				break;
			}
			map.set(tier, theme ?? getRolloutEnvironmentTheme(null, tier));
		}
		return map;
	});

	function tierLabel(tier: string): string {
		const theme = envThemeByTier.get(tier) ?? null;
		return shortEnvLabel(theme ?? tier) || tier;
	}

	type ColumnStat = {
		tier: string;
		label: string;
		theme: EnvironmentTheme | null;
		behindCount: number;
		attnCount: number;
	};

	// Column header summary: how many apps are behind in this tier, and how
	// many have a failed rollout there — derived straight from the matrix
	// cells in this column, no separate counting pass.
	const columns = $derived.by<ColumnStat[]>(() => {
		return matrix.envTiers.map((tier) => {
			let behindCount = 0;
			let attnCount = 0;
			for (const row of matrix.rows) {
				const cell = row.cells[tier];
				if (!cell) continue;
				if (cell.behindBy > 0) behindCount++;
				if (cell.statusKey === 'failed') attnCount++;
			}
			return { tier, label: tierLabel(tier), theme: envThemeByTier.get(tier) ?? null, behindCount, attnCount };
		});
	});

	type RowCellVM = {
		tier: string;
		vm: MatrixCellVM | null;
		href: string | null;
		timestamp: string | null;
	};

	type RowVM = {
		appName: string;
		title: string;
		worstLag: number;
		worstEnvLabel: string | null;
		cells: RowCellVM[];
	};

	// Grid template: fixed sticky-left "App" column + one flexible column per
	// env tier. Built once so the header row and every app row share the
	// exact same column widths.
	const gridTemplateColumns = $derived(`220px repeat(${matrix.envTiers.length}, minmax(180px, 1fr))`);

	const rowVMs = $derived.by<RowVM[]>(() => {
		return matrix.rows.map((row) => {
			const group = groups.get(row.appName);

			let worstEnvLabel: string | null = null;
			if (row.worstLag > 0) {
				for (const tier of matrix.envTiers) {
					const c = row.cells[tier];
					if (c && c.behindBy === row.worstLag) {
						worstEnvLabel = tierLabel(tier);
						break;
					}
				}
			}

			const cells: RowCellVM[] = matrix.envTiers.map((tier) => {
				const vm = row.cells[tier];
				let href: string | null = null;
				let timestamp: string | null = null;
				if (vm && group) {
					const cell = group.cells.find((c) => c.environment?.spec?.environment === tier);
					if (cell) {
						href = rolloutPath(
							cell.sourceCluster || sourceClusterName(cell.environment) || localClusterName,
							cell.rollout.metadata?.namespace || '',
							cell.rollout.metadata?.name || ''
						);
						timestamp = cell.rollout.status?.history?.[0]?.timestamp ?? null;
					}
				}
				return { tier, vm, href, timestamp };
			});

			return { appName: row.appName, title: row.title, worstLag: row.worstLag, worstEnvLabel, cells };
		});
	});
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-6 flex items-baseline justify-between gap-3">
		<div class="flex items-baseline gap-3">
			<h1 class="truncate text-2xl font-light text-gray-900 dark:text-white">Environments</h1>
			{#if matrix.envTiers.length > 0}
				<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{matrix.envTiers.length} env{matrix.envTiers.length === 1 ? '' : 's'}</span>
			{/if}
		</div>
	</div>

	{#if query.isLoading}
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			{#each Array(4) as _}
				<div class="flex items-center gap-4 border-t border-gray-100 px-5 py-4 first:border-t-0 dark:border-gray-700/60">
					<div class="h-9 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					<div class="h-9 flex-1 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					<div class="h-9 flex-1 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					<div class="h-9 flex-1 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load environments: {(query.error as Error).message}
		</div>
	{:else if matrix.envTiers.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<div class="text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No environments configured</p>
				<p class="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
					Create <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Environment</code> resources to see apps laid out across env tiers.
				</p>
			</div>
		</div>
	{:else}
		<!-- Apps × env-tier matrix -->
		<div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="grid min-w-max" style="grid-template-columns: {gridTemplateColumns};">
				<!-- Header row -->
				<div class="sticky left-0 z-20 flex items-end border-b border-r border-gray-100 bg-white px-4 py-3 dark:border-gray-700/60 dark:bg-gray-800">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">App</span>
				</div>
				{#each columns as col (col.tier)}
					<div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
						<a
							href="/envs/{encodeURIComponent(col.tier)}"
							class="environment-theme-scope inline-flex items-center gap-1 transition-colors hover:opacity-80"
							style={col.theme ? getEnvironmentThemeStyle(col.theme) : undefined}
						>
							<span class="environment-theme-badge rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">{col.label}</span>
							<ChevronRightOutline class="h-3 w-3 shrink-0 text-gray-300 dark:text-gray-600" />
						</a>
						<p class="mt-1 truncate text-[11px]">
							{#if col.behindCount > 0}
								<span class="text-amber-700 dark:text-amber-400">{col.behindCount} behind</span>
							{:else}
								<span class="text-gray-500 dark:text-gray-400">all current</span>
							{/if}
							{#if col.attnCount > 0}
								<span class="text-red-600 dark:text-red-400"> · {col.attnCount} attn</span>
							{/if}
						</p>
					</div>
				{/each}

				<!-- App rows -->
				{#each rowVMs as row (row.appName)}
					<a
						href="/apps/{encodeURIComponent(row.appName)}"
						class="sticky left-0 z-10 flex min-w-0 flex-col justify-center gap-0.5 border-b border-r border-gray-100 bg-white px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-800 dark:hover:bg-gray-700/30"
					>
						<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{row.title}</span>
						<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{row.appName}</span>
						{#if row.worstLag > 0}
							<span class="truncate text-[11px] text-amber-700 dark:text-amber-400">{row.worstEnvLabel} −{row.worstLag}</span>
						{:else}
							<span class="truncate text-[11px] text-gray-500 dark:text-gray-400">converged</span>
						{/if}
					</a>
					{#each row.cells as cell (cell.tier)}
						<div class="flex flex-col justify-center border-b border-gray-100 px-4 py-3 dark:border-gray-700/60 {cell.vm && cell.vm.behindBy > 0 ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}">
							{#if cell.vm && cell.href}
								<a href={cell.href} class="inline-flex hover:opacity-80">
									<MatrixCell vm={cell.vm} />
								</a>
								{#if cell.timestamp}
									<span class="mt-0.5 truncate font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(cell.timestamp, $now)}>{formatTimeAgoCompact(cell.timestamp, $now)}</span>
								{/if}
							{:else}
								<MatrixCell vm={cell.vm} />
							{/if}
						</div>
					{/each}
				{/each}
			</div>
		</div>

		<!-- Legend -->
		<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-400 dark:text-gray-500">
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-full bg-green-500"></span> healthy
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-full bg-red-500"></span> failed
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-full bg-blue-500"></span> deploying
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600"></span> pending
			</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-sm bg-amber-100 dark:bg-amber-900/40"></span> behind newest
			</span>
		</div>
	{/if}
</div>
