<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { groupRolloutsByApp, versionPath, repoBody, repoLabel, type AppCell } from '$lib/version-utils';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { buildReleaseFrontier, type FrontierApp, type FrontierStop } from '$lib/view-models/release-frontier';
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

	// Deterministic, presentational-only color per version string (same hash
	// as versions/+page.svelte's swatch) — ties the same version's identity
	// together visually across pages. Never used for state semantics.
	function versionHue(version: string): number {
		let hash = 0;
		for (let i = 0; i < version.length; i++) {
			hash = (hash * 31 + version.charCodeAt(i)) | 0;
		}
		return Math.abs(hash) % 360;
	}

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	const groups = $derived.by(() => groupRolloutsByApp(rollouts, environments));

	// A cell belongs to the repo this page is scoped to when its repoKey body
	// (the human path, github.com/org/name or the no-source app name) matches the
	// repo path from the URL.
	function cellInRepo(cell: AppCell): boolean {
		return repoBody(cell.repoKey) === repoPath;
	}

	// The real repoKey (with its repo:/app: discriminator) matching the URL's
	// repo path — buildReleaseFrontier needs the discriminated key, not the
	// bare display path.
	const matchedRepoKey = $derived.by<string | null>(() => {
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				if (cellInRepo(cell)) return cell.repoKey;
			}
		}
		return null;
	});

	// Repo label for the hero — derived from the first matching cell so we show
	// "(no linked repository)" for the app-name fallback case.
	const repoDisplay = $derived.by<string>(() => {
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				if (cellInRepo(cell)) return repoLabel(cell.repoKey);
			}
		}
		return repoPath;
	});

	const frontier = $derived.by<{ apps: FrontierApp[] }>(() => {
		if (!target || !matchedRepoKey) return { apps: [] };
		return buildReleaseFrontier(matchedRepoKey, target, rollouts, environments);
	});

	// Apps with zero non-absent stops are bound to none of this repo's env
	// tiers at all — nothing meaningful to chain, so they're dropped from
	// display (a visibility filter, not a change to buildReleaseFrontier's data).
	const apps = $derived(
		[...frontier.apps].filter((a) => a.total > 0).sort((a, b) => a.title.localeCompare(b.title))
	);

	// Aggregate hero totals = sum of apps' reached / sum of apps' total, per the brief.
	const reached = $derived(apps.reduce((n, a) => n + a.reached, 0));
	const total = $derived(apps.reduce((n, a) => n + a.total, 0));

	const notYet = $derived.by<string[]>(() => {
		const out: string[] = [];
		for (const a of apps) {
			for (const s of a.stops) {
				if (s.state === 'behind' || s.state === 'absent') out.push(`${a.title} · ${s.envName}`);
			}
		}
		return out;
	});

	const headline = $derived.by(() => {
		if (total === 0) return '';
		if (reached === total) return `Fully rolled out — live in all ${total} place${total === 1 ? '' : 's'}.`;
		const uniqueNotYet = [...new Set(notYet)];
		const preview = uniqueNotYet.slice(0, 3).join(', ');
		const more = uniqueNotYet.length > 3 ? '…' : '';
		return `Live in ${reached} of ${total} places${uniqueNotYet.length ? ` · not yet in ${preview}${more}` : ''}.`;
	});

	// The underlying AppCell for a given app+env stop — carries the env theme,
	// rollout source, and repoKey the frontier's plain FrontierStop doesn't.
	function cellFor(appName: string, envName: string): AppCell | undefined {
		return groups.get(appName)?.cells.find((c) => c.environment?.spec?.environment === envName);
	}

	// A connector is "flowed" (the frontier has already passed through it) when
	// the upstream stop it leaves is live or ahead of the target version.
	function connectorFlowed(state: FrontierStop['state']): boolean {
		return state === 'live' || state === 'ahead';
	}

	const STOP_LABEL: Record<FrontierStop['state'], string> = {
		live: 'live',
		ahead: 'moved on',
		behind: 'not yet',
		absent: '—'
	};
	const STOP_TEXT: Record<FrontierStop['state'], string> = {
		live: 'text-emerald-700 dark:text-emerald-400',
		ahead: 'text-gray-500 dark:text-gray-400',
		behind: 'text-gray-400 dark:text-gray-500',
		absent: 'text-gray-300 dark:text-gray-600'
	};
	const NODE_CLASS: Record<FrontierStop['state'], string> = {
		live: 'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900',
		ahead: 'border-2 border-gray-300 dark:border-gray-600',
		behind: 'border-2 border-dashed border-gray-300 dark:border-gray-600',
		absent: 'border border-dashed border-gray-200 opacity-50 dark:border-gray-700'
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
	{:else if apps.length === 0}
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
					<span>Revision{apps.length > 1 ? ` · shared by ${apps.length} apps` : ''}</span>
				</div>
				<div class="mt-1 flex items-center gap-2">
					<span
						class="h-2.5 w-2.5 shrink-0 rounded-full"
						style="background-color: hsl({versionHue(target)}, 65%, 55%)"
						aria-hidden="true"
					></span>
					<span class="truncate font-mono text-2xl text-gray-900 dark:text-white">{target}</span>
				</div>
				<div class="mt-1 truncate font-mono text-xs text-gray-400 dark:text-gray-500" title={repoDisplay}>{repoDisplay}</div>
				<div class="mt-2 text-sm text-gray-600 dark:text-gray-300">{headline}</div>
			</div>
			<div class="shrink-0 text-right">
				<div class="font-mono text-4xl font-light text-emerald-600 dark:text-emerald-400">
					{reached}<span class="text-xl text-gray-400 dark:text-gray-500">/{total}</span>
				</div>
				<div class="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">live deployments</div>
			</div>
		</div>

		<!-- Legend -->
		<div class="mb-4 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {NODE_CLASS.live}"></span> live here</span>
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {NODE_CLASS.ahead}"></span> moved to newer</span>
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {NODE_CLASS.behind}"></span> not yet reached</span>
			<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full {NODE_CLASS.absent}"></span> absent</span>
			<span>chains flow dev → staging → prod</span>
		</div>

		<!-- Per-app frontier -->
		<div class="flex flex-col gap-3">
			{#each apps as app (app.appName)}
				<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex sm:items-center sm:gap-6">
					<a href="/apps/{encodeURIComponent(app.appName)}" class="mb-3 block min-w-0 shrink-0 sm:mb-0 sm:w-44">
						<div class="truncate text-sm font-medium text-gray-900 dark:text-white">{app.title}</div>
						<div class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{app.appName}</div>
						<div class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{app.reached}/{app.total} live</div>
					</a>
					<div class="flex flex-1 flex-wrap items-center gap-x-1 gap-y-3 overflow-x-auto">
						{#each app.stops as stop, i (stop.envName)}
							{#if i > 0}
								<span
									class="mx-1 shrink-0 {connectorFlowed(app.stops[i - 1].state)
										? 'text-emerald-400 dark:text-emerald-500'
										: 'text-gray-300 dark:text-gray-600'}"
								>
									→
								</span>
							{/if}
							{@const cell = cellFor(app.appName, stop.envName)}
							<div
								class="environment-theme-scope flex shrink-0 flex-col items-center gap-1"
								style={cell?.theme ? getEnvironmentThemeStyle(cell.theme) : undefined}
							>
								<span class="environment-theme-badge rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{stop.envName}</span>
								<span class="relative inline-flex h-8 w-8 items-center justify-center rounded-full {NODE_CLASS[stop.state]}">
									{#if stop.state === 'live'}
										<span class="h-2.5 w-2.5 rounded-full bg-white"></span>
									{:else if stop.state === 'ahead'}
										<CheckOutline class="h-4 w-4 text-gray-400 dark:text-gray-500" />
									{:else if stop.state === 'absent'}
										<span class="text-xs text-gray-300 dark:text-gray-600">—</span>
									{/if}
								</span>
								<span class="text-[11px] font-medium {STOP_TEXT[stop.state]}">{STOP_LABEL[stop.state]}</span>
								{#if stop.version}
									<a
										href={versionPath(cell?.repoKey ?? matchedRepoKey ?? '', stop.version)}
										class="font-mono text-[10px] text-gray-400 hover:text-gray-700 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
									>
										{stop.version}
									</a>
								{/if}
								{#if stop.state === 'live' && cell?.rollout.status?.source}
									<GitHubViewButton sourceUrl={cell.rollout.status.source} version={target} size="xs" />
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
