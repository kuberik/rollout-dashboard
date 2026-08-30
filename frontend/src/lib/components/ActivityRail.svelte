<svelte:options runes={true} />

<script lang="ts">
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, formatDate } from '$lib/utils';
	import { buildPath, repoKeyFromSource } from '$lib/version-utils';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutPath, sourceClusterName } from '$lib/source-dashboard';
	import { now } from '$lib/stores/time';
	import Chip from '$lib/components/Chip.svelte';
	import type { Rollout, Environment } from '../../types';

	let {
		rollouts,
		environments = [],
		limit = 20,
		activityHref = '/activity',
		localClusterName = '',
		showAppName = true,
		showEnv = true,
		chrome = true
	}: {
		rollouts: Rollout[];
		environments?: Environment[];
		limit?: number;
		activityHref?: string;
		/**
		 * False on a page already scoped to ONE environment. Same rule as
		 * `showAppName`, applied to the other axis: `/envs/prod` reached via an
		 * `h1` and a URL that both say `prod` was printing a PROD chip on every
		 * row of the rail. A chip that is identical on every row is a mark that
		 * cannot mark anything.
		 */
		showEnv?: boolean;
		/**
		 * FALSE WHEN THE CALLER IS ALREADY A `Card`.
		 *
		 * This component draws its own `t-label` caption above its own bordered
		 * box — the "caption floating over a box" shape that
		 * `COMPOSITION-GRAMMAR.md` identifies as the one every rejected page is
		 * built from, against a reference page where every region is a TITLED
		 * CARD with an icon and a right-aligned rollup. `/apps/[name]` wraps it
		 * in `Card` now; passing `chrome={false}` drops the caption and the box
		 * so the two do not nest.
		 *
		 * DEFAULT TRUE, so `/envs/[name]` — the other call site, owned by
		 * another pass — renders byte-identically.
		 */
		chrome?: boolean;
		/**
		 * False on a page already scoped to ONE app. The app-detail page reached
		 * via a breadcrumb, an `h1` and a URL that all say `hello-world-app` was
		 * repeating that string 8 more times down the rail — the row restating
		 * the one fact its container already guarantees. Env detail and
		 * namespace detail DO need it, because those rails span many apps.
		 */
		showAppName?: boolean;
		// Cluster to route to when a rollout carries no source-cluster
		// annotation (e.g. a single-cluster dashboard, or a detail fetch that
		// doesn't stamp cross-cluster provenance).
		localClusterName?: string;
	} = $props();

	type ActivityEntry = {
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		/**
		 * The git revision behind `version`. Carried so the link can be keyed by
		 * REVISION — `/versions` groups by commit now, and a display label is
		 * per-service, so linking by label would land on a page that has to
		 * resolve it back. null when the deploy carried no revision annotation.
		 */
		revision: string | null;
		previousVersion: string | null;
		bakeStatus: string;
		timestamp: string;
		href: string;
		isRunning: boolean;
		source: string | null;
	};

	const entries = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const r of rollouts) {
			const history = r.status?.history ?? [];
			const env = environments.find(
				(e) =>
					e.metadata?.namespace === r.metadata?.namespace &&
					e.spec?.rolloutRef?.name === r.metadata?.name
			);
			const envName = env?.spec?.environment ?? '';
			const theme = env ? getRolloutEnvironmentTheme(r, env) : getRolloutEnvironmentTheme(r);
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const ver = getDisplayVersion(h.version);
				let prev: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== ver) {
						prev = v;
						break;
					}
				}
				const bs = h.bakeStatus || 'None';
				list.push({
					rolloutName: r.metadata?.name ?? '',
					rolloutNamespace: r.metadata?.namespace ?? '',
					displayName: r.metadata?.name ?? '',
					envName,
					theme,
					version: ver,
					revision: h.version?.revision ?? null,
					previousVersion: prev,
					bakeStatus: bs,
					timestamp: h.timestamp,
					href: rolloutPath(
						sourceClusterName(r) || localClusterName,
						r.metadata?.namespace ?? '',
						r.metadata?.name ?? ''
					),
					isRunning: bs === 'InProgress' || bs === 'Deploying',
					source: r.status?.source ?? null
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list.slice(0, limit);
	});

	type DayGroup = { label: string; key: string; entries: ActivityEntry[] };
	function dayKey(ts: string): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function dayLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function hourLabel(ts: string): string {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	const byDay = $derived.by<DayGroup[]>(() => {
		const refNow = $now;
		const map = new Map<string, DayGroup>();
		for (const a of entries) {
			const key = dayKey(a.timestamp);
			let g = map.get(key);
			if (!g) {
				g = { label: dayLabel(a.timestamp, refNow), key, entries: [] };
				map.set(key, g);
			}
			g.entries.push(a);
		}
		return Array.from(map.values());
	});

	// Same status ink as `BakeStatusIcon` (-700 light / -400 dark). The rail
	// used to carry a lighter green, a SECOND green in a product allowed
	// exactly one; red/yellow/blue had the same drift. Status hue is owned by
	// the glyph scale, so the dots read from it rather than near it.
	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-700 dark:bg-green-400',
		Failed: 'bg-red-700 dark:bg-red-400',
		InProgress: 'bg-yellow-700 dark:bg-yellow-400',
		Deploying: 'bg-blue-700 dark:bg-blue-400',
		Cancelled: 'bg-gray-500 dark:bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-400',
		None: 'text-gray-500 dark:text-gray-400'
	};
	const STATUS_LABEL: Record<string, string> = {
		Succeeded: 'Succeeded',
		Failed: 'Failed',
		InProgress: 'Baking',
		Deploying: 'Deploying',
		Cancelled: 'Cancelled',
		None: 'No deploy'
	};
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}
</script>

<!-- The `prev -> new` pair. Rendered on line 1 when the app name is suppressed
     (a page already scoped to one app), on line 2 when it is not. One snippet so
     the two layouts cannot drift apart. -->
{#snippet versionSnippet(a: ActivityEntry)}
	<span class="flex min-w-0 shrink-0 items-baseline gap-1">
		{#if a.previousVersion}
			<span class="t-code-sm text-gray-500 line-through dark:text-gray-400"
				>{a.previousVersion}</span
			>
			<span class="t-micro text-gray-500 dark:text-gray-400">→</span>
		{/if}
		{#if a.version}
			<a
				href={buildPath(repoKeyFromSource(a.source, a.rolloutName), a.revision, a.version)}
				class="t-code-sm pointer-events-auto relative z-10 text-gray-700 hover:underline dark:text-gray-300"
				>{a.version}</a
			>
		{/if}
	</span>
{/snippet}

<section>
	{#if chrome}
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="t-label text-gray-500 dark:text-gray-400">Recent activity</h2>
			<a
				href={activityHref}
				class="t-micro text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
				aria-label="View all recent activity"
				>view all ›</a
			>
		</div>
	{/if}
	<div
		class={chrome
			? 'overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800'
			: ''}
	>
		{#if entries.length === 0}
			<div class="flex flex-col items-center px-4 py-10 text-center">
				<div
					class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
				>
					<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
				</div>
				<p class="t-dense text-gray-700 dark:text-gray-300">No activity yet</p>
				<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
					Deployments will appear here as a timeline.
				</p>
			</div>
		{:else}
			<div class="p-4">
				{#each byDay as group, gi}
					<div class={gi > 0 ? 'mt-5' : ''}>
						<div class="mb-3 flex items-center gap-2">
							<span class="t-label text-gray-500 dark:text-gray-400">{group.label}</span>
							<span
								class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"
							></span>
							<span class="t-code-sm text-gray-500 dark:text-gray-400">{group.entries.length}</span>
						</div>
						<ol class="relative">
							<span
								class="absolute top-1.5 bottom-1.5 left-[7px] w-px bg-gray-200 dark:bg-gray-700"
								aria-hidden="true"
							></span>
							{#each group.entries as a, ai}
								{@const isLast = ai === group.entries.length - 1}
								<li
									class="environment-theme-scope relative pl-6 {isLast ? '' : 'pb-3'}"
									style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
								>
									<span
										class="absolute top-1 left-0 inline-flex h-3.5 w-3.5 items-center justify-center"
									>
										{#if isRunning(a.bakeStatus)}
											<span
												class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[
													a.bakeStatus
												]}"
											></span>
										{/if}
										<span
											class="relative inline-flex h-2.5 w-2.5 rounded-full {STATUS_DOT[
												a.bakeStatus
											] ?? STATUS_DOT.None} ring-2 ring-white dark:ring-gray-800"
										></span>
									</span>
									<div
										class="relative -mx-2 block rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<!-- Whole-row link: absolute overlay so any click on the
										     row (except the version link below) opens the rollout
										     detail. -->
										<a href={a.href} class="absolute inset-0 z-0" aria-label="Open {a.displayName}"
										></a>
										<div
											class="pointer-events-none relative z-[1] flex items-baseline justify-between gap-2"
										>
											<div class="flex min-w-0 items-baseline gap-2">
												{#if showEnv && (a.envName || a.theme)}
													<Chip
														role="env"
														theme={a.theme}
														label={shortEnvLabel(a.theme) || a.envName || a.theme?.label || ''}
														wide
														class="shrink-0"
													/>
												{/if}
												{#if showAppName}
													<span class="t-dense truncate text-gray-900 dark:text-white"
														>{a.displayName}</span
													>
												{:else}
													{@render versionSnippet(a)}
												{/if}
											</div>
											<span
												class="t-code-sm shrink-0 text-gray-500 dark:text-gray-400"
												title={formatDate(a.timestamp)}
											>
												{hourLabel(a.timestamp)}
											</span>
										</div>
										<!-- Second line only when it carries something the first
										     does not. `Succeeded` beside a green dot that already
										     means succeeded is a word the eye has to read to
										     discard; it appeared 8 times on one screen. -->
										{#if showAppName || a.bakeStatus !== 'Succeeded'}
											<div
												class="t-micro pointer-events-none relative z-[1] mt-0.5 flex items-baseline justify-between gap-2"
											>
												{#if a.bakeStatus !== 'Succeeded'}
													<span class={STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}
														>{STATUS_LABEL[a.bakeStatus]}</span
													>
												{:else}
													<span></span>
												{/if}
												{#if showAppName}
													{@render versionSnippet(a)}
												{/if}
											</div>
										{/if}
									</div>
								</li>
							{/each}
						</ol>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
