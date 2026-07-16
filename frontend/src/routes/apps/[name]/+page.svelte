<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { sourceDashboardURL, sourceClusterName, rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import { getDisplayVersion, formatTimeAgoCompact, formatTimeAgo, categorizeFailure, formatStatusTime, compareRollouts } from '$lib/utils';
	import { getRolloutEnvironmentTheme, getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import { getStatusCircleClass, getStatusPingClass } from '$lib/bake-status';
	import { detectStuck, detectStuckBehind } from '$lib/utils';
	import type { Rollout, Environment } from '../../../types';

	const appName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type Cell = {
		envName: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		sourceURL: string; // dashboard URL this env/rollout lives on
		sourceCluster: string; // cluster NAME (for name-based routing)
	};

	// Build the rollout detail path with the source cluster name embedded, so a
	// card click opens the rollout on the cluster it actually lives on.
	function rolloutHref(cell: Cell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout?.metadata?.namespace || '',
			cell.rollout?.metadata?.name || ''
		);
	}

	const cells = $derived.by<Cell[]>(() => {
		const envObjs = environments.filter((e) => e.spec?.rolloutRef?.name === appName);
		if (envObjs.length > 0) {
			const result: Cell[] = envObjs.map((env) => {
				const envName = env.spec?.environment || '';
				const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, env)) || null;
				const theme = rollout ? getRolloutEnvironmentTheme(rollout, env) : null;
				return { envName, environment: env, rollout, theme, sourceURL: sourceDashboardURL(env), sourceCluster: sourceClusterName(env) };
			});
			return result.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
		}
		// Fallback: no Environment resources, but we may still have rollouts named appName
		// across namespaces. Show them sorted by namespace.
		const matchingRollouts = rollouts.filter((r) => r.metadata?.name === appName);
		return matchingRollouts
			.map<Cell>((r) => {
				const theme = getRolloutEnvironmentTheme(r);
				return {
					envName: r.metadata?.namespace || '',
					environment: {} as Environment,
					rollout: r,
					theme,
					sourceURL: sourceDashboardURL(r),
					sourceCluster: sourceClusterName(r)
				};
			})
			.sort((a, b) => (a.rollout?.metadata?.namespace || '').localeCompare(b.rollout?.metadata?.namespace || ''));
	});

	const hasEnvironmentBinding = $derived(
		environments.some((e) => e.spec?.rolloutRef?.name === appName)
	);

	// The environment this cell should promote from: the peer it is most closely
	// behind (smallest positive distance). Used to show commit drift between
	// environments ("N commits behind staging").
	function upstreamPeerFor(cell: Cell): Cell | null {
		if (!cell.rollout) return null;
		let best: { peer: Cell; by: number } | null = null;
		for (const peer of cells) {
			if (peer === cell || !peer.rollout) continue;
			const rel = compareRollouts(cell.rollout, peer.rollout);
			if (rel && rel.kind === 'behind' && typeof rel.by === 'number' && rel.by > 0) {
				if (!best || rel.by < best.by) best = { peer, by: rel.by };
			}
		}
		return best?.peer ?? null;
	}

	const appTitle = $derived.by(() => {
		const titles: string[] = [];
		for (const c of cells) {
			if (c.rollout?.status?.title) titles.push(c.rollout.status.title);
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
			if (c.rollout?.status?.description && c.rollout.status.description !== c.rollout.status.title) {
				return c.rollout.status.description;
			}
		}
		return null;
	});

	type ActivityEntry = {
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		timestamp: string;
		bakeStatus: string;
		rollout: Rollout;
		ns: string;
		entryId: number;
		sourceURL: string;
		sourceCluster: string;
	};

	const allActivity = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const cell of cells) {
			if (!cell.rollout?.status?.history) continue;
			for (const entry of cell.rollout.status.history) {
				list.push({
					envName: cell.envName,
					theme: cell.theme,
					version: getDisplayVersion(entry.version),
					timestamp: entry.timestamp,
					bakeStatus: entry.bakeStatus || 'None',
					rollout: cell.rollout,
					ns: cell.rollout.metadata?.namespace || '',
					entryId: entry.id ?? 0,
					sourceURL: cell.sourceURL,
					sourceCluster: cell.sourceCluster
				});
			}
		}
		return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	});

	const recentActivity = $derived(allActivity.slice(0, 14));

	type ActivityDayGroup = { label: string; key: string; entries: ActivityEntry[] };
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
	const activityByDay = $derived.by<ActivityDayGroup[]>(() => {
		const refNow = $now;
		const map = new Map<string, ActivityDayGroup>();
		for (const a of recentActivity) {
			const key = dayKey(a.timestamp);
			let group = map.get(key);
			if (!group) {
				group = { label: dayLabel(a.timestamp, refNow), key, entries: [] };
				map.set(key, group);
			}
			group.entries.push(a);
		}
		return Array.from(map.values());
	});

	// Version map: for each version, where is it deployed (history[0]) and where else does it appear in history
	type VersionLifecycle = {
		version: string;
		current: { envName: string; cell: Cell; bakeStatus: string; timestamp: string }[];
		// Past deploys deduped per env: keep most-recent timestamp + total count.
		past: { envName: string; cell: Cell; timestamp: string; count: number }[];
	};

	const versionLifecycles = $derived.by<VersionLifecycle[]>(() => {
		const map = new Map<string, VersionLifecycle>();
		// Track past entries per (version, env) so we can dedupe and keep the newest timestamp.
		const pastByKey = new Map<string, { envName: string; cell: Cell; timestamp: string; count: number }>();
		for (const c of cells) {
			const h = c.rollout?.status?.history;
			if (!h || h.length === 0) continue;
			const current = h[0];
			const currentVer = getDisplayVersion(current.version);
			if (!map.has(currentVer)) map.set(currentVer, { version: currentVer, current: [], past: [] });
			map.get(currentVer)!.current.push({
				envName: c.envName,
				cell: c,
				bakeStatus: current.bakeStatus || 'None',
				timestamp: current.timestamp
			});
			for (let i = 1; i < h.length; i++) {
				const pastVer = getDisplayVersion(h[i].version);
				if (!map.has(pastVer)) map.set(pastVer, { version: pastVer, current: [], past: [] });
				const key = `${pastVer} ${c.envName} ${c.rollout?.metadata?.namespace ?? ''}`;
				const existing = pastByKey.get(key);
				if (existing) {
					existing.count += 1;
					if (new Date(h[i].timestamp) > new Date(existing.timestamp)) {
						existing.timestamp = h[i].timestamp;
					}
				} else {
					const entry = { envName: c.envName, cell: c, timestamp: h[i].timestamp, count: 1 };
					pastByKey.set(key, entry);
					map.get(pastVer)!.past.push(entry);
				}
			}
		}
		const out = [...map.values()];
		// Sort each version's past pills by timestamp (newest first)
		for (const v of out) {
			v.past.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		}
		// Sort by the most-recent timestamp anywhere in the version's lifecycle, newest first.
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

	// Per-version timeline events: for each version, every (env, timestamp)
	// pair when it was deployed. Used to render a Gantt-style strip per row.
	type VersionEvent = {
		envName: string;
		timestamp: string;
		bakeStatus: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		isCurrent: boolean; // is this env still on this version?
	};
	const versionEvents = $derived.by<Record<string, VersionEvent[]>>(() => {
		const out: Record<string, VersionEvent[]> = {};
		for (const c of cells) {
			const history = c.rollout?.status?.history ?? [];
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const v = getDisplayVersion(h.version);
				if (!v) continue;
				if (!out[v]) out[v] = [];
				out[v].push({
					envName: c.envName,
					timestamp: h.timestamp,
					bakeStatus: h.bakeStatus || 'None',
					theme: c.theme,
					isCurrent: i === 0
				});
			}
		}
		for (const v of Object.keys(out)) {
			out[v].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
		}
		return out;
	});

	const currentVersions = $derived.by(() => {
		const set = new Set<string>();
		for (const c of cells) {
			const v = c.rollout?.status?.history?.[0]?.version;
			if (v) set.add(getDisplayVersion(v));
		}
		return [...set];
	});

	// ──────────────────────── Gantt model ────────────────────────
	// Each env gets a horizontal lane. Within a lane, each deploy
	// of the rollout in that env becomes a bar that runs from its
	// timestamp to the next deploy in the same env (or 'now' for
	// the current version). Same version uses the same color
	// across lanes so promotion velocity is visible at a glance.

	type GanttSegment = {
		envName: string;
		envLabel: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		colorClass: string;
		startMs: number;
		endMs: number;
		bakeStatus: string;
		isCurrent: boolean;
		rank: number; // 0 = oldest known version, higher = newer
		behindLatest: number; // 0 = newest known, 1 = one version older, …
	};
	type GanttLane = {
		envName: string;
		envLabel: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		segments: GanttSegment[];
	};

	// User-pickable timeline range for the Gantt. 'all' shows everything
	// from the earliest known deploy to now. Finer options (1h/6h/12h) let
	// the user zoom into a recent deploy burst.
	type GanttRange = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | 'all';
	let ganttRange = $state<GanttRange>('all');
	const GANTT_RANGE_MS: Record<GanttRange, number | null> = {
		'1h': 60 * 60 * 1000,
		'6h': 6 * 60 * 60 * 1000,
		'12h': 12 * 60 * 60 * 1000,
		'24h': 24 * 60 * 60 * 1000,
		'7d': 7 * 24 * 60 * 60 * 1000,
		'30d': 30 * 24 * 60 * 60 * 1000,
		'all': null
	};

	// Tailwind palette — distinct hues for adjacent versions. Cycled
	// based on the version's index in chronological deploy order.
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

	// Build the Gantt: window, lanes, segments. Colour assignment is
	// stable per version (first-seen order in chronological scan).
	const gantt = $derived.by<{
		windowStart: number;
		windowEnd: number;
		lanes: GanttLane[];
		versionColors: Map<string, string>;
		versionRank: Map<string, number>; // 0 oldest, N-1 newest
		latestVersion: string | null;
	}>(() => {
		const refNow = $now.getTime();
		const versionColors = new Map<string, string>();
		// Pass 1: collect all (env, version, timestamp) entries to find
		// earliest deploy and assign colours by first-seen order.
		type Raw = { envName: string; envLabel: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> | null; ver: string; ts: number; bakeStatus: string; isLatest: boolean };
		const all: Raw[] = [];
		for (const c of cells) {
			const history = c.rollout?.status?.history ?? [];
			const envLabel = hasEnvironmentBinding ? c.envName : (c.theme?.label ?? c.envName);
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const v = getDisplayVersion(h.version);
				if (!v) continue;
				all.push({
					envName: c.envName,
					envLabel,
					theme: c.theme,
					ver: v,
					ts: new Date(h.timestamp).getTime(),
					bakeStatus: h.bakeStatus || 'None',
					isLatest: i === 0
				});
			}
		}
		if (all.length === 0) {
			return { windowStart: refNow - 60_000, windowEnd: refNow, lanes: [], versionColors, versionRank: new Map(), latestVersion: null };
		}
		all.sort((a, b) => a.ts - b.ts);
		// Assign colours + ranks by first-seen order. Rank N = Nth-newest;
		// 0 is the oldest known version, (totalVersions-1) is the newest.
		let colorIdx = 0;
		const versionRank = new Map<string, number>();
		for (const r of all) {
			if (!versionColors.has(r.ver)) {
				versionColors.set(r.ver, VERSION_PALETTE[colorIdx % VERSION_PALETTE.length]);
				versionRank.set(r.ver, colorIdx);
				colorIdx++;
			}
		}
		const latestRank = colorIdx - 1;
		let latestVersion: string | null = null;
		for (const [v, r] of versionRank) {
			if (r === latestRank) latestVersion = v;
		}
		const windowEnd = refNow;
		// Pick the window start: 'all' uses earliest deploy; presets cap
		// the window to N ago from now, but never start later than the
		// earliest deploy (so we don't lose deploys older than the range).
		const rangeMs = GANTT_RANGE_MS[ganttRange];
		const windowStart = rangeMs === null
			? all[0].ts
			: Math.max(all[0].ts, refNow - rangeMs);

		// Pass 2: per-env segments. For each env, sort by timestamp asc,
		// then segment[i] runs from entry[i].ts → entry[i+1].ts (or now).
		const byEnv = new Map<string, { envLabel: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> | null; entries: Raw[] }>();
		for (const r of all) {
			let g = byEnv.get(r.envName);
			if (!g) {
				g = { envLabel: r.envLabel, theme: r.theme, entries: [] };
				byEnv.set(r.envName, g);
			}
			g.entries.push(r);
		}
		const lanes: GanttLane[] = [];
		// Preserve cells order so lanes mirror the promotion flow above.
		for (const c of cells) {
			const g = byEnv.get(c.envName);
			if (!g) continue;
			const entries = g.entries.sort((a, b) => a.ts - b.ts);
			// Deduplicate consecutive identical versions per env (a redeploy
			// of the same version shouldn't visually split into two bars).
			const dedup: Raw[] = [];
			for (const e of entries) {
				const last = dedup[dedup.length - 1];
				if (last && last.ver === e.ver) continue;
				dedup.push(e);
			}
			const segments: GanttSegment[] = dedup.map((e, i) => {
				const nextTs = dedup[i + 1]?.ts ?? windowEnd;
				const rank = versionRank.get(e.ver) ?? 0;
				return {
					envName: c.envName,
					envLabel: g.envLabel,
					theme: g.theme,
					version: e.ver,
					colorClass: versionColors.get(e.ver) ?? 'bg-gray-400 dark:bg-gray-500',
					startMs: e.ts,
					endMs: nextTs,
					bakeStatus: e.bakeStatus,
					isCurrent: i === dedup.length - 1 && e.isLatest,
					rank,
					behindLatest: latestRank - rank
				};
			});
			lanes.push({ envName: c.envName, envLabel: g.envLabel, theme: g.theme, segments });
		}
		return { windowStart, windowEnd, lanes, versionColors, versionRank, latestVersion };
	});

	function ganttPct(ms: number, w: { windowStart: number; windowEnd: number }): number {
		const span = w.windowEnd - w.windowStart;
		if (span <= 0) return 100;
		return Math.max(0, Math.min(100, ((ms - w.windowStart) / span) * 100));
	}

	// Time-axis ticks: pick a step so we end up with ~5–8 ticks. Anything
	// denser overlaps on narrow tracks.
	const ganttTicks = $derived.by<{ ms: number; label: string }[]>(() => {
		const w = { start: gantt.windowStart, end: gantt.windowEnd };
		const span = w.end - w.start;
		if (span <= 0) return [];
		const HOUR = 3_600_000;
		const DAY = 86_400_000;
		let step: number;
		let fmt: (d: Date) => string;
		if (span < 6 * HOUR) {
			step = HOUR;
			fmt = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		} else if (span < 30 * HOUR) {
			step = 6 * HOUR;
			fmt = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' });
		} else if (span < 10 * DAY) {
			step = DAY;
			fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		} else if (span < 60 * DAY) {
			step = 7 * DAY;
			fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		} else {
			step = 30 * DAY;
			fmt = (d) => d.toLocaleDateString(undefined, { month: 'short' });
		}
		// Snap first tick to step boundary above windowStart
		const first = Math.ceil(w.start / step) * step;
		const ticks: { ms: number; label: string }[] = [];
		for (let t = first; t <= w.end; t += step) {
			ticks.push({ ms: t, label: fmt(new Date(t)) });
		}
		return ticks;
	});

	function formatSegmentDuration(s: GanttSegment): string {
		const ms = s.endMs - s.startMs;
		if (ms < 60_000) return '<1m';
		if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
		if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
		return `${Math.round(ms / 86_400_000)}d`;
	}
	const deployedCellCount = $derived(
		cells.filter((c) => c.rollout?.status?.history?.[0]).length
	);
	const undeployedCount = $derived(cells.length - deployedCellCount);
	const allInSync = $derived(
		currentVersions.length === 1 && cells.length > 1 && undeployedCount === 0
	);

	// Promotion candidates: versions deployed in an earlier-tier env but not yet the latest env
	// (used to nudge "ready to promote v1.5 from dev → prod")
	type PromotionHint = {
		version: string;
		fromEnv: string;
		toEnv: string;
		fromCell: Cell;
		toCell: Cell;
		// Position of the lagging env's current version in the leading env's history.
		// 1 = one deploy behind, 2 = two, etc. null when we can't determine.
		behindBy: number | null;
	};

	// For each cell, scan all peers. A peer that the data says we're "behind"
	// becomes a promotion hint (peer → me-is-lagging). Direction is derived
	// from history, not env-name ordering.
	const promotionHints = $derived.by<PromotionHint[]>(() => {
		if (cells.length < 2) return [];
		const hints: PromotionHint[] = [];
		for (const later of cells) {
			if (!later.rollout) continue;
			if (later.rollout.spec?.wantedVersion) continue;
			let bestFor: PromotionHint | null = null;
			for (const earlier of cells) {
				if (earlier === later || !earlier.rollout) continue;
				const rel = compareRollouts(later.rollout, earlier.rollout);
				if (!rel || rel.kind !== 'behind') continue;
				const candidate: PromotionHint = {
					version: rel.otherVersion,
					fromEnv: earlier.envName,
					toEnv: later.envName,
					fromCell: earlier,
					toCell: later,
					behindBy: rel.by
				};
				if (!bestFor || (candidate.behindBy ?? 0) > (bestFor.behindBy ?? 0)) bestFor = candidate;
			}
			if (bestFor) hints.push(bestFor);
		}
		return hints;
	});

	// For each cell, the promotion hint that targets it (if any) — used to render
	// a 'behind by …' badge on the lagging environment card.
	function hintFor(cell: Cell): PromotionHint | undefined {
		return promotionHints.find((h) => h.toCell === cell);
	}

	// Per-app version rank by release time (version.created). Newest version
	// in the lifecycle = rank 0, then -1, -2, etc. Used by the per-env rank
	// chip on the action cards below.
	const versionReleaseRank = $derived.by<Map<string, number>>(() => {
		const maxCreatedByVer = new Map<string, number>();
		for (const c of cells) {
			for (const h of c.rollout?.status?.history ?? []) {
				const v = h.version ? getDisplayVersion(h.version) : null;
				if (!v) continue;
				const created = (h.version as any)?.created;
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

	function rankForCell(cell: Cell): number | null {
		const v = cell.rollout?.status?.history?.[0]?.version
			? getDisplayVersion(cell.rollout.status.history[0].version)
			: null;
		if (!v) return null;
		return versionReleaseRank.get(v) ?? null;
	}

	// Most-recent succeeded version that's different from currentV — used as a
	// rollback target hint on failed cells.
	function previousSucceededFor(r: Rollout | null, currentV: string | null): string | null {
		if (!r) return null;
		for (const h of r.status?.history ?? []) {
			if (h.bakeStatus !== 'Succeeded') continue;
			const v = getDisplayVersion(h.version);
			if (v && v !== currentV) return v;
		}
		return null;
	}

	// Status helpers
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
		None: '—'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-500',
		None: 'text-gray-400 dark:text-gray-600'
	};

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	const failedCount = $derived(
		cells.filter((c) => c.rollout?.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		cells.filter((c) => {
			const s = c.rollout?.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
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
			<!-- Promotion flow skeleton -->
			<div>
				<div class="mb-3 h-3 w-32 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
				<div class="flex flex-wrap gap-3">
					{#each Array(3) as _}
						<div class="h-28 min-w-[180px] flex-1 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
					{/each}
				</div>
			</div>
			<!-- Lifecycle + activity skeleton -->
			<div class="grid gap-6 lg:grid-cols-5">
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700 lg:col-span-3"></div>
				<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700 lg:col-span-2"></div>
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
				{#if failedCount > 0}<span class="font-medium text-red-600 dark:text-red-400">· {failedCount} failed</span>{/if}
				{#if activeCount > 0}<span class="font-medium text-yellow-700 dark:text-yellow-400">· {activeCount} in progress</span>{/if}
				{#if failedCount === 0 && activeCount === 0 && undeployedCount > 0}<span>· {undeployedCount} pending</span>{/if}
				{#if failedCount === 0 && activeCount === 0 && allInSync}<span class="text-green-600 dark:text-green-400">· in sync</span>{/if}
			</div>
		</div>
		{#if appDescription}
			<p class="-mt-3 mb-6 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{appDescription}</p>
		{/if}

		<!-- Two-pane workspace: per-env action cards on the left,
		     activity rail on the right. -->
		<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
			<!-- Left: env action cards. Each card has a header bar
			     (status + env + namespace + rank) and a 3-column body
			     (Version · State · Recent deploys). -->
			<section class="flex flex-col gap-3">
				{#each cells as c (c.envName + (c.rollout?.metadata?.namespace ?? ''))}
					{@const latest = c.rollout?.status?.history?.[0]}
					{@const status = latest?.bakeStatus || 'None'}
					{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
					{@const prevV = previousSucceededFor(c.rollout, ver)}
					{@const stuck = c.rollout
						? (detectStuck(c.rollout, { now: $now }) ||
							(() => {
								for (const peer of cells) {
									if (peer === c) continue;
									const r = detectStuckBehind(c.rollout, peer.rollout, peer.envName, { now: $now });
									if (r) return r;
								}
								return null;
							})())
						: null}
					{@const rank = rankForCell(c)}
					{@const isNewest = rank === 0}
					{@const source = c.rollout?.status?.source}
					{@const failureCategory = status === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null}
					{@const stateText = failureCategory
						? `${failureCategory} failed`
						: status === 'Succeeded'
							? 'Succeeded'
							: status === 'InProgress'
								? 'Baking'
								: status === 'Deploying'
									? 'Deploying'
									: status === 'Cancelled'
										? 'Cancelled'
										: 'No deploy yet'}
					{@const stateClass = status === 'Failed'
						? 'text-red-600 dark:text-red-400'
						: status === 'Succeeded'
							? 'text-emerald-600 dark:text-emerald-400'
							: status === 'InProgress'
								? 'text-yellow-700 dark:text-yellow-400'
								: status === 'Deploying'
									? 'text-blue-600 dark:text-blue-400'
									: 'text-gray-500 dark:text-gray-400'}
					{@const recentDeploys = (c.rollout?.status?.history ?? []).slice(0, 5)}
					{@const upstream = upstreamPeerFor(c)}
					{@const commitsCluster = c.sourceCluster || localClusterName}
					<article
						class="environment-theme-scope group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
						style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
					>
						<!-- Whole-card link: an absolute overlay over the entire article
						     so any click on the card (except interactive widgets like
						     the GitHub button) opens the rollout detail. Interactive
						     children must be `relative z-10` to stay clickable. -->
						<a
							href={rolloutHref(c)}
							class="absolute inset-0 z-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
							aria-label="Open rollout detail for {c.envName}"
						></a>
						<!-- Header bar — visual hierarchy only; clicks fall through to
						     the overlay link above. -->
						<div class="pointer-events-none relative z-[1] flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5 dark:border-gray-700/60">
							<div class="flex min-w-0 items-center gap-2.5">
								<span class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(status)}">
									<BakeStatusIcon bakeStatus={status} size="small" />
								</span>
								<span class="environment-theme-badge shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{hasEnvironmentBinding ? c.envName : (c.theme?.label ?? c.envName)}</span>
								<span class="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{c.rollout?.metadata?.namespace ?? ''}</span>
								{#if stuck}<StuckBadge reason={stuck} size="xs" />{/if}
								{#if isNewest}
									<span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-300">
										<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
										newest
									</span>
								{:else if rank !== null}
									<span class="inline-flex shrink-0 items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-gray-600 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-300">−{rank} from newest</span>
								{/if}
							</div>
							<!-- GitHub button stays interactive: opt back into pointer
							     events + raise z-index above the card overlay link. -->
							{#if source}
								<div class="pointer-events-auto relative z-10 flex shrink-0 gap-1.5">
									<GitHubViewButton sourceUrl={source} version={ver ?? ''} size="xs" />
								</div>
							{/if}
						</div>

						<!-- 3-column body — visual; clicks fall through to the card link. -->
						<div class="pointer-events-none relative z-[1] grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-gray-700/60">
							<!-- Version -->
							<div class="pointer-events-auto relative z-10 px-4 py-3">
								<div class="mb-1 font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Version</div>
								<div class="flex flex-wrap items-baseline gap-2">
									{#if c.rollout?.spec?.wantedVersion}<PinBadge version={c.rollout.spec.wantedVersion} size="xs" />{/if}
									{#if ver}
										<a href={versionPathForRollout(c.rollout, appName, ver)} class="font-mono text-base text-gray-900 hover:underline dark:text-white">{ver}</a>
									{:else}
										<span class="font-mono text-base text-gray-900 dark:text-white">—</span>
									{/if}
								</div>
								{#if prevV}
									<div class="mt-0.5 font-mono text-[11px] text-gray-400 line-through dark:text-gray-500">was {prevV}</div>
								{/if}
							</div>
							<!-- State -->
							<div class="px-4 py-3">
								<div class="mb-1 font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">State</div>
								<div class="text-sm {stateClass}" title={latest?.bakeStatusMessage ?? ''}>{stateText}</div>
								{#if latest?.timestamp}
									<div class="mt-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400" title={formatTimeAgo(latest.timestamp, $now)}>{formatStatusTime(status, latest.timestamp, $now)}</div>
								{/if}
							</div>
							<!-- Recent deploys: 5-tick mini history strip -->
							<div class="px-4 py-3">
								<div class="mb-1 font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Recent deploys</div>
								<div class="flex items-center gap-1">
									{#if recentDeploys.length === 0}
										<span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">no deploys yet</span>
									{:else}
										{#each [...Array(5).keys()] as i}
											{@const h = recentDeploys[recentDeploys.length - 1 - i]}
											{@const idx = 4 - i}
											<span
												class="inline-block h-1.5 w-4 rounded-sm {h ? (h.bakeStatus === 'Succeeded' ? 'bg-green-500' : h.bakeStatus === 'Failed' ? 'bg-red-500' : h.bakeStatus === 'InProgress' ? 'bg-yellow-400' : h.bakeStatus === 'Deploying' ? 'bg-blue-500' : 'bg-gray-400') : 'bg-gray-200 dark:bg-gray-700'} {idx === 4 ? 'opacity-100' : 'opacity-55'}"
												title={h ? `${getDisplayVersion(h.version)} · ${h.bakeStatus}` : 'empty slot'}
											></span>
										{/each}
									{/if}
								</div>
							</div>
						</div>
						<!-- Commit drift: how far this environment is behind the one it
						     promotes from, as commits (on behalf of the viewing user).
						     pointer-events-auto/z-10 so its Connect button + links stay
						     clickable above the whole-card overlay link. -->
						{#if source && upstream}
							<div class="pointer-events-auto relative z-10 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60">
								<CommitSummary
									namespace={c.rollout?.metadata?.namespace ?? ''}
									name={c.rollout?.metadata?.name ?? ''}
									cluster={commitsCluster}
									base={c.rollout?.status?.history?.[0]?.version?.revision}
									head={upstream.rollout?.status?.history?.[0]?.version?.revision}
									verb={`behind ${hasEnvironmentBinding ? upstream.envName : (upstream.theme?.label ?? upstream.envName)}`}
									showAvatars
									hideWhenEmpty
								/>
							</div>
						{/if}
					</article>
				{/each}

				<!-- Compact Gantt lives inside the left column so the activity rail
				     in the right column extends alongside it. -->
				<section class="mt-3">
					<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							Version lifecycle
						</h2>
						{#if gantt.lanes.length > 0}
							<div class="flex items-center gap-2">
								<!-- Range picker -->
								<div class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-gray-100 p-0.5 text-[10px] font-medium dark:bg-gray-700/60">
									{#each (['1h','6h','12h','24h','7d','30d','all'] as GanttRange[]) as r}
										<button
											type="button"
											onclick={() => (ganttRange = r)}
											class="rounded px-1.5 py-0.5 uppercase tracking-wider transition-colors
												{ganttRange === r
													? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
													: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
										>{r}</button>
									{/each}
								</div>
								<span class="font-mono text-[10px] text-gray-400 dark:text-gray-500">
									{formatTimeAgoCompact(new Date(gantt.windowStart).toISOString(), $now)} ago · now
								</span>
							</div>
						{/if}
					</div>
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						{#if gantt.lanes.length === 0}
							<div class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
								No deploy history yet.
							</div>
						{:else}
							<!-- Header row: time-axis ticks. Grid template matches lanes. -->
							<div class="grid items-center gap-3 border-b border-gray-100 px-4 pt-3 pb-2 dark:border-gray-700/60" style="grid-template-columns: 80px minmax(0, 1fr);">
								<div></div>
								<div class="relative h-4">
									{#each ganttTicks as t}
										<span
											class="absolute -translate-x-1/2 font-mono text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500"
											style="left: {ganttPct(t.ms, gantt)}%"
										>
											{t.label}
										</span>
									{/each}
								</div>
							</div>

							<!-- Lanes — same grid template so env column aligns with header placeholder. -->
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each gantt.lanes as lane}
									{@const laneCell = cells.find((c) => c.envName === lane.envName)}
									<li class="grid items-center gap-3 px-4 py-3" style="grid-template-columns: 80px minmax(0, 1fr);">
										<!-- Env label column -->
										<span
											class="environment-theme-scope environment-theme-badge inline-flex max-w-full items-center justify-center truncate rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
											style={lane.theme ? getEnvironmentThemeStyle(lane.theme) : ''}
											title={lane.envLabel}
										>{lane.envLabel}</span>
										<!-- Track with absolute-positioned bars -->
										<div class="relative h-7 rounded bg-gray-50 dark:bg-gray-900/40">
											<!-- Tick verticals -->
											{#each ganttTicks as t}
												<span class="absolute top-0 h-full w-px bg-gray-200 dark:bg-gray-700/60" style="left: {ganttPct(t.ms, gantt)}%" aria-hidden="true"></span>
											{/each}
											<!-- 'now' marker on right edge -->
											<span class="absolute right-0 top-0 h-full w-px bg-gray-400 dark:bg-gray-500" aria-hidden="true"></span>
											{#each lane.segments as seg}
												{@const left = ganttPct(seg.startMs, gantt)}
												{@const right = ganttPct(seg.endMs, gantt)}
												{@const width = right - left}
												{@const showLabel = width >= 18}
												{@const showRank = width >= 18 && seg.behindLatest > 0}
												{@const behindLabel = seg.behindLatest === 0 ? 'newest' : `${seg.behindLatest} behind newest`}
												<a
													href={laneCell ? rolloutHref(laneCell) : '#'}
													class="group absolute top-0.5 bottom-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded {seg.colorClass} text-[10px] font-mono font-medium text-white shadow-sm transition-all hover:z-10 hover:brightness-110 {seg.isCurrent ? 'ring-1 ring-white/50 dark:ring-white/30' : 'opacity-90'} {showLabel ? 'px-1.5' : 'px-0'}"
													style="left: {left}%; width: {width}%;"
													title={`${seg.envName} · ${seg.version} · ${behindLabel} · ${seg.bakeStatus} · ${formatTimeAgo(new Date(seg.startMs).toISOString(), $now)} for ${formatSegmentDuration(seg)}${seg.isCurrent ? ' (current)' : ''}`}
												>
													{#if showLabel}
														<span class="truncate">{seg.version}</span>
													{/if}
													{#if showRank}
														<span class="min-w-0 truncate rounded-sm bg-black/25 px-1 text-[8px] font-bold text-white/90">−{seg.behindLatest}</span>
													{/if}
												</a>
											{/each}
										</div>
									</li>
								{/each}
							</ul>

							<!-- Version ladder: newest at the top, with offset from newest -->
							{@const sortedVers = [...gantt.versionRank].sort((a, b) => b[1] - a[1])}
							{@const latestRank = sortedVers[0]?.[1] ?? 0}
							<div class="border-t border-gray-100 px-4 py-2 dark:border-gray-700/60">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
									<span class="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">versions · newest first</span>
									{#each sortedVers as [ver, rank]}
										{@const behind = latestRank - rank}
										<span class="inline-flex items-center gap-1.5 text-[10px]">
											<span class="inline-block h-2 w-3 rounded-sm {gantt.versionColors.get(ver)}"></span>
											<span class="font-mono text-gray-600 dark:text-gray-300">{ver}</span>
											<span class="rounded bg-gray-100 px-1 font-mono text-[9px] text-gray-500 dark:bg-gray-700/60 dark:text-gray-400" title={behind === 0 ? 'Newest version' : `${behind} ${behind === 1 ? 'version' : 'versions'} behind newest`}>
												{behind === 0 ? 'newest' : `−${behind}`}
											</span>
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</section>
			</section>

			<!-- Right rail: activity timeline -->
			<aside class="flex flex-col gap-3">
				<div class="flex items-baseline justify-between">
					<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Recent activity</h2>
					<a
						href={`/activity?app=${encodeURIComponent(appName)}`}
						class="text-[10px] text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
					>view all ›</a>
				</div>
				<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					{#if recentActivity.length === 0}
						<div class="flex flex-col items-center px-4 py-10 text-center">
							<div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60">
								<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
							</div>
							<p class="text-sm font-medium text-gray-700 dark:text-gray-300">No activity yet</p>
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Deployments will appear here as a timeline.</p>
						</div>
					{:else}
						<div class="p-4">
							{#each activityByDay as group, gi}
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
												<a
													href={rolloutPath(a.sourceCluster || localClusterName, a.ns, a.rollout.metadata?.name || '')}
													class="block rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
												>
													<div class="flex items-baseline justify-between gap-2">
														<div class="flex min-w-0 items-center gap-2">
															<span class="environment-theme-badge shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-gray-700 dark:bg-gray-700/60 dark:text-gray-300">{hasEnvironmentBinding ? (a.envName || 'no-env') : (a.theme?.label ?? a.envName ?? 'no-env')}</span>
															<span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">{a.version}</span>
														</div>
														<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500" title={formatTimeAgo(a.timestamp, $now)}>
															{hourLabel(a.timestamp)}
														</span>
													</div>
													<div class="mt-0.5 text-[11px] {STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}">{STATUS_LABEL[a.bakeStatus]}</div>
												</a>
											</li>
										{/each}
									</ol>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
</div>

