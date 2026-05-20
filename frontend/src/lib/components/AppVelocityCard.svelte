<svelte:options runes={true} />

<script lang="ts">
	import { getDisplayVersion, formatTimeAgoCompact, detectStuck, detectStuckBehind } from '$lib/utils';
	import type { StuckReason } from '$lib/utils';
	import { getEnvironmentThemeStyle, shortEnvLabel, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { getStatusCircleClass } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import type { Rollout, Environment } from '../../types';

	type Cell = {
		envName: string;
		rollout: Rollout | null;
		env: Environment;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	let {
		title,
		name,
		cells,
		refNow
	}: {
		title: string;
		name: string;
		cells: Cell[];
		refNow: Date;
	} = $props();

	// Same hue family as the Gantt on /apps/[name]; newest gets sky, then violet, etc.
	const VERSION_PALETTE = [
		'bg-sky-500/80 dark:bg-sky-500/70',
		'bg-violet-500/80 dark:bg-violet-500/70',
		'bg-emerald-500/80 dark:bg-emerald-500/70',
		'bg-rose-500/80 dark:bg-rose-500/70',
		'bg-amber-500/80 dark:bg-amber-500/70',
		'bg-teal-500/80 dark:bg-teal-500/70',
		'bg-fuchsia-500/80 dark:bg-fuchsia-500/70',
		'bg-indigo-500/80 dark:bg-indigo-500/70'
	];

	type Seg = { version: string; color: string; left: number; width: number; isCurrent: boolean };
	type Lane = {
		envName: string;
		envLabel: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		segs: Seg[];
		currentVersion: string | null;
		currentRank: number | null; // 0 newest
		bakeStatus: string;
		stuck: StuckReason | null;
	};

	const built = $derived.by<{ lanes: Lane[]; versionRank: Map<string, number>; lifecycle: string[] }>(() => {
		type Raw = { envName: string; envLabel: string; theme: any; ver: string; ts: number; createdMs: number; bakeStatus: string; isLatest: boolean };
		const all: Raw[] = [];
		for (const c of cells) {
			const history = c.rollout?.status?.history ?? [];
			const envLabel = shortEnvLabel(c.theme) || c.envName || '—';
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const v = getDisplayVersion(h.version);
				if (!v) continue;
				// version.created = OCI image creation time (true release order).
				// Falls back to deploy timestamp when not populated.
				const created = (h.version as any)?.created;
				const createdMs = created ? new Date(created).getTime() : new Date(h.timestamp).getTime();
				all.push({
					envName: c.envName,
					envLabel,
					theme: c.theme,
					ver: v,
					ts: new Date(h.timestamp).getTime(),
					createdMs,
					bakeStatus: h.bakeStatus || 'None',
					isLatest: i === 0
				});
			}
		}
		if (all.length === 0) {
			return { lanes: [], versionRank: new Map(), lifecycle: [] };
		}
		// Rank versions by their RELEASE time (version.created), not by
		// deploy time. A version pinned in staging doesn't become "newer"
		// than an unpinned version deployed earlier — the underlying
		// release order is what we want to surface.
		const maxCreatedByVer = new Map<string, number>();
		for (const r of all) {
			const prev = maxCreatedByVer.get(r.ver);
			if (prev === undefined || r.createdMs > prev) maxCreatedByVer.set(r.ver, r.createdMs);
		}
		const versionRank = new Map<string, number>();
		const lifecycle = [...maxCreatedByVer.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([v]) => v);
		lifecycle.forEach((v, i) => versionRank.set(v, i));

		// Window: from earliest deploy to now (per-card span).
		const windowEnd = refNow.getTime();
		const windowStart = Math.min(...all.map((a) => a.ts));
		const span = Math.max(1, windowEnd - windowStart);

		const lanes: Lane[] = [];
		for (const c of cells) {
			const entries = all
				.filter((r) => r.envName === c.envName)
				.sort((a, b) => a.ts - b.ts);
			// Dedup consecutive identical versions
			const dedup: Raw[] = [];
			for (const e of entries) {
				const last = dedup[dedup.length - 1];
				if (last && last.ver === e.ver) continue;
				dedup.push(e);
			}
			const segs: Seg[] = dedup.map((e, i) => {
				const nextTs = dedup[i + 1]?.ts ?? windowEnd;
				const left = ((e.ts - windowStart) / span) * 100;
				const width = ((nextTs - e.ts) / span) * 100;
				return {
					version: e.ver,
					color: VERSION_PALETTE[(versionRank.get(e.ver) ?? 0) % VERSION_PALETTE.length],
					left,
					width,
					isCurrent: i === dedup.length - 1 && e.isLatest
				};
			});
			const lastEntry = dedup[dedup.length - 1];
			const currentVersion = lastEntry?.ver ?? null;
			const currentRank = currentVersion ? versionRank.get(currentVersion) ?? null : null;
			const bakeStatus = lastEntry?.bakeStatus ?? 'None';

			let stuck: StuckReason | null = null;
			const own = detectStuck(c.rollout, { now: refNow });
			if (own) stuck = own;
			else {
				for (const peer of cells) {
					if (peer === c) continue;
					const r = detectStuckBehind(c.rollout, peer.rollout, peer.envName, { now: refNow });
					if (r) {
						stuck = r;
						break;
					}
				}
			}

			lanes.push({
				envName: c.envName,
				envLabel: shortEnvLabel(c.theme) || c.envName || '—',
				theme: c.theme,
				segs,
				currentVersion,
				currentRank,
				bakeStatus,
				stuck
			});
		}
		return { lanes, versionRank, lifecycle };
	});

	const worstStatus = $derived.by(() => {
		const statuses = built.lanes.map((l) => l.bakeStatus);
		if (statuses.includes('Failed')) return 'Failed';
		if (statuses.includes('InProgress')) return 'InProgress';
		if (statuses.includes('Deploying')) return 'Deploying';
		if (statuses.every((s) => s === 'Succeeded')) return 'Succeeded';
		return 'None';
	});
	const worstStuck = $derived.by<StuckReason | null>(() => {
		for (const l of built.lanes) if (l.stuck) return l.stuck;
		return null;
	});

	const driftSummary = $derived.by(() => {
		const currentVersions = new Set(built.lanes.map((l) => l.currentVersion).filter(Boolean) as string[]);
		if (currentVersions.size === 0) return { label: 'no deploys yet', synced: false };
		if (currentVersions.size === 1) return { label: 'all on newest', synced: true };
		return { label: `spread across ${currentVersions.size} versions`, synced: false };
	});

	function ringClass(bake: string, stuck: StuckReason | null): string {
		if (stuck) return 'ring-amber-500';
		switch (bake) {
			case 'Succeeded': return 'ring-emerald-400';
			case 'Failed': return 'ring-red-500';
			case 'InProgress': return 'ring-yellow-400';
			case 'Deploying': return 'ring-blue-500';
			default: return 'ring-gray-400';
		}
	}

	const latestDeploy = $derived.by<string | null>(() => {
		let ts: string | null = null;
		for (const c of cells) {
			const h = c.rollout?.status?.history?.[0]?.timestamp;
			if (h && (!ts || new Date(h) > new Date(ts))) ts = h;
		}
		return ts;
	});
</script>

<a
	href="/apps/{name}"
	class="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
>
	<!-- Header row: status circle · title + name · drift summary -->
	<div class="flex items-start gap-3 px-5 pt-4">
		<span class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(worstStatus)}">
			<BakeStatusIcon bakeStatus={worstStatus} size="medium" />
		</span>
		<div class="flex min-w-0 flex-1 flex-col">
			<div class="flex min-w-0 items-baseline gap-2">
				<span class="truncate text-base font-semibold text-gray-900 dark:text-white">{title}</span>
				{#if worstStuck}<StuckBadge reason={worstStuck} size="xs" />{/if}
			</div>
			<span class="truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">{name}</span>
		</div>
		<div class="flex shrink-0 flex-col items-end gap-0.5">
			<span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider {driftSummary.synced ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}">
				<span class="h-1.5 w-1.5 rounded-full {driftSummary.synced ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-500'}"></span>
				{driftSummary.label}
			</span>
			{#if built.lifecycle[0]}
				<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">
					newest <span class="text-gray-600 dark:text-gray-300">{built.lifecycle[0]}</span>
				</span>
			{/if}
		</div>
	</div>

	<!-- Lane chart: one row per env. Layout: [env badge] [lane segments]
	     [rank chip — center-aligned] [status icon]. The current version
	     is shown inside its lane segment (when wide enough); no separate
	     version text on the right. -->
	<div class="flex flex-col gap-1.5 px-5 py-4">
		{#each built.lanes as lane (lane.envName)}
			<div
				class="environment-theme-scope grid items-center gap-1.5"
				style="grid-template-columns: 64px minmax(0, 1fr) 56px 20px; {lane.theme ? getEnvironmentThemeStyle(lane.theme) : ''}"
			>
				<span class="environment-theme-badge inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{lane.envLabel}</span>
				<div class="relative h-5 overflow-hidden rounded-md bg-gray-50 dark:bg-gray-900/40">
					{#each lane.segs as s, si}
						{@const showLabel = s.width >= 14}
						<span
							class="absolute top-0.5 bottom-0.5 flex min-w-0 items-center overflow-hidden whitespace-nowrap rounded-sm font-mono text-[9px] font-semibold text-white/95 {s.color} {s.isCurrent ? `ring-[1.5px] ring-inset ${ringClass(lane.bakeStatus, lane.stuck)}` : ''} {showLabel ? 'px-1' : 'px-0'}"
							style="left: {s.left}%; width: {s.width}%;"
							title={`${lane.envName} · ${s.version}${s.isCurrent ? ' (current)' : ''}`}
						>
							{#if showLabel}{s.version}{/if}
						</span>
					{/each}
				</div>
				<div class="flex justify-center">
					{#if lane.currentRank === 0}
						<span class="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">newest</span>
					{:else if lane.currentRank !== null}
						<span class="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-gray-600 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-300">−{lane.currentRank}</span>
					{:else}
						<span class="font-mono text-[9px] text-gray-400 dark:text-gray-500">—</span>
					{/if}
				</div>
				<!-- Status icon at the end — same pastel disc + static icon
				     the rest of the dashboard uses. No halo: the icon alone
				     is the indicator. -->
				<span class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(lane.bakeStatus)}" title={lane.bakeStatus}>
					<BakeStatusIcon bakeStatus={lane.bakeStatus} size="small" />
				</span>
			</div>
		{/each}
	</div>

	<!-- Footer: version legend (newest first) -->
	{#if built.lifecycle.length > 0}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-5 py-2.5 dark:border-gray-700/60">
			<span class="font-mono text-[9px] uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">versions</span>
			{#each built.lifecycle as v, vi}
				<span class="inline-flex items-baseline gap-1">
					<span class="h-1.5 w-3 rounded-sm {VERSION_PALETTE[vi % VERSION_PALETTE.length]}"></span>
					<span class="font-mono text-[10px] text-gray-600 dark:text-gray-300">{v}</span>
					<span class="font-mono text-[9px] uppercase tracking-wider {vi === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}">{vi === 0 ? 'newest' : `−${vi}`}</span>
				</span>
			{/each}
			{#if latestDeploy}
				<span class="ml-auto font-mono text-[10px] text-gray-400 dark:text-gray-500">newest deploy {formatTimeAgoCompact(latestDeploy, refNow)} ago</span>
			{/if}
		</div>
	{/if}
</a>
