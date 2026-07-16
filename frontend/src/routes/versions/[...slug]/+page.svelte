<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion } from '$lib/utils';
	import { groupRolloutsByApp, versionPath, repoBody, repoLabel, type AppCell } from '$lib/version-utils';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { Spinner } from 'flowbite-svelte';
	import { ArrowLeftOutline, TagOutline, CheckOutline } from 'flowbite-svelte-icons';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import type { Rollout, Environment } from '../../../types';

	// The route is /versions/[...slug]; slug is "<repo path>/<version>" where the
	// repo path is real path segments (github.com/org/name) and the version is
	// the final segment. Split the last segment off as the version.
	const parsed = $derived.by<{ repoPath: string; target: string }>(() => {
		const raw = (page.params.slug as string) || '';
		const parts = raw.split('/').filter((s) => s.length > 0);
		const versionRaw = parts.pop() ?? '';
		return {
			repoPath: parts.map((p) => safeDecode(p)).join('/'),
			target: safeDecode(versionRaw)
		};
	});
	function safeDecode(s: string): string {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	}
	const target = $derived(parsed.target);
	const repoPath = $derived(parsed.repoPath);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type StopState = 'live' | 'ahead' | 'behind';
	type Stop = { envName: string; state: StopState; version: string | null; cell: AppCell };
	type AppFrontier = { appName: string; title: string; stops: Stop[] };

	// A cell belongs to the repo this page is scoped to when its repoKey body
	// (the human path, github.com/org/name or the no-source app name) matches the
	// repo path from the URL.
	function cellInRepo(cell: AppCell): boolean {
		return repoBody(cell.repoKey) === repoPath;
	}

	// Repo label for the hero — derived from the first matching cell so we show
	// "(no linked repository)" for the app-name fallback case.
	const repoDisplay = $derived.by<string>(() => {
		const groups = groupRolloutsByApp(rollouts, environments);
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				if (cellInRepo(cell)) return repoLabel(cell.repoKey);
			}
		}
		return repoPath;
	});

	// The earliest-known "created" timestamp for the target version within this
	// repo, used to order envs that have never explicitly deployed it.
	const targetCreatedMs = $derived.by<number | null>(() => {
		const groups = groupRolloutsByApp(rollouts, environments);
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				if (!cellInRepo(cell)) continue;
				for (const h of cell.rollout.status?.history ?? []) {
					if (h.version && getDisplayVersion(h.version) === target && h.version.created) {
						return new Date(h.version.created).getTime();
					}
				}
			}
		}
		return null;
	});

	function classifyStop(cell: AppCell): StopState {
		const history = cell.rollout.status?.history ?? [];
		const current = history[0];
		const currentVer = current?.version ? getDisplayVersion(current.version) : null;
		if (currentVer === target) return 'live';
		if (history.slice(1).some((h) => h.version && getDisplayVersion(h.version) === target)) {
			return 'ahead';
		}
		const createdMs = current?.version?.created ? new Date(current.version.created).getTime() : null;
		if (targetCreatedMs !== null && createdMs !== null) {
			return createdMs >= targetCreatedMs ? 'ahead' : 'behind';
		}
		return 'behind';
	}

	const frontiers = $derived.by<AppFrontier[]>(() => {
		if (!target) return [];
		const groups = groupRolloutsByApp(rollouts, environments);
		const out: AppFrontier[] = [];
		for (const group of groups.values()) {
			// Only cells belonging to this repo, and only apps that ran the version.
			const cells = group.cells.filter(cellInRepo);
			if (cells.length === 0) continue;
			const usesVersion = cells.some((c) =>
				(c.rollout.status?.history ?? []).some((h) => h.version && getDisplayVersion(h.version) === target)
			);
			if (!usesVersion) continue;
			let title = group.appName;
			for (const c of cells) {
				if (c.rollout.status?.title) {
					title = c.rollout.status.title;
					break;
				}
			}
			const stops: Stop[] = cells.map((cell) => ({
				envName: cell.envName,
				state: classifyStop(cell),
				version: cell.rollout.status?.history?.[0]?.version
					? getDisplayVersion(cell.rollout.status.history[0].version!)
					: null,
				cell
			}));
			out.push({ appName: group.appName, title, stops });
		}
		return out.sort((a, b) => a.title.localeCompare(b.title));
	});

	const liveCount = $derived(frontiers.reduce((n, a) => n + a.stops.filter((s) => s.state === 'live').length, 0));
	const totalStops = $derived(frontiers.reduce((n, a) => n + a.stops.length, 0));
	const notYet = $derived.by<string[]>(() => {
		const out: string[] = [];
		for (const a of frontiers) {
			for (const s of a.stops) {
				if (s.state === 'behind') out.push(`${a.title} · ${s.envName}`);
			}
		}
		return out;
	});

	const headline = $derived.by(() => {
		if (totalStops === 0) return '';
		if (liveCount === totalStops) return `Fully rolled out — live in all ${totalStops} place${totalStops === 1 ? '' : 's'}.`;
		const uniqueNotYet = [...new Set(notYet)];
		const preview = uniqueNotYet.slice(0, 3).join(', ');
		const more = uniqueNotYet.length > 3 ? '…' : '';
		return `Live in ${liveCount} of ${totalStops} places${uniqueNotYet.length ? ` · not yet in ${preview}${more}` : ''}.`;
	});

	const STOP_DOT: Record<StopState, string> = {
		live: 'bg-emerald-500',
		ahead: 'bg-gray-400 dark:bg-gray-500',
		behind: 'bg-gray-200 dark:bg-gray-700'
	};
	const STOP_LABEL: Record<StopState, string> = {
		live: 'live',
		ahead: 'moved on',
		behind: 'not yet'
	};
	const STOP_TEXT: Record<StopState, string> = {
		live: 'text-emerald-700 dark:text-emerald-400',
		ahead: 'text-gray-500 dark:text-gray-400',
		behind: 'text-gray-400 dark:text-gray-500'
	};
</script>

<svelte:head>
	<title>kuberik | {target}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<a href="/versions" class="mb-4 inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
		<ArrowLeftOutline class="h-3.5 w-3.5" /> All versions
	</a>

	{#if query.isLoading}
		<div class="flex items-center justify-center py-20">
			<Spinner size="6" />
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if frontiers.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<TagOutline class="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">Version not found</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				No app in <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">{repoPath}</code> has
				<code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">{target}</code> anywhere in its deploy history.
			</p>
		</div>
	{:else}
		<!-- Hero -->
		<div class="mb-5 flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
					<span>Revision{frontiers.length > 1 ? ` · shared by ${frontiers.length} apps` : ''}</span>
				</div>
				<div class="mt-1 truncate font-mono text-2xl text-gray-900 dark:text-white">{target}</div>
				<div class="mt-1 truncate font-mono text-xs text-gray-400 dark:text-gray-500" title={repoDisplay}>{repoDisplay}</div>
				<div class="mt-2 text-sm text-gray-600 dark:text-gray-300">{headline}</div>
			</div>
			<div class="shrink-0 text-right">
				<div class="font-mono text-4xl font-light text-emerald-600 dark:text-emerald-400">
					{liveCount}<span class="text-xl text-gray-400 dark:text-gray-500">/{totalStops}</span>
				</div>
				<div class="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">live deployments</div>
			</div>
		</div>

		<!-- Legend -->
		<div class="mb-4 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {STOP_DOT.live}"></span> live here</span>
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {STOP_DOT.ahead}"></span> moved to newer</span>
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full border border-gray-300 dark:border-gray-600 {STOP_DOT.behind}"></span> not yet reached</span>
			<span>chains flow dev → staging → prod</span>
		</div>

		<!-- Per-app frontier -->
		<div class="flex flex-col gap-3">
			{#each frontiers as app (app.appName)}
				<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex sm:items-center sm:gap-6">
					<a href="/apps/{encodeURIComponent(app.appName)}" class="mb-3 block min-w-0 shrink-0 sm:mb-0 sm:w-44">
						<div class="truncate text-sm font-medium text-gray-900 dark:text-white">{app.title}</div>
						<div class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{app.appName}</div>
						<div class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
							{app.stops.filter((s) => s.state === 'live').length}/{app.stops.length} live
						</div>
					</a>
					<div class="flex flex-1 flex-wrap items-center gap-x-1 gap-y-3 overflow-x-auto">
						{#each app.stops as stop, i (stop.envName)}
							{#if i > 0}<span class="mx-1 shrink-0 text-gray-300 dark:text-gray-600">→</span>{/if}
							<div class="environment-theme-scope flex shrink-0 flex-col items-center gap-1" style={stop.cell.theme ? getEnvironmentThemeStyle(stop.cell.theme) : undefined}>
								<span class="environment-theme-badge rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{stop.envName}</span>
								<span class="relative inline-flex h-8 w-8 items-center justify-center rounded-full {stop.state === 'behind' ? 'border-2 border-dashed border-gray-300 dark:border-gray-600' : stop.state === 'live' ? 'ring-2 ring-emerald-200 dark:ring-emerald-900' : ''}">
									<span class="h-3.5 w-3.5 rounded-full {STOP_DOT[stop.state]}"></span>
									{#if stop.state === 'ahead'}
										<CheckOutline class="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-white text-gray-400 dark:bg-gray-800 dark:text-gray-500" />
									{/if}
								</span>
								<span class="text-[11px] font-medium {STOP_TEXT[stop.state]}">{STOP_LABEL[stop.state]}</span>
								{#if stop.version}
									<a href={versionPath(stop.cell.repoKey, stop.version)} class="font-mono text-[10px] text-gray-400 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300">{stop.version}</a>
								{/if}
								{#if stop.state === 'live' && stop.cell.rollout.status?.source}
									<GitHubViewButton sourceUrl={stop.cell.rollout.status.source} version={target} size="xs" />
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
