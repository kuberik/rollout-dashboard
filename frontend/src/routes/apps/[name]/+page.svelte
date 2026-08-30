<svelte:options runes={true} />

<script lang="ts">
	/**
	 * APP DETAIL — DIRECTION B: ACT / STATE.
	 *
	 * ══ THE DECISION THIS FILE RECORDS ══════════════════════════════════
	 *
	 * `DESIGN-INTENT.md` names Direction B as **the decided direction** for
	 * this page and it had never been built. Three other forms had:
	 * "the frontier" (a full-width build table), the two-pane workspace (one
	 * card per environment plus a rail), and the commit spine / version
	 * ladder. All three were rejected by the human, the last of them with
	 * *"i don't like version ladder"* — a rejection they had already made
	 * once. The Gantt before it was rejected four times.
	 *
	 * So there is no ladder here, no Gantt, no env-card stack and no ledger
	 * table. `DESIGN-INTENT.md` rejects the ledger by name ("buries the
	 * action among seven equal rows") and the wave/ladder by name ("crowds
	 * once four regions share a rung"), keeping exactly one habit from the
	 * second: **the action lives in the gap.**
	 *
	 * Direction B's thesis, verbatim:
	 *
	 *   > Split by intent, not by data type. The left column is only what
	 *   > needs a decision, written as tasks. The right column is the state
	 *   > you consult while deciding — the chain, the fleet, the exposure.
	 *   > Nothing appears twice.
	 *
	 * ══ THE THREE OBJECTS, AND WHAT EACH ANSWERS ════════════════════════
	 *
	 * The page is graded on three questions (`PAGE-CRITERIA.md` §03):
	 *
	 *   2. WHICH ENV RUNS WHAT, HOW FAR BACK?  →  THE STAGE CHAIN.
	 *      One node per environment: status dot, env chip, and the joined
	 *      `[rank][build]` badge hard right. Between every pair of nodes sits
	 *      a HOP — the promotion edge, drawn as a rail with its own count.
	 *      "Where is this app stuck" is read straight down one column, and
	 *      the answer is a POSITION plus a printed number, never a hue ramp.
	 *
	 *   3. IS ITS PROD FLEET CONSISTENT?  →  THE PRODUCTION FLEET BLOCK.
	 *      Regions are a SET, so they get the nodes and none of the rails,
	 *      under a header that states the verdict as WORDS: `all agree`, or
	 *      `3 builds`. One glance, no counting.
	 *
	 *   1. WHAT IS THIS APP'S HISTORY?  →  THE ACTIVITY TIMELINE.
	 *      This is the one criterion Direction B's three state objects do
	 *      NOT answer, and it is deliberately NOT answered by reintroducing
	 *      a list of every build — that was the ladder, and the ladder is
	 *      rejected. `ActivityRail` is the product's existing "what happened,
	 *      in order" object: real events, newest first, grouped by day, each
	 *      one `<prev> → <new>` in an environment at a time. A build list
	 *      says what EXISTS; a timeline says what HAPPENED, which is what the
	 *      word history means. The task bodies carry the other half — the
	 *      commits that have not shipped yet — so the two together cover the
	 *      whole line without either repeating the other.
	 *
	 *      It sits in the LEFT column, under the tasks, because the left
	 *      column is the axis of EVENTS AND HUMAN ACTION (what must be
	 *      decided, and what was decided) while the right column is the state
	 *      as it stands right now. That keeps the intent split intact rather
	 *      than making the read-only column 900px tall beside a 140px one.
	 *      DOM order is act → state → history so that at phone width the
	 *      state column is NOT pushed below ten rows of timeline; the desktop
	 *      grid puts history back under the tasks with `grid-template-areas`.
	 *
	 * ══ IT GROWS WITH DECISIONS, NOT WITH ENVIRONMENTS ══════════════════
	 *
	 * That is Direction B's load-bearing property and it is preserved by
	 * FOLDING A TASK BY DECISION rather than by environment. Production
	 * regions on the same build, behind by the same gap, are ONE promotion
	 * step — that is the domain model's own "production regions are a SET" —
	 * so they are one task carrying a `×N` count. Stages are never folded:
	 * dev and staging are two separate steps, and a single control over a
	 * merged stage row is the ambiguous-target defect `DESIGN.md` names.
	 *
	 * Measured on the fixtures:
	 *   · `edge-mesh`, 13 environments (dev + 12 prod regions), ten regions
	 *     on one build and two on another → **2 tasks**.
	 *   · `payments-core`, 9 environments (3 stages + 6 regions) → **4
	 *     tasks**: staging, the four converged regions as one, the straggler,
	 *     and the diverged region.
	 * The chain and the fleet are one row per environment by design — that is
	 * their job — but they are 24px rows in a 340px column, not 170px cards.
	 *
	 * ══ THE EXPOSURE BLOCKER, DECIDED ═══════════════════════════════════
	 *
	 * Direction B's exposure bar needs ready-pod counts and `/api/rollouts`
	 * does not carry them. Of the three options the spec offers, this takes
	 * **(a): fetch them per environment, on this page only.** It is a detail
	 * page with a bounded environment count, and the alternative (b) — the
	 * same object built out of environments — would restate the chain, which
	 * breaks the one rule the whole direction rests on.
	 *
	 * Two honesty guards, because a wrong ratio is worse than no ratio:
	 *   · A kustomization that substitutes MORE THAN ONE rollout deploys more
	 *     than one app's pods and nothing in the payload says which Deployment
	 *     belongs to which. That environment counts as UNKNOWN, never as its
	 *     neighbour's pods.
	 *   · The bar's denominator names what it actually counted, and any
	 *     environment that could not be measured is printed. When nothing
	 *     resolves there is no bar at all, only a sentence.
	 *
	 * ══ RULES CARRIED OVER, NOT RE-LITIGATED ════════════════════════════
	 *
	 *   · NO GANTT, NO EMBER, NO PER-SHA COLOUR — `DESIGN.md`'s tombstone.
	 *   · SIX STATUS HUES AND THEY ARE SPENT: green succeeded, YELLOW baking,
	 *     BLUE deploying (never the same value), red failed, amber stuck,
	 *     gray pending. The status circle keeps its tint.
	 *   · AMBER IS `stuck` AND NOTHING ELSE FOR STATE. The study paints a
	 *     hop's `N waiting` amber; here the count is printed in mono and the
	 *     GAP is carried by the rail's dash. A promoting pipeline is not a
	 *     stuck one and must not wear the alarm's colour.
	 *   · `newest` is quiet mint, `−N` is the loud red — the human's own
	 *     correction, encoded in `Chip.svelte`.
	 *   · THE ENV PALETTE IS CLOSED. Nothing here touches it.
	 *
	 * `PromotionLadder.svelte` and `view-models/promotion-ladder.ts` lost their
	 * last call site with this change and were DELETED on 2026-08-26, together
	 * with `RegionSet`, `MatrixCell`, `LagChip`, `StatusTile` and
	 * `release-frontier.ts` — all verified at zero call sites first.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, connectGithub } from '$lib/api/github';
	import { rolloutPath, sourceDashboardURL } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { getEnvironmentRank, compareEnvironmentNames } from '$lib/env-order';
	import { shortEnvLabel } from '$lib/environment-theme';
	import {
		getDisplayVersion,
		formatDate,
		formatTimeAgoCompact,
		detectStuck,
		detectStuckBehind,
		formatDurationMs
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { buildLadder, divergedFromLine, type Build } from '$lib/view-models/build-ladder';
	import {
		promotionBlock,
		promotionCandidates,
		newestDeployableCandidate,
		detectStuckPromotion,
		type PromotionBlock
	} from '$lib/view-models/promotion';
	import { regionLabel } from '$lib/view-models/regions';
	import { getStatusCircleClass } from '$lib/bake-status';
	import Chip from '$lib/components/Chip.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import StageChain from '$lib/components/StageChain.svelte';
	import ExposureBar from '$lib/components/ExposureBar.svelte';
	import BlockReason from '$lib/components/BlockReason.svelte';
	import WaitingBuilds from '$lib/components/WaitingBuilds.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import { Button } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid,
		EditOutline,
		ReplyOutline,
		ArrowRightOutline,
		SearchOutline,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CheckCircleSolid,
		ChartMixedOutline,
		ArrowUpRightFromSquareOutline,
		CodeBranchSolid,
		GridSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment, Kustomization } from '../../../types';
	import type { ManagedResourceStatus } from '../../../types/managed-resource';

	const appName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	// Queried ONCE for the whole page — never one prompt per task.
	const githubQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const
	}));
	const githubDisconnected = $derived(
		!!githubQuery.data?.configured && !githubQuery.data?.connected
	);
	const commitsAvailable = $derived(
		!!githubQuery.data?.configured && !!githubQuery.data?.connected
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const kustomizations = $derived<Kustomization[]>(query.data?.kustomizations?.items || []);

	const groups = $derived.by<Map<string, AppGroup>>(() =>
		groupRolloutsByApp(rollouts, environments)
	);
	const group = $derived<AppGroup | undefined>(groups.get(appName));
	const hasEnvironmentBinding = $derived(group?.hasEnvironmentBinding ?? false);

	/** Promotion order, top to bottom — the direction a build actually travels. */
	const cells = $derived<AppCell[]>(
		[...(group?.cells ?? [])].sort((a, b) => compareEnvironmentNames(a.envName, b.envName))
	);

	/** The one derivation every rank on this page indexes into. */
	const ladder = $derived(buildLadder(cells));

	function rolloutHref(cell: AppCell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || ''
		);
	}

	function isProdTier(envName: string): boolean {
		return getEnvironmentRank(envName) >= 7;
	}
	const prodCells = $derived(
		hasEnvironmentBinding ? cells.filter((c) => isProdTier(c.envName)) : []
	);
	/** The ONLY gate on saying the word "region" anywhere on this page. */
	const isFanOut = $derived(prodCells.length > 1);

	function fullEnvLabel(cell: AppCell): string {
		const raw = hasEnvironmentBinding
			? cell.envName
			: cell.theme?.environmentName || cell.theme?.label || cell.envName;
		return shortEnvLabel(raw) || raw || cell.envName;
	}
	function envLabel(cell: AppCell): string {
		const raw = hasEnvironmentBinding
			? cell.envName
			: cell.theme?.environmentName || cell.theme?.label || cell.envName;
		// In a fan-out the chip must still identify the REGION: `prod-eu-west`
		// and `prod-eu-central` both ellipsise to `PROD-EU…` at the chip's 12ch
		// cap, and the dropped token is the one every row shares.
		if (isFanOut && isProdTier(cell.envName)) return regionLabel(raw) || raw;
		return fullEnvLabel(cell);
	}

	const appTitle = $derived.by(() => {
		const titles: string[] = [];
		for (const c of cells) if (c.rollout.status?.title) titles.push(c.rollout.status.title);
		if (titles.length === 0) return appName;
		if (hasEnvironmentBinding) return titles[0];
		let prefix = titles[0];
		for (const t of titles.slice(1)) {
			let i = 0;
			while (i < prefix.length && i < t.length && prefix[i] === t[i]) i++;
			prefix = prefix.slice(0, i);
		}
		const cleaned = prefix.replace(/[\s\-/|·:]+$/, '').trim();
		return cleaned.length >= 3 ? cleaned : titles.sort((a, b) => a.length - b.length)[0];
	});

	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}
	function cellRevision(cell: AppCell): string | null {
		return cell.rollout.status?.history?.[0]?.version?.revision ?? null;
	}
	function cellStatus(cell: AppCell): string {
		return cell.rollout.status?.history?.[0]?.bakeStatus || 'None';
	}
	function cellTimestamp(cell: AppCell): string | null {
		return cell.rollout.status?.history?.[0]?.timestamp ?? null;
	}
	function cellCluster(cell: AppCell): string {
		return cell.sourceCluster || localClusterName;
	}
	function previousTag(cell: AppCell): string | null {
		return cell.rollout.status?.history?.[1]?.version?.tag ?? null;
	}
	function previousVersion(cell: AppCell): string | null {
		const history = cell.rollout.status?.history ?? [];
		const current = cellVersion(cell);
		for (let i = 1; i < history.length; i++) {
			const v = getDisplayVersion(history[i].version);
			if (v && v !== current) return v;
		}
		return null;
	}

	/**
	 * The deploy-status mark. It answers ONE question — did the deploy
	 * succeed — and it is the only thing on a node that changes with status.
	 * `stuck` is deliberately NOT a dot colour: a stuck environment shows its
	 * TRUE bake state and the stoppage is carried by the alarm chip.
	 */
	const DOT: Record<string, { cls: string; word: string }> = {
		// `red-400` in dark, NOT `red-500`. DESIGN.md's closed budget names the
		// product's ONE red as `red-700` / `red-400` — the pair `rank`,
		// `diverged`, `failing` and `ActivityRail`'s own Failed dot all print —
		// and `red-500` was a second dark red on this page spent on nothing else.
		Failed: { cls: 'bg-red-700 dark:bg-red-400', word: 'deploy failed' },
		Deploying: { cls: 'bg-blue-700 dark:bg-blue-400', word: 'deploying' },
		InProgress: { cls: 'bg-yellow-700 dark:bg-yellow-400', word: 'baking' },
		Succeeded: { cls: 'bg-green-700 dark:bg-green-400', word: 'deploy succeeded' },
		Cancelled: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'bake cancelled' },
		None: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'no bake status' }
	};
	function dotFor(status: string) {
		return DOT[status] ?? DOT.None;
	}

	function stuckFor(cell: AppCell) {
		const own = detectStuck(cell.rollout, { now: $now });
		if (own) return own;
		const promo = detectStuckPromotion(cell.rollout, { now: $now });
		if (promo) return promo;
		for (const peer of cells) {
			if (peer === cell) continue;
			const r = detectStuckBehind(cell.rollout, peer.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}
	type StuckReason = NonNullable<ReturnType<typeof stuckFor>>;

	/** Each detector's own measured span. Never a guess. */
	function stuckForMs(reason: StuckReason | null): number | null {
		if (!reason) return null;
		if (reason.kind === 'baking' || reason.kind === 'deploying') return reason.durationMs;
		if (reason.kind === 'behind') return reason.peerAdvancedMs;
		return reason.waitingMs;
	}
	function stuckTitle(reason: StuckReason | null): string {
		if (!reason) return 'Promotion is not moving';
		const forMs = stuckForMs(reason);
		const span = forMs === null ? null : formatDurationMs(forMs);
		if (reason.kind === 'baking') return `Baking for ${span}`;
		if (reason.kind === 'deploying') return `Deploying for ${span}`;
		if (reason.kind === 'behind') return `Behind ${reason.peerEnv}, which moved on ${span} ago`;
		const n = reason.candidateCount;
		const gates =
			reason.blockingGates.length > 0 ? `, blocked by ${reason.blockingGates.join(', ')}` : '';
		return `${n} ${n === 1 ? 'build' : 'builds'} waiting for ${span}${gates}`;
	}

	/** Compact span from raw ms, same unit boundaries as `formatTimeAgoCompact`. */
	function compactMs(ms: number): string {
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		if (d < 90) return `${d}d`;
		const mo = Math.floor(d / 30);
		if (mo < 12) return `${mo}mo`;
		return `${Math.floor(mo / 12)}y`;
	}

	function divergedFor(cell: AppCell): boolean {
		const ts = cellTimestamp(cell);
		return divergedFromLine(ladder, cellVersion(cell), ts ? new Date(ts).getTime() : 0);
	}

	// ── READY PODS, FETCHED PER ENVIRONMENT ──────────────────────────────
	//
	// `/api/rollouts` carries no replica field at all, so exposure needs one
	// `managed-resources` call per environment. That is option (a) of the
	// three the spec offers, taken because this is a DETAIL page with a
	// bounded environment count.
	const SUBSTITUTE_FROM_RE = /^rollout\.kuberik\.com\/substitute\.[^/]+\.from$/;

	/**
	 * The kustomizations that deploy THIS rollout and nothing else.
	 *
	 * `null` means "cannot be attributed" and is NOT the same as an empty
	 * list. A kustomization whose `substitute.*.from` annotations name two
	 * rollouts renders two apps' Deployments into one namespace, and nothing
	 * in the payload says which Deployment belongs to which — so counting its
	 * pods for either app would be inventing data. `hello-dep` on the live
	 * cluster is exactly that shape.
	 */
	function attributableKustomizations(cell: AppCell): Kustomization[] | null {
		const ns = cell.rollout.metadata?.namespace;
		const name = cell.rollout.metadata?.name;
		if (!ns || !name) return null;
		const src = sourceDashboardURL(cell.rollout);
		const out: Kustomization[] = [];
		for (const k of kustomizations) {
			if (k.metadata?.namespace !== ns) continue;
			if (sourceDashboardURL(k) !== src) continue;
			const annotations = k.metadata?.annotations || {};
			const froms = Object.entries(annotations)
				.filter(([key]) => SUBSTITUTE_FROM_RE.test(key))
				.map(([, value]) => value);
			if (froms.length === 0) continue;
			if (!froms.includes(name)) continue;
			if (new Set(froms).size > 1) return null;
			out.push(k);
		}
		return out;
	}

	type PodTarget = { key: string; cluster: string; refs: { ns: string; name: string }[] | null };
	const podTargets = $derived.by<PodTarget[]>(() =>
		cells.map((c) => {
			const ks = attributableKustomizations(c);
			return {
				key: `${c.envName}/${c.rollout.metadata?.namespace ?? ''}`,
				cluster: cellCluster(c),
				refs:
					ks === null
						? null
						: ks.map((k) => ({
								ns: k.metadata?.namespace ?? '',
								name: k.metadata?.name ?? ''
							}))
			};
		})
	);
	const podQueryKey = $derived(
		podTargets
			.map((t) =>
				t.refs === null
					? `${t.key}:?`
					: `${t.key}:${t.cluster}:${t.refs.map((r) => `${r.ns}/${r.name}`).join(',')}`
			)
			.join('|')
	);
	const podsQuery = createQuery(() => ({
		queryKey: ['app-ready-pods', appName, podQueryKey],
		queryFn: async (): Promise<Record<string, number>> => {
			const out: Record<string, number> = {};
			await Promise.all(
				podTargets
					.filter((t) => t.refs !== null && t.refs.length > 0)
					.map(async (t) => {
						let ready = 0;
						for (const r of t.refs!) {
							const sep = '?';
							const url = `/api/kustomizations/${r.ns}/${r.name}/managed-resources${t.cluster ? `${sep}cluster=${encodeURIComponent(t.cluster)}` : ''}`;
							const res = await fetch(url);
							if (!res.ok) return; // leave this environment UNKNOWN
							const data = (await res.json()) as { managedResources?: ManagedResourceStatus[] };
							for (const m of data.managedResources ?? []) {
								const gvk = m.groupVersionKind ?? '';
								if (!gvk.endsWith('/Deployment') && !gvk.endsWith('/StatefulSet')) continue;
								const n = m.object?.status?.readyReplicas;
								if (typeof n === 'number') ready += n;
							}
						}
						out[t.key] = ready;
					})
			);
			return out;
		},
		enabled: podTargets.some((t) => t.refs !== null && t.refs.length > 0),
		staleTime: 30_000,
		refetchInterval: 30_000
	}));
	const podsByEnv = $derived<Record<string, number>>(podsQuery.data ?? {});

	// ── Per-environment facts, computed once ─────────────────────────────
	type EnvFacts = {
		cell: AppCell;
		key: string;
		label: string;
		title: string;
		namespace: string;
		version: string | null;
		revision: string | null;
		prevVersion: string | null;
		status: string;
		timestamp: string | null;
		rank: number;
		block: PromotionBlock;
		stuck: StuckReason | null;
		stuckSpan: string | null;
		diverged: boolean;
		held: boolean;
		adverse: boolean;
		prod: boolean;
		pods: number | null;
		origin: string | null;
	};

	/**
	 * Who put this build here, from `history[0].triggeredBy`. A FIELD, not an
	 * inference — and a `System` trigger whose name is just "System" names
	 * nothing, so it prints the short form instead.
	 */
	function originClause(cell: AppCell): string | null {
		const t = cell.rollout.status?.history?.[0]?.triggeredBy;
		if (!t?.name) return null;
		if (t.kind === 'User') return `by ${t.name}`;
		const generic = !t.name || t.name.toLowerCase() === t.kind.toLowerCase();
		return generic ? 'automatic' : `by ${t.name}`;
	}

	const envFacts = $derived.by<EnvFacts[]>(() =>
		cells.map((c) => {
			const status = cellStatus(c);
			const block = promotionBlock(c.rollout);
			const stuck = stuckFor(c);
			const diverged = divergedFor(c);
			const span = stuckForMs(stuck);
			const key = `${c.envName}/${c.rollout.metadata?.namespace ?? ''}`;
			return {
				cell: c,
				key,
				label: envLabel(c),
				title: fullEnvLabel(c),
				namespace: c.rollout.metadata?.namespace ?? '',
				version: cellVersion(c),
				revision: cellRevision(c),
				prevVersion: previousVersion(c),
				status,
				timestamp: cellTimestamp(c),
				rank: ladder.rankOf(cellVersion(c)),
				block,
				stuck,
				stuckSpan: stuck && span !== null ? compactMs(span) : null,
				diverged,
				held: !!c.rollout.spec?.wantedVersion,
				// ⛔ `block.blocked` IS NOT ADVERSE. (2026-08-30)
				//
				// A live UX critique of the running product: *"`NEEDS A DECISION —
				// 3 items` offers no decisions — every card gives only `Investigate`
				// and `View on GitHub`. One of the three genuinely IS a decision (a
				// manual-approval gate) and is rendered identically to the two that
				// are not."* This predicate is why. Every gate-blocked environment
				// was `adverse`, `adverse` renders the BROKEN branch, and the broken
				// branch's whole action row is `Investigate` + `View on GitHub` —
				// two links, on a column headed `Needs a decision`.
				//
				// A gate-blocked environment is not broken. Its deploy succeeded, it
				// is serving, and the only thing that has not happened is the NEXT
				// promotion. What it is depends entirely on WHICH KIND of gate, and
				// `promotionBlock` already draws that line structurally: an
				// `awaitingApproval` gate published an allow-list and nothing is on
				// it — only a person moves that, so it is a DECISION — while a
				// `notPassing` gate is a schedule window or a health check, which
				// clears itself and is therefore not a decision at all. Both were
				// being filed under "broken" and offered the same two links.
				//
				// Adverse now means what the word means: the deploy failed, a state
				// has lasted past its detector, or the build is off every release
				// line.
				adverse: status === 'Failed' || stuck !== null || diverged,
				prod: hasEnvironmentBinding && isProdTier(c.envName),
				pods: typeof podsByEnv[key] === 'number' ? podsByEnv[key] : null,
				origin: originClause(c)
			};
		})
	);

	/**
	 * THE BLOCKING GATE, split into the two halves of a badge instead of
	 * glued into a sentence. `word` is what the gate is doing to this
	 * environment; `names` is the gate itself — the one fact on a blocked task
	 * that no mark on this page can carry, and the reason this survives the
	 * prose cut at all.
	 */
	function gateMark(f: EnvFacts): { word: string; names: string } | null {
		const held = f.block.awaitingApprovalGates;
		const waiting = f.block.notPassingGates;
		if (held.length > 0) return { word: 'held by', names: held.join(', ') };
		if (waiting.length > 0) return { word: 'waiting on', names: waiting.join(', ') };
		return null;
	}

	// ── OBJECT 1 · NEEDS A DECISION ──────────────────────────────────────
	//
	// One task per BROKEN environment, plus one per DECISION to promote. The
	// second half is what makes this column the act half rather than a list
	// of alarms — Direction B's whole point is that a promotion you could
	// make right now is a decision waiting on you, and the action belongs in
	// the gap it would close.
	//
	// FOLDING IS BY DECISION, and this is the property the direction lives
	// or dies on. Production regions are a SET: four regions on the same
	// build, behind by the same gap, are ONE promotion step, so they are one
	// task with a `×4` count and one target per region in the action row.
	// Stages are NEVER folded — dev and staging are two separate steps, and a
	// single control over a merged stage row is a destructive action with an
	// ambiguous target.
	//
	// A BROKEN region is never folded either: it has its own cause, its own
	// span and its own next step.
	// FIVE KINDS, AND THE SPLIT IS BY WHO HAS TO ACT.
	//
	//   adverse  something is broken           → Investigate / Rollback
	//   held     someone pinned it             → Change Version   (a person did this)
	//   approve  a gate refuses every build    → Deploy           (a person must decide)
	//   promote  a build is ready to move      → Promote          (a person may decide)
	//   waiting  a schedule or health gate     → nothing          (it clears itself)
	//
	// The first four are DECISIONS and share one column. `waiting` is not a
	// decision and does not belong under a header that says it is; it gets its
	// own card, with no action, because offering a control for something that
	// needs no action is how the column ended up offering `Investigate` five
	// times.
	type TaskKind = 'adverse' | 'held' | 'approve' | 'promote' | 'waiting';
	type Task = {
		id: string;
		kind: TaskKind;
		members: EnvFacts[];
		lead: EnvFacts;
		/**
		 * The env chip's label. A FOLDED task names the TIER, not its first
		 * member: four regions sharing one promotion step are not `AP-SOUTH`,
		 * and printing one member's name over a `×4` claims a subject the task
		 * does not have. The individual regions are named on the buttons,
		 * where each one is a target.
		 */
		label: string;
		/**
		 * ⛔ `reason` WAS A SENTENCE AND IS GONE (2026-08-27).
		 *
		 * It printed `Deploy failed`, `Baking for 3 days`, `4 builds waiting
		 * for 28 days, blocked by hello-world-manual-approval`, `Running a
		 * build that is on no release line` or `Pinned to v1.2.3` at 13px
		 * beside the very marks that already carry those facts. The human:
		 * *"Text doesn't cut it and just pollutes."*
		 *
		 * Each clause was tested against "would the reader lose a FACT, or only
		 * a caption for a fact already on screen?" and every clause but ONE was
		 * a caption:
		 *
		 * | sentence | what carries it instead |
		 * |---|---|
		 * | `Deploy failed` | the `failing` CHIP — `[STAGING][FAILED]`, the same badge geometry as `[EU-CENTRAL][DIVERGED]` — plus the status circle (the product's `Failed` atom, a RED ring and glyph at 32px) and the red `!` in the gap slot |
		 * | `Baking for 3 days` | the YELLOW pulse circle, and `[STUCK][3d]` — the alarm chip's own value half already prints the span |
		 * | `Deploying for 2 days` | the BLUE spinner circle + `[STUCK][2d]` |
		 * | `Behind staging, which moved on 2d ago` | `[STUCK][2d]` + `behind staging` on the identity line |
		 * | `N builds waiting for <span>` | `[STUCK][<span>]` + the `WaitingBuilds` ledger, which lists the builds themselves |
		 * | `Running a build that is on no release line` | the `diverged` chip, 8px to its left |
		 * | `Pinned to <version>` | `PinBadge` — the product's own pin mark, `[🔒 PINNED]`, with the version in its title and the `Change Version` button naming the action |
		 *
		 * THE ONE FACT THAT WAS NOT ANYWHERE ELSE is the BLOCKING GATE'S NAME.
		 * `hello-world-manual-approval` is an identifier, not a description:
		 * nothing else on this page prints it and no mark can be derived from
		 * it. So it becomes a MARK rather than being deleted — the neutral
		 * two-section badge `[held|waiting][<gate name>]`, which is the
		 * `[label][value]` geometry every other badge in the product already
		 * uses. `unranked`'s gray, because a gate's NAME is an identity and the
		 * adverse verdict is already on the `stuck` chip beside it.
		 */
		gate: { word: string; names: string } | null;
		/** True when the pin is the reason — renders `PinBadge`, not a sentence. */
		pinned: string | null;
		upstream: string | null;
		/** The FULL queue on this edge. `WaitingBuilds` does the truncating. */
		waiting: Build[];
		promoteVersion: string | null;
		promoteTag: string | null;
		pods: number | null;
		sinceMs: number | null;
	};

	/**
	 * The nearest environment UPSTREAM of this one that is running something.
	 *
	 * STRICTLY LOWER TIER, never a peer. Production regions are a SET and
	 * `compareEnvironmentNames` falls back to `localeCompare` inside a tier,
	 * so a peer comparison made `prod-sa-east` read as "behind prod-eu-west"
	 * — an ordering that does not exist. What sa-east is behind is the last
	 * STAGE, which is the only thing that promotes into it.
	 */
	function upstreamOf(f: EnvFacts): EnvFacts | null {
		const tier = getEnvironmentRank(f.cell.envName);
		let best: EnvFacts | null = null;
		for (const g of envFacts) {
			if (g === f || !g.version) continue;
			if (getEnvironmentRank(g.cell.envName) >= tier) continue;
			best = g;
		}
		return best;
	}

	/**
	 * The builds waiting to cross into this environment, newest first.
	 *
	 * `promotionCandidates` ONLY — the controller's own answer to "what could
	 * this rollout deploy next", scoped to its own retention window. There is
	 * deliberately no fallback that slices the ladder by rank: a rank is a
	 * position in a list of builds, not a statement that any of them could
	 * land here, and a diverged environment's rank is not a distance at all.
	 * An empty list renders nothing rather than a guess.
	 */
	function waitingBuildsFor(f: EnvFacts): Build[] {
		const out: Build[] = [];
		for (const c of promotionCandidates(f.cell.rollout)) {
			const v = getDisplayVersion(c as { version?: string; revision?: string; tag: string });
			const b = v ? ladder.get(v) : undefined;
			if (b) out.push(b);
		}
		return out;
	}

	/**
	 * A broken task lists what is waiting only when WAITING is the cause. On a
	 * gate-blocked or promotion-stuck environment the queue is the whole
	 * story; on a failed deploy it is a second subject on a row that already
	 * has one.
	 */
	function waitingIsTheStory(f: EnvFacts): boolean {
		return f.block.blocked || f.stuck?.kind === 'promotion' || f.stuck?.kind === 'behind';
	}

	function sinceMsOf(f: EnvFacts): number | null {
		if (!f.timestamp) return null;
		const t = new Date(f.timestamp).getTime();
		return Number.isFinite(t) ? $now.getTime() - t : null;
	}

	const tasks = $derived.by<Task[]>(() => {
		const out: Task[] = [];

		// ── broken, one per environment ──────────────────────────────────
		for (const f of envFacts) {
			if (!f.adverse) continue;
			const waiting = waitingIsTheStory(f) ? waitingBuildsFor(f) : [];
			// ── AN ADVERSE ENVIRONMENT CAN ALSO BE AWAITING A DECISION, AND
			//    THE EARLIER FIX MISSED EXACTLY THAT CASE. (2026-08-30)
			//
			// `block.blocked` was un-folded from `adverse` so a gate-blocked
			// environment would stop rendering the BROKEN branch — but the
			// gate loop below skips anything already `adverse`, and on the LIVE
			// cluster `hello-world-app`'s PROD and STAGING are BOTH: stuck
			// (nothing has moved for a day) AND awaiting an approval (the gate
			// refuses every one of the 19 builds queued behind it). They took
			// the adverse branch, so the card printed `Someone has to approve a
			// newer version` and then offered `Investigate` and `View on
			// GitHub` — the very pairing the human named, surviving under the
			// very fix that was supposed to remove it.
			//
			// The two facts are not in competition and neither may be dropped.
			// The environment IS stuck, so it keeps its `stuck` alarm — the
			// loudest mark in the product, and it may not be softened for a
			// state that has genuinely stalled. And the way OUT of the stall is
			// a person picking a build, so the row also gets the decision: the
			// same filled `Deploy <build>` through the same modal rollout
			// detail's own `Available Version Upgrades` list uses.
			//
			// ⛔ ONLY FOR AN APPROVAL GATE. A `notPassing` gate clears itself;
			// putting a deploy button on it would be asking a person to act on
			// something that needs nobody, which is the mirror-image defect.
			const approval = f.block.awaitingApprovalGates.length > 0;
			const head = approval ? (waitingBuildsFor(f)[0] ?? null) : null;
			out.push({
				id: `adverse:${f.key}`,
				kind: 'adverse',
				members: [f],
				lead: f,
				label: f.label,
				gate: f.block.blocked ? gateMark(f) : null,
				pinned: null,
				upstream: null,
				waiting,
				promoteVersion: head?.version ?? null,
				promoteTag: head?.tag ?? null,
				pods: f.pods,
				sinceMs: sinceMsOf(f)
			});
		}

		// ── pinned, one per environment ──────────────────────────────────
		for (const f of envFacts) {
			if (f.adverse || !f.held) continue;
			out.push({
				id: `held:${f.key}`,
				kind: 'held',
				members: [f],
				lead: f,
				label: f.label,
				gate: null,
				pinned: f.cell.rollout.spec?.wantedVersion ?? null,
				upstream: upstreamOf(f)?.title ?? null,
				waiting: [],
				promoteVersion: null,
				promoteTag: null,
				pods: f.pods,
				sinceMs: sinceMsOf(f)
			});
		}

		// ── gate-blocked: a DECISION or a WAIT, never both ───────────────
		//
		// Runs AFTER the pinned loop, and that order is the fix for a reported
		// defect: *"while prod was pinned, that panel blamed `HELD BY
		// hello-world-manual-approval`; the actual cause was the PIN, which the
		// page never mentions."* A pin refuses every candidate, so a pinned
		// environment is ALSO gate-blocked and both descriptions are true — but
		// only one is the cause, and it is the one a person chose. `f.held`
		// claims the environment first and the gate never gets to speak for it.
		for (const f of envFacts) {
			if (f.adverse || f.held) continue;
			if (!f.block.blocked) continue;
			const approval = f.block.awaitingApprovalGates.length > 0;
			const queue = waitingBuildsFor(f);
			const head = queue[0] ?? null;
			out.push({
				id: `${approval ? 'approve' : 'waiting'}:${f.key}`,
				kind: approval ? 'approve' : 'waiting',
				members: [f],
				lead: f,
				label: f.label,
				gate: gateMark(f),
				pinned: null,
				upstream: upstreamOf(f)?.title ?? null,
				waiting: queue,
				// THE DECISION IS A SPECIFIC BUILD, and it is the newest WAITING
				// one — `newestDeployableCandidate` returns null here by
				// definition, because no candidate is deployable while the gate
				// refuses them all. Deploying past a refusing gate is a control
				// the product already offers on rollout detail's own
				// `Available Version Upgrades` list; this is the same act with
				// the same modal, moved to where the decision is stated.
				promoteVersion: approval ? (head?.version ?? null) : null,
				promoteTag: approval ? (head?.tag ?? null) : null,
				pods: f.pods,
				sinceMs: sinceMsOf(f)
			});
		}

		// ── promotable, folded by DECISION ───────────────────────────────
		const buckets = new Map<string, EnvFacts[]>();
		for (const f of envFacts) {
			if (f.adverse || f.held) continue;
			if (f.rank <= 0 || !f.version) continue;
			if (newestDeployableCandidate(f.cell.rollout) === null) continue;
			// Regions on the same build share one promotion step; stages never do.
			const bucket = f.prod && isFanOut ? `prod@${f.version}` : `env@${f.key}`;
			const list = buckets.get(bucket);
			if (list) list.push(f);
			else buckets.set(bucket, [f]);
		}
		for (const [id, members] of buckets) {
			const lead = members[0];
			const waiting = waitingBuildsFor(lead);
			const candidate = newestDeployableCandidate(lead.cell.rollout);
			out.push({
				id: `promote:${id}`,
				kind: 'promote',
				members,
				lead,
				label: members.length > 1 ? 'prod' : lead.label,
				gate: null,
				pinned: null,
				upstream: upstreamOf(lead)?.title ?? null,
				waiting,
				promoteVersion: candidate
					? getDisplayVersion(candidate as { version?: string; revision?: string; tag: string })
					: null,
				promoteTag: candidate?.tag ?? null,
				pods: members.every((m) => m.pods === null)
					? null
					: members.reduce((n, m) => n + (m.pods ?? 0), 0),
				sinceMs: sinceMsOf(lead)
			});
		}

		const grade = (t: Task) =>
			t.kind === 'adverse'
				? t.lead.status === 'Failed'
					? 0
					: t.lead.stuck
						? 1
						: 2
				: t.kind === 'held'
					? 3
					: t.kind === 'approve'
						? 4
						: t.kind === 'promote'
							? 5
							: 6;
		return out.sort((a, b) => grade(a) - grade(b) || b.lead.rank - a.lead.rank);
	});

	/**
	 * THE FOOT NOTE, CUT TO THE ONE OBSERVABLE THAT IS NOWHERE ELSE (2026-08-27).
	 *
	 * It read `2 pods · unchanged for 4d · hello-world-prod` on a broken task
	 * and `on c0d3e88 for 4h · automatic` on a promotable one — four clauses
	 * per task, on every task, in a column headed "Needs a decision". The
	 * human named this line: *"Text doesn't cut it and just pollutes."* Clause
	 * by clause:
	 *
	 * · `on <sha>` — DELETED. Direction B's own thesis is *"nothing appears
	 *   twice"*, and the running build is the state column's job: every
	 *   environment's node prints its sha in a joined badge 340px to the right.
	 * · `N pods` — DELETED. Pod counts come from the same per-environment
	 *   managed-resources call that feeds `ExposureBar`, so whenever this
	 *   clause can be printed the exposure bar is drawn from the same numbers
	 *   with a percentage and a key. When it cannot, neither can this.
	 * · `automatic` — DELETED. `originClause` returns it for every
	 *   controller-driven promotion, which is nearly all of them, so it marked
	 *   the norm on three of four tasks. `by <name>` SURVIVES, because a
	 *   human-triggered deploy is the deviation and the person's name is a
	 *   fact no mark carries.
	 * · `unchanged for <span>` on a BROKEN task — SURVIVES. Staleness is the
	 *   difference between a deploy that failed a minute ago and one that has
	 *   been failing for four days, and nothing else on the page states it: a
	 *   broken task has no `stuck` chip unless a detector fired, and the
	 *   activity rail below is per-deploy, not per-state.
	 * · the whole line on a PROMOTABLE task — DELETED. `WaitingBuilds` already
	 *   prints a `released` age against every build in the queue, which is the
	 *   same question answered against better subjects.
	 *
	 * `source` still goes hard right, on the task's own right margin.
	 */
	function footNote(t: Task): { state: string | null; source: string | null } {
		const span = t.sinceMs !== null ? compactMs(t.sinceMs) : null;
		if (t.kind === 'adverse') {
			// The namespace is rendered by the markup, as a link.
			return { state: span ? `no progress for ${span}` : 'no progress', source: null };
		}
		if (!t.lead.version) return { state: 'never deployed', source: null };
		const by = t.lead.origin && t.lead.origin !== 'automatic' ? t.lead.origin : null;
		return { state: null, source: by };
	}

	/**
	 * THE DECISION COLUMN HOLDS DECISIONS. `waiting` is filtered out here and
	 * rendered in its own card below — a schedule window is a fact about the
	 * clock, and a column that counts it as an "item" is overstating what is
	 * being asked of the reader by exactly the number of self-clearing gates
	 * the app happens to have.
	 */
	const decisions = $derived(tasks.filter((t) => t.kind !== 'waiting'));
	const waitingItems = $derived(tasks.filter((t) => t.kind === 'waiting'));

	/** Header count for the act column. */
	const taskCount = $derived(decisions.length);

	// ── OBJECT 2 · THE STATE COLUMN ──────────────────────────────────────
	//
	// The chain is the LINE of stages; production, when it fans out, is a SET
	// and gets its own block. When there is exactly one production
	// environment there is no set, so it is simply the chain's last node.
	type ChainNode = {
		key: string;
		label: string;
		title: string;
		theme: AppCell['theme'];
		version: string | null;
		rank: number;
		diverged: boolean;
		dotClass: string;
		statusWord: string;
		settled: boolean;
		href?: string;
		quiet?: boolean;
	};

	function nodeOf(f: EnvFacts): ChainNode {
		const d = dotFor(f.status);
		return {
			key: f.key,
			label: f.label,
			title: f.title,
			theme: f.cell.theme,
			version: f.version,
			rank: f.rank,
			diverged: f.diverged,
			dotClass: d.cls,
			statusWord: d.word,
			// MARK THE DEVIATION, NEVER THE NORM — `StageChain` draws no dot for
			// a node whose deploy simply succeeded. See that component.
			settled: f.status === 'Succeeded',
			href: rolloutHref(f.cell)
		};
	}

	const stageFacts = $derived(envFacts.filter((f) => !(isFanOut && f.prod)));
	const fleetFacts = $derived(isFanOut ? envFacts.filter((f) => f.prod) : []);
	const chainNodes = $derived<ChainNode[]>(stageFacts.map(nodeOf));

	/**
	 * THE HOP — the gap on a promotion edge, as a first-class object.
	 *
	 * The count is `rank(downstream) − rank(upstream)`, both read off the one
	 * ladder, so it is the number of builds that must cross this edge. Never
	 * a second derivation and never a fabricated number: when either side is
	 * not on the ladder the hop says so instead of printing a zero.
	 */
	type Hop = { waiting: number; label: string };
	/**
	 * ⛔ A HOP LABELS ITSELF ONLY WHEN IT HAS A COUNT (2026-08-27).
	 *
	 * Four of the six branches printed a caption for the rail they sit on or
	 * for the node above them, and on a healthy app EVERY hop read `in sync`
	 * — the page marking the norm once per promotion edge, in prose, which is
	 * the rule this repo has enforced everywhere else. The human:
	 * *"Text doesn't cut it and just pollutes."*
	 *
	 * · `in sync` → the rail is SOLID. That is the mark, and it is the whole
	 *   reason the rail has two styles.
	 * · `<ENV> not deployed` → the node directly above prints the
	 *   `not deployed` chip in the rank slot.
	 * · `nothing downstream yet` → likewise, on the node below.
	 * · `off the line` → the node below carries the `diverged` chip.
	 *
	 * `N waiting` and `N ahead` STAY: a count is a fact, the dashed rail says
	 * only that a gap exists, and "how many builds are stuck on this edge" is
	 * the question this whole object was built to answer.
	 */
	function hopBetween(up: EnvFacts | null, down: EnvFacts | null): Hop {
		if (!up || !up.version) return { waiting: 0, label: '' };
		if (!down || !down.version) return { waiting: 0, label: '' };
		if (up.rank < 0 || down.rank < 0 || down.diverged) return { waiting: 0, label: '' };
		const n = down.rank - up.rank;
		if (n > 0)
			return { waiting: n, label: `${n} version${n === 1 ? '' : 's'} waiting to move` };
		if (n < 0) return { waiting: 0, label: `${-n} version${n === -1 ? '' : 's'} ahead` };
		return { waiting: 0, label: '' };
	}
	const chainHops = $derived.by<(Hop | null)[]>(() =>
		stageFacts.map((f, i) => (i < stageFacts.length - 1 ? hopBetween(f, stageFacts[i + 1]) : null))
	);

	/**
	 * The hop from the last stage INTO the production fleet. A fan-out has no
	 * single downstream rank, so it takes the fleet's MODAL build — the one
	 * most regions are on — which is the same build the fleet verdict is
	 * about.
	 */
	const fleetModal = $derived.by<EnvFacts | null>(() => {
		const live = fleetFacts.filter((f) => f.version && !f.diverged);
		if (live.length === 0) return null;
		const counts = new Map<string, number>();
		for (const f of live) counts.set(f.version!, (counts.get(f.version!) ?? 0) + 1);
		let best = live[0];
		let bestN = -1;
		for (const f of live) {
			const n = counts.get(f.version!) ?? 0;
			if (n > bestN || (n === bestN && f.rank < best.rank)) {
				best = f;
				bestN = n;
			}
		}
		return best;
	});
	/**
	 * The fleet's rows. Regions on the AGREED build render quiet — the number
	 * and the sha in full, the colour given up. See `StageChain`'s `quiet`.
	 * With twelve regions this is the difference between two red marks that
	 * say "these are the ones that differ" and twelve that say nothing.
	 */
	const fleetNodes = $derived<ChainNode[]>(
		fleetFacts.map((f) => ({
			...nodeOf(f),
			quiet: !!fleetModal && f.version === fleetModal.version && !f.diverged
		}))
	);

	const fleetHop = $derived.by<Hop | null>(() => {
		if (!isFanOut) return null;
		const last = stageFacts[stageFacts.length - 1] ?? null;
		return hopBetween(last, fleetModal);
	});

	/** Criterion 3, stated as WORDS beside the rows that draw it. */
	const fleetVerdict = $derived.by<{ label: string; agree: boolean } | null>(() => {
		const live = fleetFacts.filter((f) => f.version);
		if (live.length === 0) return null;
		const builds = new Set(live.map((f) => f.version as string));
		return builds.size === 1
			? { label: 'all agree', agree: true }
			: { label: `${builds.size} versions`, agree: false };
	});

	/**
	 * The rollup on the state card.
	 *
	 * ⛔ IT SAID `1/7 on newest`. `on newest` is this product's own shorthand
	 * and nothing on the page taught it; `1 of 7 up to date` is the phrase
	 * `/apps`, `/environments` and `/envs/[name]` now all print for the same
	 * fact, in the reference page's own `3/3 healthy` rollup idiom.
	 */
	const stateCount = $derived.by<string>(() => {
		const deployed = envFacts.filter((f) => f.version);
		if (deployed.length === 0) return 'nothing deployed';
		const onNewest = deployed.filter((f) => f.rank === 0).length;
		return `${onNewest} of ${deployed.length} up to date`;
	});

	/**
	 * EVERY DEPLOYED ENVIRONMENT IS ON THE NEWEST BUILD — the predicate that
	 * lets the card's rollup go GREEN, and nothing weaker. This is the same
	 * rule `/apps` now applies to its status circle after a live critique
	 * caught it printing a green tick beside *"PROD is 14 builds behind"*: the
	 * product's strongest all-clear may only be spent on an actual all-clear.
	 */
	const stateOnNewest = $derived.by<boolean>(() => {
		const deployed = envFacts.filter((f) => f.version);
		return deployed.length > 0 && deployed.every((f) => f.rank === 0);
	});

	// ── OBJECT 3 · EXPOSURE ──────────────────────────────────────────────
	type Segment = { version: string; pods: number; percent: number; newest: boolean };
	const exposure = $derived.by<{
		segments: Segment[];
		totalPods: number;
		newestPercent: number | null;
		unknown: number;
	}>(() => {
		const byVersion = new Map<string, number>();
		let total = 0;
		let unknown = 0;
		for (const f of envFacts) {
			if (!f.version) continue;
			if (f.pods === null) {
				unknown++;
				continue;
			}
			byVersion.set(f.version, (byVersion.get(f.version) ?? 0) + f.pods);
			total += f.pods;
		}
		if (total === 0) return { segments: [], totalPods: 0, newestPercent: null, unknown };
		const segments: Segment[] = [...byVersion.entries()]
			.map(([version, pods]) => ({
				version,
				pods,
				percent: Math.round((pods / total) * 100),
				newest: ladder.rankOf(version) === 0
			}))
			.sort((a, b) => ladder.rankOf(a.version) - ladder.rankOf(b.version));
		const newestPods = segments.filter((s) => s.newest).reduce((n, s) => n + s.pods, 0);
		return {
			segments,
			totalPods: total,
			newestPercent: Math.round((newestPods / total) * 100),
			unknown
		};
	});

	/**
	 * ⛔ THERE IS NO VERDICT LEDE UNDER THE `h1` ANY MORE (2026-08-27).
	 *
	 * From the human: *"Environment and app detail I generally don't like this
	 * descriptive text. That's something claude design added but i don't want
	 * it. We need to design dashboard in such a way that user's attention is
	 * pulled in to where is necessary. Text doesn't cut it and just pollutes."*
	 *
	 * `verdictSentence` printed the worst environment's state at 17px directly
	 * above a column headed `Needs a decision` whose FIRST ROW is that same
	 * environment, sorted there by `grade`. Measured on `/apps/payments-core`
	 * at 1440 it was the fourth loudest object on the page (119.7 ink units) —
	 * a sentence out-ranking every chip in the state column while saying what
	 * the task 90px below it says with a glyph, an identity chip and an
	 * adverse chip.
	 *
	 * WHAT CARRIES EACH FACT NOW: which environment → the task's `env` chip;
	 * what is wrong with it → the `diverged` / `stuck` / `failing` chip and the
	 * status circle; how far behind → the 24px `−N` in the gap slot; the
	 * running build → the state column's node badge. `verdictSentence` and its
	 * tests still stand for whoever else wants a sentence; this page does not.
	 */
	/** Below this a 24h chart is a rendering glitch shaped like data. */
	const SPARK_MIN = 3;
	const deploys24h = $derived.by<number>(() => {
		const end = $now.getTime();
		const start = end - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const c of cells) {
			for (const h of c.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				const t = new Date(h.timestamp).getTime();
				if (t >= start && t <= end) n++;
			}
		}
		return n;
	});
	const lastDeployIso = $derived.by<string | null>(() => {
		let best: string | null = null;
		let bestMs = -1;
		for (const c of cells) {
			const ts = c.rollout.status?.history?.[0]?.timestamp;
			if (!ts) continue;
			const t = new Date(ts).getTime();
			if (Number.isFinite(t) && t > bestMs) {
				bestMs = t;
				best = ts;
			}
		}
		return best;
	});

	// A `versionHref` used to hang a `/versions/<revision>` link off every
	// waiting build. It is gone on purpose: that page answers "where is this
	// commit across every app", which is not the question a task about one
	// promotion edge is asking. See `WaitingBuilds`.

	// ── Change version / Promote / Rollback ──────────────────────────────
	// ONE modal instance for the whole page. Every control here targets ONE
	// rollout explicitly — a folded task renders one target per member rather
	// than a single button whose subject is chosen silently.
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalPin = $state(false);
	let modalVersion = $state<string | null>(null);
	let modalExplanation = $state('');
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(cell: AppCell, tag: string | null, version: string | null) {
		modalRollout = cell.rollout;
		modalPin = false;
		modalVersion = tag;
		modalExplanation = version ? `Promote ${version} to ${fullEnvLabel(cell)}.` : '';
		modalCluster = cellCluster(cell);
		modalOpen = true;
	}
	function openChangeVersion(cell: AppCell) {
		modalRollout = cell.rollout;
		modalPin = false;
		modalVersion = null;
		modalExplanation = '';
		modalCluster = cellCluster(cell);
		modalOpen = true;
	}
	function openRollback(cell: AppCell) {
		const target = previousVersion(cell);
		modalRollout = cell.rollout;
		modalPin = true;
		modalVersion = previousTag(cell);
		modalExplanation = target
			? `Rollback from ${cellVersion(cell)} to ${target} due to issues with the current deployment.`
			: '';
		modalCluster = cellCluster(cell);
		modalOpen = true;
	}

	/** Which folded tasks have their extra targets revealed. */
	let expanded = $state<Record<string, boolean>>({});
	const TARGETS_SHOWN = 4;
	// ── THE PAGE'S ONE BLOCKING FACT ─────────────────────────────────────────
	//
	// `COMPOSITION-GRAMMAR.md` §4, and the object the human named as the good
	// example when they rejected the gray row band: a FILLED banner with a 40px
	// circular icon, a bold headline and a second line carrying the concrete
	// consequence. This page had no such object — its heading line printed the
	// app name and a deploy count, and the reason nothing had promoted in three
	// weeks was three cards down in 11px gray.
	//
	// ⛔ THE CAUSE ORDER IS THE SAME AS THE TASK ORDER, AND FOR THE SAME
	// REASON. A pin outranks a gate: a gate holds the next promotion, a pin
	// refuses all of them, so while `spec.wantedVersion` is set no gate is the
	// cause even though every gate is also blocking. This is the exact defect
	// reported against this page — *"while prod was pinned, that panel blamed
	// `HELD BY hello-world-manual-approval`; the actual cause was the pin, which
	// the page never mentions."*
	type PageBlocker = {
		severity: 'error' | 'warning' | 'pinned' | 'info';
		icon: typeof ExclamationCircleSolid;
		title: string;
		message: string;
		footnote?: string;
		pulse: boolean;
	};

	const pageBlocker = $derived.by<PageBlocker | null>(() => {
		const nb = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

		const failed = envFacts.find((f) => f.status === 'Failed');
		if (failed) {
			return {
				severity: 'error',
				icon: ExclamationCircleSolid,
				title: `${failed.title.toUpperCase()}’s last deploy failed`,
				message: `Nothing promotes past ${failed.title.toUpperCase()} until a deploy succeeds.`,
				pulse: true
			};
		}

		const pinned = envFacts.find((f) => f.held);
		if (pinned) {
			return {
				severity: 'pinned',
				icon: PauseSolid,
				title: `${pinned.title.toUpperCase()} is pinned`,
				message: `Held at ${pinned.cell.rollout.spec?.wantedVersion ?? pinned.version}. ${nb(
					pinned.block.candidateCount,
					'newer build'
				)} available, and none will deploy until the pin is cleared.`,
				footnote: 'The gates on this environment are blocking too, but the pin is the cause.',
				pulse: false
			};
		}

		const stuck = envFacts.find((f) => f.stuck);
		if (stuck) {
			return {
				severity: 'warning',
				icon: ExclamationCircleSolid,
				title: `${stuck.title.toUpperCase()} is stuck`,
				message: stuck.stuckSpan
					? `Unchanged for ${stuck.stuckSpan} and nothing is holding it on purpose.`
					: 'Unchanged long enough that it will not clear on its own.',
				pulse: true
			};
		}

		// The deepest approval-gated environment. Ranked, never `find`: `cells`
		// is in promotion order, so the first hit is DEV — the least
		// consequential place in the pipeline to be blocked.
		const gated = envFacts
			.filter((f) => f.block.blocked && f.block.awaitingApprovalGates.length > 0)
			.sort((a, b) => b.rank - a.rank)[0];
		if (gated) {
			return {
				severity: 'warning',
				icon: ExclamationCircleSolid,
				title: `${gated.title.toUpperCase()} is waiting on an approval`,
				message: `${nb(
					gated.block.candidateCount,
					'build'
				)} ready and none approved. Nothing promotes into ${gated.title.toUpperCase()} until ${gated.block.awaitingApprovalGates.join(
					', '
				)} allows one.`,
				footnote: 'This will not clear on its own.',
				pulse: true
			};
		}

		return null;
	});
</script>

<svelte:head>
	<title>kuberik | {appTitle}</title>
</svelte:head>

<!-- A column header rule: uppercase label left, mono count right. Both
     columns wear it, which is what makes them read as two halves of one
     object rather than as two unrelated panels. -->
{#snippet columnHead(label: string, count: string, dotClass: string | null, note: string | null)}
	<header
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
	>
		{#if dotClass}
			<span class="h-[5px] w-[5px] shrink-0 rounded {dotClass}" aria-hidden="true"></span>
		{/if}
		<h2 class="t-label text-gray-500 dark:text-gray-400">{label}</h2>
		{#if note}
			<span class="t-micro text-gray-500 dark:text-gray-400">{note}</span>
		{/if}
		<span class="t-code-sm ms-auto text-gray-500 dark:text-gray-400">{count}</span>
	</header>
{/snippet}

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if query.isLoading}
		<!-- The skeleton mirrors the real shape: verdict line, then act | state. -->
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-6 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
				<div class="space-y-6">
					<div class="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
					<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				</div>
				<div class="h-80 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			</div>
		</div>
	{:else if query.isError}
		<div
			class="rounded-xl border border-gray-200 px-4 py-3 text-sm text-red-700 dark:border-gray-700 dark:text-red-400"
		>
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if cells.length === 0}
		<div class="flex flex-col items-center justify-center py-6 text-center">
			<LayersSolid class="mb-6 h-10 w-10 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-medium text-gray-900 dark:text-white">App not found</p>
			<p class="t-dense mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				No <code class="t-code-sm rounded bg-gray-50 px-1 dark:bg-gray-800">Environment</code>
				resources reference
				<code class="t-code-sm rounded bg-gray-50 px-1 dark:bg-gray-800">{appName}</code>.
			</p>
			<a
				href="/apps"
				class="mt-6 inline-flex h-9 items-center justify-center gap-1 rounded border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				<ArrowLeftOutline class="h-3 w-3" /> Back to apps
			</a>
		</div>
	{:else}
		<!-- ═══ THE VERDICT LINE. No card. ══════════════════════════════════ -->
		<section class="mb-6">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<h1 class="flex min-w-0 flex-wrap items-baseline gap-2">
						<span class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">
							{appName}
						</span>
						{#if appTitle && appTitle !== appName}
							<span class="t-display min-w-0 truncate text-gray-500 dark:text-gray-400">
								{appTitle}
							</span>
						{/if}
					</h1>
				</div>

				<!-- A sparkline of twelve empty buckets is not a measurement. -->
				<div class="flex shrink-0 items-center gap-2">
					{#if deploys24h > 0}
						<span class="t-label text-gray-500 dark:text-gray-400">Last 24h</span>
						{#if deploys24h >= SPARK_MIN}
							<DeployVolumeSparkline
								rollouts={cells.map((c) => c.rollout)}
								hours={24}
								buckets={12}
							/>
						{/if}
						<span class="t-dense whitespace-nowrap text-gray-500 dark:text-gray-400">
							{deploys24h} deploy{deploys24h === 1 ? '' : 's'}
						</span>
					{:else if lastDeployIso}
						<span
							class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
							title={formatDate(lastDeployIso)}
						>
							last deploy {formatTimeAgoCompact(lastDeployIso, $now)} ago
						</span>
					{:else}
						<span class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400">
							never deployed
						</span>
					{/if}
				</div>
			</div>
		</section>

		<!-- ═══ THE PAGE'S ONE BLOCKING FACT ════════════════════════════════
		     The same `AlertPanel` rollout detail renders its schedule gate and
		     its version pin in — 40px circular icon, bold headline, the concrete
		     consequence on the second line. `COMPOSITION-GRAMMAR.md` §4 names
		     this as what *"attention pulled by design, not text"* looks like,
		     and it is the object the human pointed at when they rejected the
		     gray row band as *"feels like a bug"*.

		     ONE. The SET of things needing a person is the `Needs a decision`
		     card below; this states the single worst fact and its CAUSE. -->
		{#if pageBlocker}
			<AlertPanel
				severity={pageBlocker.severity}
				icon={pageBlocker.icon}
				title={pageBlocker.title}
				message={pageBlocker.message}
				footnote={pageBlocker.footnote}
				pulse={pageBlocker.pulse}
				class="mb-6"
			/>
		{/if}

		<!-- ═══ ACT | STATE ═════════════════════════════════════════════════
		     The study's `minmax(0,1fr) 340px`, collapsing to one column below
		     860px. The breakpoint is a CONTAINER query, not a viewport one:
		     the sidebar is 176px at `sm`+ and absent below it, so the content
		     box is not monotonic in viewport width and a media query flips
		     the layout the wrong way across that boundary.

		     DOM order is act → state → history, so the phone stack puts the
		     state column ABOVE the timeline. On desktop the grid areas put
		     history back under the tasks. -->
		<div class="ab-wrap">
			<div class="ab-grid">
				<!-- ── ACT ──────────────────────────────────────────────────
				     THE WRAPPER OWNS THE GRID AREA, not the `Card`. Svelte's
				     scoped CSS is compiled per component, so `.ab-act` passed
				     through a child's `class` prop would land on an element that
				     never carries this component's scoping hash and the grid
				     area would silently not apply. -->
				<div class="ab-act flex flex-col gap-4">
					<Card
						icon={ExclamationCircleSolid}
						iconClass={taskCount > 0
							? 'text-amber-500 dark:text-amber-400'
							: 'text-gray-400 dark:text-gray-500'}
						title="Needs you"
						verdict="{taskCount} environment{taskCount === 1 ? '' : 's'}"
						verdictTone={taskCount > 0 ? 'adverse' : 'neutral'}
						padded={false}
					>
						{#if tasks.length === 0}
							<!-- The calm sentence. A quiet column is what a healthy app
						     looks like, and it is the shape this direction is FOR. -->
							<!-- ONE line, Direction B's own words. The second line — *"What
						     each environment is running is in the state column"* — was
						     wayfinding for a column that is 24px to its right, has its
						     own header reading `State`, and is the only other thing on
						     the screen. -->
							<div class="px-4 py-4">
								<p class="t-dense text-gray-700 dark:text-gray-300">Nothing here needs you.</p>
							</div>
						{:else}
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each decisions as t, i (t.id)}
									{@const f = t.lead}
									{@const broken = t.kind === 'adverse'}
									{@const foot = footNote(t)}
									{@const circled = broken && f.status !== 'Succeeded'}
									<li>
										<!-- THE TINTED GROUND is the study's one use of a status
									     background, and it is on a TASK, not on a card. It is a
									     FILL, not an edge stripe, which is what the enforced
									     rule bans. Only the broken grade wears it: a promotion
									     that is merely available is not an alarm and must not
									     read as one.

									     ⛔ THE GROUND IS NEUTRAL NOW, AND THE RED IS ON THE
									     MARK (2026-08-27, colour audit §10). It was
									     `bg-red-50/80 dark:bg-red-950/25`, and BOTH halves
									     failed a measurement:

									     · DARK CAME OUT MAGENTA. `dark:bg-red-950/25`
									       composited to `#29212d`, OKLCH hue **313.8°** — 292°
									       from the red it is meant to be and **20.4° from
									       staging's identity violet**. A task marked BROKEN was
									       tinted staging. It is the same mechanism `.dark
									       .chip-env` is open on: the card ground `#1e2939` is
									       itself chromatic (C 0.0335 at hue 257.7, i.e. blue),
									       so a warm fill at low alpha cancels against it and
									       crosses neutral. RAISING THE ALPHA IS NOT THE FIX —
									       measured at 0.60 the hue comes right and the field
									       goes to **3,691 ink units, 22.7x the dark alarm
									       chip**, which is worse. There is no alpha over this
									       ground that is both red and quiet.
									     · LIGHT WAS A STATUS FIELD AT 69,780px². `bg-red-50/80`
									       is C 0.0103 — invisible as a colour — but over that
									       area it measured **719 ink units, 3.5x the alarm
									       chip**. DESIGN.md bans status-coloured boxed callouts
									       outright and this is the largest one in the product.

									     So the ROW keeps its own ground, because the proximity
									     argument below is still right, and the ground stops
									     carrying the STATUS. It is NEUTRAL — ZERO chromatic ink,
									     and neutral by construction so it cannot cancel against
									     the blue card. What says BROKEN is the 24px red `!`
									     glyph and the row's own status circle, which are MARKS.
									     Two colour values removed, none added.

									     ⚠️ THE NEUTRAL PAIR IT PICKED (`bg-gray-50
									     dark:bg-gray-700/30`) WAS MEASURED AND REPLACED ON
									     2026-08-27 — see the block immediately above the element.
									     The dark half was the wrong way up.

									     ⚠️ `/` DRAWS THE SAME FIELD (`#fffafa`, alpha 0.4,
									     68,738px², dark `#1b1827` at hue 295.3 — **2.1° from
									     staging violet**) and is OUT OF SCOPE for this pass, so
									     the two pages now disagree. Recorded in DESIGN.md.

									     IT IS FULL-BLEED, and that is the whole point of it.
									     The study wins the effect with `margin:0 -13px` so the
									     tint runs past the text to the panel's own inner edges;
									     inset by a gutter it reads as a floating rectangle
									     dropped inside a card instead of as the row's ground.
									     So the LIST ITEM carries no padding at all — the task
									     itself owns the box, tinted or not, and the two grades
									     therefore agree about their geometry at every width.
									     Top and bottom the tint meets the `divide-y` seam; at
									     the ends of the list the panel's `overflow-hidden`
									     clips it into the 12px corner. -->
										<!-- ⛔ THE BROKEN TASK IS A RECESS NOW, AND IN DARK IT IS THE
									     PAGE SHOWING THROUGH THE CARD (2026-08-27).

									     The human's instruction has a positive half: *"design
									     dashboard in such a way that user's attention is pulled in
									     to where is necessary."* Cutting the prose was the first
									     half; this is the second. Measured in-browser:

									     | ground | ΔL vs its own surround | OKLCH C |
									     |---|---|---|
									     | light `gray-50` BEFORE | −0.0154 | 0.0017 |
									     | light `gray-100` AFTER | **−0.0330** | 0.0029 |
									     | dark `gray-700/30` BEFORE | +0.0291 | 0.0337 |
									     | dark `gray-700/60` AFTER | **+0.0573** | 0.0339 |

									     LIGHT WAS 1.5% OF A LIGHTNESS STEP — a field that
									     measured as a field and did not read as one. Dark had the
									     right direction and half the distance.

									     THE VALUES ARE `/environments`' `ADVERSE_ROW`, CHARACTER
									     FOR CHARACTER. That page landed on
									     `bg-gray-100 dark:bg-gray-700/60` for exactly this idea —
									     "the row in this list is the one that is wrong" — after
									     the same measurement, and two detail pages spending two
									     different grounds on one idea is the cross-page
									     inconsistency this repo keeps paying for. It is also the
									     value a reader arrives here already carrying, because
									     `/environments` is the page they clicked through.

									     WHY THE CHANNEL IS LIGHTNESS AND NEVER HUE. Presence is
									     `area x chroma`, and a task row is ~70,000px². `red-50` at
									     C 0.013 costs **1,071 ink units against the alarm's
									     218.6** — a 4.9x inversion — which is the arithmetic that
									     deleted this row's own `bg-red-50/80` last round, and the
									     same arithmetic `/environments` re-derived independently.
									     At C 0.0029 this ground is **59x below the alarm's fill**
									     and cannot compete with it. ZERO new colour values, and
									     dark cannot go magenta the way `dark:bg-red-950/25` did at
									     hue 313.8, because there is no hue in it to cancel.

									     `py-4` rather than `py-3`: the broken task carries the
									     least content on the page — no build ledger, one button —
									     so at equal padding it was also the SHORTEST row, and
									     density was arguing against the ground. 8px of extra
									     height makes the recess a band rather than a stripe. -->
										<!-- ⛔ THE GRAY RECESS IS GONE. (2026-08-30)
									     > *"i don't like that you're highlighting a stuck row
									     > like this… it feels like a bug. is this what you
									     > implemented when i said there should be a better way
									     > to mark something as needing attention rather than
									     > just a badge? there are many examples on the rest of
									     > the page that are much better."*

									     The measurement above is right — no CHROMATIC field is
									     affordable at 70,000px² — and the conclusion drawn from
									     it was wrong. Having proved that hue is unaffordable it
									     reached for the only channel left, LIGHTNESS, which is
									     the channel a browser spends on `:disabled`, on a
									     loading skeleton and on a dimmed row. A gray band on a
									     white list does not read as *look here*; it reads as
									     *this one is not working*, which is the sentence the
									     human wrote.

									     WHAT MARKS ATTENTION INSTEAD is the thing the human
									     named as the good example: a FILLED BANNER at the top of
									     the page for the blocking fact, and a TITLED CARD around
									     the set. Both are objects with headers and rollups, both
									     already exist in the product, and neither can be
									     mistaken for a rendering fault. Inside the card the rows
									     are identical — the moment one row can be styled
									     differently from its neighbour, this comes back under a
									     new name.

									     `py-4` on a broken task survives: it carries the least
									     content (no build ledger, one button) and at equal
									     padding it was the shortest row on the page. -->
										<div
											class="tk px-4 {broken ? 'py-4' : 'py-3'} {t.waiting.length === 0
												? 'tk--nobody'
												: ''} {circled ? 'tk--circle' : ''} {broken ? 'tk--broken' : ''}"
										>
											<!-- IDENTITY — the gap slot leads. A number for a
										     promotable environment, `!` for a broken one. -->
											<!-- THE GAP SLOT IS ITS OWN GRID COLUMN, not a flex item.
										     As a flex item it wrapped: the cluster beside it is
										     wider than a 390px row, so the row broke and left a
										     24px `−4` alone on a line of its own. A two-column
										     grid lets the cluster wrap INSIDE its own track while
										     the number stays where it belongs.

										     THE SENTENCE IS ITS OWN CELL, not the last item of
										     the chip flow. At 390 the reason wraps to two or
										     three lines, and a centred glyph then floats against
										     the middle of a paragraph instead of marking the row
										     it belongs to. Splitting it out lets the glyph align
										     to the CHIP band and nothing else — and above 620px
										     the sentence returns to the same line, so the dense
										     desktop row is unchanged. -->
											<div class="tk-id">
												{#if broken}
													<span
														class="tk-glyph t-display-id text-red-700 dark:text-red-400"
														aria-hidden="true">!</span
													>
												{:else if f.rank > 0}
													<!-- ⛔ NOT RED. (2026-08-30) This was `red-700` at
												     24px — the single largest chromatic mark on the
												     page — printed on every environment that is
												     merely behind. From a live UX critique: *"`−N`
												     chips render RED across the product, so normal
												     pipeline drift reads as failure."* It is the
												     same defect as `Chip`'s `rank` role and takes
												     the same fix and the same argument: *"drift is
												     the normal state of a promotion pipeline; the
												     only adverse state is stuck"*, so a distance
												     may not wear the failure hue. Red is left to
												     the `!`, which means something broke. -->
													<span
														class="tk-glyph t-display-id text-gray-500 dark:text-gray-400"
														title="{f.rank} build{f.rank === 1 ? '' : 's'} behind the newest"
														>−{f.rank}</span
													>
												{:else}
													<span class="tk-glyph t-display-id text-gray-500 dark:text-gray-400"
														>·</span
													>
												{/if}

												<span class="tk-chips">
													{#if circled}
														<!-- The status circle earns its place here and
													     nowhere else on the page: when the DEPLOY is
													     what is wrong, the status IS the subject.
													     Full colour — red failed, YELLOW baking,
													     BLUE deploying, gray pending; six hues, and
													     they are spent.

													     A `Succeeded` circle is deliberately absent.
													     A gate-blocked environment deployed fine and
													     is stuck on the NEXT promotion, so a green
													     tick beside a red `!` is two marks arguing
													     about the same row. Mark the deviation, not
													     the norm. -->
														<span
															class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
																f.status
															)}"
															title="{f.title} — {dotFor(f.status).word}"
														>
															<BakeStatusIcon bakeStatus={f.status} size="medium" />
															<span class="sr-only">{dotFor(f.status).word}</span>
														</span>
													{/if}
													<Chip
														role="env"
														theme={f.cell.theme}
														label={t.label}
														title={t.members.map((m) => m.title).join(' · ')}
														wide
														class="min-w-0 shrink-0"
													/>
													{#if t.members.length > 1}
														<Chip
															role="count"
															label="×{t.members.length}"
															title={t.members.map((m) => m.title).join(' · ')}
														/>
													{/if}
													{#if broken && f.status === 'Failed'}
														<!-- `failing` IS THE WORD THE RED DOT CANNOT SAY —
													     `Chip`'s own words, and the role exists for
													     exactly this substitution. Deleting the
													     `Deploy failed` sentence left the task with a
													     red `!` and a red circle and no VERB, and the
													     other two broken grades kept theirs
													     (`DIVERGED`, `STUCK`), so one slot had three
													     geometries. ADVERSE tone, text-only, ZERO new
													     colour values — `red-700` / `red-400` is
													     already on this task twice — so `alarm` stays
													     the only chip with a FILL and the loudest mark
													     on the page. The status circle beside it is
													     not a duplicate: it carries the HUE that tells
													     failed from baking from deploying, and
													     `/apps` already ships this exact pair. -->
														<Chip
															role="failing"
															label="failed"
															title="{f.title}'s last deploy failed"
														/>
													{/if}
													{#if f.stuck}
														<Chip
															role="alarm"
															label="stuck"
															value={f.stuckSpan}
															valueTitle={stuckTitle(f.stuck)}
															title={stuckTitle(f.stuck)}
														/>
													{/if}
													{#if f.diverged}
														<Chip
															role="diverged"
															label="unreleased"
															wide
															title="Running a version that is on no environment's release list"
														/>
													{/if}
													{#if t.pinned}
														<!-- THE PIN IS A MARK, NOT `Pinned to v1.2.3`. The
													     product's own pin badge, the same one
													     `/envs/[name]` puts on a pinned row, with the
													     version in its title and the `Change Version`
													     button naming the way out. -->
														<PinBadge version={t.pinned} size="xs" />
													{/if}
												</span>

												{#if t.upstream}
													<span class="tk-reason t-code-sm text-gray-500 dark:text-gray-400"
														>behind {t.upstream}</span
													>
												{/if}
											</div>

											<!-- ⛔ `HELD BY ghd-p2fld` IS DEAD. (2026-08-30)
										     > *"an opaque generated gate name presented as an
										     > explanation."*

										     It was a `[held by][<gate name>]` badge, and the badge
										     was doing the job of a sentence: a reader was expected
										     to infer from a Kubernetes object's generated name
										     whether anything was wrong, whether it would clear on
										     its own, and whether they were the one who had to move.
										     None of those is recoverable from `ghd-p2fld`.

										     `BlockReason` states the CONSEQUENCE first, in ordinary
										     English, and demotes the name to a muted mono `rule:`
										     handle so it reads as something to go look up rather
										     than as the reason. The same object, with the same
										     words, is on `/environments` and `/envs/[name]`. -->
											{#if t.gate}
												<BlockReason
													awaiting={f.block.awaitingApprovalGates}
													notPassing={f.block.notPassingGates}
													class="mt-1.5"
												/>
											{/if}

											<!-- WHAT IS WAITING — the commits that have not shipped.
										     A person deciding to promote is deciding about the
										     changes, not about the number.

										     NO `href`. A waiting sha used to link to
										     `/versions/<revision>`, which answers "where is this
										     commit across every app" — a fleet-wide question,
										     and not the one this task is asking. The queue is
										     EVIDENCE; the task's targets are its buttons. The
										     component owns the truncation so its `+N more` can
										     expand in place instead of sitting inert under three
										     links. -->
											{#if t.waiting.length > 0}
												<div class="tk-why min-w-0">
													<WaitingBuilds
														namespace={f.namespace}
														name={f.cell.rollout.metadata?.name ?? ''}
														cluster={cellCluster(f.cell)}
														base={f.revision}
														head={t.waiting[0]?.revision ?? null}
														builds={t.waiting.map((b) => ({
															version: b.version,
															revision: b.revision,
															createdMs: b.createdMs
														}))}
														{commitsAvailable}
													/>
												</div>
											{/if}

											<!-- THE ACTION, IN THE GAP. Every button on this page is
										     in this column, and each one names exactly one
										     rollout — a folded task renders one target per
										     member rather than a single control whose subject is
										     chosen silently.

										     MAXIMUM ONE PRIMARY PER PAGE, and it goes to the
										     topmost task, which the sort has already made the
										     worst one. It is an explicit class override rather
										     than Flowbite `color="dark"`, which resolves to
										     `bg-gray-800` in BOTH themes and would make the
										     primary the quietest control on a gray-800 card. -->
											<div class="tk-act flex shrink-0 flex-wrap items-center gap-2">
												{#if t.kind === 'promote'}
													{@const shown = expanded[t.id]
														? t.members
														: t.members.slice(0, TARGETS_SHOWN)}
													{#each shown as m, mi (m.key)}
														<!-- 14px, `8px 16px`, 8px radius — the product's
													     button, `app.css`'s `.btn`. It was a Flowbite
													     `size="xs"` with a hand-rolled black override,
													     i.e. 12px text and a fourth button geometry;
													     `COMPOSITION-GRAMMAR.md` §5 measures the
													     reference page's controls at 14px and notes
													     that is *"larger than the 10-12px the
													     redesigned pages use for nearly everything"*. -->
														<button
															type="button"
															class="btn {i === 0 && mi === 0 ? 'btn-primary' : 'btn-secondary'}"
															onclick={() => openPromote(m.cell, t.promoteTag, t.promoteVersion)}
														>
															<ArrowRightOutline />
															{#if t.members.length === 1}
																Promote {t.promoteVersion ?? ''}
															{:else}
																{m.label}
															{/if}
														</button>
													{/each}
													{#if t.members.length > TARGETS_SHOWN && !expanded[t.id]}
														<button
															type="button"
															class="t-micro text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
															onclick={() => (expanded = { ...expanded, [t.id]: true })}
															>+{t.members.length - TARGETS_SHOWN} more</button
														>
													{/if}
												{:else if t.kind === 'approve'}
													<!-- ⭐ THE DECISION THIS COLUMN IS NAMED AFTER.
												     (2026-08-30)
												     > *"`NEEDS A DECISION — 3 items` offers no
												     > decisions — every card gives only
												     > `Investigate` and `View on GitHub`. One of
												     > the three genuinely is a decision (a
												     > manual-approval gate) and is rendered
												     > identically to the two that are not."*

												     An approval gate has published an allow-list
												     and nothing is on it. No amount of waiting
												     changes that; a PERSON does. So the control is
												     the act itself — deploy the newest waiting
												     build past the gate — and it is FILLED,
												     because it is the one primary action on the
												     row and this is the row the page exists for.

												     IT IS NOT AN INVENTED CONTROL. Rollout detail
												     already puts a filled `Deploy` on every
												     `Blocked` candidate in its own
												     `Available Version Upgrades` list, through
												     this same modal. The act was always reachable;
												     it was two clicks away on another page while
												     the column that named the decision offered a
												     search icon. -->
													<!-- ONE FILLED PRIMARY PER PAGE, and it is the
												     FIRST decision. That rule survives the
												     composition pass intact — it was always about
												     ACTIONS, and a column where every row shouts
												     has no first row. -->
													{#if t.promoteTag}
														<button
															type="button"
															class="btn {i === 0 ? 'btn-primary' : 'btn-secondary'}"
															onclick={() => openPromote(f.cell, t.promoteTag, t.promoteVersion)}
														>
															<ArrowRightOutline />
															Deploy {t.promoteVersion ?? ''}
														</button>
													{/if}
													<!-- THE OTHER TWO WAYS OUT, both secondary: pin a
												     different build, or go read the gate. -->
													<!-- `Change Version` names a field; `Pick a different
												     version` names what happens. Same modal. -->
													<button
														type="button"
														class="btn btn-secondary"
														onclick={() => openChangeVersion(f.cell)}
													>
														<EditOutline />
														Pick a different version
													</button>
													<a href={rolloutHref(f.cell)} class="btn btn-secondary">
														<SearchOutline />
														Investigate
													</a>
												{:else if t.kind === 'held'}
													<!-- A PIN. The step is to undo it or move it, and
												     `Change Version` named neither. -->
													<button
														type="button"
														class="btn {i === 0 ? 'btn-primary' : 'btn-secondary'}"
														onclick={() => openChangeVersion(f.cell)}
													>
														<EditOutline />
														Release the hold
													</button>
												{:else}
													<!-- THE DECISION FIRST, WHERE THERE IS ONE. A stuck
												     environment whose every queued build is refused by
												     an approval gate is broken AND waiting on a person;
												     the way out is the person, so the filled control is
												     the act, and `Investigate` drops to secondary
												     behind it. -->
													{#if t.promoteTag}
														<button
															type="button"
															class="btn {i === 0 ? 'btn-primary' : 'btn-secondary'}"
															onclick={() => openPromote(f.cell, t.promoteTag, t.promoteVersion)}
														>
															<ArrowRightOutline />
															Deploy {t.promoteVersion ?? ''}
														</button>
													{/if}
													<a
														href={rolloutHref(f.cell)}
														class="btn {i === 0 && !t.promoteTag
															? 'btn-primary'
															: 'btn-secondary'}"
													>
														<SearchOutline />
														Investigate
													</a>
													<!-- ROLLBACK IS OFFERED ONLY WHERE THE BUILD ITSELF
												     IS THE SUSPECT — a failed deploy, or one wedged
												     mid-bake or mid-deploy. An environment held by
												     an approval gate deployed perfectly well and is
												     waiting on the NEXT build; putting `Rollback`
												     on it offers to undo something that is not
												     wrong. -->
													{#if previousTag(f.cell) && (f.status === 'Failed' || f.stuck?.kind === 'baking' || f.stuck?.kind === 'deploying')}
														<button
															type="button"
															class="btn btn-secondary"
															onclick={() => openRollback(f.cell)}
														>
															<ReplyOutline />
															Go back a version
														</button>
													{/if}
													{#if f.cell.sourceURL && f.version}
														<!-- Only on a broken task: the current build is
													     the suspect there. On a promotable task the
													     builds worth opening are the WAITING ones,
													     and every one of them is already a link. -->
														<!-- `size="sm"`, not `xs`, and NO `class="rounded"`.
													     Flowbite's `sm` is 14px / `8px 16px` /
													     `rounded-lg` — the same three numbers `.btn`
													     is built from — so this sits in the row as a
													     peer instead of as a 12px 4px-radius outlier.
													     The COMPONENT is untouched on purpose: its
													     other call site is under `/rollouts/…/history`,
													     which is part of the reference page. -->
														<GitHubViewButton
															sourceUrl={f.cell.sourceURL}
															version={f.version}
															size="sm"
															color="light"
														/>
													{/if}
												{/if}
											</div>

											<!-- THE FOOT NOTE, CUT TO ONE CLAUSE. See `footNote`:
										     the sha, the pod count and the `automatic` trigger are
										     all gone, and a promotable task has no foot line at
										     all. What is left on a broken task is STALENESS — the
										     difference between a deploy that failed a minute ago
										     and one that has been failing four days — and, hard
										     right on the task's own margin, the namespace as a
										     LINK, which is the half a person needs to open the
										     thing. The whole `<p>` disappears when neither half
										     has anything, so a promotable task loses the line
										     rather than reserving an empty one. -->
											{#if foot.state || broken || foot.source}
												<p
													class="tk-foot t-code-sm flex min-w-0 flex-wrap items-baseline gap-x-4 text-gray-500 dark:text-gray-400"
												>
													{#if foot.state}
														<span class="min-w-0 truncate">{foot.state}</span>
													{/if}
													{#if broken}
														<!-- A LINK THAT LEAVES THE PAGE SAYS SO. Every
														     drill-through link on the reference page
														     carries this glyph; this one was bare text
														     that happened to underline on hover. -->
														<a
															href={rolloutHref(f.cell)}
															class="tk-foot-src inline-flex min-w-0 items-center gap-1 truncate hover:text-gray-700 hover:underline dark:hover:text-gray-300"
															title="Open the {f.title} rollout"
															><span class="truncate">{f.namespace}</span
															><ArrowUpRightFromSquareOutline class="h-3 w-3 shrink-0" /></a
														>
													{:else if foot.source}
														<span class="tk-foot-src truncate">{foot.source}</span>
													{/if}
												</p>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
						{#if githubDisconnected && tasks.some((t) => t.waiting.length > 0)}
							<!-- Panel-level, exactly ONCE — never one prompt per task, and
						     never at all when there is no build list for it to fill.
						     An unavailable integration does not get a row of its own.

						     THE LABEL IS THE ACTION, NOT AN EXPLANATION OF IT
						     (2026-08-27). It read `Connect GitHub to see what each
						     waiting build changes` — a control carrying its own
						     rationale, 48 characters of it, under a ledger whose
						     middle column is visibly empty. The empty column IS the
						     explanation; the button only has to name what it does. -->
							<button
								type="button"
								class="t-micro w-full border-t border-gray-200 px-4 py-2 text-left text-gray-500 hover:text-gray-700 hover:underline dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
								onclick={() => connectGithub()}
								title="Connect GitHub to see what each waiting build changes"
							>
								Connect GitHub
							</button>
						{/if}
					</Card>

					<!-- ── WAITING — NOT A DECISION, AND NOW NOT IN THE COLUMN
					     THAT CLAIMS IT IS. (2026-08-30)

					     A gate that published no allow-list and is simply not
					     passing right now is a schedule window or a health
					     check: it clears on its own, nobody has to do anything,
					     and it was being counted as an "item" under a header
					     reading `Needs a decision` and given the same
					     `Investigate` link as a failed deploy. That is how the
					     column came to offer no decisions.

					     Its own card, its own rollup, and DELIBERATELY NO
					     ACTION BUTTON. Offering a control for something that
					     needs no action is the defect, not the cure. -->
					{#if waitingItems.length > 0}
						<Card
							icon={ClockSolid}
							title="Waiting, nothing to do"
							verdict="{waitingItems.length} environment{waitingItems.length === 1 ? '' : 's'}"
							verdictTitle="On hold behind a check or a deploy window. These clear on their own."
							padded={false}
						>
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each waitingItems as t (t.id)}
									{@const f = t.lead}
									<li class="px-4 py-3">
										<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
										<Chip role="env" theme={f.cell.theme} label={f.label} wide />
										<span class="t-dense min-w-0 text-gray-500 dark:text-gray-400">
											{t.waiting.length} newer version{t.waiting.length === 1 ? '' : 's'} ready
										</span>
										<!-- Same glyph the decision card's foot link carries: a
										     link that leaves the page says so. -->
										<a
											href={rolloutHref(f.cell)}
											class="t-micro ms-auto inline-flex shrink-0 items-center gap-1 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
											title="Open the {f.title} rollout"
											>{f.namespace}<ArrowUpRightFromSquareOutline class="h-3 w-3 shrink-0" /></a
										>
										</div>
										<!-- The whole point of this card is that NOTHING has to be
										     done here, so the line that says WHY is the only thing
										     it owes the reader. Same object as everywhere else. -->
										<BlockReason
											awaiting={f.block.awaitingApprovalGates}
											notPassing={f.block.notPassingGates}
											class="mt-1.5"
										/>
									</li>
								{/each}
							</ul>
						</Card>
					{/if}
				</div>

				<!-- ── STATE ──────────────────────────────────────────────── -->
				<div class="ab-state">
					<Card
						icon={GridSolid}
						title="Where it’s running"
						verdict={stateCount}
						verdictTone={stateOnNewest ? 'good' : 'neutral'}
						verdictTitle="Environments running the newest version this app has"
						padded={false}
					>
						<!-- 1 · THE STAGE CHAIN -->
						<div class="px-4 py-3">
							<StageChain nodes={chainNodes} hops={chainHops} />
						</div>

						<!-- 2 · THE PRODUCTION FLEET — a rule, a verdict in words,
					     then the nodes with no rails. Regions are a SET. -->
						{#if isFanOut}
							{#if fleetHop}
								<div class="ab-fleethop px-4">
									<span class="ab-rail {fleetHop.waiting > 0 ? 'ab-rail--gap' : ''}"></span>
									<span class="t-code-sm truncate text-gray-500 dark:text-gray-400"
										>{fleetHop.label}</span
									>
								</div>
							{/if}
							<div class="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
								<div class="mb-2 flex items-center gap-2">
									<!-- A SUB-HEADER INSIDE A CARD STILL GETS AN ICON. The
								     reference page carries 115 of them and every titled
								     region has one; the rejected pages carried four in
								     total. -->
									<CodeBranchSolid class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
									<h3 class="t-label text-gray-500 dark:text-gray-400">
										Production · {fleetNodes.length} regions
									</h3>
									{#if fleetVerdict}
										<span class="ms-auto">
											<!-- ALWAYS `count`, NEVER `rank` (2026-08-27, colour audit §10).
										     This read `role={fleetVerdict.agree ? 'count' : 'rank'}`,
										     so `3 BUILDS` printed in `rank`'s adverse red whenever
										     the production fleet spanned more than one build.
										     Two rules said no. DESIGN.md assigns `count` the
										     NEUTRAL tone and lists red's owners as `Failed`,
										     `diverged`, `rank (-N)` and `failing` — a COUNT of
										     builds is none of them. And *"Drift is not a valid
										     status"* is enforced: regions on different builds
										     mid-promotion is the normal state, not an adverse
										     one. What IS adverse about a region is already on
										     that region's own node. -->
											<Chip
												role="count"
												label={fleetVerdict.label}
												wide
												title={fleetVerdict.agree
													? 'Every production region runs the same version'
													: 'Production regions are running different versions'}
											/>
										</span>
									{/if}
								</div>
								<StageChain nodes={fleetNodes} />
							</div>
						{/if}

						<!-- 3 · EXPOSURE -->
						<div class="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
							<div class="mb-2 flex items-center gap-2">
								<ChartMixedOutline class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
								<!-- ⛔ `EXPOSURE` NAMES A CONCEPT FROM PROGRESSIVE-DELIVERY
								     LITERATURE, not a thing on the screen. Under it sits a
								     bar of pods by version and a percentage; what a reader
								     wants to know is how much of what is actually serving is
								     on the new version. The heading says that now. -->
								<h3 class="t-label text-gray-500 dark:text-gray-400">
									How much is on the newest
								</h3>
							</div>
							<ExposureBar
								segments={exposure.segments}
								totalPods={exposure.totalPods}
								newestPercent={exposure.newestPercent}
								unknownEnvironments={exposure.unknown}
								loading={podsQuery.isLoading}
							/>
						</div>
					</Card>
				</div>

				<!-- ── HISTORY — criterion 1. What HAPPENED, in order. ───────
				     A TITLED CARD like every other region on the page.
				     `ActivityRail` drew its own `t-label` caption above its own
				     bordered box, which is the exact "caption floating over a
				     box" shape `COMPOSITION-GRAMMAR.md` names as what the
				     rejected pages are made of. `chrome={false}` drops that so
				     the two do not nest; the prop defaults TRUE so
				     `/envs/[name]`, the other call site, is untouched. -->
				<div class="ab-hist min-w-0">
					<Card icon={ClockSolid} title="Recent activity">
						{#snippet rollup()}
							<a
								href="/activity"
								class="t-micro text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
								>view all ›</a
							>
						{/snippet}
						<ActivityRail
							rollouts={cells.map((c) => c.rollout)}
							{environments}
							limit={10}
							{localClusterName}
							showAppName={false}
							chrome={false}
						/>
					</Card>
				</div>
			</div>
		</div>

		<ChangeVersionModal
			bind:open={modalOpen}
			rollout={modalRollout}
			isPinVersionMode={modalPin}
			initialSelectedVersion={modalVersion}
			initialExplanation={modalExplanation}
			cluster={modalCluster}
		/>
	{/if}
</div>

<style>
	/* THE GRID IS A CONTAINER QUERY, not a viewport one. The sidebar is 176px
	   at `sm`+ and absent below it, so the content box is not monotonic in
	   viewport width: a 639px viewport gives this grid 607px and a 640px
	   viewport gives it 431px. A `lg:` media query flips the layout the wrong
	   way across that boundary. */
	.ab-wrap {
		container-type: inline-size;
	}

	.ab-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'act'
			'state'
			'hist';
		gap: 24px;
		align-items: start;
	}

	.ab-act {
		grid-area: act;
	}
	.ab-state {
		grid-area: state;
	}
	.ab-hist {
		grid-area: hist;
	}

	/* The study's own breakpoint. Above it the state column is a fixed 340px
	   and history returns to the left column, under the tasks. */
	@container (min-width: 860px) {
		.ab-grid {
			grid-template-columns: minmax(0, 1fr) 340px;
			grid-template-areas:
				'act state'
				'hist state';
			column-gap: 24px;
		}
	}

	/* The hop from the last stage into the production fleet. Same geometry as
	   `StageChain`'s own hops so the two read as one rail. */
	.ab-fleethop {
		display: grid;
		grid-template-columns: 5px minmax(0, 1fr);
		align-items: center;
		column-gap: 8px;
		height: 20px;
	}
	.ab-rail {
		display: block;
		width: 0;
		height: 100%;
		margin-left: 2px;
		border-left: 1px solid var(--color-gray-200);
	}
	:global(.dark) .ab-rail {
		border-left-color: var(--color-gray-700);
	}
	.ab-rail--gap {
		border-left-style: dashed;
		border-left-color: var(--color-gray-400);
	}
	:global(.dark) .ab-rail--gap {
		border-left-color: var(--color-gray-500);
	}

	/* ── THE TASK ROW ────────────────────────────────────────────────────
	   Its own container, because the panel's width is what it must respond
	   to. Phone form: four stacked bands — identity, what is waiting, the
	   action, the foot note. Deliberately in that order: the reason a person
	   is here comes first, the evidence second, the control third. */
	.tk {
		container-type: inline-size;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'id'
			'why'
			'act'
			'foot';
		align-items: start;
		column-gap: 16px;
		row-gap: 8px;
	}

	/* A task with no build list — a failed deploy, a pin, a diverged
	   environment — loses the band rather than reserving an empty one. */
	.tk--nobody {
		grid-template-areas:
			'id'
			'act'
			'foot';
	}

	/* ── THE IDENTITY BAND ───────────────────────────────────────────────
	   Glyph in the margin, chips beside it, the sentence under them. Its own
	   grid rather than one wrapping flex row, because the glyph must align to
	   the CHIP band and to nothing else: centred against a sentence that wraps
	   to three lines at 390px it floats in the middle of a paragraph, which is
	   what it was doing before. */
	.tk-id {
		grid-area: id;
		display: grid;
		/* 29px is a TYPE METRIC, not a spacing value: `t-display-id` is a 24px
		   monospace, so `!` and `·` measure 14.22px and every two-character
		   `−N` measures 28.42px. Floor the track there and the chip column
		   starts at the same x on every task in the panel, instead of stepping
		   in and out as the gap slot changes character count down the list. A
		   three-digit rank still grows the track for its own task. */
		grid-template-columns: minmax(29px, auto) minmax(0, 1fr);
		grid-template-areas:
			'glyph chips'
			'. reason';
		align-items: start;
		column-gap: 12px;
		row-gap: 4px;
		min-width: 0;
	}
	.tk-glyph {
		grid-area: glyph;
		/* THE ONE CONSTANT: a chip is 20px tall, so the glyph's LINE BOX is
		   20px and its optical centre lands on the chip's. `t-display-id` is
		   24px/1.15 = 27.6px, which is 3.8px too tall to centre against a chip
		   and cannot be corrected by `align-items` alone. With the status
		   circle present the band is that circle's 32px instead. Scoped
		   Svelte styles outrank the unlayered `.t-display-id`; a Tailwind
		   `leading-[20px]` would NOT, because Tailwind's utilities are layered
		   and every unlayered rule beats every layered one. */
		line-height: 20px;
		white-space: nowrap;
	}
	.tk--circle .tk-glyph {
		line-height: 32px;
	}
	.tk-chips {
		grid-area: chips;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.tk-reason {
		grid-area: reason;
		min-width: 0;
	}

	/* Above 620px the sentence returns to the chips' own line: there is room
	   for it, and the dense one-line desktop row is the form the study drew.
	   The glyph keeps its band line-height here too, so it stays pinned to the
	   chips even in the narrow window where the sentence still takes two
	   lines. The sentence is centred against the band when it is shorter than
	   the band and top-aligned when it is taller, which `align-self: center`
	   gives for free in a row whose height is the taller of the two. */
	@container (min-width: 620px) {
		.tk-id {
			grid-template-columns: minmax(29px, auto) auto minmax(0, 1fr);
			grid-template-areas: 'glyph chips reason';
		}
		.tk-reason {
			align-self: center;
		}
	}

	.tk-why {
		grid-area: why;
	}
	.tk-act {
		grid-area: act;
	}
	.tk-foot {
		grid-area: foot;
	}
	/* The provenance goes hard right, onto the task's own right margin — the
	   edge the panel head's count and the `Connect GitHub` prompt already use,
	   and the one the build ledger aligns its `released` column to whenever
	   the ledger is full width.

	   ⛔ ONLY WHERE THERE IS A RIGHT EDGE TO JUSTIFY AGAINST (2026-08-27).
	   This used to be unconditional, and the note above ("when the two halves
	   cannot share a line it drops to the next one and STAYS right") described
	   the defect rather than a feature: at 390 the task foot rendered

	       unchanged for 4h
	                          payments-core-prod-eu-central

	   — a caption alone on a line, hard right, with no column to be the right
	   of. It is the same failure that shipped on `/environments`' 390 layout,
	   from the same cause: a desktop grid collapses to a stack and a cell
	   keeps its desktop alignment. Below the task's own 620px container
	   breakpoint — the width at which the row stops being two columns — both
	   halves simply read left, in order, like the stack they are. */
	@container (min-width: 620px) {
		.tk-foot-src {
			margin-inline-start: auto;
		}
	}

	/* THE ICONS COME OFF below 480px so the buttons fit one line. The icon is
	   the half of each button that carries no meaning the label does not. */
	@container (max-width: 479px) {
		.tk-act :global(button),
		.tk-act :global(a) {
			padding-inline: 8px;
		}
		.tk-act :global(button svg),
		.tk-act :global(a svg) {
			display: none;
		}
	}

	/* ── DESKTOP FORM ────────────────────────────────────────────────────
	   Identity across the top, then the waiting builds beside the action.
	   620px is where the identity cluster at its widest — a 24px number, a
	   32px circle, an env chip and `STUCK 27d` — clears ~300px while the
	   buttons take ~380px, leaving the build list a real column. */
	@container (min-width: 620px) {
		.tk {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'id id'
				'why act'
				'foot foot';
			align-items: center;
		}
		.tk--nobody {
			grid-template-areas:
				'id act'
				'foot foot';
		}
		.tk-act {
			justify-content: flex-end;
		}
	}
</style>
