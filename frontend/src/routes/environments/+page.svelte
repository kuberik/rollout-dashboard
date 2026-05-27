<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceDashboardURL, withDashboardParam } from '$lib/source-dashboard';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure, compareRollouts, detectStuck, detectStuckBehind } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterURL = $derived<string>(clusterQuery.data?.url || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type Cell = { rollout: Rollout; env: Environment; theme: ReturnType<typeof getRolloutEnvironmentTheme> | null };
	type EnvSection = {
		envName: string;
		envLabel: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		cells: { appName: string; appTitle: string; cell: Cell }[];
		healthy: number;
		active: number;
		failed: number;
		stuck: number;
		deploys24h: number;
		rollouts: Rollout[];
	};

	const envSections = $derived.by<EnvSection[]>(() => {
		const map = new Map<string, EnvSection>();
		for (const env of environments) {
			const envName = env.spec?.environment;
			if (!envName) continue;
			const appName = env.spec?.rolloutRef?.name;
			if (!appName) continue;
			const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
			if (!r) continue;
			const theme = getRolloutEnvironmentTheme(r, env);
			let s = map.get(envName);
			if (!s) {
				s = {
					envName,
					envLabel: shortEnvLabel(theme) || envName,
					theme,
					cells: [],
					healthy: 0,
					active: 0,
					failed: 0,
					stuck: 0,
					deploys24h: 0,
					rollouts: []
				};
				map.set(envName, s);
			}
			const appTitle = r.status?.title || appName;
			s.cells.push({ appName, appTitle, cell: { rollout: r, env, theme } });
			s.rollouts.push(r);
		}
		// Compute counters using $now snapshot
		const refNow = $now;
		const cutoff = refNow.getTime() - 24 * 60 * 60 * 1000;
		for (const s of map.values()) {
			s.cells.sort((a, b) => a.appTitle.localeCompare(b.appTitle));
			for (const { cell } of s.cells) {
				const status = cell.rollout.status?.history?.[0]?.bakeStatus;
				if (status === 'Succeeded') s.healthy++;
				else if (status === 'Failed') s.failed++;
				else if (status === 'InProgress' || status === 'Deploying') s.active++;
				const own = detectStuck(cell.rollout, { now: refNow });
				if (own) s.stuck++;
				for (const h of cell.rollout.status?.history ?? []) {
					if (!h.timestamp) continue;
					if (new Date(h.timestamp).getTime() >= cutoff) s.deploys24h++;
				}
			}
		}
		return [...map.values()].sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	});

	function deployHistoryStrip(r: Rollout): { status: string; key: string }[] {
		const history = (r.status?.history ?? []).slice(0, 6);
		const out: { status: string; key: string }[] = [];
		for (let i = 0; i < 6; i++) {
			const h = history[i];
			out.push({ status: h?.bakeStatus ?? '', key: `${i}-${h?.id ?? 'empty'}` });
		}
		return out.reverse(); // oldest left → newest right
	}

	function dotBg(status: string): string {
		switch (status) {
			case 'Succeeded': return 'bg-green-500';
			case 'Failed': return 'bg-red-500';
			case 'InProgress': return 'bg-yellow-400';
			case 'Deploying': return 'bg-blue-500';
			case 'Cancelled': return 'bg-gray-400';
			default: return 'bg-gray-200 dark:bg-gray-700';
		}
	}

	function summaryLine(r: Rollout): string {
		const latest = r.status?.history?.[0];
		const status = latest?.bakeStatus || 'None';
		if (status === 'Failed') return 'last deploy failed';
		if (status === 'Deploying') return 'currently deploying';
		if (status === 'InProgress') return 'baking';
		const history = (r.status?.history ?? []).slice(0, 6);
		const failures = history.filter((h) => h.bakeStatus === 'Failed').length;
		if (failures > 0) return `${failures}/${history.length} failed`;
		if (history.length === 0) return 'no deploys';
		return 'all recent succeeded';
	}

	function summaryClass(r: Rollout): string {
		const latest = r.status?.history?.[0];
		const status = latest?.bakeStatus || 'None';
		if (status === 'Failed') return 'text-red-600 dark:text-red-400';
		if (status === 'InProgress' || status === 'Deploying') return 'text-yellow-700 dark:text-yellow-400';
		const failures = (r.status?.history ?? []).slice(0, 6).filter((h) => h.bakeStatus === 'Failed').length;
		if (failures > 0) return 'text-amber-700 dark:text-amber-400';
		return 'text-gray-500 dark:text-gray-400';
	}

	// "was vX": prev distinct version from history
	function prevVersionFor(r: Rollout): string | null {
		const history = r.status?.history ?? [];
		const current = history[0]?.version;
		const currentV = current ? getDisplayVersion(current) : null;
		for (const h of history.slice(1)) {
			const v = getDisplayVersion(h.version);
			if (v && v !== currentV) return v;
		}
		return null;
	}

	function appStuckFor(appName: string, envName: string, section: EnvSection, refNow: Date): StuckReason | null {
		const me = section.cells.find((c) => c.appName === appName)?.cell.rollout;
		if (!me) return null;
		const own = detectStuck(me, { now: refNow });
		if (own) return own;
		// behind another env? walk all envs for this app
		for (const peerSec of envSections) {
			if (peerSec.envName === envName) continue;
			const peer = peerSec.cells.find((c) => c.appName === appName)?.cell.rollout;
			if (!peer) continue;
			const r = detectStuckBehind(me, peer, peerSec.envName, { now: refNow });
			if (r) return r;
		}
		return null;
	}
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-6 flex items-baseline justify-between gap-3">
		<div class="flex items-baseline gap-3">
			<h1 class="truncate text-2xl font-light text-gray-900 dark:text-white">Environments</h1>
			{#if envSections.length > 0}
				<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{envSections.length} env{envSections.length === 1 ? '' : 's'}</span>
			{/if}
		</div>
		
	</div>

	{#if query.isLoading}
		<div class="space-y-4">
			{#each Array(2) as _}
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-700/60">
						<div class="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					{#each Array(3) as _}
						<div class="flex items-center gap-4 border-t border-gray-100 px-5 py-4 dark:border-gray-700/60">
							<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
							<div class="flex flex-1 flex-col gap-1.5">
								<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
							</div>
							<div class="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load environments: {(query.error as Error).message}
		</div>
	{:else if envSections.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<div class="text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No environments configured</p>
				<p class="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
					Create <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Environment</code> resources to see app deploy status grouped by env.
				</p>
			</div>
		</div>
	{:else}
		<!-- Stacked env sections -->
		<div class="flex flex-col gap-4">
			{#each envSections as s (s.envName)}
				<section
					class="environment-theme-scope overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
					style={s.theme ? getEnvironmentThemeStyle(s.theme) : undefined}
				>
					<!-- Header row -->
					<a
						href="/envs/{encodeURIComponent(s.envName)}"
						class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-gray-100 px-5 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/30"
					>
						<div class="flex min-w-0 items-center gap-3">
							<span class="environment-theme-badge shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">{s.envLabel}</span>
							<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{s.envName}</span>
						</div>
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
							<span class="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
								<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
								<span class="font-mono tabular-nums">{s.healthy}</span> healthy
							</span>
							{#if s.active > 0}
								<span class="inline-flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400">
									<span class="h-1.5 w-1.5 rounded-full bg-yellow-400"></span>
									<span class="font-mono tabular-nums">{s.active}</span> active
								</span>
							{/if}
							{#if s.failed > 0}
								<span class="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
									<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
									<span class="font-mono tabular-nums">{s.failed}</span> failing
								</span>
							{/if}
							{#if s.stuck > 0}
								<span class="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
									<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
									<span class="font-mono tabular-nums">{s.stuck}</span> stuck
								</span>
							{/if}
							<span class="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400">
								<DeployVolumeSparkline rollouts={s.rollouts} hours={24} />
								<span class="font-mono tabular-nums">{s.deploys24h}/24h</span>
							</span>
							<span class="font-mono tabular-nums text-gray-500 dark:text-gray-400">· {s.cells.length} app{s.cells.length === 1 ? '' : 's'}</span>
						</div>
					</a>

					<!-- App rows -->
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each s.cells as { appName, appTitle, cell } (appName)}
							{@const r = cell.rollout}
							{@const detailHref = withDashboardParam(`/rollouts/${r.metadata?.namespace}/${r.metadata?.name}`, sourceDashboardURL(cell.env), localClusterURL)}
							{@const latest = r.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							{@const failureCategory = status === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null}
							{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
							{@const prevV = prevVersionFor(r)}
							{@const strip = deployHistoryStrip(r)}
							{@const stuck = appStuckFor(appName, s.envName, s, $now)}
							{@const isRunning = status === 'InProgress' || status === 'Deploying'}
							<li>
								<a
									href={detailHref}
									class="grid items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
									style="grid-template-columns: 36px minmax(0, 1.5fr) 180px 110px 60px;"
								>
									<!-- Status circle. No animate-ping halo — icon (pulse for
									     bake, spinner for deploy) is the running indicator. -->
									<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
										<BakeStatusIcon bakeStatus={status} size="medium" />
									</span>

									<!-- Title + name + status chip + "was vX" -->
									<div class="flex min-w-0 flex-col gap-0.5">
										<div class="flex min-w-0 items-baseline gap-2">
											<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{appTitle}</span>
											{#if stuck}<StuckBadge reason={stuck} size="xs" />{/if}
											{#if status === 'Succeeded' && !stuck}
												<span class="inline-flex shrink-0 items-center rounded border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">healthy</span>
											{:else if status === 'Failed'}
												<span class="inline-flex shrink-0 items-center rounded border border-red-300 bg-red-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-red-700 dark:border-red-700/60 dark:bg-red-900/30 dark:text-red-300">failing</span>
											{:else if status === 'Deploying'}
												<span class="inline-flex shrink-0 items-center rounded border border-blue-300 bg-blue-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-700/60 dark:bg-blue-900/30 dark:text-blue-300">deploying</span>
											{:else if status === 'InProgress'}
												<span class="inline-flex shrink-0 items-center rounded border border-yellow-300 bg-yellow-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-yellow-700 dark:border-yellow-700/60 dark:bg-yellow-900/30 dark:text-yellow-300">baking</span>
											{:else if status === 'None'}
												<span class="inline-flex shrink-0 items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-400">pending</span>
											{/if}
										</div>
										<div class="flex min-w-0 items-baseline gap-2">
											<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{appName}</span>
											{#if prevV}
												<span class="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">· was <span class="line-through">{prevV}</span></span>
											{/if}
											{#if failureCategory}
												<span class="truncate text-[10px] text-red-600 dark:text-red-400" title={latest?.bakeStatusMessage ?? ''}>· {failureCategory} failed</span>
											{/if}
										</div>
									</div>

									<!-- 6-tick deploy history strip + summary line -->
									<div class="hidden flex-col gap-1 sm:flex">
										<div class="flex items-center gap-1">
											{#each strip as t, i (t.key)}
												<span class="inline-block h-1.5 w-3.5 rounded-sm {dotBg(t.status)} {i === strip.length - 1 ? 'opacity-100' : 'opacity-55'}"></span>
											{/each}
											<span class="ml-1 font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">last 6</span>
										</div>
										<span class="truncate font-mono text-[10px] {summaryClass(r)}">{summaryLine(r)}</span>
									</div>

									<!-- Version (pin badge appears to the left of the version) -->
									<div class="flex items-center justify-end gap-1.5 justify-self-end">
										{#if r.spec?.wantedVersion}<PinBadge version={r.spec.wantedVersion} size="xs" />{/if}
										<span class="font-mono text-xs text-gray-700 dark:text-gray-300" title={ver ?? ''}>{ver ?? '—'}</span>
									</div>

									<!-- Age -->
									{#if latest?.timestamp}
										<span class="text-right font-mono text-[10px] text-gray-400 dark:text-gray-500 justify-self-end" title={formatTimeAgo(latest.timestamp, $now)}>{formatTimeAgoCompact(latest.timestamp, $now)}</span>
									{:else}
										<span class="text-right font-mono text-[10px] text-gray-300 dark:text-gray-600 justify-self-end">—</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>
