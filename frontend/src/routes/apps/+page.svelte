<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup } from '$lib/version-utils';
	import { buildMatrix } from '$lib/view-models/matrix';
	import type { MatrixCellVM } from '$lib/view-models/matrix';
	import { detectStuck, detectStuckBehind, formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { ExclamationCircleOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Same grouping the rest of the redesign uses: `groups` gives us the raw
	// per-cell rollout (for bakeStatus/stuck/pin detection), `matrix` gives us
	// the sorted env-tier columns + per-cell version/behindBy (Task 4's
	// `buildMatrix`, already unit-tested). Combining both here is
	// presentation-only glue — the derivations themselves aren't duplicated.
	const groups = $derived.by<Map<string, AppGroup>>(() => groupRolloutsByApp(rollouts, environments));
	const matrix = $derived.by(() => buildMatrix(rollouts, environments));

	type CellState =
		| 'fail'
		| 'stuck'
		| 'deploying'
		| 'baking'
		| 'pending'
		| 'onNewest'
		| 'behind1'
		| 'behind2';

	type RowCell = {
		tier: string;
		envLabel: string;
		version: string;
		behindBy: number;
		state: CellState;
		tag: string;
		timestamp: string | null;
	};

	type AppRow = {
		appName: string;
		title: string;
		cells: RowCell[];
		envCount: number;
		deployedCount: number;
		onNewestCount: number;
		worstLag: number;
		worst: CellState;
		rank: number;
		newestVersion: string | null;
		mostRecentTs: string | null;
		lead: string;
	};

	// Convergence-bar cell colors — matches the bake-status palette used
	// everywhere else in the app (green=succeeded, red=failed, blue=Deploying,
	// yellow=InProgress/baking, amber=stuck, gray=pending). "Behind" isn't a
	// bake-status value, so it gets two amber shades of its own (light = 1
	// behind, darker = 2+ behind) rather than inventing a new hue.
	const CELL_CLASS: Record<CellState, string> = {
		fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
		stuck: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
		pending: 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400',
		deploying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
		baking: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
		onNewest: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
		behind1: 'bg-amber-50 text-amber-600 dark:bg-amber-900/15 dark:text-amber-400',
		behind2: 'bg-amber-200 text-amber-800 dark:bg-amber-800/40 dark:text-amber-200'
	};

	// Worst-first priority — drives both the row's leading status circle and
	// the "needs attention" sort rank below.
	const SEVERITY: CellState[] = [
		'fail',
		'stuck',
		'deploying',
		'baking',
		'behind2',
		'behind1',
		'pending',
		'onNewest'
	];

	// Classify one app's cell at one env tier into the small set of states the
	// convergence bar renders. Reuses `detectStuck`/`detectStuckBehind` (same
	// stuck logic as the rest of the dashboard) and `vm.statusKey`/`behindBy`
	// from `buildMatrix` — no new status vocabulary invented here.
	function classifyCell(
		group: AppGroup,
		tier: string,
		vm: MatrixCellVM,
		refNow: Date
	): { state: CellState; tag: string; timestamp: string | null } {
		const cell = group.cells.find((c) => c.environment?.spec?.environment === tier);
		const rollout = cell?.rollout ?? null;
		const bakeStatus = rollout?.status?.history?.[0]?.bakeStatus || 'None';
		const timestamp = rollout?.status?.history?.[0]?.timestamp ?? null;
		const pinned = !!rollout?.spec?.wantedVersion;

		let stuckReason = detectStuck(rollout, { now: refNow });
		if (!stuckReason && cell) {
			for (const peer of group.cells) {
				if (peer === cell) continue;
				const r = detectStuckBehind(rollout, peer.rollout, peer.envName, { now: refNow });
				if (r) {
					stuckReason = r;
					break;
				}
			}
		}

		if (vm.statusKey === 'failed') return { state: 'fail', tag: 'fail', timestamp };
		if (stuckReason) return { state: 'stuck', tag: '···', timestamp };
		if (bakeStatus === 'Deploying') return { state: 'deploying', tag: '···', timestamp };
		if (bakeStatus === 'InProgress') return { state: 'baking', tag: '···', timestamp };
		if (vm.statusKey === 'pending') return { state: 'pending', tag: '···', timestamp };
		if (vm.behindBy === 0) return { state: 'onNewest', tag: '✓', timestamp };
		const behindState: CellState = vm.behindBy >= 2 ? 'behind2' : 'behind1';
		return { state: behindState, tag: pinned ? 'held' : `−${vm.behindBy}`, timestamp };
	}

	function circleBakeStatus(state: CellState): string | undefined {
		switch (state) {
			case 'fail':
				return 'Failed';
			case 'deploying':
				return 'Deploying';
			case 'baking':
				return 'InProgress';
			case 'pending':
				return 'None';
			default:
				return 'Succeeded'; // onNewest, behind1, behind2 — deploy itself succeeded
		}
	}

	function circleClass(state: CellState): string {
		// 'stuck' isn't a bakeStatus value getStatusCircleClass knows about —
		// match the amber treatment the old attention strip used for it.
		if (state === 'stuck') return 'bg-amber-100 dark:bg-amber-900/30';
		return getStatusCircleClass(circleBakeStatus(state));
	}

	function leadToneClass(app: AppRow): string {
		if (app.worst === 'fail') return 'text-red-600 dark:text-red-400';
		if (app.worst === 'stuck') return 'text-amber-600 dark:text-amber-400';
		if (app.worst === 'deploying' || app.worst === 'baking') return 'text-blue-600 dark:text-blue-400';
		if (app.rank === 2 && app.lead.startsWith('✓')) return 'text-green-600 dark:text-green-400';
		return 'text-gray-600 dark:text-gray-300';
	}

	const appRows = $derived.by<AppRow[]>(() => {
		const refNow = $now;
		const rows: AppRow[] = [];
		for (const mrow of matrix.rows) {
			const group = groups.get(mrow.appName);
			if (!group) continue;

			const cells: RowCell[] = [];
			for (const tier of matrix.envTiers) {
				const vm = mrow.cells[tier];
				if (!vm) continue;
				const { state, tag, timestamp } = classifyCell(group, tier, vm, refNow);
				cells.push({
					tier,
					envLabel: shortEnvLabel(vm.envName) || vm.envName,
					version: vm.version,
					behindBy: vm.behindBy,
					state,
					tag,
					timestamp
				});
			}
			if (cells.length === 0) continue;

			const envCount = cells.length;
			// "deployed" = non-pending cells (they have real deploy history);
			// "on newest" is scoped to that same set so the "N of M" ratio
			// never reports N > M for an app with a still-pending env.
			const deployed = cells.filter((c) => c.state !== 'pending');
			const deployedCount = deployed.length;
			const onNewestCount = deployed.filter((c) => c.behindBy === 0).length;

			let worst: CellState = 'onNewest';
			for (const s of SEVERITY) {
				if (cells.some((c) => c.state === s)) {
					worst = s;
					break;
				}
			}
			const rank =
				worst === 'fail' || worst === 'stuck' ? 0 : worst === 'deploying' || worst === 'baking' ? 1 : 2;

			let newestVersion: string | null = null;
			for (const c of cells) {
				if (c.version) {
					newestVersion = c.version;
					break;
				}
			}
			let mostRecentTs: string | null = null;
			for (const c of cells) {
				if (c.timestamp && (!mostRecentTs || new Date(c.timestamp) > new Date(mostRecentTs))) {
					mostRecentTs = c.timestamp;
				}
			}

			const failing = cells.filter((c) => c.state === 'fail');
			const stuck = cells.filter((c) => c.state === 'stuck');
			const active = cells.filter((c) => c.state === 'deploying' || c.state === 'baking');
			let lead: string;
			if (failing.length > 0) {
				const labels = failing.map((c) => c.envLabel.toUpperCase());
				lead = `${labels.join(', ')} ${labels.length > 1 ? 'are' : 'is'} failing`;
			} else if (stuck.length > 0) {
				const labels = stuck.map((c) => c.envLabel.toUpperCase());
				lead = labels.length > 1 ? `${labels.join(', ')} are stuck` : `${labels[0]} is stuck`;
			} else if (active.length > 0) {
				lead = `${active[0].envLabel.toUpperCase()} rolling out`;
			} else if (mrow.worstLag > 0) {
				const worstCell = cells.find((c) => c.behindBy === mrow.worstLag) ?? cells[cells.length - 1];
				lead = `${worstCell.envLabel.toUpperCase()} trails newest by ${mrow.worstLag}`;
			} else {
				lead = '✓ every env on newest';
			}

			rows.push({
				appName: mrow.appName,
				title: mrow.title,
				cells,
				envCount,
				deployedCount,
				onNewestCount,
				worstLag: mrow.worstLag,
				worst,
				rank,
				newestVersion,
				mostRecentTs,
				lead
			});
		}
		// Rank 0 (failing/stuck) first, then rank 1 (deploying/baking), then
		// the rest — worst-lag descending within each rank.
		return rows.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return b.worstLag - a.worstLag;
		});
	});

	const attnCount = $derived(appRows.filter((a) => a.rank === 0).length);
	const motionCount = $derived(appRows.filter((a) => a.rank === 1).length);
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-6 flex flex-wrap items-baseline justify-between gap-3">
		<div class="min-w-0">
			<h1 class="truncate text-2xl font-light text-gray-900 dark:text-white">Apps</h1>
			{#if !query.isLoading && !query.isError && appRows.length > 0}
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
					{appRows.length} app{appRows.length === 1 ? '' : 's'}
					{#if attnCount > 0}
						· <span class="font-medium text-red-600 dark:text-red-400"
							>{attnCount} need{attnCount === 1 ? 's' : ''} attention</span
						>
					{/if}
					{#if motionCount > 0}
						· {motionCount} in motion
					{/if}
				</p>
			{/if}
		</div>
		<a
			href="/rollouts"
			class="shrink-0 text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			All rollouts
		</a>
	</div>

	{#if query.isLoading}
		<!-- Skeleton mirrors the row-list shape -->
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each Array(6) as _}
					<li class="flex items-center gap-4 px-5 py-4">
						<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
						<div class="flex flex-1 flex-col gap-1.5">
							<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							<div class="h-2.5 w-56 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
						</div>
						<div class="hidden w-40 flex-col items-end gap-1.5 sm:flex">
							<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
							<div class="h-2.5 w-20 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if appRows.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<!-- Faded sample row: shows what an app row will look like -->
			<div class="pointer-events-none relative mx-auto w-full max-w-lg select-none opacity-60 grayscale" aria-hidden="true">
				<div class="flex items-center gap-4 overflow-hidden rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass('Succeeded')}">
						<BakeStatusIcon bakeStatus="Succeeded" size="medium" />
					</span>
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<div class="flex items-baseline gap-2">
							<span class="text-sm font-semibold text-gray-900 dark:text-white">My App</span>
							<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">my-app</span>
						</div>
						<div class="flex flex-wrap gap-1">
							{#each [{ env: 'dev', tag: '✓' }, { env: 'staging', tag: '✓' }, { env: 'prod', tag: '−1' }] as cell}
								<span class="inline-flex items-center gap-1 rounded-md bg-green-100 px-1.5 py-1 text-[10px] font-semibold dark:bg-green-900/30">
									<span class="uppercase tracking-wider">{cell.env}</span>
									<span class="font-mono normal-case">{cell.tag}</span>
								</span>
							{/each}
						</div>
					</div>
				</div>
			</div>
			<div class="mt-8 text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No apps yet</p>
				<p class="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
					An app appears here once you bind a <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code> to an <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Environment</code> resource. Apps consolidate the same rollout across all environments.
				</p>
			</div>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each appRows as app (app.appName)}
					<li>
						<a
							href="/apps/{app.appName}"
							class="flex flex-col gap-2.5 px-5 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-5 dark:hover:bg-gray-700/30"
						>
							<!-- status circle + title -->
							<div class="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
								<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {circleClass(app.worst)}">
									{#if app.worst === 'stuck'}
										<ExclamationCircleOutline class="h-5 w-5 text-amber-600 dark:text-amber-400" />
									{:else}
										<BakeStatusIcon bakeStatus={circleBakeStatus(app.worst)} size="medium" />
									{/if}
								</span>
								<div class="flex min-w-0 flex-col">
									<span class="truncate text-sm font-semibold text-gray-900 dark:text-white">{app.title}</span>
									<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{app.appName}</span>
								</div>
							</div>

							<!-- convergence bar -->
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-1">
									{#each app.cells as cell (cell.tier)}
										<span
											class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold {CELL_CLASS[cell.state]}"
											title="{cell.envLabel}{cell.version ? ` · ${cell.version}` : ''}"
										>
											<span class="uppercase tracking-wider">{cell.envLabel}</span>
											<span class="font-mono normal-case">{cell.tag}</span>
										</span>
									{/each}
								</div>
								<p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
									{app.onNewestCount} of {app.deployedCount} on newest · {app.envCount} env{app.envCount === 1 ? '' : 's'}
								</p>
							</div>

							<!-- relative: lead + sub -->
							<div class="flex min-w-0 flex-col sm:w-64 sm:shrink-0 sm:items-end sm:text-right">
								<span class="truncate text-xs font-medium {leadToneClass(app)}">{app.lead}</span>
								<span class="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">
									{#if app.newestVersion}newest {app.newestVersion}{/if}{#if app.mostRecentTs} · {formatTimeAgoCompact(app.mostRecentTs, $now)} ago{/if}
								</span>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<!-- Legend -->
		<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-400 dark:text-gray-500">
			<span>each cell = one environment</span>
			<span class="inline-flex items-center gap-1">
				<span class="inline-flex h-4 w-4 items-center justify-center rounded {CELL_CLASS.onNewest}">✓</span>
				on newest
			</span>
			<span class="inline-flex items-center gap-1">
				<span class="inline-flex h-4 items-center justify-center rounded px-1 {CELL_CLASS.behind1}">−N</span>
				behind
			</span>
			<span class="inline-flex items-center gap-1">
				<span class="inline-flex h-4 w-4 items-center justify-center rounded {CELL_CLASS.fail}">!</span>
				needs attention
			</span>
		</div>
	{/if}
</div>
