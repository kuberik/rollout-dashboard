<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { getDisplayVersion, formatTimeAgo, formatTimeAgoCompact, categorizeFailure, formatStatusTime, compareRollouts, detectStuck } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		SearchOutline,
		ChevronRightOutline,
		CheckOutline,
		HourglassOutline,
		RefreshOutline,
		CloseOutline
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import PipelineGlyph from '$lib/components/PipelineGlyph.svelte';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import { derivePipeline, kruiseRolloutsForRollout } from '$lib/pipeline';
	import type { Rollout, Environment, Kustomization, KruiseRollout } from '../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const kustomizations = $derived<Kustomization[]>(query.data?.kustomizations?.items || []);
	const kruiseRollouts = $derived<KruiseRollout[]>(query.data?.kruiseRollouts?.items || []);

	function envForRollout(r: Rollout): Environment | undefined {
		return environments.find(
			(e) =>
				e.metadata?.namespace === r.metadata?.namespace &&
				e.spec?.rolloutRef?.name === r.metadata?.name
		);
	}

	type StatusKey = 'succeeded' | 'failed' | 'active' | 'pending';

	type Card = {
		ns: string;
		name: string;
		title: string;
		envKey: string;
		envDisplay: string;
		envName: string; // raw env name (e.g. 'staging') for behind-by lookups
		theme: ReturnType<typeof getRolloutEnvironmentTheme>;
		version: string | null;
		timestamp: string | null;
		bakeStatus: string;
		statusKey: StatusKey;
		isRunning: boolean;
		bakeStatusMessage: string | null;
		failureCategory: string | null;
		previousSucceededVersion: string | null;
		pinnedVersion: string | null;
		stuck: StuckReason | null;
		behind: { fromEnv: string; version: string; behindBy: number | null } | null;
		rollout: Rollout;
	};

	// Build a per-app map: appName → Array<{envName, rollout, env}> sorted by env tier.
	// Used to compute "N versions behind" diagnostics on each card.
	const appIndex = $derived.by(() => {
		const map = new Map<string, { envName: string; rollout: Rollout }[]>();
		for (const env of environments) {
			const appName = env.spec?.rolloutRef?.name;
			const envName = env.spec?.environment;
			if (!appName || !envName) continue;
			const ns = env.metadata?.namespace;
			const r = rollouts.find((x) => x.metadata?.name === appName && x.metadata?.namespace === ns);
			if (!r) continue;
			if (!map.has(appName)) map.set(appName, []);
			map.get(appName)!.push({ envName, rollout: r });
		}
		for (const list of map.values()) {
			list.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
		}
		return map;
	});

	// Find the most relevant peer env for this rollout — the one where my
	// current version exists as a past deploy. That env has progressed past
	// me, so we say I'm "behind <env>" — direction derived from data, not
	// from env-name tier assumptions. If no peer has progressed past me but
	// my history contains a peer's current version, I'm "ahead" of it.
	function computeBehind(
		r: Rollout,
		envName: string
	): { fromEnv: string; version: string; behindBy: number | null } | null {
		if (r.spec?.wantedVersion) return null;
		const peers = appIndex.get(r.metadata?.name ?? '');
		if (!peers || peers.length < 2) return null;
		// Prefer peers that have actually moved past me (kind === 'behind').
		// Among them, pick the one with the highest behindBy (furthest behind).
		let best: { fromEnv: string; version: string; behindBy: number | null } | null = null;
		for (const peer of peers) {
			if (peer.envName === envName) continue;
			const rel = compareRollouts(r, peer.rollout);
			if (!rel || rel.kind !== 'behind') continue;
			const candidate = { fromEnv: peer.envName, version: rel.otherVersion, behindBy: rel.by };
			if (!best || (candidate.behindBy ?? 0) > (best.behindBy ?? 0)) best = candidate;
		}
		return best;
	}

	const cards = $derived.by<Card[]>(() => {
		return rollouts.map((r) => {
			const latest = r.status?.history?.[0];
			const env = envForRollout(r);
			const theme = getRolloutEnvironmentTheme(r, env);
			const bakeStatus = latest?.bakeStatus || 'None';
			const isRunning = bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
			let statusKey: StatusKey;
			if (bakeStatus === 'Failed') statusKey = 'failed';
			else if (isRunning) statusKey = 'active';
			else if (!latest) statusKey = 'pending';
			else statusKey = 'succeeded';
			const envDisplay = shortEnvLabel(theme);
			const envName = env?.spec?.environment ?? '';
			const behind = envName ? computeBehind(r, envName) : null;
			// For failed cards: find the most recent succeeded version that's different
			// from the current one. Gives the user a rollback target at a glance.
			let previousSucceededVersion: string | null = null;
			if (bakeStatus === 'Failed') {
				const currentV = latest?.version ? getDisplayVersion(latest.version) : null;
				for (const h of r.status?.history ?? []) {
					if (h.bakeStatus !== 'Succeeded') continue;
					const v = getDisplayVersion(h.version);
					if (v && v !== currentV) {
						previousSucceededVersion = v;
						break;
					}
				}
			}
			return {
				ns: r.metadata?.namespace || '',
				name: r.metadata?.name || '',
				title: r.status?.title || r.metadata?.name || '',
				envKey: theme?.name || '',
				envDisplay,
				envName,
				theme,
				version: latest?.version ? getDisplayVersion(latest.version) : null,
				timestamp: latest?.timestamp || null,
				bakeStatus,
				statusKey,
				isRunning,
				bakeStatusMessage: latest?.bakeStatusMessage || null,
				failureCategory: bakeStatus === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null,
				previousSucceededVersion,
				pinnedVersion: r.spec?.wantedVersion || null,
				stuck: detectStuck(r, { now: $now }),
				behind,
				rollout: r
			};
		});
	});

	// Filters
	let searchQuery = $state('');
	let statusFilters = $state<StatusKey[]>([]);
	let envFilters = $state<string[]>([]);

	function toggleStatus(k: StatusKey) {
		statusFilters = statusFilters.includes(k)
			? statusFilters.filter((x) => x !== k)
			: [...statusFilters, k];
	}
	function toggleEnv(name: string) {
		envFilters = envFilters.includes(name)
			? envFilters.filter((x) => x !== name)
			: [...envFilters, name];
	}
	function clearFilters() {
		statusFilters = [];
		envFilters = [];
		searchQuery = '';
	}

	const knownEnvs = $derived.by(() => {
		const map = new Map<string, { display: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> }>();
		for (const c of cards) {
			if (!c.envKey) continue;
			if (!map.has(c.envKey)) map.set(c.envKey, { display: c.envDisplay, theme: c.theme });
		}
		return [...map.entries()]
			.map(([key, v]) => ({ key, display: v.display, theme: v.theme }))
			.sort((a, b) => compareEnvironmentNames(a.display, b.display));
	});

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return cards.filter((c) => {
			if (statusFilters.length > 0 && !statusFilters.includes(c.statusKey)) return false;
			if (envFilters.length > 0 && !envFilters.includes(c.envKey)) return false;
			if (q) {
				const hay = `${c.ns} ${c.name} ${c.title} ${c.envKey} ${c.envDisplay} ${c.version ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Group filtered cards by namespace, sort cards within group by severity then recency,
	// sort groups by worst severity first then alphabetical.
	type NsGroup = {
		ns: string;
		cards: Card[];
		failedCount: number;
		activeCount: number;
		pendingCount: number;
		severity: number; // 3 failed, 2 active, 1 pending, 0 healthy
		newestDeploy: string | null;
	};

	const grouped = $derived.by<NsGroup[]>(() => {
		const sevRank: Record<StatusKey, number> = { failed: 0, active: 1, pending: 2, succeeded: 3 };
		const map = new Map<string, NsGroup>();
		for (const c of filtered) {
			let g = map.get(c.ns);
			if (!g) {
				g = {
					ns: c.ns,
					cards: [],
					failedCount: 0,
					activeCount: 0,
					pendingCount: 0,
					severity: 0,
					newestDeploy: null
				};
				map.set(c.ns, g);
			}
			g.cards.push(c);
			if (c.statusKey === 'failed') g.failedCount++;
			else if (c.statusKey === 'active') g.activeCount++;
			else if (c.statusKey === 'pending') g.pendingCount++;
			if (c.timestamp && (!g.newestDeploy || new Date(c.timestamp) > new Date(g.newestDeploy))) {
				g.newestDeploy = c.timestamp;
			}
		}
		for (const g of map.values()) {
			g.severity =
				g.failedCount > 0 ? 3 : g.activeCount > 0 ? 2 : g.pendingCount > 0 ? 1 : 0;
			g.cards.sort((a, b) => {
				const s = sevRank[a.statusKey] - sevRank[b.statusKey];
				if (s !== 0) return s;
				const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
				const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
				return bt - at;
			});
		}
		return [...map.values()].sort((a, b) => {
			if (b.severity !== a.severity) return b.severity - a.severity;
			return a.ns.localeCompare(b.ns);
		});
	});

	// Counters from full set (not filtered) for the header pills
	const counts = $derived.by(() => {
		const c = { succeeded: 0, failed: 0, active: 0, pending: 0 };
		for (const card of cards) c[card.statusKey]++;
		return c;
	});

	// Things that need attention — surfaced above the main list when present.
	// Failed comes first, then stuck. Pinned-version cards are intentionally
	// excluded because the user opted in to that state.
	const attentionItems = $derived.by(() => {
		const out: { card: Card; reason: 'failed' | 'stuck'; detail: string }[] = [];
		for (const c of cards) {
			if (c.statusKey === 'failed') {
				const detail = c.failureCategory ? `${c.failureCategory} failed` : 'failed';
				out.push({ card: c, reason: 'failed', detail });
			} else if (c.stuck) {
				const r = c.stuck;
				const detail = r.kind === 'baking'
					? `baking >1h`
					: r.kind === 'deploying'
						? `deploying >1h`
						: `behind ${r.peerEnv}`;
				out.push({ card: c, reason: 'stuck', detail });
			}
		}
		// Failed first, then stuck. Cap at 6 so the strip stays calm.
		return out.sort((a, b) => (a.reason === 'failed' ? 0 : 1) - (b.reason === 'failed' ? 0 : 1)).slice(0, 6);
	});

	// Activity pulse: how many deploys landed in the last 24h. Gives the user
	// a sense of cluster cadence (idle weekend vs busy release day).
	const recent24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const c of cards) {
			if (!c.timestamp) continue;
			if (new Date(c.timestamp).getTime() >= cutoff) n++;
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
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header — meta on the right reads `last 24h [spark] N deploys`
	     per design. No refetch spinner; refetches happen silently. -->
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">Rollouts</h1>
		{#if cards.length > 0 && recent24h > 0}
			<a href="/activity" class="hidden items-center gap-2 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 sm:inline-flex" title="View activity">
				<span class="font-mono uppercase tracking-wider">last 24h</span>
				<DeployVolumeSparkline {rollouts} hours={24} buckets={20} />
				<span class="font-mono tabular-nums">{recent24h} deploy{recent24h === 1 ? '' : 's'}</span>
			</a>
		{/if}
	</div>

	<!-- Stat tiles: clickable status filters. The big visual at the top
	     of the page so an engineer immediately knows the fleet state. -->
	{#if cards.length > 0}
		<!-- Each tile uses a distinct, static icon — the row-status pause
		     icon was being reused everywhere and made the zero tiles
		     indistinguishable. Bake spinner stays inline on actual list
		     rows; these are summary tiles, no animation needed. -->
		{@const tiles = [
			{ key: 'succeeded' as StatusKey, label: 'Healthy', count: counts.succeeded, bake: 'Succeeded', icon: CheckOutline, iconTone: 'text-green-600 dark:text-green-400' },
			{ key: 'active' as StatusKey, label: 'In progress', count: counts.active, bake: 'Deploying', icon: RefreshOutline, iconTone: 'text-blue-600 dark:text-blue-400' },
			{ key: 'pending' as StatusKey, label: 'Pending', count: counts.pending, bake: 'None', icon: HourglassOutline, iconTone: 'text-gray-500 dark:text-gray-400' },
			{ key: 'failed' as StatusKey, label: 'Failed', count: counts.failed, bake: 'Failed', icon: CloseOutline, iconTone: 'text-red-600 dark:text-red-400' }
		]}
		<div class="mb-4 grid gap-2 grid-cols-2 sm:grid-cols-4">
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
					<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {isZero ? 'bg-gray-50 dark:bg-gray-700/30' : getStatusCircleClass(t.bake)}">
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

	<!-- Filter bar: search + compact env filter pills (per design). -->
	{#if cards.length > 0}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search rollouts…"
					class="block w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				{#each knownEnvs as e}
					{@const sel = envFilters.includes(e.key)}
					<button
						type="button"
						onclick={() => toggleEnv(e.key)}
						aria-pressed={sel}
						class="environment-theme-scope inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors
							{sel
								? 'environment-theme-badge'
								: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					>{e.display}</button>
				{/each}
			</div>
			{#if envFilters.length > 0 || statusFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
				>clear</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-6">
			{#each Array(2) as _}
				<div>
					<div class="mb-3 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="h-3 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-4 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each Array(3) as _}
								<li class="flex items-center gap-4 px-5 py-4">
									<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
									<div class="flex flex-1 flex-col gap-1.5">
										<div class="h-3.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
									</div>
									<div class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-4 w-12 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load rollouts: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<!-- Faded sample card preview showing what a rollout looks like -->
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
						<span class="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-700 dark:text-gray-300">PROD</span>
					</div>
					<div class="mt-2 flex items-baseline justify-between gap-3 pl-12">
						<span class="font-mono text-sm font-medium text-gray-700 dark:text-gray-300">v1.2.3</span>
						<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">2h</span>
					</div>
				</div>
			</div>
			<!-- Empty state message + CTA -->
			<div class="mt-8 text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No rollouts yet</p>
				<p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400 mx-auto">Cards like the one above will appear here once you create a <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code> resource in your cluster.</p>
				<a
					href="https://github.com/kuberik/rollout-controller"
					target="_blank"
					rel="noopener noreferrer"
					class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
				>
					Read the docs
					<span aria-hidden="true">↗</span>
				</a>
			</div>
		</div>
	{:else if grouped.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No matches</p>
			<button
				type="button"
				onclick={clearFilters}
				class="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			>Clear filters</button>
		</div>
	{:else}
		{#if attentionItems.length > 0 && statusFilters.length === 0 && envFilters.length === 0 && !searchQuery}
			{@const failedCount = attentionItems.filter((i) => i.reason === 'failed').length}
			{@const stuckCount = attentionItems.filter((i) => i.reason === 'stuck').length}
			<!-- Needs attention: loud red-tinted hero when there are failures.
			     Falls back to amber tint when only stuck (less urgent). -->
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
							{#if failedCount > 0}{failedCount} {failedCount === 1 ? 'rollout has' : 'rollouts have'} failed{#if stuckCount > 0}, {stuckCount} stuck{/if}
							{:else}{stuckCount} {stuckCount === 1 ? 'rollout is' : 'rollouts are'} stuck{/if}
						</span>
						<span class="text-xs {failedCount > 0 ? 'text-red-700/80 dark:text-red-300/80' : 'text-amber-700/80 dark:text-amber-300/80'}">Click to jump to the rollout.</span>
					</div>
				</div>
				<ul class="divide-y {failedCount > 0 ? 'divide-red-200/60 dark:divide-red-800/40' : 'divide-amber-200/60 dark:divide-amber-800/40'}">
					{#each attentionItems as item}
						{@const c = item.card}
						<li class="environment-theme-scope" style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}>
							<a
								href={`/rollouts/${c.ns}/${c.name}`}
								class="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/60 dark:hover:bg-gray-800/60"
							>
								<span class="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(c.bakeStatus)}">
									<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
								</span>
								<div class="flex min-w-0 flex-1 items-baseline gap-2">
									<span class="truncate text-sm font-medium text-gray-900 dark:text-white">{c.title}</span>
									<span class="truncate text-xs {failedCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}">· {item.detail}</span>
								</div>
								<span class="shrink-0 font-mono text-[10px] text-gray-500 dark:text-gray-400">{c.ns}</span>
								{#if c.envDisplay}
									<span class="environment-theme-badge inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{c.envDisplay}</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<div class="space-y-6">
			{#each grouped as g (g.ns)}
				<section>
					<!-- Namespace header -->
					<a
						href={`/namespaces/${g.ns}`}
						class="group mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-2 dark:border-gray-700/60"
					>
						<div class="flex min-w-0 items-baseline gap-2">
							<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
							<span class="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">{g.cards.length}</span>
							{#if g.failedCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400">· {g.failedCount} failed</span>
							{:else if g.activeCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-yellow-700 dark:text-yellow-400">· {g.activeCount} in progress</span>
							{:else if g.pendingCount > 0}
								<span class="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">· {g.pendingCount} pending</span>
							{/if}
						</div>
						<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
					</a>

					<!-- Rollouts panel with column headers + fixed-width rows so
					     all rollouts in this namespace align across columns. -->
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<!-- Column header row (lg only) -->
						<div class="row-grid hidden gap-x-4 border-b border-gray-100 px-5 py-2 font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:border-gray-700/60 dark:text-gray-500 lg:grid">
							<span></span>
							<span>Rollout</span>
							<span>Pipeline</span>
							<span>24h</span>
							<span class="text-right">Version · age</span>
							<span></span>
						</div>
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each g.cards as c (c.ns + '/' + c.name)}
								<li class="environment-theme-scope" style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}>
									<a
										href={`/rollouts/${c.ns}/${c.name}`}
										class="row-grid gap-x-4 gap-y-2 px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 sm:px-5"
									>
										<!-- Status icon. No animate-ping halo on list rows — the
										     icon (pulse for bake, spinner for deploy) is enough
										     signal; the halo at row scale read as "too much". -->
										<span class="relative col-start-1 row-span-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(c.bakeStatus)} sm:row-span-1">
											<BakeStatusIcon bakeStatus={c.bakeStatus} size="medium" />
										</span>

										<!-- Title block: title · name · diagnostic line -->
										<div class="flex min-w-0 flex-col">
											<div class="flex min-w-0 items-baseline gap-2">
												<span class="truncate text-base font-semibold text-gray-900 dark:text-white">{c.title}</span>
												{#if c.stuck}<StuckBadge reason={c.stuck} size="xs" />{/if}
											</div>
											<div class="flex min-w-0 items-baseline gap-2">
												<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{c.name}</span>
												{#if c.failureCategory}
													<span class="truncate text-[11px] text-red-600 dark:text-red-400" title={c.bakeStatusMessage ?? ''}>· {c.failureCategory} failed</span>
												{:else if c.behind}
													<span class="truncate text-[11px] text-amber-700 dark:text-amber-400" title={`Behind ${c.behind.version} on ${c.behind.fromEnv}`}>
														· {c.behind.behindBy && c.behind.behindBy > 0 ? `${c.behind.behindBy} behind` : 'behind'} {c.behind.fromEnv}
													</span>
												{:else if c.bakeStatus === 'InProgress'}
													<span class="truncate text-[11px] text-yellow-700 dark:text-yellow-400">· baking</span>
												{:else if c.bakeStatus === 'Deploying'}
													<span class="truncate text-[11px] text-blue-600 dark:text-blue-400">· deploying</span>
												{/if}
											</div>
										</div>

										<!-- Pipeline glyph: real canary-step stages from the linked
										     KruiseRollout(s) + a trailing bake cell. Multi-KR
										     rollouts render as stacked tracks so steps don't read
										     across tracks. Bake stays pending until all tracks
										     complete — same gating as the rollout detail page. -->
										<div class="hidden shrink-0 items-center lg:flex">
											<PipelineGlyph summary={derivePipeline(c.rollout, kruiseRolloutsForRollout(c.rollout, kustomizations, kruiseRollouts))} />
										</div>

										<!-- 24h sparkline: this rollout's hourly deploy density.
										     12 buckets (2h each) for visual density. -->
										<div class="hidden shrink-0 items-center lg:flex" aria-label="24h deploys">
											<DeployVolumeSparkline rollouts={[c.rollout]} hours={24} buckets={12} />
										</div>

										<!-- Version + age block (right side) -->
										<div class="col-start-2 row-start-2 flex min-w-0 flex-col sm:col-start-auto sm:row-start-auto sm:items-end">
											<div class="flex min-w-0 items-baseline gap-1.5">
												{#if c.pinnedVersion}<PinBadge version={c.pinnedVersion} size="xs" />{/if}
												<span class="truncate font-mono text-sm font-medium text-gray-900 dark:text-white" title={c.version ?? ''}>{c.version ?? '—'}</span>
											</div>
											{#if c.timestamp}
												<span class="font-mono text-[10px] {c.isRunning ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}" title={formatTimeAgo(c.timestamp, $now)}>
													{c.isRunning ? 'started ' : ''}{formatStatusTime(c.bakeStatus, c.timestamp, $now)}
												</span>
											{:else}
												<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">no deploy</span>
											{/if}
										</div>

										<!-- Env badge -->
										{#if c.envDisplay}
											<span class="environment-theme-badge inline-flex shrink-0 items-center justify-self-center rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{c.envDisplay}</span>
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					</div>

			</section>
			{/each}
		</div>
	{/if}
</div>
