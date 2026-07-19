<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp, versionPathForRollout } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { cellLag } from '$lib/view-models/lag';
	import { getEnvironmentRank } from '$lib/env-order';
	import {
		getDisplayVersion,
		formatTimeAgo,
		detectStuck,
		detectStuckBehind
	} from '$lib/utils';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { ArrowLeftOutline, ArrowRightOutline, LayersSolid } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import LagChip from '$lib/components/LagChip.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../../types';

	const appName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Same grouping the Apps list / apps×env matrix use — a single source of
	// truth for "what is this app's per-env cell", so the detail page can't
	// drift from the fleet-wide view. Cells are already sorted upstream-first
	// (dev → staging → prod) by env-tier rank.
	const groups = $derived.by<Map<string, AppGroup>>(() => groupRolloutsByApp(rollouts, environments));
	const group = $derived<AppGroup | undefined>(groups.get(appName));
	const cells = $derived<AppCell[]>(group?.cells ?? []);
	const hasEnvironmentBinding = $derived(group?.hasEnvironmentBinding ?? false);

	// Build the rollout detail path with the source cluster name embedded, so a
	// card click opens the rollout on the cluster it actually lives on.
	function rolloutHref(cell: AppCell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || ''
		);
	}

	function envLabelFor(cell: AppCell): string {
		return hasEnvironmentBinding ? cell.envName : (cell.theme?.label ?? cell.envName);
	}

	// "Prod regions" in the real data model are multi-cluster fan-out at the
	// prod tier (multiple Environment resources whose tier is prod, one per
	// cluster/region) — not a separate concept. We only split cells into
	// stage-steps vs. prod-fan-out when the app actually has Environment
	// bindings (env-tier rank is meaningless for the no-binding namespace
	// fallback below).
	function isProdTier(envName: string): boolean {
		return getEnvironmentRank(envName) >= 7;
	}
	const stageCells = $derived(hasEnvironmentBinding ? cells.filter((c) => !isProdTier(c.envName)) : cells);
	const prodCells = $derived(hasEnvironmentBinding ? cells.filter((c) => isProdTier(c.envName)) : []);

	const appTitle = $derived.by(() => {
		const titles: string[] = [];
		for (const c of cells) {
			if (c.rollout.status?.title) titles.push(c.rollout.status.title);
		}
		if (titles.length === 0) return appName;
		if (hasEnvironmentBinding) return titles[0];
		// Fallback mode: titles often have env suffixes like 'Foo / dev'. Find the longest
		// common prefix, then strip trailing separator characters.
		let prefix = titles[0];
		for (const t of titles.slice(1)) {
			let i = 0;
			while (i < prefix.length && i < t.length && prefix[i] === t[i]) i++;
			prefix = prefix.slice(0, i);
		}
		const cleaned = prefix.replace(/[\s\-/|·:]+$/, '').trim();
		return cleaned.length >= 3 ? cleaned : titles.sort((a, b) => a.length - b.length)[0];
	});

	const appDescription = $derived.by(() => {
		for (const c of cells) {
			if (c.rollout.status?.description && c.rollout.status.description !== c.rollout.status.title) {
				return c.rollout.status.description;
			}
		}
		return null;
	});

	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}

	function cellStatus(cell: AppCell): string {
		return cell.rollout.status?.history?.[0]?.bakeStatus || 'None';
	}

	// Distinct versions across the app, upstream(newest)-first — the same
	// "upstream tier = newest" convention `cellLag`/`buildMatrix` use. Only
	// meaningful when the app has real Environment bindings (a real tier
	// order to walk); see versionReleaseRank for the no-binding fallback.
	const versionsUpstreamFirst = $derived.by<string[]>(() => {
		const list: string[] = [];
		for (const c of cells) {
			const v = cellVersion(c);
			if (v && !list.includes(v)) list.push(v);
		}
		return list;
	});

	// Per-app version rank by release time — used only for apps with no
	// Environment binding, where there's no promotion-tier order to derive
	// "newest" from. Rank 0 = the most recently released version.
	const versionReleaseRank = $derived.by<Map<string, number>>(() => {
		const maxCreatedByVer = new Map<string, number>();
		for (const c of cells) {
			for (const h of c.rollout.status?.history ?? []) {
				const v = h.version ? getDisplayVersion(h.version) : null;
				if (!v) continue;
				const created = h.version?.created;
				const createdMs = created
					? new Date(created).getTime()
					: h.timestamp
						? new Date(h.timestamp).getTime()
						: 0;
				const prev = maxCreatedByVer.get(v);
				if (prev === undefined || createdMs > prev) maxCreatedByVer.set(v, createdMs);
			}
		}
		const sorted = [...maxCreatedByVer.entries()].sort((a, b) => b[1] - a[1]);
		const rank = new Map<string, number>();
		sorted.forEach(([v], i) => rank.set(v, i));
		return rank;
	});

	// The app's frontier version — the newest build known anywhere in its
	// history. For env-bound apps this is the most-upstream cell's version
	// (dev-most tier); for the no-binding fallback it's the most recently
	// released version by timestamp.
	const frontierVersion = $derived.by<string | null>(() => {
		if (cells.length === 0) return null;
		if (hasEnvironmentBinding) return versionsUpstreamFirst[0] ?? null;
		for (const [v, r] of versionReleaseRank) if (r === 0) return v;
		return null;
	});

	// How many known versions this cell trails the frontier by (0 = "newest").
	function behindNewestCount(cell: AppCell): number | null {
		const v = cellVersion(cell);
		if (!v) return null;
		if (hasEnvironmentBinding) {
			const idx = versionsUpstreamFirst.indexOf(v);
			return idx === -1 ? null : idx;
		}
		return versionReleaseRank.get(v) ?? null;
	}

	// Gap to this cell's immediate upstream neighbor in the promotion chain
	// (Task 3's cellLag — also what the Apps list / matrix badge every cell
	// with). Used for the arrow labels between adjacent stepper steps.
	function hopLag(cell: AppCell): number | null {
		if (!group || !hasEnvironmentBinding) return null;
		return cellLag(group, cell.envName)?.behindBy ?? null;
	}

	function stuckFor(cell: AppCell) {
		const own = detectStuck(cell.rollout, { now: $now });
		if (own) return own;
		for (const peer of cells) {
			if (peer === cell) continue;
			const r = detectStuckBehind(cell.rollout, peer.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}

	const activeCount = $derived(
		cells.filter((c) => ['InProgress', 'Deploying'].includes(cellStatus(c))).length
	);
	const failedCount = $derived(cells.filter((c) => cellStatus(c) === 'Failed').length);
	const laggingCells = $derived(hasEnvironmentBinding ? cells.filter((c) => (hopLag(c) ?? 0) > 0) : []);
	const allOnNewest = $derived(cells.length > 0 && cells.every((c) => behindNewestCount(c) === 0));

	// Propagation prose line — "Newest build {v} is live in {L} of {N}
	// environments. Not yet caught up: {ENV (why)}, …." or, when converged,
	// "Fully propagated — {v} is live in all {N} environments."
	type Propagation = { fully: boolean; text: string };
	const propagation = $derived.by<Propagation | null>(() => {
		if (!frontierVersion || cells.length === 0) return null;
		const live = cells.filter((c) => cellVersion(c) === frontierVersion);
		const lagging = cells.filter((c) => cellVersion(c) !== frontierVersion);
		const noun = hasEnvironmentBinding ? 'environment' : 'rollout';
		const envWord = cells.length === 1 ? noun : `${noun}s`;
		if (lagging.length === 0) {
			return {
				fully: true,
				text:
					cells.length === 1
						? `Fully propagated — ${frontierVersion} is live in the only ${noun}.`
						: `Fully propagated — ${frontierVersion} is live in all ${cells.length} ${envWord}.`
			};
		}
		const reasons = lagging.map((c) => {
			const status = cellStatus(c);
			const label = envLabelFor(c);
			if (status === 'Failed') return `${label} (failed)`;
			if (status === 'InProgress') return `${label} (baking)`;
			if (status === 'Deploying') return `${label} (deploying)`;
			const behind = behindNewestCount(c);
			return behind ? `${label} (−${behind})` : `${label} (behind)`;
		});
		return {
			fully: false,
			text: `Newest build ${frontierVersion} is live in ${live.length} of ${cells.length} ${envWord}. Not yet caught up: ${reasons.join(', ')}.`
		};
	});

	// ──────────────────────── Version history spine ────────────────────────
	// For each known build in this app's history: which envs are currently on
	// it (`current`), and which envs ran it in the past (`past`, deduped with
	// a count). Same derivation the previous revision of this page used for
	// its Gantt, just rendered as a flat list here instead of a timeline.
	type VersionLifecycle = {
		version: string;
		revision: string | null;
		current: { envName: string; cell: AppCell; bakeStatus: string; timestamp: string }[];
		past: { envName: string; cell: AppCell; timestamp: string; count: number }[];
	};

	const versionLifecycles = $derived.by<VersionLifecycle[]>(() => {
		const map = new Map<string, VersionLifecycle>();
		const pastByKey = new Map<string, { envName: string; cell: AppCell; timestamp: string; count: number }>();
		for (const c of cells) {
			const h = c.rollout.status?.history;
			if (!h || h.length === 0) continue;
			const current = h[0];
			const currentVer = getDisplayVersion(current.version);
			if (!map.has(currentVer)) {
				map.set(currentVer, { version: currentVer, revision: current.version?.revision ?? null, current: [], past: [] });
			}
			map.get(currentVer)!.current.push({
				envName: c.envName,
				cell: c,
				bakeStatus: current.bakeStatus || 'None',
				timestamp: current.timestamp
			});
			for (let i = 1; i < h.length; i++) {
				const pastVer = getDisplayVersion(h[i].version);
				if (!map.has(pastVer)) {
					map.set(pastVer, { version: pastVer, revision: h[i].version?.revision ?? null, current: [], past: [] });
				}
				const key = `${pastVer} ${c.envName} ${c.rollout.metadata?.namespace ?? ''}`;
				const existing = pastByKey.get(key);
				if (existing) {
					existing.count += 1;
					if (new Date(h[i].timestamp) > new Date(existing.timestamp)) existing.timestamp = h[i].timestamp;
				} else {
					const entry = { envName: c.envName, cell: c, timestamp: h[i].timestamp, count: 1 };
					pastByKey.set(key, entry);
					map.get(pastVer)!.past.push(entry);
				}
			}
		}
		const out = [...map.values()];
		for (const v of out) v.past.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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

	function anyRolloutFor(v: VersionLifecycle): Rollout | null {
		return v.current[0]?.cell.rollout ?? v.past[0]?.cell.rollout ?? null;
	}
	function anyClusterFor(v: VersionLifecycle): string {
		return v.current[0]?.cell.sourceCluster || v.past[0]?.cell.sourceCluster || localClusterName;
	}

	const STATUS_CHIP: Record<string, string> = {
		Succeeded: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
		Failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
		InProgress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
		Deploying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
		Cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400',
		None: 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400'
	};
</script>

<svelte:head>
	<title>kuberik | {appTitle}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">

	{#if query.isLoading}
		<div class="space-y-6">
			<!-- Header skeleton -->
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<!-- Promotion stepper skeleton -->
			<div>
				<div class="mb-3 h-3 w-32 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
				<div class="flex flex-wrap gap-3">
					{#each Array(3) as _}
						<div class="h-20 min-w-[168px] flex-1 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
					{/each}
				</div>
			</div>
			<!-- Version history + activity skeleton -->
			<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			</div>
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
				href="/apps"
				class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			>
				<ArrowLeftOutline class="h-3.5 w-3.5" /> Back to apps
			</a>
		</div>
	{:else}
		<!-- Header -->
		<div class="mb-6">
			<div class="flex items-baseline justify-between gap-3">
				<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">{appTitle}</h1>
			</div>
			<div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
				<code class="font-mono text-xs text-gray-400 dark:text-gray-500">{appName}</code>
				<span>
					{#if hasEnvironmentBinding}
						<span class="tabular-nums text-gray-700 dark:text-gray-300">{cells.length}</span> env{cells.length === 1 ? '' : 's'}
					{:else}
						<span class="tabular-nums text-gray-700 dark:text-gray-300">{cells.length}</span> rollout{cells.length === 1 ? '' : 's'}
					{/if}
				</span>
				{#if hasEnvironmentBinding && prodCells.length > 0}
					<span>· <span class="tabular-nums text-gray-700 dark:text-gray-300">{prodCells.length}</span> prod region{prodCells.length === 1 ? '' : 's'}</span>
				{/if}
				{#if activeCount > 0}<span class="font-medium text-blue-600 dark:text-blue-400">· {activeCount} active</span>{/if}
				{#if failedCount > 0}<span class="font-medium text-red-600 dark:text-red-400">· {failedCount} failed</span>{/if}
				{#if failedCount === 0 && activeCount === 0 && allOnNewest}<span class="text-green-600 dark:text-green-400">· all on newest</span>{/if}
				{#if failedCount === 0 && activeCount === 0 && !allOnNewest && laggingCells.length > 0}
					<span>· {laggingCells.map((c) => `${envLabelFor(c)} −${hopLag(c)}`).join(', ')}</span>
				{/if}
			</div>
			{#if propagation}
				<p class="mt-2 max-w-3xl text-sm {propagation.fully ? 'text-green-700 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}">
					{propagation.text}
				</p>
			{/if}
			{#if appDescription}
				<p class="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{appDescription}</p>
			{/if}
		</div>

		{#snippet stepNode(c: AppCell)}
			{@const status = cellStatus(c)}
			{@const ver = cellVersion(c)}
			{@const behind = behindNewestCount(c)}
			{@const stuck = stuckFor(c)}
			<a
				href={rolloutHref(c)}
				class="environment-theme-scope flex min-w-[168px] shrink-0 flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-gray-600"
				style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
			>
				<div class="flex items-center justify-between gap-2">
					<span class="environment-theme-badge truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{envLabelFor(c)}</span>
					<span class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
						<BakeStatusIcon bakeStatus={status} size="small" />
					</span>
				</div>
				<div class="flex flex-wrap items-baseline gap-1.5">
					{#if c.rollout.spec?.wantedVersion}<PinBadge version={c.rollout.spec.wantedVersion} size="xs" />{/if}
					<span class="truncate font-mono text-sm text-gray-900 dark:text-white">{ver ?? '—'}</span>
				</div>
				{#if ver}
					<div class="flex flex-wrap items-center gap-1">
						{#if behind === 0}
							<span class="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">
								newest
							</span>
						{:else if behind !== null}
							<LagChip behindBy={behind} />
						{/if}
						{#if stuck}<StuckBadge reason={stuck} size="xs" />{/if}
					</div>
				{/if}
			</a>
		{/snippet}

		<!-- Promotion stepper: stage envs left→right in promotion order, prod
		     regions (multi-cluster fan-out at the prod tier) fanning out at the
		     end. Arrows carry the cellLag gap between adjacent stages. -->
		<section class="mb-6">
			<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				Promotion
			</h2>
			<div class="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="flex flex-wrap items-center gap-2">
					{#each stageCells as c, i (c.envName + (c.rollout.metadata?.namespace ?? ''))}
						{#if i > 0}
							{@const lag = hopLag(c)}
							<div class="flex shrink-0 flex-col items-center px-1 text-center">
								<ArrowRightOutline class="h-4 w-4 text-gray-300 dark:text-gray-600" />
								{#if lag !== null}
									<span class="mt-0.5 whitespace-nowrap text-[10px] font-medium {lag > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}">
										{lag > 0 ? `${lag} behind` : 'in sync'}
									</span>
								{/if}
							</div>
						{/if}
						{@render stepNode(c)}
					{/each}

					{#if prodCells.length > 0}
						<div class="flex shrink-0 flex-col items-center px-1 text-center">
							<ArrowRightOutline class="h-4 w-4 text-gray-300 dark:text-gray-600" />
							{#if prodCells.length === 1}
								{@const lag = hopLag(prodCells[0])}
								{#if lag !== null}
									<span class="mt-0.5 whitespace-nowrap text-[10px] font-medium {lag > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}">
										{lag > 0 ? `${lag} behind` : 'in sync'}
									</span>
								{/if}
							{:else}
								<span class="mt-0.5 whitespace-nowrap text-[10px] font-medium text-gray-400 dark:text-gray-500">{prodCells.length} regions</span>
							{/if}
						</div>
						<div class="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gray-200 p-2 dark:border-gray-700">
							{#each prodCells as c (c.envName + (c.rollout.metadata?.namespace ?? ''))}
								{@render stepNode(c)}
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</section>

		<!-- Two-column workspace: version history spine (commit spine — every
		     known build and which env runs it) on the left, recent activity
		     rail on the right. -->
		<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
			<section>
				<h2 class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
					Version history
				</h2>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					{#if versionLifecycles.length === 0}
						<div class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
							No deploy history yet.
						</div>
					{:else}
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each versionLifecycles as v, i (v.version)}
								{@const rollout = anyRolloutFor(v)}
								{@const prev = versionLifecycles[i + 1]}
								<li class="px-4 py-3">
									<div class="flex flex-wrap items-center gap-2">
										{#if rollout}
											<a
												href={versionPathForRollout(rollout, appName, v.version)}
												class="font-mono text-sm font-semibold text-gray-900 hover:underline dark:text-white"
											>{v.version}</a>
										{:else}
											<span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">{v.version}</span>
										{/if}
										{#if v.version === frontierVersion}
											<span class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">
												newest
											</span>
										{/if}
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
										{#each v.current as entry (entry.envName + (entry.cell.rollout.metadata?.namespace ?? ''))}
											<span
												class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider {STATUS_CHIP[entry.bakeStatus] ?? STATUS_CHIP.None}"
												title={`${envLabelFor(entry.cell)} · ${entry.bakeStatus} · ${formatTimeAgo(entry.timestamp, $now)}`}
											>{envLabelFor(entry.cell)}</span>
										{/each}
										{#each v.past as entry (entry.envName + (entry.cell.rollout.metadata?.namespace ?? ''))}
											<span
												class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:bg-gray-700/40 dark:text-gray-400"
												title={`${envLabelFor(entry.cell)} · ${entry.count}× · last ${formatTimeAgo(entry.timestamp, $now)}`}
											>{envLabelFor(entry.cell)}{#if entry.count > 1}<span class="font-mono normal-case"> ×{entry.count}</span>{/if}</span>
										{/each}
									</div>
									{#if rollout && prev}
										<div class="mt-1.5">
											<CommitSummary
												namespace={rollout.metadata?.namespace ?? ''}
												name={rollout.metadata?.name ?? ''}
												cluster={anyClusterFor(v)}
												base={prev.revision}
												head={v.revision}
												verb={`since ${prev.version}`}
												hideWhenEmpty
											/>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>

			<aside>
				<ActivityRail
					rollouts={cells.map((c) => c.rollout)}
					environments={cells.map((c) => c.environment).filter((e): e is Environment => !!e)}
					limit={14}
					activityHref={`/activity?app=${encodeURIComponent(appName)}`}
					{localClusterName}
				/>
			</aside>
		</div>
	{/if}
</div>
