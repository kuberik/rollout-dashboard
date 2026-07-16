<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceClusterName, rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure, formatStatusTime, detectStuck } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../../types';

	const namespace = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type AppEntry = {
		rollout: Rollout;
		env: Environment | null;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		title: string;
		sourceCluster: string;
	};

	const apps = $derived.by<AppEntry[]>(() => {
		const nsRollouts = rollouts.filter((r) => r.metadata?.namespace === namespace);
		return nsRollouts
			.map((r) => {
				const env = environments.find((e) => rolloutMatchesEnvironment(r, e)) || null;
				const theme = getRolloutEnvironmentTheme(r, env);
				return {
					rollout: r,
					env,
					envName: env?.spec?.environment || '',
					theme,
					title: r.status?.title || r.metadata?.name || '',
					sourceCluster: sourceClusterName(r)
				};
			})
			.sort((a, b) => {
				const sa = a.rollout.status?.history?.[0]?.bakeStatus === 'Failed' ? 0 : 1;
				const sb = b.rollout.status?.history?.[0]?.bakeStatus === 'Failed' ? 0 : 1;
				if (sa !== sb) return sa - sb;
				return (a.rollout.metadata?.name || '').localeCompare(b.rollout.metadata?.name || '');
			});
	});

	type ActivityEntry = {
		appName: string;
		title: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		timestamp: string;
		bakeStatus: string;
		sourceCluster: string;
	};

	const recentActivity = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const a of apps) {
			const history = a.rollout.status?.history;
			if (!history) continue;
			for (const entry of history) {
				list.push({
					appName: a.rollout.metadata?.name || '',
					title: a.title,
					envName: a.envName,
					theme: a.theme,
					version: getDisplayVersion(entry.version),
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None',
					sourceCluster: a.sourceCluster
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list.slice(0, 20);
	});

	type DayGroup = { label: string; key: string; entries: ActivityEntry[] };
	function dayKey(ts: string): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function dayLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	const activityByDay = $derived.by<DayGroup[]>(() => {
		const refNow = $now;
		const map = new Map<string, DayGroup>();
		for (const a of recentActivity) {
			const key = dayKey(a.timestamp);
			let g = map.get(key);
			if (!g) {
				g = { label: dayLabel(a.timestamp, refNow), key, entries: [] };
				map.set(key, g);
			}
			g.entries.push(a);
		}
		return Array.from(map.values());
	});

	function hourLabel(ts: string): string {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	const failedCount = $derived(
		apps.filter((a) => a.rollout.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		apps.filter((a) => {
			const s = a.rollout.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
	const succeededCount = $derived(
		apps.filter((a) => a.rollout.status?.history?.[0]?.bakeStatus === 'Succeeded').length
	);
	const deploys24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const a of apps) {
			for (const h of a.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (new Date(h.timestamp).getTime() >= cutoff) n++;
			}
		}
		return n;
	});

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
		None: 'No deploy'
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
	function previousSucceededVersion(r: Rollout | null, currentV: string | null): string | null {
		if (!r) return null;
		for (const h of r.status?.history ?? []) {
			if (h.bakeStatus !== 'Succeeded') continue;
			const v = getDisplayVersion(h.version);
			if (v && v !== currentV) return v;
		}
		return null;
	}
</script>

<svelte:head>
	<title>kuberik | {namespace}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if query.isLoading}
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<div class="grid gap-3 grid-cols-2 sm:grid-cols-4">
				{#each Array(4) as _}<div class="h-20 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>{/each}
			</div>
			<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			</div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if apps.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">Namespace not found</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				No rollouts in namespace <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">{namespace}</code>.
			</p>
			<a
				href="/rollouts"
				class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			>
				<ArrowLeftOutline class="h-3.5 w-3.5" /> Back to rollouts
			</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="mb-6">
			<div class="flex items-baseline justify-between gap-3">
				<h1 class="min-w-0 truncate font-mono text-2xl font-light text-gray-900 dark:text-white">{namespace}</h1>
				
			</div>
			<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs text-gray-500 dark:text-gray-400">
				<span>namespace</span>
				<span class="text-gray-300 dark:text-gray-600">·</span>
				<span class="tabular-nums">{apps.length}</span> rollout{apps.length === 1 ? '' : 's'}
				{#if failedCount > 0}<span class="font-medium text-red-600 dark:text-red-400">· {failedCount} failing</span>{/if}
				{#if activeCount > 0}<span class="font-medium text-yellow-700 dark:text-yellow-400">· {activeCount} in progress</span>{/if}
			</div>
		</div>

		<!-- Stat tiles: 4 columns -->
		<div class="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
			<div class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Rollouts</div>
				<div class="mt-1 font-mono text-2xl font-light text-gray-900 dark:text-white">{apps.length}</div>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Healthy</div>
				<div class="mt-1 font-mono text-2xl font-light {succeededCount === apps.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}">{succeededCount}</div>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Failing</div>
				<div class="mt-1 font-mono text-2xl font-light {failedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-gray-600'}">{failedCount}</div>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Deploys · 24h</div>
				<div class="mt-1 flex items-baseline gap-2">
					<span class="font-mono text-2xl font-light text-gray-900 dark:text-white">{deploys24h}</span>
					<DeployVolumeSparkline rollouts={apps.map((a) => a.rollout)} hours={24} />
				</div>
			</div>
		</div>

		<!-- Two-column body: rollouts list + activity rail -->
		<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
			<section>
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Rollouts in {namespace}
				</h2>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each apps as a (a.rollout.metadata?.name)}
							{@const latest = a.rollout.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
							{@const failureCategory = status === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null}
							{@const prevV = status === 'Failed' ? previousSucceededVersion(a.rollout, ver) : null}
							{@const stuck = detectStuck(a.rollout, { now: $now })}
							<li class="environment-theme-scope" style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}>
								<div class="relative flex items-center gap-3 px-5 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
									<a
										href={rolloutPath(a.sourceCluster || localClusterName, a.rollout.metadata?.namespace || '', a.rollout.metadata?.name || '')}
										class="absolute inset-0 z-0"
										aria-label="Open rollout {a.rollout.metadata?.name}"
									></a>
									<span class="pointer-events-none relative z-[1] inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
										<BakeStatusIcon bakeStatus={status} size="medium" />
									</span>
									<div class="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col gap-0.5">
										<div class="flex min-w-0 items-baseline gap-2">
											<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{a.rollout.metadata?.name}</span>
											{#if stuck}<StuckBadge reason={stuck} size="xs" />{/if}
											{#if a.rollout.spec?.wantedVersion}<PinBadge version={a.rollout.spec.wantedVersion} size="xs" />{/if}
										</div>
										<div class="flex min-w-0 items-baseline gap-2">
											{#if a.title !== a.rollout.metadata?.name}<span class="truncate text-[11px] text-gray-400 dark:text-gray-500">{a.title}</span>{/if}
											{#if failureCategory}
												<span class="truncate text-[11px] text-red-600 dark:text-red-400" title={latest?.bakeStatusMessage ?? ''}>· {failureCategory} failed{#if prevV} · was <span class="font-mono">{prevV}</span>{/if}</span>
											{/if}
										</div>
									</div>
									<div class="pointer-events-auto relative z-10 flex shrink-0 flex-col items-end gap-0.5">
										{#if ver}
											<a href={versionPathForRollout(a.rollout, a.rollout.metadata?.name || '', ver)} class="font-mono text-sm text-gray-700 hover:underline dark:text-gray-300">{ver}</a>
										{:else}
											<span class="font-mono text-sm text-gray-700 dark:text-gray-300">—</span>
										{/if}
										{#if latest?.timestamp}
											<span class="font-mono text-[10px] {isRunning(status) ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'}" title={formatTimeAgo(latest.timestamp, $now)}>
												{formatStatusTime(status, latest.timestamp, $now)}
											</span>
										{/if}
									</div>
									{#if a.envName || a.theme}
										<span class="pointer-events-none relative z-[1] environment-theme-badge shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{shortEnvLabel(a.theme) || a.envName || a.theme?.label}</span>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<aside>
				<div class="mb-3 flex items-baseline justify-between">
					<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Recent activity</h2>
					<a
						href={`/activity?ns=${encodeURIComponent(namespace)}`}
						class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
					>view all ›</a>
				</div>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					{#if recentActivity.length === 0}
						<div class="flex flex-col items-center px-4 py-10 text-center">
							<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60">
								<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
							</div>
							<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No activity yet</p>
						</div>
					{:else}
						<div class="p-4">
							{#each activityByDay as group, gi}
								<div class="{gi > 0 ? 'mt-5' : ''}">
									<div class="mb-3 flex items-center gap-2">
										<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{group.label}</span>
										<span class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"></span>
										<span class="font-mono text-[10px] text-gray-300 dark:text-gray-600">{group.entries.length}</span>
									</div>
									<ol class="relative">
										<span class="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-gray-200 dark:bg-gray-700/80" aria-hidden="true"></span>
										{#each group.entries as a, ai}
											{@const isLast = ai === group.entries.length - 1}
											<li
												class="environment-theme-scope relative pl-6 {isLast ? '' : 'pb-3'}"
												style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
											>
												<span class="absolute left-0 top-1 inline-flex h-3.5 w-3.5 items-center justify-center">
													{#if isRunning(a.bakeStatus)}
														<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[a.bakeStatus]}"></span>
													{/if}
													<span class="relative inline-flex h-2.5 w-2.5 rounded-full {STATUS_DOT[a.bakeStatus] ?? STATUS_DOT.None} ring-2 ring-white dark:ring-gray-800"></span>
												</span>
												<a
													href={rolloutPath(a.sourceCluster || localClusterName, namespace, a.appName)}
													class="block rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
												>
													<div class="flex items-baseline justify-between gap-2">
														<div class="flex min-w-0 items-center gap-2">
															{#if a.envName || a.theme}
																<span class="environment-theme-badge shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-gray-700 dark:bg-gray-700/60 dark:text-gray-300">{shortEnvLabel(a.theme) || a.envName || a.theme?.label}</span>
															{/if}
															<span class="truncate text-xs font-medium text-gray-900 dark:text-white">{a.appName}</span>
														</div>
														<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
															{hourLabel(a.timestamp)}
														</span>
													</div>
													<div class="mt-0.5 flex items-center justify-between gap-2">
														<span class="text-[11px] {STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[a.bakeStatus]}</span>
														<span class="font-mono text-[11px] text-gray-700 dark:text-gray-300">{a.version}</span>
													</div>
												</a>
											</li>
										{/each}
									</ol>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</div>
