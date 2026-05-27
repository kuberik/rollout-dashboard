<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceDashboardURL, withDashboardParam } from '$lib/source-dashboard';
	import { getDisplayVersion, shortenVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure, formatStatusTime, compareRollouts } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../../types';

	const envName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterURL = $derived<string>(clusterQuery.data?.url || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type Slot = {
		appName: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		title: string;
		sourceURL: string;
	};

	const slots = $derived.by<Slot[]>(() => {
		const envObjs = environments.filter((e) => e.spec?.environment === envName);
		const result: Slot[] = envObjs.map((env) => {
			const appName = env.spec?.rolloutRef?.name || '';
			const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env)) || null;
			const theme = rollout ? getRolloutEnvironmentTheme(rollout, env) : null;
			return {
				appName,
				environment: env,
				rollout,
				theme,
				title: rollout?.status?.title || appName,
				sourceURL: sourceDashboardURL(env)
			};
		});
		return result.sort((a, b) => {
			const sevA = appSeverity(a);
			const sevB = appSeverity(b);
			if (sevA !== sevB) return sevB - sevA;
			return a.appName.localeCompare(b.appName);
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
		previousVersion: string | null;
		timestamp: string;
		bakeStatus: string;
		ns: string;
		rollout: Rollout;
		sourceURL: string;
	};
	const recentActivity = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const s of slots) {
			const history = s.rollout?.status?.history;
			if (!s.rollout || !history) continue;
			for (let i = 0; i < history.length; i++) {
				const entry = history[i];
				const currentV = getDisplayVersion(entry.version);
				let previousVersion: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== currentV) { previousVersion = v; break; }
				}
				list.push({
					appName: s.appName,
					title: s.title,
					version: currentV,
					previousVersion,
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None',
					ns: s.rollout.metadata?.namespace || '',
					rollout: s.rollout,
					sourceURL: s.sourceURL
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list.slice(0, 20);
	});

	type ActivityDayGroup = { label: string; key: string; entries: ActivityEntry[] };
	function dayKey(ts: string): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function dayLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const diffMs = today.getTime() - that.getTime();
		const days = Math.round(diffMs / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	const activityByDay = $derived.by<ActivityDayGroup[]>(() => {
		const refNow = $now;
		const map = new Map<string, ActivityDayGroup>();
		for (const a of recentActivity) {
			const key = dayKey(a.timestamp);
			let group = map.get(key);
			if (!group) {
				group = { label: dayLabel(a.timestamp, refNow), key, entries: [] };
				map.set(key, group);
			}
			group.entries.push(a);
		}
		return Array.from(map.values());
	});

	function hourLabel(ts: string): string {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

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
	// Find peers (same app deployed elsewhere) using actual deploy history
	// to derive direction instead of env-name tier ordering.
	function peerRollouts(s: Slot): { envName: string; rollout: Rollout }[] {
		const myEnv = s.environment.spec?.environment;
		if (!myEnv) return [];
		const out: { envName: string; rollout: Rollout }[] = [];
		for (const env of environments) {
			const otherEnvName = env.spec?.environment;
			if (!otherEnvName || otherEnvName === myEnv) continue;
			if (env.spec?.rolloutRef?.name !== s.appName) continue;
			const otherRollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env));
			if (otherRollout) out.push({ envName: otherEnvName, rollout: otherRollout });
		}
		return out;
	}

	type BehindInfo = { fromEnv: string; version: string; behindBy: number | null };
	function behindForSlot(s: Slot): BehindInfo | null {
		if (s.rollout?.spec?.wantedVersion) return null;
		if (!s.rollout) return null;
		let best: BehindInfo | null = null;
		for (const peer of peerRollouts(s)) {
			const rel = compareRollouts(s.rollout, peer.rollout);
			if (!rel || rel.kind !== 'behind') continue;
			const candidate = { fromEnv: peer.envName, version: rel.otherVersion, behindBy: rel.by };
			if (!best || (candidate.behindBy ?? 0) > (best.behindBy ?? 0)) best = candidate;
		}
		return best;
	}

	type PromoteInfo = { toEnv: string; version: string };
	function readyToPromote(s: Slot): PromoteInfo | null {
		if (!s.rollout) return null;
		const myCurrentH = s.rollout.status?.history?.[0];
		if (!myCurrentH || myCurrentH.bakeStatus !== 'Succeeded') return null;
		const myCurrentV = getDisplayVersion(myCurrentH.version);
		for (const peer of peerRollouts(s)) {
			if (peer.rollout.spec?.wantedVersion) continue;
			const rel = compareRollouts(s.rollout, peer.rollout);
			if (rel?.kind === 'ahead') {
				return { toEnv: peer.envName, version: myCurrentV };
			}
		}
		return null;
	}

	function deploySparkline(r: Rollout): { status: string; version: string; timestamp: string | null }[] {
		const history = r.status?.history ?? [];
		const out: { status: string; version: string; timestamp: string | null }[] = [];
		for (const h of history) {
			const v = getDisplayVersion(h.version);
			if (!v) continue;
			if (out.length > 0 && out[0].version === v) continue;
			out.unshift({ status: h.bakeStatus || 'None', version: v, timestamp: h.timestamp || null });
			if (out.length >= 6) break;
		}
		return out;
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

	// Per-app promotion chain: for an app, list all envs it's bound to,
	// ordered, with each env's current status. The current page's env is
	// mint-highlighted.
	type ChainCell = { envName: string; status: string };
	function chainFor(appName: string): ChainCell[] {
		const out: ChainCell[] = [];
		for (const env of environments) {
			if (env.spec?.rolloutRef?.name !== appName) continue;
			const otherEnv = env.spec?.environment;
			if (!otherEnv) continue;
			const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
			out.push({ envName: otherEnv, status: r?.status?.history?.[0]?.bakeStatus ?? 'None' });
		}
		return out.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	}

	function chainDot(status: string): string {
		switch (status) {
			case 'Succeeded': return 'bg-green-500';
			case 'Failed': return 'bg-red-500';
			case 'InProgress': return 'bg-yellow-400';
			case 'Deploying': return 'bg-blue-500';
			case 'Cancelled': return 'bg-gray-400';
			default: return 'bg-gray-300 dark:bg-gray-600';
		}
	}

	// Metrics for the strip
	const deploys24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const s of slots) {
			for (const h of s.rollout?.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (new Date(h.timestamp).getTime() >= cutoff) n++;
			}
		}
		return n;
	});

	const medianBakeMs = $derived.by(() => {
		const durations: number[] = [];
		for (const s of slots) {
			for (const h of s.rollout?.status?.history ?? []) {
				if (!h.bakeStartTime || !h.bakeEndTime) continue;
				const d = new Date(h.bakeEndTime).getTime() - new Date(h.bakeStartTime).getTime();
				if (d > 0) durations.push(d);
			}
		}
		if (durations.length === 0) return null;
		durations.sort((a, b) => a - b);
		const mid = Math.floor(durations.length / 2);
		return durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
	});

	function fmtDurationShort(ms: number | null): string {
		if (ms === null) return '—';
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const r = s % 60;
		if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m`;
	}

	const promotionRate = $derived.by(() => {
		// % of deploys succeeded out of all terminal deploys (last 30)
		let total = 0;
		let ok = 0;
		for (const s of slots) {
			for (const h of (s.rollout?.status?.history ?? []).slice(0, 30)) {
				if (h.bakeStatus === 'Succeeded') {
					ok++;
					total++;
				} else if (h.bakeStatus === 'Failed' || h.bakeStatus === 'Cancelled') {
					total++;
				}
			}
		}
		return total === 0 ? null : Math.round((ok / total) * 100);
	});
</script>

<svelte:head>
	<title>kuberik | {envName}</title>
</svelte:head>

<div class="environment-theme-scope mx-auto max-w-7xl px-4 py-6 sm:px-6" style={themeStyle}>

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
		<!-- Header -->
		<div class="mb-6">
			<div class="flex items-baseline justify-between gap-3">
				<h1 class="environment-theme-text min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">
					{slotTheme?.label ?? envName.charAt(0).toUpperCase() + envName.slice(1)}
				</h1>
				
			</div>
			<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
				{#if slotTheme && slotTheme.label.toLowerCase() !== envName.toLowerCase()}
					<code class="font-mono text-xs text-gray-400 dark:text-gray-500">{envName}</code>
				{/if}
				<span>
					<span class="tabular-nums {succeededCount === slots.length ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}">{succeededCount}</span>
					of {slots.length} healthy
				</span>
				{#if failedCount > 0}<span class="font-medium text-red-600 dark:text-red-400">· {failedCount} failed</span>{/if}
				{#if activeCount > 0}<span class="font-medium text-yellow-700 dark:text-yellow-400">· {activeCount} in progress</span>{/if}
				{#if newestDeploy}
					<span class="text-xs text-gray-400 dark:text-gray-500" title={`Newest deploy ${formatTimeAgo(newestDeploy, $now)}`}>
						· last deploy {formatTimeAgoCompact(newestDeploy, $now)}
					</span>
				{/if}
				<DeployVolumeSparkline rollouts={slots.filter((s) => s.rollout).map((s) => s.rollout!)} />
			</div>
		</div>

		<!-- Metrics strip: per-env summary stats. Each app defines its own
		     promotion chain, so the strip has no env-level chain — the
		     paragraph on the right makes that explicit. -->
		<section class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Apps in this env</div>
				<div class="mt-1 font-mono text-xl font-light text-gray-900 dark:text-white">{slots.length}</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Deploys · 24h</div>
				<div class="mt-1 flex items-baseline gap-2">
					<span class="font-mono text-xl font-light text-gray-900 dark:text-white">{deploys24h}</span>
					<DeployVolumeSparkline rollouts={slots.filter((s) => s.rollout).map((s) => s.rollout!)} hours={24} />
				</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Median bake</div>
				<div class="mt-1 font-mono text-xl font-light text-gray-900 dark:text-white">{fmtDurationShort(medianBakeMs)}</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Promotion rate</div>
				<div class="mt-1 font-mono text-xl font-light {promotionRate === null ? 'text-gray-400 dark:text-gray-500' : promotionRate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : promotionRate >= 70 ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}">
					{promotionRate === null ? '—' : `${promotionRate}%`}
				</div>
			</div>
			<div class="ml-auto max-w-[260px] text-right text-[11px] text-gray-500 dark:text-gray-400">
				Each app defines its own promotion chain — see the inline chips per row.
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
							{@const behind = behindForSlot(s)}
							{@const promote = behind ? null : readyToPromote(s)}
							{@const chain = chainFor(s.appName)}
							<li class="group">
								<div class="flex items-center justify-between gap-4 px-5 py-4">
									<a
										href={s.rollout ? withDashboardParam(`/rollouts/${s.rollout.metadata?.namespace}/${s.rollout.metadata?.name}`, s.sourceURL, localClusterURL) : '#'}
										class="flex min-w-0 flex-1 items-center gap-3"
									>
										<!-- Status circle. No animate-ping halo — the icon
										     (pulse for bake, spinner for deploy) is enough signal. -->
										<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
											<BakeStatusIcon bakeStatus={status} size="medium" />
										</span>
										<div class="flex min-w-0 flex-col gap-0.5">
											<div class="flex min-w-0 items-center gap-2">
												<span class="truncate text-base font-bold text-gray-900 dark:text-white">{s.appName}</span>
												{#if s.rollout?.spec?.wantedVersion}<PinBadge version={s.rollout.spec.wantedVersion} />{/if}
											</div>
											<div class="flex min-w-0 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
												{#if s.title !== s.appName}
													<span class="truncate">{s.title}</span>
													{#if s.rollout?.metadata?.namespace}<span class="text-gray-300 dark:text-gray-600">·</span>{/if}
												{/if}
												{#if s.rollout?.metadata?.namespace}
													<span class="truncate font-mono">{s.rollout.metadata.namespace}</span>
												{/if}
											</div>
											{#if status === 'Failed'}
												{@const cat = categorizeFailure(latest?.bakeStatusMessage)}
												{@const prev = previousSucceededVersion(s.rollout, latest?.version ? getDisplayVersion(latest.version) : null)}
												<div class="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400" title={latest?.bakeStatusMessage ?? ''}>
													<span class="font-medium text-gray-700 dark:text-gray-300">{cat ?? 'failed'}</span> failed{#if prev} · was <span class="font-mono" title={prev}>{shortenVersion(prev)}</span>{/if}
												</div>
											{:else if behind}
												<div class="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
													{#if behind.behindBy && behind.behindBy > 0}
														{behind.behindBy} {behind.behindBy === 1 ? 'version' : 'versions'} behind <span class="font-medium text-gray-700 dark:text-gray-300">{behind.fromEnv}</span>
													{:else}
														behind <span class="font-medium text-gray-700 dark:text-gray-300">{behind.fromEnv}</span>
													{/if}
												</div>
											{:else if promote}
												<div class="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
													<span class="font-mono" title={promote.version}>{shortenVersion(promote.version)}</span> ready for <span class="font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">{promote.toEnv}</span>
												</div>
											{/if}
										</div>
									</a>
									<!-- Per-app promotion chain: env chips for the envs this app
									     is bound to, ordered, with the current env mint-highlighted.
									     Each app has its own chain — no env-level chain. -->
									<div class="hidden flex-wrap items-center gap-1 lg:flex">
										{#if chain.length <= 1}
											<span class="font-mono text-[10px] italic text-gray-400 dark:text-gray-500">only bound to {envName}</span>
										{:else}
											{#each chain as c, ci (c.envName)}
												{#if ci > 0}
													<ChevronRightOutline class="h-3 w-3 shrink-0 text-gray-300 dark:text-gray-600" />
												{/if}
												<span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider {c.envName === envName
													? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300'
													: 'border-gray-200 bg-gray-50/60 text-gray-500 opacity-80 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-300'}">
													<span class="h-1.5 w-1.5 rounded-full {chainDot(c.status)}"></span>
													{c.envName}
												</span>
											{/each}
										{/if}
									</div>
									<div class="flex shrink-0 items-center gap-3">
										<div class="flex flex-col items-end gap-1">
											<span class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300" title={latest ? getDisplayVersion(latest.version) : ''}>
												{latest ? shortenVersion(getDisplayVersion(latest.version)) : '—'}
											</span>
											{#if latest?.timestamp}
												<span class="font-mono text-[10px] {isRunning(status) ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-500'}" title={formatTimeAgo(latest.timestamp, $now)}>
													{formatStatusTime(status, latest.timestamp, $now)}
												</span>
											{/if}
										</div>
										<!-- Deploy history sparkline -->
										{#if s.rollout}
											{@const sparkline = deploySparkline(s.rollout)}
											{#if sparkline.length > 1}
												<div class="hidden flex-col items-end gap-0.5 sm:flex" aria-label="Recent deploy history">
													<span class="text-[9px] uppercase tracking-wider text-gray-300 dark:text-gray-600">history</span>
													<div class="flex items-center gap-1">
														{#each sparkline as h}
															<span
																class="h-1 w-2.5 rounded-full {h.status === 'Succeeded' ? 'bg-green-400 dark:bg-green-500' : h.status === 'Failed' ? 'bg-red-400 dark:bg-red-500' : h.status === 'InProgress' ? 'bg-yellow-400' : h.status === 'Deploying' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}"
																title={`${h.version} · ${h.status}${h.timestamp ? ' · ' + formatTimeAgoCompact(h.timestamp, $now) + ' ago' : ''}`}
															></span>
														{/each}
													</div>
												</div>
											{/if}
										{/if}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<!-- Activity rail — vertical timeline -->
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
						<div class="flex flex-col items-center px-4 py-10 text-center">
							<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60">
								<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
							</div>
							<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No activity yet</p>
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Deployments will appear here as a timeline.</p>
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
										<!-- Spine -->
										<span class="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-gray-200 dark:bg-gray-700/80" aria-hidden="true"></span>
										{#each group.entries as a, ai}
											{@const isLast = ai === group.entries.length - 1}
											<li class="relative pl-6 {isLast ? '' : 'pb-3'}">
												<!-- Marker -->
												<span class="absolute left-0 top-1 inline-flex h-3.5 w-3.5 items-center justify-center">
													{#if isRunning(a.bakeStatus)}
														<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[a.bakeStatus]}"></span>
													{/if}
													<span class="relative inline-flex h-2.5 w-2.5 rounded-full {STATUS_DOT[a.bakeStatus] ?? STATUS_DOT.None} ring-2 ring-white dark:ring-gray-800"></span>
												</span>
												<a
													href={withDashboardParam(`/rollouts/${a.ns}/${a.appName}`, a.sourceURL, localClusterURL)}
													class="block rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
												>
													<div class="flex items-baseline justify-between gap-2">
														<span class="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">{a.appName}</span>
														<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
															{hourLabel(a.timestamp)}
														</span>
													</div>
													<div class="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
														<span class={STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}>{STATUS_LABEL[a.bakeStatus]}</span>
														<span class="flex shrink-0 items-baseline gap-1">
															{#if a.previousVersion}
																<span class="font-mono text-gray-400/70 line-through dark:text-gray-500/70" title={a.previousVersion}>{shortenVersion(a.previousVersion)}</span>
																<span class="text-[10px] text-gray-300 dark:text-gray-600">→</span>
															{/if}
															<span class="font-mono text-gray-700 dark:text-gray-300" title={a.version}>{shortenVersion(a.version)}</span>
														</span>
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
			</section>
		</div>
	{/if}
</div>
