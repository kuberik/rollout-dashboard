<svelte:options runes={true} />

<script lang="ts">
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo } from '$lib/utils';
	import { versionPath, repoKeyFromSource } from '$lib/version-utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import type { Rollout, Environment } from '../../types';

	let {
		rollouts,
		environments = [],
		limit = 20,
		activityHref = '/activity'
	}: {
		rollouts: Rollout[];
		environments?: Environment[];
		limit?: number;
		activityHref?: string;
	} = $props();

	type ActivityEntry = {
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
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
			const theme = env
				? getRolloutEnvironmentTheme(r, env)
				: getRolloutEnvironmentTheme(r);
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const ver = getDisplayVersion(h.version);
				let prev: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== ver) { prev = v; break; }
				}
				const bs = h.bakeStatus || 'None';
				list.push({
					rolloutName: r.metadata?.name ?? '',
					rolloutNamespace: r.metadata?.namespace ?? '',
					displayName: r.metadata?.name ?? '',
					envName,
					theme,
					version: ver,
					previousVersion: prev,
					bakeStatus: bs,
					timestamp: h.timestamp,
					href: `/rollouts/${r.metadata?.namespace}/${r.metadata?.name}`,
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

	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-500',
		Failed: 'bg-red-500',
		InProgress: 'bg-yellow-400',
		Deploying: 'bg-blue-500',
		Cancelled: 'bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600'
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

<section>
	<div class="mb-3 flex items-baseline justify-between">
		<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
			Recent activity
		</h2>
		<a
			href={activityHref}
			class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
		>view all ›</a>
	</div>
	<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
		{#if entries.length === 0}
			<div class="flex flex-col items-center px-4 py-10 text-center">
				<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60">
					<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
				</div>
				<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No activity yet</p>
				<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Deployments will appear here as a timeline.</p>
			</div>
		{:else}
			<div class="p-4">
				{#each byDay as group, gi}
					<div class="{gi > 0 ? 'mt-5' : ''}">
						<div class="mb-3 flex items-center gap-2">
							<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{group.label}</span>
							<span class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"></span>
							<span class="font-mono text-[10px] text-gray-300 dark:text-gray-600">{group.entries.length}</span>
						</div>
						<ol class="relative">
							<span class="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-gray-200 dark:bg-gray-700/80" aria-hidden="true"></span>
							{#each group.entries as a, ai}
								{@const isLast = ai === group.entries.length - 1}
								<li
									class="environment-theme-scope relative pl-6 {isLast ? '' : 'pb-3'}"
									style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
								>
									<span class="absolute left-0 top-1 inline-flex h-3.5 w-3.5 items-center justify-center">
										{#if isRunning(a.bakeStatus)}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[a.bakeStatus]}"></span>
										{/if}
										<span class="relative inline-flex h-2.5 w-2.5 rounded-full {STATUS_DOT[a.bakeStatus] ?? STATUS_DOT.None} ring-2 ring-white dark:ring-gray-800"></span>
									</span>
									<div class="relative block rounded-md -mx-2 px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
										<!-- Whole-row link: absolute overlay so any click on the
										     row (except the version link below) opens the rollout
										     detail. -->
										<a href={a.href} class="absolute inset-0 z-0" aria-label="Open {a.displayName}"></a>
										<div class="pointer-events-none relative z-[1] flex items-baseline justify-between gap-2">
											<div class="flex min-w-0 items-baseline gap-1.5">
												{#if a.envName || a.theme}
													<span class="environment-theme-badge shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">{shortEnvLabel(a.theme) || a.envName || a.theme?.label}</span>
												{/if}
												<span class="truncate text-sm font-medium text-gray-900 dark:text-white">{a.displayName}</span>
											</div>
											<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
												{hourLabel(a.timestamp)}
											</span>
										</div>
										<div class="pointer-events-none relative z-[1] mt-0.5 flex items-baseline justify-between gap-2 text-[11px]">
											<span class={STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}>{STATUS_LABEL[a.bakeStatus]}</span>
											<span class="flex shrink-0 items-baseline gap-1">
												{#if a.previousVersion}
													<span class="font-mono text-gray-400/70 line-through dark:text-gray-500/70">{a.previousVersion}</span>
													<span class="text-[10px] text-gray-300 dark:text-gray-600">→</span>
												{/if}
												{#if a.version}
													<a href={versionPath(repoKeyFromSource(a.source, a.rolloutName), a.version)} class="pointer-events-auto relative z-10 font-mono text-gray-700 hover:underline dark:text-gray-300">{a.version}</a>
												{/if}
											</span>
										</div>
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
