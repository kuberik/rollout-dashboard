<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		ArrowRightOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		LayersSolid,
		ChevronRightOutline,
		RocketOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../../types';

	const appName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type Cell = {
		envName: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	const cells = $derived.by<Cell[]>(() => {
		const envObjs = environments.filter((e) => e.spec?.rolloutRef?.name === appName);
		const result: Cell[] = envObjs.map((env) => {
			const envName = env.spec?.environment || '';
			const rollout =
				rollouts.find(
					(r) =>
						r.metadata?.name === appName && r.metadata?.namespace === env.metadata?.namespace
				) || null;
			const theme = rollout ? getRolloutEnvironmentTheme(rollout, env) : null;
			return { envName, environment: env, rollout, theme };
		});
		return result.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	});

	const appTitle = $derived.by(() => {
		for (const c of cells) {
			if (c.rollout?.status?.title) return c.rollout.status.title;
		}
		return appName;
	});

	const appDescription = $derived.by(() => {
		for (const c of cells) {
			if (c.rollout?.status?.description && c.rollout.status.description !== c.rollout.status.title) {
				return c.rollout.status.description;
			}
		}
		return null;
	});

	type ActivityEntry = {
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		timestamp: string;
		bakeStatus: string;
		rollout: Rollout;
		ns: string;
		entryId: number;
	};

	const allActivity = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const cell of cells) {
			if (!cell.rollout?.status?.history) continue;
			for (const entry of cell.rollout.status.history) {
				list.push({
					envName: cell.envName,
					theme: cell.theme,
					version: getDisplayVersion(entry.version),
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None',
					rollout: cell.rollout,
					ns: cell.rollout.metadata?.namespace || '',
					entryId: entry.id ?? 0
				});
			}
		}
		return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	});

	const recentActivity = $derived(allActivity.slice(0, 12));

	// Version map: for each version, where is it deployed (history[0]) and where else does it appear in history
	type VersionLifecycle = {
		version: string;
		current: { envName: string; cell: Cell; bakeStatus: string; timestamp: string }[];
		past: { envName: string; cell: Cell; timestamp: string }[];
	};

	const versionLifecycles = $derived.by<VersionLifecycle[]>(() => {
		const map = new Map<string, VersionLifecycle>();
		for (const c of cells) {
			const h = c.rollout?.status?.history;
			if (!h || h.length === 0) continue;
			const current = h[0];
			const currentVer = getDisplayVersion(current.version);
			if (!map.has(currentVer)) map.set(currentVer, { version: currentVer, current: [], past: [] });
			map.get(currentVer)!.current.push({
				envName: c.envName,
				cell: c,
				bakeStatus: current.bakeStatus || 'None',
				timestamp: current.timestamp
			});
			for (let i = 1; i < h.length; i++) {
				const pastVer = getDisplayVersion(h[i].version);
				if (!map.has(pastVer)) map.set(pastVer, { version: pastVer, current: [], past: [] });
				map.get(pastVer)!.past.push({ envName: c.envName, cell: c, timestamp: h[i].timestamp });
			}
		}
		const out = [...map.values()];
		// Sort by the most-recent timestamp anywhere in the version's lifecycle, newest first.
		return out.sort((a, b) => {
			const at = Math.max(
				...a.current.map((c) => new Date(c.timestamp).getTime()),
				...a.past.map((p) => new Date(p.timestamp).getTime()),
				0
			);
			const bt = Math.max(
				...b.current.map((c) => new Date(c.timestamp).getTime()),
				...b.past.map((p) => new Date(p.timestamp).getTime()),
				0
			);
			return bt - at;
		});
	});

	// Drift = different "current" versions across environments
	const currentVersions = $derived.by(() => {
		const set = new Set<string>();
		for (const c of cells) {
			const v = c.rollout?.status?.history?.[0]?.version;
			if (v) set.add(getDisplayVersion(v));
		}
		return [...set];
	});
	const deployedCellCount = $derived(
		cells.filter((c) => c.rollout?.status?.history?.[0]).length
	);
	const undeployedCount = $derived(cells.length - deployedCellCount);

	const hasDrift = $derived(currentVersions.length > 1);
	const allInSync = $derived(
		currentVersions.length === 1 && cells.length > 1 && undeployedCount === 0
	);

	// Promotion candidates: versions deployed in an earlier-tier env but not yet the latest env
	// (used to nudge "ready to promote v1.5 from dev → prod")
	type PromotionHint = {
		version: string;
		fromEnv: string;
		toEnv: string;
		fromCell: Cell;
		toCell: Cell;
	};

	const promotionHints = $derived.by<PromotionHint[]>(() => {
		if (cells.length < 2) return [];
		const hints: PromotionHint[] = [];
		for (let i = 0; i < cells.length - 1; i++) {
			const earlier = cells[i];
			const later = cells[i + 1];
			const earlierV = earlier.rollout?.status?.history?.[0]?.version;
			const laterV = later.rollout?.status?.history?.[0]?.version;
			if (!earlierV || !laterV) continue;
			const ev = getDisplayVersion(earlierV);
			const lv = getDisplayVersion(laterV);
			if (ev !== lv && earlier.rollout?.status?.history?.[0]?.bakeStatus === 'Succeeded') {
				hints.push({
					version: ev,
					fromEnv: earlier.envName,
					toEnv: later.envName,
					fromCell: earlier,
					toCell: later
				});
			}
		}
		return hints;
	});

	// Status helpers
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
		None: '—'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600'
	};

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	const failedCount = $derived(
		cells.filter((c) => c.rollout?.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		cells.filter((c) => {
			const s = c.rollout?.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
</script>

<svelte:head>
	<title>kuberik | {appTitle}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Breadcrumb / back -->
	<div class="mb-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
		<a href="/environments" class="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
			<ArrowLeftOutline class="h-3 w-3" />
			Environments
		</a>
		<ChevronRightOutline class="h-3 w-3 text-gray-300 dark:text-gray-600" />
		<span>App</span>
	</div>

	{#if query.isLoading}
		<div class="space-y-4">
			<div class="h-14 w-2/3 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-44 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if cells.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">App not found</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				No <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">Environment</code>
				resources reference <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">{appName}</code>.
			</p>
			<a
				href="/environments"
				class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			>
				<ArrowLeftOutline class="h-3.5 w-3.5" /> Back to environments
			</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="mb-6 flex items-start justify-between gap-4">
			<div class="min-w-0">
				<h1 class="truncate text-2xl font-light text-gray-900 dark:text-white">{appTitle}</h1>
				<div class="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
					<code class="font-mono">{appName}</code>
					<span class="text-gray-300 dark:text-gray-600">·</span>
					<span>{cells.length} environment{cells.length === 1 ? '' : 's'}</span>
				</div>
				{#if appDescription}
					<p class="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">{appDescription}</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-3">
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
					{#if failedCount === 0 && activeCount === 0 && allInSync}
						<span class="flex items-center gap-1 text-green-600 dark:text-green-400">
							<CheckCircleSolid class="h-3.5 w-3.5" />In sync
						</span>
					{:else if failedCount === 0 && activeCount === 0 && hasDrift}
						<span class="flex items-center gap-1 font-medium text-orange-600 dark:text-orange-400">
							<span class="h-2 w-2 rounded-full bg-orange-500"></span>{currentVersions.length} versions live
						</span>
					{:else if failedCount === 0 && activeCount === 0 && undeployedCount > 0}
						<span class="flex items-center gap-1 font-medium text-gray-500 dark:text-gray-400">
							<span class="h-2 w-2 rounded-full bg-gray-400"></span>{undeployedCount} env{undeployedCount === 1 ? '' : 's'} pending
						</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Promotion flow -->
		<section class="mb-8">
			<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				Promotion flow
			</h2>
			<div class="flex flex-wrap items-stretch gap-3">
				{#each cells as cell, idx}
					{@const latest = cell.rollout?.status?.history?.[0]}
					{@const status = latest?.bakeStatus || 'None'}
					<a
						href={cell.rollout
							? `/rollouts/${cell.rollout.metadata?.namespace}/${cell.rollout.metadata?.name}`
							: '#'}
						class="environment-theme-scope group flex min-w-[180px] flex-1 flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
						style={cell.theme ? getEnvironmentThemeStyle(cell.theme) : undefined}
					>
						<div class="flex items-center justify-between gap-2">
							<span
								class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider {cell.theme
									? ''
									: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}"
							>{cell.envName}</span>
							<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">{cell.rollout?.metadata?.namespace ?? ''}</span>
						</div>
						{#if latest}
							<div class="mt-3 flex items-center gap-2">
								<span class="relative flex h-2 w-2 shrink-0">
									{#if isRunning(status)}
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[status]}"></span>
									{/if}
									<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[status] ?? STATUS_DOT.None}"></span>
								</span>
								<span class="truncate font-mono text-sm font-medium text-gray-900 dark:text-white">
									{getDisplayVersion(latest.version)}
								</span>
							</div>
							<div class="mt-1 flex items-center justify-between gap-2 pl-4">
								<span class="text-[11px] font-medium {STATUS_TEXT[status] ?? STATUS_TEXT.None}">{STATUS_LABEL[status]}</span>
								{#if latest?.timestamp}
									<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(latest.timestamp, $now)}>
										{formatTimeAgoCompact(latest.timestamp, $now)}
									</span>
								{/if}
							</div>
						{:else}
							<div class="mt-3 flex items-center gap-2 text-gray-400 dark:text-gray-500">
								<span class="h-2 w-2 shrink-0 rounded-full border border-dashed border-gray-300 dark:border-gray-600"></span>
								<span class="font-mono text-[11px]">awaiting first deploy</span>
							</div>
							<div class="mt-1 pl-4 text-[11px] text-gray-400 dark:text-gray-500">no version</div>
						{/if}
					</a>
					{#if idx < cells.length - 1}
						<div class="hidden items-center text-gray-300 dark:text-gray-600 sm:flex" aria-hidden="true">
							<ArrowRightOutline class="h-4 w-4" />
						</div>
					{/if}
				{/each}
			</div>
		</section>

		{#if promotionHints.length > 0}
			<section class="mb-8">
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Promotion candidates
				</h2>
				<div class="space-y-2">
					{#each promotionHints as hint}
						<a
							href={hint.toCell.rollout
								? `/rollouts/${hint.toCell.rollout.metadata?.namespace}/${hint.toCell.rollout.metadata?.name}`
								: '#'}
							class="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm transition-colors hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/10 dark:hover:bg-blue-900/20"
						>
							<div class="flex items-center gap-2 text-blue-900 dark:text-blue-200">
								<RocketOutline class="h-4 w-4 shrink-0" />
								<span>
									<span class="font-mono font-semibold">{hint.version}</span>
									is succeeded on
									<span class="font-semibold">{hint.fromEnv}</span>
									and could move to
									<span class="font-semibold">{hint.toEnv}</span>
								</span>
							</div>
							<ChevronRightOutline class="h-4 w-4 text-blue-500 dark:text-blue-400" />
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<div class="grid gap-6 lg:grid-cols-5">
			<!-- Version lifecycle -->
			<section class="lg:col-span-3">
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Version lifecycle
				</h2>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each versionLifecycles.slice(0, 8) as v}
							<li class="px-4 py-3">
								<div class="flex items-baseline justify-between gap-2">
									<span class="font-mono text-sm font-medium text-gray-900 dark:text-white">{v.version}</span>
									{#if v.current.length === 0 && v.past.length > 0}
										<span class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">historical</span>
									{/if}
								</div>
								<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
									{#each v.current as cur}
										<span
											class="environment-theme-scope inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium dark:bg-gray-700/60"
											style={cur.cell.theme ? getEnvironmentThemeStyle(cur.cell.theme) : undefined}
										>
											<span class="relative flex h-1.5 w-1.5">
												{#if isRunning(cur.bakeStatus)}
													<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[cur.bakeStatus]}"></span>
												{/if}
												<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[cur.bakeStatus] ?? STATUS_DOT.None}"></span>
											</span>
											<span class="environment-theme-text uppercase tracking-wider text-gray-700 dark:text-gray-300">{cur.envName}</span>
										</span>
									{/each}
									{#each v.past.slice(0, 4) as p}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-600/50 dark:text-gray-500"
											title="Previously on {p.envName} at {p.timestamp}"
										>
											<span class="uppercase tracking-wider">{p.envName}</span>
											<span class="font-mono text-[9px]">{formatTimeAgoCompact(p.timestamp, $now)}</span>
										</span>
									{/each}
									{#if v.past.length > 4}
										<span class="text-[10px] text-gray-400 dark:text-gray-500">+{v.past.length - 4}</span>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<!-- Activity feed (right rail) -->
			<section class="lg:col-span-2">
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Recent activity
				</h2>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					{#if recentActivity.length === 0}
						<div class="p-4 text-sm text-gray-500 dark:text-gray-400">No deployment history.</div>
					{:else}
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each recentActivity as a}
								<li class="environment-theme-scope px-4 py-2.5 text-sm" style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}>
									<div class="flex items-center justify-between gap-2">
										<div class="flex min-w-0 items-center gap-2">
											<span class="environment-theme-badge shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-gray-700 dark:bg-gray-700/60 dark:text-gray-300">{a.envName || 'no-env'}</span>
											<span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">{a.version}</span>
										</div>
										<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
											{formatTimeAgoCompact(a.timestamp, $now)}
										</span>
									</div>
									<div class="pl-2 mt-0.5 flex items-center gap-1.5">
										<span class="relative flex h-1.5 w-1.5">
											{#if isRunning(a.bakeStatus)}
												<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[a.bakeStatus]}"></span>
											{/if}
											<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[a.bakeStatus] ?? STATUS_DOT.None}"></span>
										</span>
										<span class="text-[10px] {STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[a.bakeStatus]}</span>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
		</div>
	{/if}
</div>

