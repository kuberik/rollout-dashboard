<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterError } from '$lib/api/rollouts';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { formatStatusTime, shortenVersion, parseGoDuration } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { derivePipeline, kruiseRolloutsForRollout } from '$lib/pipeline';
	import { rolloutPath } from '$lib/source-dashboard';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import PipelineGlyph from '$lib/components/PipelineGlyph.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import type { Rollout, Environment, Kustomization, KruiseRollout } from '../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const kustomizations = $derived<Kustomization[]>(query.data?.kustomizations?.items || []);
	const kruiseRollouts = $derived<KruiseRollout[]>(query.data?.kruiseRollouts?.items || []);
	const clusterErrors = $derived<ClusterError[]>(query.data?.clusterErrors || []);
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const cards = $derived<RolloutCard[]>(buildRolloutCards(rollouts, environments, $now));

	function href(c: RolloutCard): string {
		return rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name);
	}

	const needsYou = $derived.by<RolloutCard[]>(() => {
		const out = cards.filter((c) => c.statusKey === 'failed' || c.stuck != null);
		return out.sort(
			(a, b) => (a.statusKey === 'failed' ? 0 : 1) - (b.statusKey === 'failed' ? 0 : 1)
		);
	});

	const inMotion = $derived.by<RolloutCard[]>(() => cards.filter((c) => c.isRunning));

	const steadyAll = $derived.by<RolloutCard[]>(() =>
		cards.filter((c) => c.statusKey === 'succeeded' && !c.stuck)
	);
	const STEADY_PREVIEW = 8;
	const steadyPreview = $derived(steadyAll.slice(0, STEADY_PREVIEW));

	const pendingCount = $derived(cards.filter((c) => c.statusKey === 'pending').length);

	const healthPct = $derived(
		cards.length > 0 ? Math.round((steadyAll.length / cards.length) * 100) : 0
	);

	// Downstream promotion target for a rollout: the Environment (of the same
	// app) whose relationship points "After" this env — i.e. the env that
	// deploys next once this one is healthy.
	function nextEnvLabel(c: RolloutCard): string | null {
		if (!c.envName) return null;
		const appName = c.rollout.metadata?.name;
		const next = environments.find(
			(e) =>
				e.spec?.rolloutRef?.name === appName &&
				e.spec?.relationship?.type === 'After' &&
				e.spec?.relationship?.environment === c.envName
		);
		return next?.spec?.environment ? shortEnvLabel(next.spec.environment) : null;
	}

	function bakeProgress(c: RolloutCard): { pct: number | null } {
		if (c.bakeStatus !== 'InProgress') return { pct: null };
		const start = c.rollout.status?.history?.[0]?.bakeStartTime;
		const bakeTime = c.rollout.spec?.bakeTime;
		const total = bakeTime ? parseGoDuration(bakeTime) : 0;
		if (!start || !total) return { pct: null };
		const elapsed = $now.getTime() - new Date(start).getTime();
		return { pct: Math.max(0, Math.min(100, Math.round((elapsed / total) * 100))) };
	}
</script>

<svelte:head>
	<title>kuberik | Control Center</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">
			Control Center
		</h1>
	</div>

	{#if clusterErrors.length > 0}
		<div
			class="mb-4 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/10"
		>
			{#each clusterErrors as ce (ce.name)}
				<div class="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
					<svg
						class="h-3.5 w-3.5 shrink-0"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
							clip-rule="evenodd"
						/>
					</svg>
					<span><span class="font-semibold">{ce.name}</span> unreachable — {ce.error}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-6">
			<div class="h-28 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each [0, 1, 2] as n (n)}
					<div class="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<p class="text-base font-semibold text-gray-900 dark:text-white">No rollouts yet</p>
			<p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
				Once you create <code
					class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code
				> resources, the fleet overview will appear here.
			</p>
		</div>
	{:else}
		<!-- Hero: fleet health + triage counts + 24h deploy volume -->
		<div
			class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="flex flex-wrap items-center justify-between gap-6">
				<div>
					<span
						class="text-[11px] font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
						>Fleet health</span
					>
					<div class="mt-1 flex items-baseline gap-2">
						<span class="font-mono text-4xl font-light text-gray-900 tabular-nums dark:text-white"
							>{healthPct}%</span
						>
						<span class="text-sm text-gray-500 dark:text-gray-400"
							>of {cards.length} rollout{cards.length === 1 ? '' : 's'} healthy</span
						>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<div
						class="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-red-50/60 px-4 py-2 dark:border-gray-700 dark:bg-red-900/10"
					>
						<span class="font-mono text-xl font-light text-red-700 tabular-nums dark:text-red-400"
							>{needsYou.length}</span
						>
						<span
							class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
							>need you</span
						>
					</div>
					<div
						class="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-blue-50/60 px-4 py-2 dark:border-gray-700 dark:bg-blue-900/10"
					>
						<span class="font-mono text-xl font-light text-blue-700 tabular-nums dark:text-blue-400"
							>{inMotion.length}</span
						>
						<span
							class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
							>in motion</span
						>
					</div>
					<div
						class="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-green-50/60 px-4 py-2 dark:border-gray-700 dark:bg-green-900/10"
					>
						<span
							class="font-mono text-xl font-light text-green-700 tabular-nums dark:text-green-400"
							>{steadyAll.length}</span
						>
						<span
							class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
							>steady</span
						>
					</div>
				</div>
				<div class="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
					<span class="font-mono tracking-wider uppercase">deploys · 24h</span>
					<DeployVolumeSparkline {rollouts} hours={24} buckets={24} />
				</div>
			</div>
		</div>

		<!-- Needs you now -->
		{#if needsYou.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">Needs you now</h2>
					<span class="font-mono text-xs text-gray-400 dark:text-gray-500">{needsYou.length}</span>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each needsYou as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						{@const why =
							c.statusKey === 'failed'
								? c.failureCategory
									? `${c.failureCategory} failed`
									: 'deploy failed'
								: c.stuck?.kind === 'baking'
									? 'baking >1h'
									: c.stuck?.kind === 'deploying'
										? 'deploying >1h'
										: `behind ${c.stuck?.peerEnv ?? ''}`}
						<a
							href={href(c)}
							class="environment-theme-scope flex flex-col gap-3 rounded-xl border border-gray-200 bg-red-50/40 p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-red-900/10 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<div class="flex items-center gap-3">
								<span
									class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										c.bakeStatus
									)}"
								>
									<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline gap-2">
										<span class="truncate text-sm font-semibold text-gray-900 dark:text-white"
											>{c.name}</span
										>
										{#if c.stuck}<StuckBadge reason={c.stuck} size="xs" />{/if}
									</div>
									<span class="truncate text-[11px] text-gray-400 dark:text-gray-500">{c.ns}</span>
								</div>
								{#if c.envDisplay}
									<span
										class="environment-theme-badge inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
										>{c.envDisplay}</span
									>
								{/if}
							</div>
							<div class="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
								<span class="truncate">{why}</span>
							</div>
							<div
								class="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-700/60"
							>
								<PipelineGlyph
									summary={derivePipeline(
										c.rollout,
										kruiseRolloutsForRollout(c.rollout, kustomizations, kruiseRollouts)
									)}
								/>
								<span
									class="font-mono text-xs text-gray-600 dark:text-gray-300"
									title={c.version ?? ''}>{c.version ? shortenVersion(c.version) : '—'}</span
								>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- In motion -->
		{#if inMotion.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="relative flex h-2 w-2 shrink-0">
						<span class="absolute inset-0 animate-ping rounded-full bg-blue-400/60"></span>
						<span class="relative h-2 w-2 rounded-full bg-blue-500"></span>
					</span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">In motion</h2>
					<span class="font-mono text-xs text-gray-400 dark:text-gray-500">{inMotion.length}</span>
					<span class="text-xs text-gray-400 dark:text-gray-500"
						>deploying &amp; baking right now</span
					>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each inMotion as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						{@const progress = bakeProgress(c)}
						{@const next = nextEnvLabel(c)}
						<a
							href={href(c)}
							class="environment-theme-scope flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<div class="flex items-center gap-3">
								<span
									class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										c.bakeStatus
									)}"
								>
									<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
								</span>
								<div class="min-w-0 flex-1">
									<span class="truncate text-sm font-semibold text-gray-900 dark:text-white"
										>{c.name}</span
									>
									<span
										class="block truncate font-mono text-[11px] text-gray-400 dark:text-gray-500"
										>{c.version ? shortenVersion(c.version) : '—'}</span
									>
								</div>
								{#if c.envDisplay}
									<span
										class="environment-theme-badge inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
										>{c.envDisplay}</span
									>
								{/if}
							</div>
							<div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
								{#if progress.pct !== null}
									<div
										class="h-full rounded-full bg-yellow-400 transition-[width] duration-700"
										style="width: {progress.pct}%"
									></div>
								{:else}
									<div
										class="h-full w-1/3 animate-pulse rounded-full {c.bakeStatus === 'Deploying'
											? 'bg-blue-400'
											: 'bg-yellow-400'}"
									></div>
								{/if}
							</div>
							<div class="flex items-center justify-between text-xs">
								<span
									class={c.bakeStatus === 'Deploying'
										? 'text-blue-600 dark:text-blue-400'
										: 'text-yellow-700 dark:text-yellow-400'}
								>
									{formatStatusTime(c.bakeStatus, c.timestamp, $now)}{progress.pct !== null
										? ` · ${progress.pct}%`
										: ''}
								</span>
								{#if next}
									<span class="text-gray-400 dark:text-gray-500"
										>next: <span class="font-medium text-gray-600 dark:text-gray-300">{next}</span
										></span
									>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Steady -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<span class="h-2 w-2 shrink-0 rounded-full bg-green-500"></span>
				<h2 class="text-base font-semibold text-gray-900 dark:text-white">Steady</h2>
				<span class="font-mono text-xs text-gray-400 dark:text-gray-500">{steadyAll.length}</span>
				{#if pendingCount > 0}
					<span class="text-xs text-gray-400 dark:text-gray-500">· {pendingCount} pending</span>
				{/if}
				<a
					href="/rollouts"
					class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline dark:text-green-400"
				>
					View all rollouts <ChevronRightOutline class="h-3 w-3" />
				</a>
			</div>
			{#if steadyAll.length === 0}
				<p class="text-sm text-gray-400 dark:text-gray-500">No healthy rollouts yet.</p>
			{:else}
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each steadyPreview as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<a
							href={href(c)}
							class="environment-theme-scope flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<span
								class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
									c.bakeStatus
								)}"
							>
								<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
							</span>
							<span
								class="min-w-0 flex-1 truncate text-xs font-medium text-gray-900 dark:text-white"
								>{c.name}</span
							>
							{#if c.envDisplay}
								<span
									class="environment-theme-badge inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
									>{c.envDisplay}</span
								>
							{/if}
							<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400"
								>{c.version ? shortenVersion(c.version) : '—'}</span
							>
						</a>
					{/each}
				</div>
				{#if steadyAll.length > steadyPreview.length}
					<a
						href="/rollouts"
						class="mt-2 inline-block text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
					>
						+{steadyAll.length - steadyPreview.length} more in the full rollouts list
					</a>
				{/if}
			{/if}
		</section>
	{/if}
</div>
