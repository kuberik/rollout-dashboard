<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../../types';

	const namespace = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type AppEntry = {
		rollout: Rollout;
		env: Environment | null;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		title: string;
	};

	const apps = $derived.by<AppEntry[]>(() => {
		const nsRollouts = rollouts.filter((r) => r.metadata?.namespace === namespace);
		return nsRollouts
			.map((r) => {
				const env =
					environments.find(
						(e) =>
							e.metadata?.namespace === r.metadata?.namespace &&
							e.spec?.rolloutRef?.name === r.metadata?.name
					) || null;
				const theme = getRolloutEnvironmentTheme(r, env);
				return {
					rollout: r,
					env,
					envName: env?.spec?.environment || '',
					theme,
					title: r.status?.title || r.metadata?.name || ''
				};
			})
			.sort((a, b) => a.title.localeCompare(b.title));
	});

	type TimelineEvent = {
		appName: string;
		title: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		timestamp: string;
		bakeStatus: string;
	};

	const timeline = $derived.by<TimelineEvent[]>(() => {
		const list: TimelineEvent[] = [];
		for (const a of apps) {
			if (!a.rollout.status?.history) continue;
			for (const entry of a.rollout.status.history) {
				list.push({
					appName: a.rollout.metadata?.name || '',
					title: a.title,
					envName: a.envName,
					theme: a.theme,
					version: getDisplayVersion(entry.version),
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None'
				});
			}
		}
		return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	});

	// Group timeline by day for visual scanning
	type DayGroup = { dayKey: string; dayLabel: string; events: TimelineEvent[] };
	const timelineByDay = $derived.by<DayGroup[]>(() => {
		const map = new Map<string, DayGroup>();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		for (const e of timeline) {
			const d = new Date(e.timestamp);
			const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
			const key = day.toISOString().slice(0, 10);
			let label: string;
			if (day.getTime() === today.getTime()) label = 'Today';
			else if (day.getTime() === yesterday.getTime()) label = 'Yesterday';
			else label = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
			if (!map.has(key)) map.set(key, { dayKey: key, dayLabel: label, events: [] });
			map.get(key)!.events.push(e);
		}
		return [...map.values()];
	});

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

	const newestDeploy = $derived.by<string | null>(() => {
		let t: string | null = null;
		for (const a of apps) {
			const ts = a.rollout.status?.history?.[0]?.timestamp;
			if (ts && (!t || new Date(ts) > new Date(t))) t = ts;
		}
		return t;
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
	function previousSucceededVersion(r: Rollout | null, currentV: string | null): string | null {
		if (!r) return null;
		for (const h of r.status?.history ?? []) {
			if (h.bakeStatus !== 'Succeeded') continue;
			const v = getDisplayVersion(h.version);
			if (v && v !== currentV) return v;
		}
		return null;
	}

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	function shortTime(ts: string): string {
		return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>kuberik | {namespace}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Breadcrumb -->
	<div class="mb-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
		<a href="/" class="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
			<ArrowLeftOutline class="h-3 w-3" />
			Rollouts
		</a>
		<ChevronRightOutline class="h-3 w-3 text-gray-300 dark:text-gray-600" />
		<span>Namespace</span>
	</div>

	{#if query.isLoading}
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each Array(3) as _}
					<div class="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				{/each}
			</div>
			<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
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
				href="/"
				class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			>
				<ArrowLeftOutline class="h-3.5 w-3.5" /> Back to rollouts
			</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
			<div class="flex min-w-0 items-baseline gap-3">
				<h1 class="truncate font-mono text-2xl font-light text-gray-900 dark:text-white">{namespace}</h1>
				<span class="text-sm text-gray-500 dark:text-gray-400">
					<span class="tabular-nums {succeededCount === apps.length ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}">{succeededCount}</span>
					<span>of {apps.length} healthy</span>
					{#if failedCount > 0}<span class="ml-2 font-medium text-red-600 dark:text-red-400">· {failedCount} failed</span>{/if}
					{#if activeCount > 0}<span class="ml-2 font-medium text-yellow-700 dark:text-yellow-400">· {activeCount} deploying</span>{/if}
				</span>
				{#if newestDeploy}
					<span class="text-xs text-gray-400 dark:text-gray-500" title={`Newest deploy ${formatTimeAgo(newestDeploy, $now)}`}>
						last deploy {formatTimeAgoCompact(newestDeploy, $now)}
					</span>
				{/if}
			</div>
			{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
		</div>

		<!-- Rollouts in namespace -->
		<section class="mb-6">
			<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				Rollouts ({apps.length})
			</h2>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each apps as a}
					{@const latest = a.rollout.status?.history?.[0]}
					{@const status = latest?.bakeStatus || 'None'}
					{@const failureCategory = status === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null}
					{@const previousSucceeded = status === 'Failed' ? previousSucceededVersion(a.rollout, latest?.version ? getDisplayVersion(latest.version) : null) : null}
					<a
						href="/rollouts/{a.rollout.metadata?.namespace}/{a.rollout.metadata?.name}"
						class="environment-theme-scope flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
						style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
					>
						<!-- Title row -->
						<div class="flex min-w-0 items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<span class="relative flex h-2 w-2 shrink-0">
									{#if isRunning(status)}
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[status]}"></span>
									{/if}
									<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[status] ?? STATUS_DOT.None}"></span>
								</span>
								<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{a.title}</span>
							</div>
							{#if a.envName || a.theme}
								<span class="environment-theme-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{shortEnvLabel(a.theme) || a.envName || a.theme?.label}</span>
							{/if}
						</div>
						<!-- Meta row -->
						<div class="flex min-w-0 items-baseline justify-between gap-2 pl-4">
							<span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">
								{latest ? getDisplayVersion(latest.version) : '—'}
							</span>
							{#if latest?.timestamp}
								<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(latest.timestamp, $now)}>
									{formatTimeAgoCompact(latest.timestamp, $now)}
								</span>
							{/if}
						</div>
						{#if failureCategory}
							<div class="truncate pl-4 text-[10px] text-red-700 dark:text-red-300" title={latest?.bakeStatusMessage ?? ''}>
								{failureCategory} failed{#if previousSucceeded}<span class="text-red-500/70 dark:text-red-400/70"> · was <span class="font-mono">{previousSucceeded}</span></span>{/if}
							</div>
						{/if}
					</a>
				{/each}
			</div>
		</section>

		<!-- Unified deployment timeline -->
		<section>
			<div class="mb-3 flex items-baseline justify-between">
				<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Deployment timeline
				</h2>
				<a
					href={`/activity?ns=${encodeURIComponent(namespace)}`}
					class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
				>view all ›</a>
			</div>
			<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				{#if timelineByDay.length === 0}
					<div class="p-4 text-sm text-gray-500 dark:text-gray-400">No deployment history yet.</div>
				{:else}
					<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each timelineByDay as day}
							<div class="px-4 pt-3 pb-2">
								<div class="flex items-baseline justify-between">
									<span class="text-xs font-semibold text-gray-700 dark:text-gray-300">{day.dayLabel}</span>
									<span class="text-[10px] text-gray-400 dark:text-gray-500">{day.events.length} deploy{day.events.length === 1 ? '' : 's'}</span>
								</div>
								<ul class="mt-2 space-y-0.5">
									{#each day.events as e}
										<li class="environment-theme-scope" style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}>
											<a
												href="/rollouts/{namespace}/{e.appName}"
												class="-mx-2 grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
											>
												<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">{shortTime(e.timestamp)}</span>
												<div class="flex min-w-0 items-center gap-2">
													{#if e.envName || e.theme}
														<span class="environment-theme-badge shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider">{shortEnvLabel(e.theme) || e.envName || e.theme?.label}</span>
													{/if}
													<span class="min-w-0 truncate text-gray-800 dark:text-gray-200">{e.title}</span>
													<span class="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">{e.version}</span>
												</div>
												<span class="flex shrink-0 items-center gap-1">
													<span class="relative flex h-1.5 w-1.5">
														{#if isRunning(e.bakeStatus)}
															<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[e.bakeStatus]}"></span>
														{/if}
														<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[e.bakeStatus] ?? STATUS_DOT.None}"></span>
													</span>
													<span class="text-[10px] {STATUS_TEXT[e.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[e.bakeStatus]}</span>
												</span>
											</a>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>
