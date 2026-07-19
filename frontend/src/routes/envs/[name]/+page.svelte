<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { cellLag, upstreamCell } from '$lib/view-models/lag';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { StatusKey } from '$lib/rollout-cards';
	import { historyTicks } from '$lib/view-models/deploy-history';
	import { getEnvironmentRank } from '$lib/env-order';
	import { formatTimeAgo, shortenVersion, detectStuck, detectStuckBehind } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { ArrowLeftOutline, LayersSolid } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import DeployHistoryStrip from '$lib/components/DeployHistoryStrip.svelte';
	import LagChip from '$lib/components/LagChip.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../../types';

	const envName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Whether this tier is referenced by any Environment resource at all —
	// distinct from `slots.length === 0`, which can also mean "tier exists
	// but nothing has deployed here yet".
	const envExists = $derived(environments.some((e) => e.spec?.environment === envName));

	// Same fleet-wide app grouping the Apps/Environments pages use (Task
	// 10/11 precedent) — a single source of truth for "what is this app's
	// per-env cell", so this page can't drift from the matrix/app-detail view.
	const groups = $derived.by<Map<string, AppGroup>>(() => groupRolloutsByApp(rollouts, environments));

	type EnvSlot = { appName: string; group: AppGroup; cell: AppCell };

	// Flatten every app's cell(s) bound to this env tier. Usually one cell per
	// app; more than one only happens for multi-cluster fan-out at this tier
	// (e.g. multiple prod regions), which we surface as separate rows rather
	// than inventing a peer-region rollup we can't derive reliably.
	const slots = $derived.by<EnvSlot[]>(() => {
		const out: EnvSlot[] = [];
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				if (cell.environment?.spec?.environment === envName) {
					out.push({ appName: group.appName, group, cell });
				}
			}
		}
		return out;
	});

	// Reuse the same statusKey classification the Rollouts list / matrix use
	// (succeeded | failed | active | pending) so "Healthy" here means the
	// same thing it means everywhere else in the dashboard.
	const statusByRollout = $derived.by<Map<Rollout, StatusKey>>(() => {
		const cards = buildRolloutCards(rollouts, environments, $now);
		const map = new Map<Rollout, StatusKey>();
		for (const c of cards) map.set(c.rollout, c.statusKey);
		return map;
	});

	// Env theme for the header badge: prefer a matched slot's theme; if the
	// tier exists but has no deployed apps yet, fall back to any Environment
	// resource for this tier (mirrors Environments page's envThemeByTier),
	// then finally a pure name-based preset match.
	const slotTheme = $derived.by<EnvironmentTheme | null>(() => {
		for (const s of slots) if (s.cell.theme) return s.cell.theme;
		for (const env of environments) {
			if (env.spec?.environment !== envName) continue;
			const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
			const t = getRolloutEnvironmentTheme(r ?? null, env);
			if (t) return t;
		}
		return getRolloutEnvironmentTheme(null, envName);
	});
	const themeStyle = $derived(slotTheme ? getEnvironmentThemeStyle(slotTheme) : undefined);
	const envShort = $derived(shortEnvLabel(slotTheme ?? envName) || envName);

	function rolloutHref(cell: AppCell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || ''
		);
	}

	// ──────────────────────────── Metrics strip ────────────────────────────
	const healthyCount = $derived(
		slots.filter((s) => statusByRollout.get(s.cell.rollout) === 'succeeded').length
	);
	const behindCount = $derived(
		slots.filter((s) => (cellLag(s.group, envName)?.behindBy ?? 0) > 0).length
	);
	const deploys24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const s of slots) {
			for (const h of s.cell.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (new Date(h.timestamp).getTime() >= cutoff) n++;
			}
		}
		return n;
	});

	// "One pipeline stage" vs "one production region" — real signal from the
	// env-tier rank (>=7 is the prod bucket), same threshold the app detail
	// page uses to split stage-steps from prod fan-out.
	const isProdTier = $derived(getEnvironmentRank(envName) >= 7);
	const metricsNote = $derived.by(() => {
		if (behindCount === 0) return 'Everything here is on its newest build.';
		const stage = isProdTier ? 'One production region' : 'One pipeline stage';
		return `${stage}. ${behindCount} app${behindCount === 1 ? '' : 's'} here trail${behindCount === 1 ? 's' : ''} their newest build — see below.`;
	});

	// ─────────────────────────── App row helpers ───────────────────────────
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	function stuckFor(slot: EnvSlot): StuckReason | null {
		const own = detectStuck(slot.cell.rollout, { now: $now });
		if (own) return own;
		for (const peer of slot.group.cells) {
			if (peer === slot.cell) continue;
			const r = detectStuckBehind(slot.cell.rollout, peer.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}

	// Sort "by what needs attention": failed first, then actively
	// deploying/baking, then behind-newest (worst lag first), then
	// converged apps alphabetically.
	function severity(slot: EnvSlot): number {
		const status = slot.cell.rollout.status?.history?.[0]?.bakeStatus;
		if (status === 'Failed') return 3;
		if (isRunning(status ?? '')) return 2;
		if ((cellLag(slot.group, envName)?.behindBy ?? 0) > 0) return 1;
		return 0;
	}

	const sortedSlots = $derived.by<EnvSlot[]>(() => {
		return [...slots].sort((a, b) => {
			const sevDiff = severity(b) - severity(a);
			if (sevDiff !== 0) return sevDiff;
			const lagDiff = (cellLag(b.group, envName)?.behindBy ?? 0) - (cellLag(a.group, envName)?.behindBy ?? 0);
			if (lagDiff !== 0) return lagDiff;
			return a.appName.localeCompare(b.appName);
		});
	});

	// Ticks strip length shown per app row — matches historyTicks(history,
	// count)'s tested padding/truncation behavior (Cancelled -> fail,
	// left-padded with 'none' when there's less than `count` history).
	const TICKS_COUNT = 5;
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
			<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if !envExists}
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
		<!-- Header: env badge + label + sub -->
		<div class="mb-6">
			<div class="flex items-center gap-3">
				<span class="environment-theme-badge rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
					{envShort}
				</span>
				<h1 class="environment-theme-text min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">
					{slotTheme?.label ?? envName.charAt(0).toUpperCase() + envName.slice(1)}
				</h1>
			</div>
			<p class="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-500 dark:text-gray-400">
				{#if slotTheme && slotTheme.label.toLowerCase() !== envName.toLowerCase()}
					<code class="font-mono text-xs text-gray-400 dark:text-gray-500">{envName}</code>
				{/if}
				<span>{slots.length} app{slots.length === 1 ? '' : 's'} deployed here</span>
			</p>
		</div>

		<!-- Metrics card: row of stats + a prose note about propagation state -->
		<section class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Apps</div>
				<div class="mt-1 font-mono text-xl font-light text-gray-900 dark:text-white">{slots.length}</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Healthy</div>
				<div class="mt-1 font-mono text-xl font-light {healthyCount === slots.length && slots.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}">
					{healthyCount}/{slots.length}
				</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Behind newest</div>
				<div class="mt-1 font-mono text-xl font-light {behindCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}">
					{behindCount}
				</div>
			</div>
			<div class="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
			<div>
				<div class="font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Deploys · 24h</div>
				<div class="mt-1 flex items-baseline gap-2">
					<span class="font-mono text-xl font-light text-gray-900 dark:text-white">{deploys24h}</span>
					<DeployVolumeSparkline rollouts={slots.map((s) => s.cell.rollout)} hours={24} />
				</div>
			</div>
			<p class="ml-auto max-w-sm text-right text-[11px] text-gray-500 dark:text-gray-400">
				{metricsNote}
			</p>
		</section>

		<!-- Running now: per-app status, relative position vs upstream, what & when -->
		<section>
			<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				Running now in {envShort}
			</h2>
			<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				{#if sortedSlots.length === 0}
					<div class="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
						No apps deployed to {envName} yet.
					</div>
				{:else}
					<div class="hidden items-center gap-4 border-b border-gray-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 lg:grid lg:grid-cols-[2.25rem_minmax(160px,1.6fr)_minmax(140px,1.1fr)_minmax(220px,2fr)] dark:border-gray-700/60 dark:text-gray-500">
						<span></span>
						<span>App</span>
						<span>Relative position</span>
						<span>What &amp; when</span>
					</div>
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each sortedSlots as slot (slot.appName + (slot.cell.sourceCluster ?? '') + (slot.cell.rollout.metadata?.namespace ?? ''))}
							{@const latest = slot.cell.rollout.status?.history?.[0]}
							{@const status = latest?.bakeStatus || 'None'}
							{@const lag = cellLag(slot.group, envName)}
							{@const behindBy = lag?.behindBy ?? 0}
							{@const upstream = upstreamCell(slot.group, envName)}
							{@const sha = latest?.version?.revision ? shortenVersion(latest.version.revision) : null}
							{@const message = latest?.message?.trim()}
							{@const stuck = stuckFor(slot)}
							{@const rawHistoryCount = slot.cell.rollout.status?.history?.length ?? 0}
							{@const ticks = historyTicks(slot.cell.rollout.status?.history, TICKS_COUNT)}
							<li>
								<a
									href={rolloutHref(slot.cell)}
									class="grid grid-cols-[2.25rem_1fr] items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50 lg:grid-cols-[2.25rem_minmax(160px,1.6fr)_minmax(140px,1.1fr)_minmax(220px,2fr)] dark:hover:bg-gray-700/30"
								>
									<!-- status -->
									<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
										<BakeStatusIcon bakeStatus={status} size="medium" />
									</span>

									<!-- App -->
									<div class="flex min-w-0 flex-col gap-0.5">
										<div class="flex min-w-0 items-center gap-2">
											<span class="truncate text-base font-bold text-gray-900 dark:text-white">{slot.cell.rollout.status?.title || slot.appName}</span>
											{#if slot.cell.rollout.spec?.wantedVersion}<PinBadge version={slot.cell.rollout.spec.wantedVersion} size="xs" />{/if}
											{#if stuck}<StuckBadge reason={stuck} size="xs" />{/if}
										</div>
										<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{slot.appName}</span>
									</div>

									<!-- Relative position -->
									<div class="flex min-w-0 flex-col gap-0.5">
										{#if behindBy > 0}
											<LagChip {behindBy} />
										{:else}
											<span class="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">
												newest
											</span>
										{/if}
										{#if upstream}
											<span class="truncate text-[11px] text-gray-500 dark:text-gray-400">
												{behindBy > 0 ? `trails ${shortEnvLabel(upstream.theme ?? upstream.envName)}` : `matches ${shortEnvLabel(upstream.theme ?? upstream.envName)}`}
												{#if sha}
													· <span class="font-mono">{sha}</span>
												{/if}
											</span>
										{/if}
									</div>

									<!-- What & when -->
									<div class="flex min-w-0 flex-col gap-1">
										<span class="truncate text-[13px] text-gray-700 dark:text-gray-300" title={message || undefined}>
											{message || '—'}
										</span>
										{#if latest?.timestamp}
											<span class="text-[11px] text-gray-400 dark:text-gray-500">
												deployed {formatTimeAgo(latest.timestamp, $now)}{#if isRunning(status)} · {status === 'InProgress' ? 'baking' : 'deploying'}{/if}
											</span>
										{:else}
											<span class="text-[11px] text-gray-400 dark:text-gray-500">no deploys yet</span>
										{/if}
										{#if rawHistoryCount > 1}
											<DeployHistoryStrip {ticks} />
										{/if}
									</div>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	{/if}
</div>
