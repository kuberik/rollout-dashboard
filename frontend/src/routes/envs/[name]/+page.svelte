<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		LayersSolid,
		ChevronRightOutline,
		ClockSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../../types';

	const envName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type Slot = {
		appName: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		title: string;
	};

	const slots = $derived.by<Slot[]>(() => {
		const envObjs = environments.filter((e) => e.spec?.environment === envName);
		const result: Slot[] = envObjs.map((env) => {
			const appName = env.spec?.rolloutRef?.name || '';
			const rollout =
				rollouts.find(
					(r) => r.metadata?.name === appName && r.metadata?.namespace === env.metadata?.namespace
				) || null;
			const theme = rollout ? getRolloutEnvironmentTheme(rollout, env) : null;
			return {
				appName,
				environment: env,
				rollout,
				theme,
				title: rollout?.status?.title || appName
			};
		});
		return result.sort((a, b) => {
			const sevA = appSeverity(a);
			const sevB = appSeverity(b);
			if (sevA !== sevB) return sevB - sevA;
			return a.title.localeCompare(b.title);
		});
	});

	function appSeverity(s: Slot): number {
		const status = s.rollout?.status?.history?.[0]?.bakeStatus;
		if (status === 'Failed') return 3;
		if (status === 'InProgress' || status === 'Deploying') return 1;
		return 0;
	}

	const slotTheme = $derived(slots.find((s) => s.theme)?.theme ?? null);
	const themeStyle = $derived(slotTheme ? getEnvironmentThemeStyle(slotTheme) : undefined);

	const namespaces = $derived.by(() => {
		const set = new Set<string>();
		for (const s of slots) {
			if (s.environment.metadata?.namespace) set.add(s.environment.metadata.namespace);
		}
		return [...set].sort();
	});

	type ActivityEntry = {
		appName: string;
		title: string;
		version: string;
		timestamp: string;
		bakeStatus: string;
		ns: string;
		rollout: Rollout;
	};
	const recentActivity = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const s of slots) {
			if (!s.rollout?.status?.history) continue;
			for (const entry of s.rollout.status.history) {
				list.push({
					appName: s.appName,
					title: s.title,
					version: getDisplayVersion(entry.version),
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None',
					ns: s.rollout.metadata?.namespace || '',
					rollout: s.rollout
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list.slice(0, 20);
	});

	const failedCount = $derived(
		slots.filter((s) => s.rollout?.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		slots.filter((s) => {
			const x = s.rollout?.status?.history?.[0]?.bakeStatus;
			return x === 'InProgress' || x === 'Deploying';
		}).length
	);
	const succeededCount = $derived(
		slots.filter((s) => s.rollout?.status?.history?.[0]?.bakeStatus === 'Succeeded').length
	);
	const otherCount = $derived(
		Math.max(0, slots.length - succeededCount - activeCount - failedCount)
	);
	const newestDeploy = $derived.by<string | null>(() => {
		let t: string | null = null;
		for (const s of slots) {
			const ts = s.rollout?.status?.history?.[0]?.timestamp;
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
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}
</script>

<svelte:head>
	<title>kuberik | {envName}</title>
</svelte:head>

<div class="environment-theme-scope mx-auto max-w-7xl px-4 py-6 sm:px-6" style={themeStyle}>
	<!-- Breadcrumb / back -->
	<div class="mb-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
		<a href="/environments" class="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
			<ArrowLeftOutline class="h-3 w-3" />
			Environments
		</a>
		<ChevronRightOutline class="h-3 w-3 text-gray-300 dark:text-gray-600" />
		<span class="font-medium text-gray-700 dark:text-gray-300">{envName}</span>
	</div>

	{#if query.isLoading}
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<div class="h-20 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="grid gap-6 lg:grid-cols-5">
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700 lg:col-span-3"></div>
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700 lg:col-span-2"></div>
			</div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-400">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if slots.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">Environment not found</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				No <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">Environment</code>
				resources reference <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">{envName}</code>.
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
				<div class="flex items-baseline gap-3">
					<h1 class="environment-theme-text truncate text-2xl font-light text-gray-900 dark:text-white">
						{slotTheme?.label ?? envName.charAt(0).toUpperCase() + envName.slice(1)}
					</h1>
					{#if slotTheme && slotTheme.label.toLowerCase() !== envName.toLowerCase()}
						<code class="font-mono text-xs text-gray-400 dark:text-gray-500">{envName}</code>
					{/if}
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
					<span>{slots.length} app{slots.length === 1 ? '' : 's'}</span>
					<span class="text-gray-300 dark:text-gray-600">·</span>
					<span>{namespaces.length} namespace{namespaces.length === 1 ? '' : 's'}</span>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-3">
				{#if query.isFetching}<Spinner size="5" color="gray" />{/if}
			</div>
		</div>

		<!-- Health summary: single compact stat card with composition bar -->
		<section class="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<!-- Headline number -->
				<div class="flex items-baseline gap-1.5">
					<span class="text-3xl font-light {failedCount > 0 ? 'text-red-600 dark:text-red-400' : succeededCount === slots.length ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}">{succeededCount}</span>
					<span class="text-sm text-gray-400 dark:text-gray-500">/ {slots.length} healthy</span>
				</div>
				<!-- Inline status pills (only non-zero) -->
				<div class="flex items-center gap-3">
					{#if activeCount > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-yellow-400"></span>
							</span>
							{activeCount} deploying
						</span>
					{/if}
					{#if failedCount > 0}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
							<ExclamationCircleSolid class="h-3 w-3 text-red-500" />
							{failedCount} failed
						</span>
					{/if}
					{#if failedCount === 0 && activeCount === 0 && succeededCount === slots.length}
						<span class="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
							<CheckCircleSolid class="h-3 w-3" />
							All healthy
						</span>
					{/if}
					{#if newestDeploy}
						<span class="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 dark:text-gray-500" title="Newest deploy {formatTimeAgo(newestDeploy, $now)}">
							<ClockSolid class="h-3 w-3" />
							{formatTimeAgoCompact(newestDeploy, $now)}
						</span>
					{/if}
				</div>
			</div>
			<!-- Composition bar -->
			<div class="mt-3 flex h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
				{#if succeededCount > 0}
					<span class="bg-green-500" style="width:{(succeededCount / slots.length) * 100}%"></span>
				{/if}
				{#if activeCount > 0}
					<span class="bg-yellow-400" style="width:{(activeCount / slots.length) * 100}%"></span>
				{/if}
				{#if failedCount > 0}
					<span class="bg-red-500" style="width:{(failedCount / slots.length) * 100}%"></span>
				{/if}
				{#if otherCount > 0}
					<span class="bg-gray-300 dark:bg-gray-600" style="width:{(otherCount / slots.length) * 100}%"></span>
				{/if}
			</div>
		</section>

		<div class="grid gap-6 lg:grid-cols-5">
			<!-- App list -->
			<section class="lg:col-span-3">
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Apps in {envName}
				</h2>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each slots as s}
							{@const latest = s.rollout?.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							<li class="group">
								<div class="flex items-center justify-between gap-3 px-4 py-3">
									<a
										href={s.rollout ? `/rollouts/${s.rollout.metadata?.namespace}/${s.rollout.metadata?.name}` : '#'}
										class="min-w-0 flex-1"
									>
										<div class="flex items-center gap-2">
											<span class="relative flex h-2 w-2 shrink-0">
												{#if isRunning(status)}
													<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[status]}"></span>
												{/if}
												<span class="relative inline-flex h-2 w-2 rounded-full {STATUS_DOT[status] ?? STATUS_DOT.None}"></span>
											</span>
											<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{s.title}</span>
										</div>
										<div class="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-gray-500 dark:text-gray-400">
											<span class="font-mono">{s.appName}</span>
											{#if s.rollout?.metadata?.namespace}
												<span class="text-gray-300 dark:text-gray-600">·</span>
												<span class="font-mono">{s.rollout.metadata.namespace}</span>
											{/if}
										</div>
									</a>
									<div class="flex shrink-0 items-center gap-3">
										<div class="flex flex-col items-end">
											<span class="truncate font-mono text-xs font-medium text-gray-800 dark:text-gray-200">
												{latest ? getDisplayVersion(latest.version) : '—'}
											</span>
											<span class="text-[10px] {STATUS_TEXT[status] ?? STATUS_TEXT.None}">{STATUS_LABEL[status]}</span>
										</div>
										{#if latest?.timestamp}
											<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(latest.timestamp, $now)}>
												{formatTimeAgoCompact(latest.timestamp, $now)}
											</span>
										{/if}
										<a
											href="/apps/{s.appName}"
											class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
											title="See {s.appName} across all environments"
										>flow ›</a>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<!-- Activity rail -->
			<section class="lg:col-span-2">
				<div class="mb-3 flex items-baseline justify-between">
					<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						Recent activity
					</h2>
					<a
						href={`/activity?env=${encodeURIComponent(envName)}`}
						class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
					>view all ›</a>
				</div>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					{#if recentActivity.length === 0}
						<div class="p-4 text-sm text-gray-500 dark:text-gray-400">No deployment history.</div>
					{:else}
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each recentActivity as a}
								<li>
									<a
										href="/rollouts/{a.ns}/{a.appName}"
										class="block px-4 py-2.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<div class="flex items-center justify-between gap-2">
											<span class="min-w-0 truncate font-medium text-gray-900 dark:text-white">{a.title}</span>
											<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
												{formatTimeAgoCompact(a.timestamp, $now)}
											</span>
										</div>
										<div class="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
											<span class="flex items-center gap-1.5">
												<span class="relative flex h-1.5 w-1.5">
													{#if isRunning(a.bakeStatus)}
														<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[a.bakeStatus]}"></span>
													{/if}
													<span class="relative inline-flex h-1.5 w-1.5 rounded-full {STATUS_DOT[a.bakeStatus] ?? STATUS_DOT.None}"></span>
												</span>
												<span class={STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}>{STATUS_LABEL[a.bakeStatus]}</span>
											</span>
											<span class="font-mono text-gray-500 dark:text-gray-400">{a.version}</span>
										</div>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
		</div>
	{/if}
</div>
