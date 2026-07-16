<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getDisplayVersion, formatTimeAgo } from '$lib/utils';
	import { groupRolloutsByApp, versionPath } from '$lib/version-utils';
	import { now } from '$lib/stores/time';
	import { TagOutline } from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type VersionRow = {
		version: string;
		apps: Set<string>;
		live: number;
		mostRecentMs: number;
	};

	type RepoSection = {
		repoKey: string;
		repoLabel: string;
		versions: VersionRow[];
		mostRecentMs: number;
	};

	// Version identity is scoped per repo (see version-utils.ts repoKeyFor) —
	// two apps on unrelated repos never merge into one row just because they
	// happen to share a tag or short SHA.
	const repoSections = $derived.by<RepoSection[]>(() => {
		const groups = groupRolloutsByApp(rollouts, environments);
		const repos = new Map<string, Map<string, VersionRow>>();
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				const history = cell.rollout.status?.history ?? [];
				let versionsByKey = repos.get(cell.repoKey);
				if (!versionsByKey) {
					versionsByKey = new Map();
					repos.set(cell.repoKey, versionsByKey);
				}
				history.forEach((entry, i) => {
					if (!entry.version) return;
					const v = getDisplayVersion(entry.version);
					if (!v) return;
					let row = versionsByKey!.get(v);
					if (!row) {
						row = { version: v, apps: new Set(), live: 0, mostRecentMs: 0 };
						versionsByKey!.set(v, row);
					}
					row.apps.add(group.appName);
					if (i === 0) row.live++;
					if (entry.timestamp) {
						const ms = new Date(entry.timestamp).getTime();
						if (ms > row.mostRecentMs) row.mostRecentMs = ms;
					}
				});
			}
		}
		const sections: RepoSection[] = [];
		for (const [repoKey, versionsByKey] of repos) {
			const versions = [...versionsByKey.values()].sort((a, b) => b.mostRecentMs - a.mostRecentMs);
			if (versions.length === 0) continue;
			// repoLabel is identical across every cell sharing a repoKey — grab it
			// off any cell in that bucket via groupRolloutsByApp's cells.
			let label = repoKey;
			outer: for (const group of groups.values()) {
				for (const cell of group.cells) {
					if (cell.repoKey === repoKey) {
						label = cell.repoLabel;
						break outer;
					}
				}
			}
			sections.push({ repoKey, repoLabel: label, versions, mostRecentMs: versions[0].mostRecentMs });
		}
		return sections.sort((a, b) => b.mostRecentMs - a.mostRecentMs);
	});
</script>

<svelte:head>
	<title>kuberik | Versions</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-baseline justify-between gap-3">
		<h1 class="min-w-0 truncate text-2xl font-light text-gray-900 dark:text-white">Versions</h1>
		<span class="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
			every revision in play, grouped by repository · where each has reached, and which apps share it
		</span>
	</div>

	{#if query.isLoading}
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each Array(8) as _}
					<li class="flex items-center gap-5 px-5 py-4">
						<div class="flex flex-1 items-center gap-3">
							<div class="h-3.5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						</div>
						<div class="hidden gap-3 sm:flex">
							<div class="h-4 w-24 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
							<div class="h-4 w-16 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if repoSections.length === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
			<p class="text-sm font-medium text-gray-900 dark:text-white">No versions yet</p>
			<p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
				Versions appear here once rollouts have deploy history.
			</p>
		</div>
	{:else}
		<div class="flex flex-col gap-5">
			{#each repoSections as section (section.repoKey)}
				<section>
					<h2 class="mb-2 flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						<span class="truncate font-mono normal-case tracking-normal text-gray-700 dark:text-gray-300">{section.repoLabel}</span>
						<span class="text-gray-300 dark:text-gray-600">· {section.versions.length} version{section.versions.length === 1 ? '' : 's'}</span>
					</h2>
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each section.versions as row (row.version)}
								{@const appList = [...row.apps]}
								<li>
									<a
										href={versionPath(section.repoKey, row.version)}
										class="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<span class="min-w-0 flex-1 truncate font-mono text-sm text-gray-900 dark:text-white">
											{row.version}
										</span>
										<span class="hidden shrink-0 sm:block">
											{#if appList.length > 1}
												<span class="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
													shared · {appList.length} apps
												</span>
											{:else}
												<span class="truncate text-xs text-gray-500 dark:text-gray-400">{appList[0]}</span>
											{/if}
										</span>
										<span class="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400" title={row.live === 0 ? 'not currently live anywhere' : undefined}>
											{row.live} live
										</span>
										<span class="hidden w-24 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500 sm:block">
											{formatTimeAgo(new Date(row.mostRecentMs).toISOString(), $now)}
										</span>
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
