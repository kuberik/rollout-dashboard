<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact, detectStuck, detectStuckBehind } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { Spinner } from 'flowbite-svelte';
	import { CheckOutline, RefreshOutline, HourglassOutline, CloseOutline, ExclamationCircleOutline } from 'flowbite-svelte-icons';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import AppVelocityCard from '$lib/components/AppVelocityCard.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
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
			const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env)) || null;
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
			return a.name.localeCompare(b.name);
		});
	});

	// Returns the worst stuck reason across this app's cells, or null.
	// Cell-level: baking-too-long, or behind upstream env for too long.
	function appStuckReason(a: AppSummary, refNow: Date): StuckReason | null {
		let worst: StuckReason | null = null;
		for (const c of a.cells) {
			const own = detectStuck(c.rollout, { now: refNow });
			if (own && (!worst || stuckPriority(own) > stuckPriority(worst))) worst = own;
			for (const peer of a.cells) {
				if (peer === c) continue;
				const r = detectStuckBehind(c.rollout, peer.rollout, peer.envName, { now: refNow });
				if (r && (!worst || stuckPriority(r) > stuckPriority(worst))) worst = r;
			}
		}
		return worst;
	}
	function stuckPriority(r: StuckReason): number {
		if (r.kind === 'baking' || r.kind === 'deploying') return 2;
		return 1;
	}

	// Apps that need user attention — failed or stuck. Surfaced as a
	// compact strip above the main list when there are issues.
	type AttentionItem = { app: AppSummary; reason: 'failed' | 'stuck'; detail: string };
	const attentionItems = $derived.by<AttentionItem[]>(() => {
		const refNow = $now;
		const out: AttentionItem[] = [];
		for (const a of apps) {
			if (a.failedCount > 0) {
				out.push({ app: a, reason: 'failed', detail: `${a.failedCount} env${a.failedCount === 1 ? '' : 's'} failing` });
			} else {
				const r = appStuckReason(a, refNow);
				if (r) {
					const detail = r.kind === 'baking'
						? 'baking >1h'
						: r.kind === 'deploying'
							? 'deploying >1h'
							: `behind ${r.peerEnv}`;
					out.push({ app: a, reason: 'stuck', detail });
				}
			}
		}
		return out.sort((x, y) => (x.reason === 'failed' ? 0 : 1) - (y.reason === 'failed' ? 0 : 1)).slice(0, 6);
	});

	// Fleet roll-up
	const fleetTotals = $derived.by(() => {
		let failed = 0, active = 0, stuck = 0, pending = 0, healthy = 0;
		for (const a of apps) {
			if (a.failedCount > 0) failed++;
			else if (a.activeCount > 0) active++;
			else if (appStuckReason(a, $now)) stuck++;
			else if (a.deployedCount < a.envCount) pending++;
			else healthy++;
		}
		return { failed, active, stuck, pending, healthy };
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
	type AppStatus = 'failed' | 'active' | 'stuck' | 'pending' | 'healthy';
	function appStatusKey(a: AppSummary, refNow: Date): AppStatus {
		if (a.failedCount > 0) return 'failed';
		if (a.activeCount > 0) return 'active';
		if (appStuckReason(a, refNow)) return 'stuck';
		if (a.deployedCount < a.envCount) return 'pending';
		return 'healthy';
	}

	let statusFilters = $state<AppStatus[]>([]);

	function toggleStatus(k: AppStatus) {
		statusFilters = statusFilters.includes(k)
			? statusFilters.filter((x) => x !== k)
			: [...statusFilters, k];
	}
	function clearFilters() {
		statusFilters = [];
	}

	const filteredApps = $derived.by(() => {
		const refNow = $now;
		return apps.filter((a) => {
			if (statusFilters.length > 0 && !statusFilters.includes(appStatusKey(a, refNow))) return false;
			return true;
		});
	});
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">Apps</h1>
		<div class="flex items-center gap-3">
			{#if apps.length > 0 && fleetNewestDeploy}
				<span class="hidden items-center gap-2 text-xs text-gray-400 dark:text-gray-500 sm:inline-flex" title={`Newest deploy ${formatTimeAgo(fleetNewestDeploy, $now)}`}>
					<span>last deploy {formatTimeAgoCompact(fleetNewestDeploy, $now)}</span>
					<DeployVolumeSparkline {rollouts} />
				</span>
			{/if}
			
		</div>
	</div>

	<!-- Stat tiles: each tile gets its own static, semantically distinct
	     icon. The previous BakeStatusIcon reuse made the zero tiles look
	     identical (all pause icons), and "stuck" had to special-case its
	     own SVG. Inlining keeps the tile semantics obvious. -->
	{#if apps.length > 0}
		{@const tiles = [
			{ key: 'healthy' as AppStatus, label: 'Healthy', count: fleetTotals.healthy, bake: 'Succeeded', icon: CheckOutline, iconTone: 'text-green-600 dark:text-green-400' },
			{ key: 'active' as AppStatus, label: 'In progress', count: fleetTotals.active, bake: 'Deploying', icon: RefreshOutline, iconTone: 'text-blue-600 dark:text-blue-400' },
			{ key: 'stuck' as AppStatus, label: 'Stuck', count: fleetTotals.stuck, bake: 'InProgress', icon: ExclamationCircleOutline, iconTone: 'text-amber-600 dark:text-amber-400' },
			{ key: 'pending' as AppStatus, label: 'Pending', count: fleetTotals.pending, bake: 'None', icon: HourglassOutline, iconTone: 'text-gray-500 dark:text-gray-400' },
			{ key: 'failed' as AppStatus, label: 'Failed', count: fleetTotals.failed, bake: 'Failed', icon: CloseOutline, iconTone: 'text-red-600 dark:text-red-400' }
		]}
		<div class="mb-4 grid gap-2 grid-cols-2 sm:grid-cols-5">
			{#each tiles as t}
				{@const sel = statusFilters.includes(t.key)}
				{@const isZero = t.count === 0}
				<button
					type="button"
					onclick={() => !isZero && toggleStatus(t.key)}
					aria-pressed={sel}
					disabled={isZero}
					class="group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-2.5 text-left shadow-sm transition-all dark:bg-gray-800
						{sel
							? 'border-gray-900 ring-1 ring-gray-900 dark:border-white dark:ring-white'
							: isZero
								? 'border-gray-100 dark:border-gray-800'
								: 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}"
				>
					<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {isZero ? 'bg-gray-50 dark:bg-gray-700/30' : (t.key === 'stuck' ? 'bg-amber-100 dark:bg-amber-900/30' : getStatusCircleClass(t.bake))}">
						<t.icon class="h-5 w-5 {isZero ? 'text-gray-300 dark:text-gray-600' : t.iconTone}" />
					</span>
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="font-mono text-2xl font-light tabular-nums leading-none {isZero ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'}">{t.count}</span>
						<span class="mt-1 truncate text-[11px] uppercase tracking-wider {isZero ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'}">{t.label}</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}


	{#if query.isLoading}
		<!-- Skeleton mirrors the list-of-rows shape -->
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each Array(6) as _}
					<li class="flex items-center gap-5 px-5 py-4">
						<div class="flex flex-1 items-center gap-3">
							<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
							<div class="flex flex-col gap-1.5">
								<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
							</div>
						</div>
						<div class="hidden gap-3 sm:flex">
							{#each Array(3) as _}
								<div class="h-4 w-20 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if apps.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<!-- Faded sample card: shows what an app card will look like -->
			<div class="pointer-events-none relative mx-auto w-full max-w-sm select-none opacity-60 grayscale" aria-hidden="true">
				<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class="inline-flex h-9 w-9 items-center justify-center rounded-full {getStatusCircleClass('Succeeded')}">
								<BakeStatusIcon bakeStatus="Succeeded" size="medium" />
							</span>
							<div class="flex flex-col">
								<span class="text-base font-bold text-gray-900 dark:text-white">My App</span>
								<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">my-app</span>
							</div>
						</div>
					</div>
					<div class="mt-2 flex flex-wrap gap-2 pl-12">
						{#each [{ env: 'DEV', v: 'v1.3' }, { env: 'STAGE', v: 'v1.2' }, { env: 'PROD', v: 'v1.2' }] as cell}
							<div class="inline-flex items-baseline gap-1">
								<span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider dark:bg-gray-700">
									<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
									<span>{cell.env}</span>
								</span>
								<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400">{cell.v}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
			<div class="mt-8 text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No apps yet</p>
				<p class="mt-2 mx-auto max-w-md text-sm text-gray-500 dark:text-gray-400">
					An app appears here once you bind a <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code> to an <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Environment</code> resource. Apps consolidate the same rollout across all environments.
				</p>
			</div>
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
		{#if attentionItems.length > 0 && statusFilters.length === 0}
			{@const failedCount = attentionItems.filter((i) => i.reason === 'failed').length}
			{@const stuckCount = attentionItems.filter((i) => i.reason === 'stuck').length}
			<!-- Loud needs-attention hero. Red when failures, amber when only stuck. -->
			<div class="mb-6 overflow-hidden rounded-xl border-2 {failedCount > 0
				? 'border-red-300 bg-red-50/60 dark:border-red-700/60 dark:bg-red-900/15'
				: 'border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-900/15'} shadow-sm">
				<div class="flex items-center gap-3 px-5 py-3">
					<span class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full {failedCount > 0
						? 'bg-red-100 dark:bg-red-900/40'
						: 'bg-amber-100 dark:bg-amber-900/40'}">
						<span class="absolute inset-0 animate-ping rounded-full {failedCount > 0 ? 'bg-red-400/40' : 'bg-amber-400/40'}"></span>
						<svg class="relative h-5 w-5 {failedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
						</svg>
					</span>
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="text-sm font-semibold {failedCount > 0 ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'}">
							{#if failedCount > 0}{failedCount} {failedCount === 1 ? 'app has' : 'apps have'} failures{#if stuckCount > 0}, {stuckCount} stuck{/if}
							{:else}{stuckCount} {stuckCount === 1 ? 'app is' : 'apps are'} stuck{/if}
						</span>
						<span class="text-xs {failedCount > 0 ? 'text-red-700/80 dark:text-red-300/80' : 'text-amber-700/80 dark:text-amber-300/80'}">Click to jump to the app.</span>
					</div>
				</div>
				<ul class="divide-y {failedCount > 0 ? 'divide-red-200/60 dark:divide-red-800/40' : 'divide-amber-200/60 dark:divide-amber-800/40'}">
					{#each attentionItems as item}
						{@const a = item.app}
						{@const bake = item.reason === 'failed' ? 'Failed' : 'InProgress'}
						<li>
							<a
								href="/apps/{a.name}"
								class="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/60 dark:hover:bg-gray-800/60"
							>
								<span class="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(bake)}">
									<BakeStatusIcon bakeStatus={bake} size="small" />
								</span>
								<div class="flex min-w-0 flex-1 items-baseline gap-2">
									<span class="truncate text-sm font-medium text-gray-900 dark:text-white">{a.name}</span>
									<span class="truncate text-xs {failedCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}">· {item.detail}</span>
								</div>
								<span class="shrink-0 font-mono text-[10px] text-gray-500 dark:text-gray-400">{a.envCount} env{a.envCount === 1 ? '' : 's'}</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<!-- Velocity cards: per-app card with header + lane chart + legend.
		     2-up on md+, single column on mobile. Lane chart shows per-env
		     deploy history with stable per-version palette so drift reads
		     visually; "newest" rank in mint, "−N" rank in neutral gray. -->
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			{#each filteredApps as app (app.name)}
				<AppVelocityCard title={app.title} name={app.name} cells={app.cells} refNow={$now} />
			{/each}
		</div>
	{/if}
</div>
