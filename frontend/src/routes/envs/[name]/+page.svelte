<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid,
		ChevronRightOutline
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

	// Newest deploy across this env's slots — gives "is this env active?" signal.
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
	// Compute "behind by N versions" for each slot on this env. We look for the same
	// app deployed on an earlier-tier env (e.g. dev when we're on prod); if the
	// earlier env has a newer succeeded version, count distinct versions between
	// this slot's current version and the earlier env's current version.
	type BehindInfo = { fromEnv: string; version: string; behindBy: number | null };
	function behindForSlot(s: Slot): BehindInfo | null {
		const myEnv = s.environment.spec?.environment;
		if (!myEnv) return null;
		// Pinned env is intentionally held.
		if (s.rollout?.spec?.wantedVersion) return null;
		const myCurrentH = s.rollout?.status?.history?.[0];
		if (!myCurrentH) return null;
		const myCurrentV = getDisplayVersion(myCurrentH.version);
		// Find candidate earlier envs that deploy the same app.
		const candidates: { envName: string; rollout: Rollout }[] = [];
		for (const env of environments) {
			const otherEnvName = env.spec?.environment;
			if (!otherEnvName || otherEnvName === myEnv) continue;
			if (env.spec?.rolloutRef?.name !== s.appName) continue;
			if (compareEnvironmentNames(otherEnvName, myEnv) >= 0) continue;
			const otherRollout = rollouts.find(
				(r) => r.metadata?.name === s.appName && r.metadata?.namespace === env.metadata?.namespace
			);
			if (otherRollout) candidates.push({ envName: otherEnvName, rollout: otherRollout });
		}
		if (candidates.length === 0) return null;
		// Use the *closest* earlier env (highest rank below myEnv) — that's the
		// promotion source we care about.
		candidates.sort((a, b) => compareEnvironmentNames(b.envName, a.envName));
		const source = candidates[0];
		const sourceH = source.rollout.status?.history?.[0];
		if (!sourceH || sourceH.bakeStatus !== 'Succeeded') return null;
		const sourceV = getDisplayVersion(sourceH.version);
		if (sourceV === myCurrentV) return null;
		// Walk source history to count distinct versions until myCurrentV.
		const distinct: string[] = [];
		for (const h of source.rollout.status?.history ?? []) {
			const v = getDisplayVersion(h.version);
			if (distinct[distinct.length - 1] !== v) distinct.push(v);
			if (v === myCurrentV) break;
		}
		const idx = distinct.indexOf(myCurrentV);
		return { fromEnv: source.envName, version: sourceV, behindBy: idx >= 0 ? idx : null };
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
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
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
		<!-- Header: title + inline summary -->
		<div class="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
			<div class="flex min-w-0 items-baseline gap-3">
				<h1 class="environment-theme-text truncate text-2xl font-light text-gray-900 dark:text-white">
					{slotTheme?.label ?? envName.charAt(0).toUpperCase() + envName.slice(1)}
				</h1>
				{#if slotTheme && slotTheme.label.toLowerCase() !== envName.toLowerCase()}
					<code class="font-mono text-xs text-gray-400 dark:text-gray-500">{envName}</code>
				{/if}
				<span class="text-sm text-gray-500 dark:text-gray-400">
					<span class="tabular-nums {succeededCount === slots.length ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}">{succeededCount}</span>
					<span>of {slots.length} healthy</span>
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
							{@const behind = behindForSlot(s)}
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
											{#if s.rollout?.spec?.wantedVersion}
												<span
													class="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
													title={`Pinned to ${s.rollout.spec.wantedVersion}`}
												>pin</span>
											{/if}
										</div>
										<div class="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-gray-500 dark:text-gray-400">
											<span class="font-mono">{s.appName}</span>
											{#if s.rollout?.metadata?.namespace}
												<span class="text-gray-300 dark:text-gray-600">·</span>
												<span class="font-mono">{s.rollout.metadata.namespace}</span>
											{/if}
										</div>
										{#if status === 'Failed'}
											{@const cat = categorizeFailure(latest?.bakeStatusMessage)}
											{@const prev = previousSucceededVersion(s.rollout, latest?.version ? getDisplayVersion(latest.version) : null)}
											<div class="mt-1 truncate pl-4 text-[10px] text-red-700 dark:text-red-300" title={latest?.bakeStatusMessage ?? ''}>
												{cat ?? 'failed'} failed{#if prev}<span class="text-red-500/70 dark:text-red-400/70"> · was <span class="font-mono">{prev}</span></span>{/if}
											</div>
										{:else if behind}
											<div class="mt-1 flex items-center gap-1 pl-4 text-[10px] text-orange-700 dark:text-orange-300">
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
									<div class="flex shrink-0 items-center gap-3">
										<span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">
											{latest ? getDisplayVersion(latest.version) : '—'}
										</span>
										{#if latest?.timestamp}
											<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(latest.timestamp, $now)}>
												{formatTimeAgoCompact(latest.timestamp, $now)}
											</span>
										{/if}
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
