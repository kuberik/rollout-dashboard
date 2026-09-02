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
	 *   · SIX STATUS HUES AND THEY ARE SPENT: green succeeded, YELLOW checking,
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
	import { groupRolloutsByApp, displayVersionForTag } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { getEnvironmentRank, compareEnvironmentNames } from '$lib/env-order';
	import { leadTime, compactSpan, type LeadEnv } from '$lib/view-models/lead-time';
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
	import {
		rankVerdicts,
		rankBehindBy,
		rankTitle,
		type RankVerdict
	} from '$lib/view-models/env-rank';
	import { getStatusCircleClass, BAKE_WORD } from '$lib/bake-status';
	import Chip from '$lib/components/Chip.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import PromotionPipeline, {
		type Station,
		type Frontier,
		type Hop
	} from '$lib/components/PromotionPipeline.svelte';
	import ExposureBar, { hasExposure } from '$lib/components/ExposureBar.svelte';
	import BlockingStoryLines from '$lib/components/BlockingStoryLines.svelte';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		joinClauses,
		shortStory,
		type GateContext,
		type BlockingStory,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import { fetchScheduleObjects, type ScheduleObject } from '$lib/api/schedules';
	import WaitingBuilds from '$lib/components/WaitingBuilds.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import ClearPinModal from '$lib/components/ClearPinModal.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import { Button } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		LayersSolid,
		EditOutline,
		ReplyOutline,
		ArrowRightOutline,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CheckCircleSolid,
		ChartMixedOutline,
		RocketSolid,
		ClockOutline,
		ArrowUpRightFromSquareOutline,
		ChevronDoubleRightOutline,
		ChevronRightOutline,
		LinkOutline,
		LockOpenOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment, Kustomization } from '../../../types';
	import type { ManagedResourceStatus } from '../../../types/managed-resource';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

	const appName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) } })
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

	/**
	 * The one derivation every BUILD ORDERING on this page indexes into. It
	 * decides which build is newer than which; it no longer decides how far
	 * behind anything is.
	 */
	const ladder = $derived(buildLadder(cells));

	/**
	 * ⛔ THE `−N` ON THIS PAGE IS THE PRODUCT'S ONE `behind`. (2026-08-31)
	 *
	 * It used to be `ladder.rankOf(...)` — the union across every
	 * environment — while the card 340px to its right printed
	 * `N versions ready` from `promotionCandidates`, the rollout's own list.
	 * A live critique caught the pair: `−20 PROD` beside `15 versions ready`
	 * inside ONE block, with rollout detail saying `15 upgrades available`.
	 * Two numbers, one word, one card.
	 *
	 * `rankVerdicts` is now the same own-list count both of those already
	 * used, so `−N`, `N versions ready` and `N upgrades available` are the
	 * same number by construction. See `env-rank.ts` for the measurement.
	 *
	 * `-1` keeps this page's existing sentinel for "no number to print" —
	 * `unknown` and `diverged` both land there, and every reader below
	 * already guards on `rank > 0` / `rank < 0`.
	 */
	const rankByCell = $derived(group ? rankVerdicts(group) : new Map<AppCell, RankVerdict>());
	function rankOfCell(cell: AppCell): number {
		const v = rankByCell.get(cell);
		if (!v) return -1;
		if (v.kind === 'newest') return 0;
		if (v.kind === 'behind') return v.by;
		return -1;
	}

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
		// ⛔ THE WORDS ARE `bake-status.ts`'S, NOT THIS PAGE'S (2026-08-30).
		// `baking`, `bake cancelled` and `no bake status` were three more
		// spellings of the product's own field name. See `BAKE_WORD`.
		Failed: { cls: 'bg-red-700 dark:bg-red-400', word: BAKE_WORD.Failed },
		Deploying: { cls: 'bg-blue-700 dark:bg-blue-400', word: BAKE_WORD.Deploying },
		InProgress: { cls: 'bg-yellow-700 dark:bg-yellow-400', word: BAKE_WORD.InProgress },
		Succeeded: { cls: 'bg-green-700 dark:bg-green-400', word: BAKE_WORD.Succeeded },
		Cancelled: { cls: 'bg-gray-300 dark:bg-gray-600', word: BAKE_WORD.Cancelled },
		None: { cls: 'bg-gray-300 dark:bg-gray-600', word: BAKE_WORD.None }
	};
	function dotFor(status: string) {
		return DOT[status] ?? DOT.None;
	}

	/**
	 * ⭐ A GATE CORRECTLY REFUSING A CANDIDATE IS NOT A STOPPAGE. (2026-09-02)
	 *
	 * > *"i still don't like the design here on app detail page."* — three rows,
	 * > three `!` glyphs, three amber `STUCK 2d` chips, three `Investigate`
	 * > buttons, for one app blocked on one provider.
	 *
	 * The FIRST half of that defect is not composition, it is TRUTH. Measured
	 * against the live cluster, `hello-frontend-app`'s three environments each
	 * report:
	 *
	 *     gates:      dependency-hello-frontend-needs-api  passing=true
	 *                 ghd-…                                passing=true
	 *     conditions: DeploymentBlocked=False:HealthChecksHealthy
	 *                 Ready=True:BakeTimePassed
	 *
	 * Every gate is PASSING. Nothing is broken, nothing is wedged, and all three
	 * run the newest build the contract admits (`rel-66`). The only thing that
	 * has not happened is a promotion of `rel-67`, which requires `api ^1.67.0`
	 * while `hello-api-app` ships `1.66.0`. That is the dependency gate doing
	 * exactly its job.
	 *
	 * `detectStuckPromotion` wants to exclude this — its own comment says *"a
	 * block made up purely of not-passing gates is WAITING, not stuck"* — but it
	 * tests `awaitingApprovalGates.length === 0`, and `awaitingApprovalGates` is
	 * the CRUDE bucket this page already has a tombstone about: the environment
	 * controller AND the dependency controller both publish allow-lists, so
	 * three of the four gate writers land in it. `blockingStory` is the
	 * classifier that joins on the published owner reference, and this page
	 * already computes it for every environment. So the two are made to agree
	 * here rather than the detector being taught a fourth spelling of the same
	 * question — `promotion.ts` has its own tests and four other callers.
	 *
	 * ⭐ AND THE PRODUCT ALREADY AGREED WITH THIS EVERYWHERE ELSE. For the same
	 * rollout at the same second, rollout detail — the reference page — says
	 * **"DEV is waiting on another deploy"**, and `/apps` says
	 * **"hello-frontend-app in DEV is waiting on another deploy"**. This page
	 * was the ONE surface in the product saying `DEV is stuck`, and it said it
	 * in the colour the product reserves for a stall. Three surfaces, one fact,
	 * and the loudest one had it wrong.
	 *
	 * ⛔ THE CARVE-OUT IS EXACT. `detectStuck` — baking or deploying past its
	 * detector — is a genuine wedge whatever the gates say, and it is untouched
	 * above this predicate. So is `Failed`, and so is `diverged`. What is
	 * narrowed is only the two detectors that fire on A PROMOTION NOT HAVING
	 * HAPPENED (`detectStuckPromotion`, `detectStuckBehind`), and only when the
	 * story says no person and no unattributable rule is holding it — i.e. a
	 * clock, a check, or another deploy, every one of which the product's own
	 * verdict already reads as *"nobody has to approve anything."*
	 */
	function refusedNotStalled(story: BlockingStory): boolean {
		return story.blocked && story.person.length === 0 && story.unknown.length === 0;
	}

	/**
	 * ⭐ THE PIPELINE IS NOT A CAUSE.
	 *
	 * A `promotion`-kind gate is written by the **environment controller** and
	 * its allow-list is the set of builds the environment IN FRONT has already
	 * deployed — joined from `Environment.status.rolloutGateRef`, never from the
	 * `ghd-` name prefix. So *"waiting for dev to deploy it first"* is not a
	 * fact about STAGING; it is the definition of a promotion pipeline, and it
	 * is already drawn as a LINE, in order, by `PromotionPipeline` 200px below.
	 *
	 * Strip those and what is left is the environment's OWN reason for standing
	 * still. Two environments with the same remainder are held by the same
	 * fact and are one row, not two.
	 */
	function ownCause(story: BlockingStory): ClassifiedGate[] {
		return story.gates.filter((g) => g.kind !== 'promotion');
	}

	function pipelineOnlyGates(story: BlockingStory): number {
		return story.gates.length - ownCause(story).length;
	}

	/**
	 * The fold key. `kind|clause|clearsAt` and never the gate's `id`: three
	 * environments each carry their OWN `RolloutDependency` gate object, one per
	 * namespace, and they are the same fact — while two schedule gates that
	 * reopen at different times are not, which `clearsAt` keeps apart.
	 *
	 * When the remainder is empty the environment's only holder IS the
	 * pipeline, and it falls back to the full set so it can never silently
	 * merge with something it has nothing in common with.
	 */
	function causeKey(story: BlockingStory): string {
		const own = ownCause(story);
		const gates = own.length > 0 ? own : story.gates;
		return gates
			.map((g) => `${g.kind}|${g.clause}|${g.clearsAt ?? ''}`)
			.sort()
			.join('¦');
	}

	function stuckFor(cell: AppCell, story: BlockingStory) {
		const own = detectStuck(cell.rollout, { now: $now });
		if (own) return own;
		// ⭐ THE JOIN GOES INTO THE DETECTOR NOW, NOT AROUND IT. (2026-09-02)
		// `detectStuckPromotion` classifies every blocking gate itself when it
		// is handed a `GateContext`, and only `person`/`unknown` may spell
		// `stuck` over a gated rollout — the same rule `refusedNotStalled` was
		// wrapping it in. This page has always had the context; passing it makes
		// ONE derivation of the question instead of two that can drift.
		const promo = detectStuckPromotion(cell.rollout, { now: $now, gateContext });
		if (promo) return promo;
		// ⚠️ `refusedNotStalled` SURVIVES FOR THE PEER DETECTOR ONLY.
		// `detectStuckBehind` lives in `utils.ts`, takes no gate context and
		// therefore still cannot tell a wedge from a gate correctly refusing a
		// candidate. Until it can, the guard belongs in front of it — narrowed
		// to the one call that needs it rather than deleted, which would put the
		// amber back on `hello-frontend-app` by the other route.
		if (refusedNotStalled(story)) return null;
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
		if (reason.kind === 'baking') return `Checking for ${span}`;
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
		refetchInterval: pollWhenHealthy(30_000)
	}));
	const podsByEnv = $derived<Record<string, number>>(podsQuery.data ?? {});

	// ── Per-environment facts, computed once ─────────────────────────────
	type EnvFacts = {
		cell: AppCell;
		key: string;
		/** EVERY gate holding this environment, each with how it clears. */
		story: BlockingStory;
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

	/**
	 * ⭐ THE GATE JOIN TABLE. Built from the SAME `/api/rollouts` payload the
	 * page already has: `Environment.status.rolloutGateRef` names the gate the
	 * environment controller owns and `spec.relationship` says which
	 * environment has to deploy first, `RolloutDependency.status.gateName` does
	 * the same for a cross-service contract.
	 *
	 * ⛔ WITHOUT IT, `ghd-p2fld` WAS CAPTIONED `Needs a person to approve`.
	 * Three of the four things that write a `RolloutGate` publish an allow-list,
	 * so "has an allow-list ⇒ a person must approve it" is wrong three times out
	 * of four, and it is wrong in the worst direction: it sends someone at 3am
	 * to find a human who cannot approve a controller-owned object.
	 */
	let scheduleObjects = $state<Record<string, ScheduleObject[]>>({});
	const gateContext = $derived.by<GateContext>(() => {
		let ctx = buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null
		});
		for (const [ns, objs] of Object.entries(scheduleObjects)) ctx = withSchedules(ctx, ns, objs);
		return ctx;
	});

	/*
	 * WHEN DOES THE WINDOW OPEN? One GET per environment whose block includes a
	 * gate with no allow-list, cached by namespace. Same endpoint and same
	 * arithmetic `/versions` and the rollout detail page already run — lifted
	 * into `api/schedules.ts` so three surfaces cannot disagree about when a
	 * window reopens. It never blocks a render: the story states the block with
	 * or without a clock, and gains the clock when the answer lands.
	 */
	$effect(() => {
		for (const c of cells) {
			const ns = c.rollout.metadata?.namespace;
			const name = c.rollout.metadata?.name;
			if (!ns || !name) continue;
			if (!promotionBlock(c.rollout).notPassingGates.length) continue;
			if (scheduleObjects[ns]) continue;
			fetchScheduleObjects(ns, name, cellCluster(c) || undefined)
				.then((objs) => {
					scheduleObjects = { ...scheduleObjects, [ns]: objs };
				})
				.catch(() => {});
		}
	});

	const envFacts = $derived.by<EnvFacts[]>(() =>
		cells.map((c) => {
			const status = cellStatus(c);
			const block = promotionBlock(c.rollout);
			const story = blockingStory(c.rollout, gateContext, {
				place: fullEnvLabel(c),
				now: $now
			});
			const stuck = stuckFor(c, story);
			const diverged = divergedFor(c);
			const span = stuckForMs(stuck);
			const key = `${c.envName}/${c.rollout.metadata?.namespace ?? ''}`;
			return {
				cell: c,
				key,
				story,
				label: envLabel(c),
				title: fullEnvLabel(c),
				namespace: c.rollout.metadata?.namespace ?? '',
				version: cellVersion(c),
				revision: cellRevision(c),
				prevVersion: previousVersion(c),
				status,
				timestamp: cellTimestamp(c),
				rank: rankOfCell(c),
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
	// ⛔ IT USED TO NAME ONE GATE OUT OF THREE, AND IT PICKED BY ALLOW-LIST.
	// For prod `hello-world-app` the API reports three gates holding it —
	// `ghd-xm669` (the environment controller's), `hello-world-manual-approval`
	// (a person's) and `schedule-gate-zvsqr` (**failing**) — and this returned
	// `held by ghd-xm669, hello-world-manual-approval`: two gates, neither of
	// them the failing one, under a word that was wrong for the first. The mark
	// now comes off `blockingStory`, so it names the whole set and the WORD
	// matches what each of them actually is.
	function gateMark(f: EnvFacts): { word: string; names: string } | null {
		if (!f.story.blocked || f.story.gates.length === 0) return null;
		const word =
			f.story.person.length > 0
				? 'needs approval'
				: f.story.upstream.length > 0
					? 'waiting on'
					: 'window closed';
		return { word, names: f.story.gates.map((g) => g.id).join(', ') };
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
	 * ⛔ `behind <env>` ONLY WHEN THERE IS SOMETHING TO BE BEHIND. (2026-08-31)
	 *
	 * From a live critique: this page printed `−20 STAGING behind dev` and
	 * `−20 PROD behind staging` while the rail beside it showed dev, staging
	 * and prod ALL RUNNING `991829b`. Three identical deployments, rendered as
	 * a two-hop lag chain. `upstreamOf` answers "who promotes into me", which
	 * is a fact about the TOPOLOGY and is true whatever anyone is running; the
	 * caption spends it as a fact about DRIFT.
	 *
	 * Both halves are required and each removes a different lie:
	 *   · SAME BUILD ⇒ NOTHING. Same sha is the same code. The two rollouts'
	 *     own candidate counts may still differ (they are different upgrade
	 *     paths — see `env-rank.ts`), and that difference is not a lag.
	 *   · UPSTREAM MUST BE NEWER, on the app's build ladder, which is the
	 *     page's ordering authority. If the ladder cannot place either build
	 *     the comparison is unresolvable and this says nothing at all —
	 *     DESIGN.md's standing rule, applied to a caption.
	 */
	function upstreamAheadOf(f: EnvFacts): EnvFacts | null {
		const up = upstreamOf(f);
		if (!up || !up.version || !f.version) return null;
		if (up.version === f.version) return null;
		const upRank = ladder.rankOf(up.version);
		const myRank = ladder.rankOf(f.version);
		if (upRank < 0 || myRank < 0) return null;
		return upRank < myRank ? up : null;
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

	/**
	 * IS THE RUNNING BUILD THE THING TO GO AND LOOK AT?
	 *
	 * Yes when the deploy failed, or wedged mid-bake or mid-deploy — the build
	 * put itself there. No when the environment is merely stuck behind a gate:
	 * that deploy succeeded and is serving, and what a person is deciding
	 * about is the queue in front of it. `Go back a version` was already
	 * gated on exactly this; `View on GitHub` was not, so a gate-blocked row
	 * carried three buttons where the decision is two-way.
	 *
	 * ⛔ `diverged` IS NOT IN HERE, AND `View on GitHub` ADDS IT BACK AT ITS
	 * OWN CALL SITE. An environment running a build that is on no release line
	 * IS a row where the running build is the thing to go and look at — that
	 * is the whole content of `unreleased` — so the GitHub link belongs on it.
	 * `Go back a version` does not: rolling a diverged environment back is a
	 * guess about which build it should have been on, and this page has never
	 * offered it. Two questions, two conditions, one of them shared.
	 */
	function buildIsSuspect(f: EnvFacts): boolean {
		return f.status === 'Failed' || f.stuck?.kind === 'baking' || f.stuck?.kind === 'deploying';
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
			// ⛔ `awaitingApprovalGates` IS NOT "NEEDS A PERSON". It means the
			// gate published an allow-list, and the environment controller and
			// the dependency controller both publish one — so STAGING, held
			// only by `ghd-p2fld` (its upstream has not deployed this build)
			// and a closed window, was filed under `Needs you`. Nobody there
			// needs to do anything. `story.person` is the classified bucket.
			const approval = f.story.person.length > 0;
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
				upstream: upstreamAheadOf(f)?.title ?? null,
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
			// ⛔ `awaitingApprovalGates` IS NOT "NEEDS A PERSON". It means the
			// gate published an allow-list, and the environment controller and
			// the dependency controller both publish one — so STAGING, held
			// only by `ghd-p2fld` (its upstream has not deployed this build)
			// and a closed window, was filed under `Needs you`. Nobody there
			// needs to do anything. `story.person` is the classified bucket.
			const approval = f.story.person.length > 0;
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
				upstream: upstreamAheadOf(f)?.title ?? null,
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
				upstream: upstreamAheadOf(lead)?.title ?? null,
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
	 * · `unchanged for <span>` on a BROKEN task — SURVIVES ONLY WITHOUT A
	 *   `stuck` CHIP (narrowed 2026-08-30). Where a detector fired, the chip's
	 *   own value half already prints the span and this restated it verbatim.
	 *   Where none fired — a failed deploy — it is the only statement of
	 *   staleness on the page, because the activity rail below is per-deploy,
	 *   not per-state.
	 * · the NAMESPACE — DELETED 2026-08-30. It was a link to
	 *   `rolloutHref(f.cell)`, which is the `Investigate` button's own href.
	 * · the whole line on a PROMOTABLE task — DELETED. `WaitingBuilds` already
	 *   prints a `released` age against every build in the queue, which is the
	 *   same question answered against better subjects.
	 *
	 * `source` still goes hard right, on the task's own right margin.
	 */
	function footNote(t: Task): { state: string | null; source: string | null } {
		const span = t.sinceMs !== null ? compactMs(t.sinceMs) : null;
		if (t.kind === 'adverse') {
			// ⛔ NOT WHEN THE `stuck` CHIP ALREADY PRINTS A SPAN. (2026-08-30)
			//
			// > *"a `STUCK` chip with `1d` in it, and a `no progress for 1d`
			// > line. … would the reader lose a fact, or only a restatement?"*
			//
			// Measured on the live cluster: `hello-world-app`'s PROD row wore
			// `[STUCK][1d]` and then said `no progress for 1d` 130px below it.
			// Two renderings of one duration, and the chip is the louder and
			// the more precise of the two — `stuckSpan` is how long the
			// DETECTOR has fired, which is the number that made the row a task.
			//
			// It SURVIVES where there is no chip: a deploy that failed has no
			// stuck detector behind it, and then the difference between a
			// minute ago and four days ago is the whole severity of the row and
			// nothing else on the page states it.
			if (t.lead.stuckSpan) return { state: null, source: null };
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

	/**
	 * ⭐ ONE ROW PER CAUSE, NOT ONE PER ENVIRONMENT. (2026-09-02)
	 *
	 * The rejected card printed three rows that differed by one word. Measured
	 * on `hello-frontend-app`, each was ~110px of `[ENV] 1 newer version ready`
	 * + the SAME sentence about `hello-api-app` + the same `Details`
	 * disclosure + its own namespace link: one fact, drawn three times, with
	 * every mark on it drawn three times too. That is the repetition defect
	 * this branch already cut off `/environments` (a handle printed five times)
	 * and out of the alert banners (one fact in two colours, stacked).
	 *
	 * ⛔ AND FOLDING IS LEGAL HERE FOR THE SAME REASON IT IS ILLEGAL ABOVE.
	 * `tasks` refuses to fold stages, and the reason is written there: *"a
	 * single control over a merged stage row is a destructive action with an
	 * ambiguous target."* A `waiting` group carries NO control that changes
	 * cluster state — that is the definition of the kind — so there is no
	 * target to be ambiguous about. `decisions` are left one-per-environment,
	 * untouched, because every one of them ends in a button.
	 *
	 * The environments do not disappear: they are the row's SET of chips, in
	 * promotion order, each one the link to its own rollout. N environments
	 * cost one line instead of N rows, which is `PAGE-CRITERIA.md`'s own
	 * *"N envs cost zero width"* read down the other axis.
	 */
	type WaitGroup = {
		id: string;
		members: Task[];
		/** This group's own reason. The pipeline's own gates are not in it. */
		gates: ClassifiedGate[];
		story: BlockingStory;
		/** The app to go and look at, when a dependency contract is the cause. */
		provider: string | null;
		providerHref: string | null;
		candidates: number;
	};

	/**
	 * The provider named by whichever of this group's gates is a dependency
	 * contract — read back out of the same `GateContext` that classified it,
	 * so the link and the sentence can never name two different services.
	 */
	function providerOf(namespace: string, gates: ClassifiedGate[]): string | null {
		for (const g of gates) {
			if (g.kind !== 'dependency') continue;
			const dep = gateContext.dependency.get(`${namespace}/${g.id}`);
			if (dep?.provider) return dep.provider;
		}
		return null;
	}

	const waitGroups = $derived.by<WaitGroup[]>(() => {
		const buckets = new Map<string, Task[]>();
		for (const t of waitingItems) {
			const k = causeKey(t.lead.story);
			const list = buckets.get(k);
			if (list) list.push(t);
			else buckets.set(k, [t]);
		}
		return [...buckets].map(([id, members]) => {
			const lead = members[0].lead;
			const own = ownCause(lead.story);
			// A SINGLE-MEMBER GROUP KEEPS ITS WHOLE STORY. "Waiting for dev to
			// deploy it first" is not the pipeline's definition when there is
			// only one environment on the row — it is the only thing holding it.
			const gates = members.length > 1 && own.length > 0 ? own : lead.story.gates;
			const provider = providerOf(lead.namespace, gates);
			return {
				id,
				members,
				gates,
				story: { ...lead.story, gates },
				provider,
				providerHref: provider && groups.has(provider) ? `/apps/${provider}` : null,
				candidates: members.reduce((n, m) => Math.max(n, m.waiting.length), 0)
			};
		});
	});

	/** Header count for the act column. */
	const taskCount = $derived(decisions.length);

	/**
	 * ⭐ THE FILLED PRIMARY GOES TO THE ACTION, NOT TO ROW ZERO. (2026-09-02)
	 *
	 * *"A FILLED button is reserved for the action that changes what is
	 * running."* Every control in this card used to test `i === 0` — the
	 * topmost task — which was sound only while `Investigate` was a `.btn` and
	 * every row therefore had something fillable. It is a link now, and the
	 * first casualty was visible immediately: a page whose first task is a
	 * FAILED deploy (no candidate to promote, so no `Deploy` control) and whose
	 * second is an approval gate holding a real build drew the approval's
	 * `Deploy 064b655` SECONDARY and left the page with no primary at all. The
	 * one control on the page that changes what is running was the quietest
	 * thing in its own row.
	 *
	 * So the assertion moves from POSITION to CAPABILITY: the topmost task that
	 * can actually deploy something. `held` is the fallback — clearing a pin is
	 * the only other control here that changes what the controller may run —
	 * and when neither exists the page has NO filled button, which is the
	 * correct state for a card that can only be read.
	 */
	const primaryTaskId = $derived(
		(decisions.find((t) => t.promoteTag) ?? decisions.find((t) => t.kind === 'held'))?.id ?? null
	);

	/**
	 * ⭐ IS THERE AN ACT COLUMN AT ALL? (2026-08-30)
	 *
	 * > *"it also looks a bit weird when there are no actions needed."*
	 *
	 * On a healthy app the page opened with `Needs you · 0 environments` over
	 * a body reading *"Nothing here needs you."* — a 47px header bar, a
	 * right-aligned rollup and a 120px card spent, in the page's most
	 * prominent slot, on ABSENCE. It is also the exact structural defect that
	 * has cut nine components from this product: an object that MOSTLY DRAWS
	 * THE NORM. Measured on the `hello-frontend-app` fixture the card occupied
	 * y=133 → y=249 to carry one sentence, and pushed the only list on the
	 * left column 140px down the page.
	 *
	 * WHAT REPLACES IT IS NOT A QUIETER CARD, IT IS THE ABSENCE OF ONE. When
	 * nothing needs a person the act column does not render, and `Recent
	 * activity` — already on the page, already a real list, already the thing
	 * a healthy app's reader came for — takes the top-left slot. NO HOLE IS
	 * LEFT WHERE A LIST WOULD BE: the list moves up into it.
	 *
	 * AND THE REASSURANCE IS NOT DELETED, IT IS PROMOTED TO A MEASUREMENT.
	 * The state card must render either way, its header carries a hard
	 * right-aligned rollup by construction, and on a healthy app that rollup
	 * reads `3 of 3 up to date` in the product's one state green. That is the
	 * grammar's own `3/3 healthy` idiom: a reader takes the card's answer
	 * without reading a row of it, and the answer is COUNTED rather than
	 * claimed. A sentence asserting nothing is wrong is a weaker object than
	 * a fraction proving it.
	 *
	 * ⛔ `waitingItems` KEEPS THE COLUMN ALIVE. A schedule window holding a
	 * promotion is not a decision, but it IS something happening, and its card
	 * says so in its own title. Only a page with neither drops the column.
	 */
	/** Declared with `loneWaitGroups`, which it reads — see below. */

	// ── OBJECT 2 · THE STATE COLUMN ──────────────────────────────────────
	//
	// The chain is the LINE of stages; production, when it fans out, is a SET
	// and gets its own block. When there is exactly one production
	// environment there is no set, so it is simply the chain's last node.
	function nodeOf(f: EnvFacts): Station {
		const d = dotFor(f.status);
		return {
			key: f.key,
			label: f.label,
			title: f.title,
			theme: f.cell.theme,
			version: f.version,
			rank: f.rank,
			diverged: f.diverged,
			// THE STATUS ITSELF, not a dot class. The pipeline draws the
			// product's 32px status circle — the same atom the task rows use —
			// and `getStatusCircleClass` / `BakeStatusIcon` own the six hues, so
			// this page stops carrying a second table of them for the chain.
			status: f.status,
			statusWord: d.word,
			// ⭐ WHEN DID THIS ENVIRONMENT LAST MOVE. Criterion 2 is *"which env
			// runs what, AND HOW FAR BACK"*, and the chain only ever answered the
			// first half: a build badge says WHICH, never WHEN. It is the
			// rollout's own `history[0].timestamp`, the same field the activity
			// list is built from, printed compactly with the full date in the
			// title.
			age: f.timestamp ? formatTimeAgoCompact(f.timestamp, $now) : null,
			ageTitle: f.timestamp ? `Deployed ${formatDate(f.timestamp)}` : null,
			// ⭐ IS IT ACTUALLY SERVING. The number the page already fetches for
			// the exposure bar, spent a second time where it answers a different
			// question: the bar splits the FLEET by build, this says how much of
			// it is behind THIS station. `null` where it could not be
			// attributed — see `attributableKustomizations`.
			pods: f.pods,
			href: rolloutHref(f.cell)
		};
	}

	/**
	 * ⭐ THE NEWEST BUILD, NAMED ONCE — the fix for *"we're only showing
	 * absolute versions, not relative"*. (2026-09-01)
	 *
	 * The pipeline printed a bare sha at every station, and on a healthy app
	 * every station is on head, so the card was seven-eighths absolute and had
	 * nothing to be relative ABOUT. Stating the frontier once, at 24px, does
	 * both halves at the same time: the sha lands where it is the SUBJECT (and
	 * where the copy control belongs, because that is the string an operator
	 * pastes into `kubectl`), and every station below is then free to lead with
	 * `newest` / `N behind` — its distance from a number the reader can see.
	 *
	 * ⛔ THE GUARD, AND WHY IT IS NOT PARANOIA. `ladder.builds[0]` is the head
	 * of the app-wide UNION, while a station's `newest` is the head of that
	 * ROLLOUT'S OWN release list (`env-rank.ts`, 2026-08-31). Measured across
	 * the 15 live rollouts those agree, because the union only ever adds
	 * OLDER builds — but "measured today" is not "true by construction". If
	 * they ever disagree this would print `newest build 2.67.0-67` above a
	 * station chip reading `newest 2.66.0-66`: one card, two builds, both
	 * called newest. DESIGN.md forbids rendering an unresolvable comparison as
	 * a definite claim, so the headline is WITHHELD rather than reconciled, and
	 * the card degrades to exactly what it rendered before this change.
	 */
	const frontier = $derived.by<Frontier | null>(() => {
		const b = ladder.builds[0];
		if (!b?.version) return null;
		for (const f of envFacts) {
			if (f.rank === 0 && f.version && f.version !== b.version) return null;
		}
		const iso = b.createdMs ? new Date(b.createdMs).toISOString() : null;
		return {
			version: b.version,
			tag: b.tag,
			age: iso ? formatTimeAgoCompact(iso, $now) : null,
			ageTitle: iso ? `Released ${formatDate(iso)}` : null
		};
	});

	const stageFacts = $derived(envFacts.filter((f) => !(isFanOut && f.prod)));
	const fleetFacts = $derived(isFanOut ? envFacts.filter((f) => f.prod) : []);
	const chainNodes = $derived<Station[]>(stageFacts.map(nodeOf));

	/**
	 * THE HOP — the gap on a promotion edge, as a first-class object.
	 *
	 * The count is `rank(downstream) − rank(upstream)`, both read off the one
	 * ladder, so it is the number of builds that must cross this edge. Never
	 * a second derivation and never a fabricated number: when either side is
	 * not on the ladder the hop says so instead of printing a zero.
	 */
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
		// ⛔ SAME BUILD ⇒ NO HOP, AND THE SUBTRACTION NEVER RUNS. (2026-08-31)
		// The two counts are each rollout's OWN candidate list now, and two
		// environments on one sha can hold different counts — measured live,
		// `hello-world-app` at `c78a9de4`: prod 30, dev 28, staging 29. The
		// difference is a fact about two upgrade paths, never a gap between
		// two deployments of one build; rendered as a hop it would read
		// `1 version waiting to move` across an edge nothing is waiting on.
		if (up.version === down.version) return { waiting: 0, label: '' };
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
	const fleetNodes = $derived<Station[]>(
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
	 * ⭐ THE GATE GOES ON THE EDGE IT HOLDS. (2026-09-02)
	 *
	 * > *"the hop between stations, which is where the gate actually lives,
	 * > carries nothing."*
	 *
	 * A station says WHAT IS RUNNING HERE. The hop is the PROMOTION, and the
	 * thing refusing a promotion is a gate — so the gate belongs on the hop and
	 * on nothing else. It was being printed instead in a card in the act column,
	 * one column and 200px away from the edge it is about, while every rail on
	 * `hello-frontend-app` was a plain 1px line with 600px of nothing beside it.
	 *
	 * ⛔ ONCE, NOT ONCE PER EDGE. One dependency gate holds all three
	 * environments here; drawn per station it would be the same clause three
	 * times, which is the repetition rule this page has already applied twice
	 * (three `Needs you` rows folded to one, five copies of a handle cut from
	 * `/environments`). A cause is attached to the MOST UPSTREAM edge it bites
	 * and skipped on the contiguous run below it — the drawing then lands where
	 * the wave actually stopped, and everything under it is visibly behind. WHO
	 * it holds is the BANNER's job; see `bannerSubject`.
	 *
	 * ⛔ AND ONLY CAUSES NOBODY ELSE IS DRAWING. `waitGroups` is exactly the set
	 * of blocks that carry NO control — the ones the act column deliberately has
	 * no button for. A gate that needs a person is a `decision`, it has a row
	 * with a `Deploy` on it, and drawing its clause here too would put one fact
	 * in two objects. Such an edge still goes DASHED: the shape says "held", the
	 * drawing says "by what", and only the drawing can be a duplicate.
	 */
	const waitGroupByEnv = $derived.by<Map<string, WaitGroup>>(() => {
		const m = new Map<string, WaitGroup>();
		for (const g of waitGroups)
			for (const t of g.members) for (const f of t.members) m.set(f.key, g);
		return m;
	});

	/** `heldEntering[i]` — the cause DRAWN on the edge into `stageFacts[i]`. */
	const heldEntering = $derived.by<(WaitGroup | null)[]>(() => {
		const out: (WaitGroup | null)[] = [];
		let drawn: string | null = null;
		for (const f of stageFacts) {
			const g = waitGroupByEnv.get(f.key) ?? null;
			if (!g) {
				drawn = null;
				out.push(null);
			} else if (g.id === drawn) {
				out.push(null);
			} else {
				drawn = g.id;
				out.push(g);
			}
		}
		return out;
	});

	/** Every environment this edge's cause is also holding downstream. */
	function hopFrom(g: WaitGroup | null, base: Hop): Hop {
		if (!g) return base;
		return {
			...base,
			story: g.story,
			href: g.providerHref,
			hrefLabel: g.provider
		};
	}

	/**
	 * ⭐ THE EDGE INTO THE FIRST STAGE — the hop this chain never had.
	 *
	 * With every environment on one build, every edge BETWEEN stations is in
	 * sync and the only thing actually held is the newest build's entry into
	 * DEV. That edge had no object at all, which is why a page whose whole
	 * subject is "a promotion is stuck" drew three solid rails.
	 *
	 * It renders ONLY when it is held. An open entry hop is the norm, and this
	 * file cuts objects that mostly draw the norm.
	 */
	const entryHop = $derived.by<Hop | null>(() => {
		const g = heldEntering[0];
		if (!g) return null;
		const first = stageFacts[0];
		const n = first && first.rank > 0 ? first.rank : 0;
		return hopFrom(g, { waiting: n, label: '' });
	});

	const pipeHops = $derived.by<(Hop | null)[]>(() =>
		chainHops.map((h, i) => (h ? hopFrom(heldEntering[i + 1] ?? null, h) : h))
	);

	/**
	 * The fleet is a SET with one edge into it, so it takes a cause only when
	 * EVERY blocked region shares one — a set cannot be spoken for by one of its
	 * members, and a region held by something of its own keeps its row in the
	 * waiting card.
	 */
	const fleetCause = $derived.by<WaitGroup | null>(() => {
		if (fleetFacts.length === 0) return null;
		const gs = fleetFacts.map((f) => waitGroupByEnv.get(f.key) ?? null);
		const first = gs[0];
		if (!first || gs.some((g) => g?.id !== first.id)) return null;
		// Already drawn on the last stage's own edge — do not repeat it here.
		const lastDrawn = [...heldEntering].reverse().find((g) => g) ?? null;
		if (lastDrawn?.id === first.id) return null;
		return first;
	});
	const pipeFleetHop = $derived.by<Hop | null>(() =>
		fleetHop ? hopFrom(fleetCause, fleetHop) : fleetHop
	);

	/** The causes the pipeline is drawing, so the waiting card stops repeating them. */
	const hopCauseKeys = $derived.by<Set<string>>(() => {
		const s = new Set<string>();
		for (const g of heldEntering) if (g) s.add(g.id);
		if (fleetCause) s.add(fleetCause.id);
		return s;
	});

	/** What is left for the waiting card: causes no edge could carry. */
	const loneWaitGroups = $derived(waitGroups.filter((g) => !hopCauseKeys.has(g.id)));

	/**
	 * ⛔ AND `waitingItems` ONLY KEEPS IT ALIVE WHERE THE PIPELINE CANNOT SPEAK
	 * FOR THEM. (2026-09-02) Every cause the promotion chain now DRAWS on its
	 * own edge is struck from this card — see `hopCauseKeys`. On
	 * `hello-frontend-app` that is all of them, so the act column goes and the
	 * page opens with the banner and the chain, which is where the fact now
	 * lives. What survives here is a cause no edge could carry: a production
	 * region held by something the rest of the fleet is not.
	 */
	const hasAct = $derived(decisions.length > 0 || loneWaitGroups.length > 0);

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

	/**
	 * ⭐ WHERE THIS APP'S CODE LIVES — the rail's `External Links`.
	 *
	 * Every route off this page ran through a task's button (`View on GitHub`,
	 * `Investigate`), and a healthy app has no tasks. So the page that says an
	 * app is fine offered no way to reach the code it is fine about. The
	 * reference page's rail opens with exactly this card.
	 *
	 * IT IS THE REPO, NOT A BUILD. `GitHubViewButton` links to one build's tree
	 * and belongs on the row whose build is the suspect; this is the app's
	 * source, deduplicated across environments (they normally share one), and
	 * it renders nothing at all when the rollouts carry no source.
	 */
	const sourceRepos = $derived.by<{ url: string; label: string }[]>(() => {
		const out: { url: string; label: string }[] = [];
		const seen = new Set<string>();
		for (const c of cells) {
			// ⛔ NOT `cell.sourceURL`. That field is `sourceDashboardURL(...)` —
			// the DASHBOARD this rollout was read from — so it rendered
			// `kuberik-spoke.192.168.1.102.nip.io` under a heading that says
			// `Source`, twice, because a hub/spoke app is read from two of them.
			// `status.source` is the repository the rollout is built from.
			const raw = c.rollout.status?.source;
			if (!raw) continue;
			// `git@github.com:Owner/repo.git` is a transport address, not a link.
			// Same normalisation `GitHubViewButton` performs, minus the build.
			let url = raw.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
			if (!/^https?:\/\//.test(url)) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			out.push({ url, label: url.replace(/^https?:\/\//, '').replace(/\/$/, '') });
		}
		return out;
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
	 * ── OBJECT 4 · HOW IT'S GOING — the rail's second complete answer.
	 *
	 * ⭐ THE RAIL WAS EMPTIEST EXACTLY WHERE THE APP WAS WORST. (2026-09-02)
	 *
	 * `COMPOSITION-GRAMMAR.md` §7 wants *"a stack of small complete answers"*,
	 * four of them on the reference page. This rail held `Source` — one row —
	 * and an exposure card that renders only when the managed-resources call
	 * resolves pod counts. On `hello-frontend-app` neither the second card nor
	 * anything else appeared, so the column beside the page's lead object was
	 * 340px of nothing on the one app in the fixture that is actually stuck.
	 *
	 * WHAT BELONGS HERE IS WHAT THE MAIN COLUMN STRUCTURALLY CANNOT SAY. The
	 * chain answers *where is it* and *how far behind*; the activity list
	 * answers *what happened*. Neither can answer HOW FAST THIS APP SHIPS,
	 * which is `PAGE-CRITERIA.md`'s own `/apps` criterion 3 (*"which ship
	 * slowly? — lead time dev→prod"*) asked at app scope. It is the same card
	 * `/apps` and `/envs/<name>` already carry in the same slot, with the same
	 * icon, the same `<dl>` and the same `—` for a fact that cannot be
	 * evidenced — the third page in a family of three, not a new object.
	 *
	 * ⛔ AND NOT ONE ROW OF IT IS ON THE PAGE ALREADY. `Furthest behind` — the
	 * row both siblings carry third — is DELIBERATELY ABSENT: every station in
	 * the chain 300px to the left prints its own `N behind` chip, and a card
	 * restating the maximum of three chips is the repetition this pass is
	 * removing everywhere else. The head band's `Last 24h` is a different
	 * window from `Deploys · 7d` and says so in its own label.
	 */
	const SPARK_DAYS = 7;
	const deploys7d = $derived.by<number>(() => {
		const end = $now.getTime();
		const start = end - SPARK_DAYS * 24 * 60 * 60 * 1000;
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

	/** Median bake span across this app's whole history. `/envs/<name>`'s own. */
	const medianBakeMs = $derived.by<number | null>(() => {
		const spans: number[] = [];
		for (const c of cells)
			for (const h of c.rollout.status?.history ?? []) {
				if (!h.bakeStartTime || !h.bakeEndTime) continue;
				const a = new Date(h.bakeStartTime).getTime();
				const b = new Date(h.bakeEndTime).getTime();
				if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
				spans.push(b - a);
			}
		if (spans.length === 0) return null;
		spans.sort((x, y) => x - y);
		const mid = spans.length >> 1;
		return spans.length % 2 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
	});

	/**
	 * The app's median trip from its first environment to its first production
	 * region — `leadTime`'s own measurement, the one `/apps` prints in its
	 * `Lead` column, computed here from the same `status.history` this page
	 * already reads. `null` (an em dash) whenever no build has been observed at
	 * both ends inside the retained history: never an estimate.
	 */
	const appLead = $derived.by(() => {
		const envs: LeadEnv[] = cells.map((c) => ({
			label: shortEnvLabel(c.envName) || c.envName,
			order: getEnvironmentRank(c.envName),
			prod: hasEnvironmentBinding && isProdTier(c.envName),
			deploys: (c.rollout.status?.history ?? []).flatMap((h) => {
				const v = getDisplayVersion(h.version);
				if (!v || !h.timestamp) return [];
				const ms = new Date(h.timestamp).getTime();
				return Number.isFinite(ms) ? [{ version: v, ms }] : [];
			})
		}));
		return leadTime(envs);
	});

	/**
	 * ⛔ NO RAIL TRACK WHEN THERE IS NOTHING IN THE RAIL. The same rule
	 * `hasAct` already applies to the act column: left as a template area with
	 * no element in it, the grid still reserves 340px and a 24px gap, which is
	 * a visible hole beside the page's lead card. An app with no source
	 * annotation and no resolvable pod counts simply has no small complete
	 * answers to consult, and a column with nothing in it is not a column.
	 *
	 * ⚠️ `How it's going` DOES NOT KEEP IT ALIVE ON ITS OWN. Its two rows can
	 * both be `—` on an app whose history carries no bake window and no
	 * observed trip to production, and a 340px track holding one card of em
	 * dashes is the object-drawing-the-norm defect, not a rail.
	 */
	const hasCadence = $derived(deploys7d > 0 || medianBakeMs !== null || appLead !== null);
	const hasRail = $derived(
		sourceRepos.length > 0 ||
			podsQuery.isLoading ||
			hasCadence ||
			hasExposure(exposure.newestPercent, exposure.segments)
	);

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

	/**
	 * ⭐ PROGRESSIVE DISCLOSURE ON THE TAIL. (2026-09-01)
	 *
	 * > *"it looks too much like spreadsheet."*
	 *
	 * `Recent activity` printed ten rows of `<env> <old> → <new> <time>`, all
	 * the same shape, all the same weight, on a page whose other card is three
	 * rows of the same shape. `COMPOSITION-GRAMMAR.md` §8 is the reference
	 * page's own habit — *"the card states its rollup, lists what matters, and
	 * hides the tail behind one control"*, which is what
	 * `Show 8 ready resources ›` is. Six rows still covers the last two days on
	 * every live app; the rest is one click away and nothing is lost.
	 */
	const ACTIVITY_SHOWN = 6;
	let activityExpanded = $state(false);
	const activityLimit = $derived(activityExpanded ? 40 : ACTIVITY_SHOWN);
	/** Deploys this page can show at all — the card's rollup, and the gate on
	 *  whether the disclosure control has anything to disclose. */
	const deployEvents = $derived.by<number>(() => {
		let n = 0;
		for (const c of cells) {
			for (const h of c.rollout.status?.history ?? []) if (h.timestamp) n++;
		}
		return n;
	});
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
	/**
	 * ⭐ `Release the hold` NOW RELEASES THE HOLD.
	 *
	 * It used to call `openChangeVersion` — a version PICKER with no control
	 * for clearing a pin. *"A CTA that lands on the wrong control is worse than
	 * no CTA, because the operator now believes they tried."* The act lives in
	 * `ClearPinModal`, with the same wording rollout detail uses, so there is
	 * one dialog and one sentence about what clearing the pin will really do.
	 */
	let clearPinOpen = $state(false);
	let clearPinRollout = $state<Rollout | null>(null);
	let clearPinCluster = $state<string | undefined>(undefined);

	function openReleaseHold(cell: AppCell) {
		clearPinRollout = cell.rollout;
		clearPinCluster = cellCluster(cell);
		clearPinOpen = true;
	}

	/**
	 * THE DEEP LINK FROM `/apps`. That page's step is a LINK by design — an app
	 * can have several environments in one state and a list-level mutation
	 * would have to pick one silently — so it names the environment in the
	 * query and this opens the dialog for exactly that one on arrival. One hop,
	 * landing ON the control rather than near it.
	 */
	let releaseHandled = $state<string | null>(null);
	$effect(() => {
		const want = page.url.searchParams.get('release');
		if (!want) return;
		const key = `${page.url.pathname}?${want}`;
		if (releaseHandled === key) return;
		const target = envFacts.find((f) => f.held && f.cell.envName === want);
		if (!target) return;
		releaseHandled = key;
		openReleaseHold(target.cell);
	});

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
				// ⛔ THE RAW OCI TAG, IN A SENTENCE. The same defect the critique
				// caught on `/apps`: `spec.wantedVersion` is
				// `main-1787999329-991829b6ab3…` and this page's own rail calls
				// that build `991829b`. `displayVersionForTag` is the one shared
				// lookup from tag to the name the product prints.
				message: `Held at ${displayVersionForTag(pinned.cell.rollout, pinned.cell.rollout.spec?.wantedVersion) || pinned.version}. ${nb(
					pinned.block.candidateCount,
					'newer build'
				)} available, and none will deploy until the pin is cleared.`,
				footnote: 'The gates on this environment are blocking too, but the pin is the cause.',
				pulse: false
			};
		}

		const stuck = envFacts.find((f) => f.stuck);
		if (stuck) {
			// ⛔ `nothing is holding it on purpose` IS A CLAIM FROM ABSENCE, AND IT
			// WAS FALSE ON THIS PAGE'S OWN EVIDENCE. (2026-08-31) The banner said
			// it while the environment row 60px below said *"Waiting for someone
			// to approve it — This will not clear on its own"*. One page, two
			// answers to "is anything holding this?", and the louder object had
			// the wrong one. `stuck` and `blocked` are independent facts (a
			// rollout can be wedged AND gated), and the banner had only ever been
			// told about the first.
			//
			// When a gate is holding it the banner says so in `blockingStory`'s
			// own words, so the sentence at the top of the page and the sentence
			// in the row are the same sentence.
			const span = stuck.stuckSpan ? `Unchanged for ${stuck.stuckSpan}.` : 'Unchanged long enough that it will not clear on its own.';
			if (stuck.story.blocked) {
				return {
					severity: 'warning',
					icon: ExclamationCircleSolid,
					title: `${stuck.title.toUpperCase()} is stuck`,
					message: `${span} ${stuck.story.consequence}`,
					footnote: stuck.story.resolution,
					pulse: true
				};
			}
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

		// ⛔ THIS BRANCH IS GONE AND THE REASON IS THE WORST BUG THE CRITIC FOUND.
		//
		// It filtered on `awaitingApprovalGates.length > 0` and then printed
		// *"STAGING is waiting on an approval … Nothing promotes into STAGING
		// until `ghd-p2fld` allows one. **This will not clear on its own.**"*
		// At the same second, rollout detail — one `Investigate` click away —
		// said *"Automatic deploys are paused … until 13h 34m."* The API said
		// BOTH were true: `ghd-p2fld` published an empty allow-list AND
		// `schedule-gate-nwm62` was not passing. One page said escalate at 3am,
		// the other said go back to bed, and neither said both.
		//
		// Worse, the one it named was misattributed. `ghd-p2fld` belongs to the
		// **environment controller** — its allow-list is the set of builds
		// STAGING's upstream has already deployed — so *"waiting on an
		// approval"* named a human who does not exist.
		//
		// `blockingStory` is now the only thing on any page that answers this,
		// and `blockedEnv` below picks WHICH environment to speak for, never
		// WHICH GATE within it.
		return null;
	});

	/**
	 * The environment to put the blocking banner on: deepest in the pipeline
	 * first, because a block in PROD is the one that matters. Ranked, never
	 * `find` — `cells` is in promotion order and the first hit would be DEV.
	 */
	// ⛔ `f.rank` IS THE LAG, NOT THE PIPELINE POSITION (`rankOfCell` returns
	// `v.by`). Sorting on it put DEV — 16 behind — above PROD at 15, i.e. the
	// least consequential place in the pipeline on the page's one banner.
	// `getEnvironmentRank` is the promotion order, and a block that needs a
	// PERSON outranks every position.
	// ⭐ AND THE FRONTIER OUTRANKS THE DEPTH WHEN THE DEPTH IS ONLY THE
	// PIPELINE. (2026-09-02) `hello-frontend-app` is held in all three
	// environments by one dependency gate. DEV is held by that gate ALONE;
	// STAGING and PROD are held by it AND by an environment-controller gate
	// that says *"waiting for dev to deploy it first"* — i.e. they are behind
	// because DEV is, which is a promotion pipeline working. Ranking by depth
	// put the page's one banner on PROD and headlined it *"Two things are
	// holding PROD"*, naming a symptom, while rollout detail and `/apps` both
	// said *"DEV is waiting on another deploy"*. Three surfaces, one fact, and
	// this one named a different environment.
	//
	// `ClassifiedGate.kind === 'promotion'` is the environment controller's own
	// gate, joined from `Environment.status.rolloutGateRef` — never a name
	// pattern. Fewest of those first = the front of the wave. Where two
	// environments are blocked INDEPENDENTLY they both carry zero and the
	// original depth rule decides, unchanged, so a block in PROD still wins
	// over an unrelated one in DEV.
	const blockedEnv = $derived(
		envFacts
			.filter((f) => f.story.blocked)
			.sort(
				(a, b) =>
					(b.story.person.length > 0 ? 1 : 0) - (a.story.person.length > 0 ? 1 : 0) ||
					(a.story.selfClearing ? 1 : 0) - (b.story.selfClearing ? 1 : 0) ||
					pipelineOnlyGates(a.story) - pipelineOnlyGates(b.story) ||
					getEnvironmentRank(b.cell.envName) - getEnvironmentRank(a.cell.envName)
			)[0] ?? null
	);

	/**
	 * The cause the page BANNER is already speaking for, or `null` when the
	 * banner is a pin / a failure / a stall rather than a gate story, or when
	 * there is no banner at all. The waiting card tests its groups against this
	 * so that one fact is never drawn twice in one viewport — see the row.
	 */
	const bannerCauseKey = $derived(
		!pageBlocker && blockedEnv ? causeKey(blockedEnv.story) : null
	);

	/**
	 * ⭐ ONE CAUSE, N ENVIRONMENTS — AND THE HEADLINE SAYS SO. (2026-09-02)
	 *
	 * `blockedEnv` picks the environment to SPEAK FOR, on a tiebreak that puts
	 * the front of the wave first, and the banner then headlined it *"DEV is
	 * waiting on another deploy"*. On `hello-frontend-app` that is a third of
	 * the truth: one dependency gate holds DEV, STAGING **and** PROD — the
	 * waiting card said *3 environments* and all three stations read `1 BEHIND`
	 * — so the loudest object on the page named the smallest part of its own
	 * subject.
	 *
	 * The classifier is untouched. `blockingStory` already takes the SUBJECT
	 * from its caller precisely because *"what identifies a rollout depends on
	 * the page"*, and this is that decision made at page level: the environments
	 * sharing the block's cause, named.
	 *
	 * ⛔ THE SUBJECT STAYS AN ENVIRONMENT PHRASE. The page fixes the app, so a
	 * headline that named only the provider would be a sentence about somebody
	 * else's service; what a reader needs at a glance is HOW MUCH OF THIS APP is
	 * stopped. The app's own name leads the phrase because `${subject} is …`
	 * needs a grammatically SINGULAR head — `DEV, STAGING and PROD is waiting`
	 * is not English, and `blocking-story.ts` owns that verb. It is also the
	 * exact subject `/apps` already prints for this rollout
	 * (*"hello-frontend-app in DEV is waiting on another deploy"*), so this is
	 * that spelling generalised from one environment to the set, not a new one.
	 *
	 * ⛔ AND IT IS NEVER SAID OF ONE. A single held environment keeps `place`,
	 * unchanged and byte-identical, because `hello-frontend-app in DEV` on a
	 * page titled `hello-frontend-app` is the app's name spent for nothing.
	 */
	const bannerPeers = $derived.by<EnvFacts[]>(() => {
		if (!blockedEnv) return [];
		const key = causeKey(blockedEnv.story);
		return envFacts.filter((f) => f.story.blocked && causeKey(f.story) === key);
	});
	/**
	 * ⛔ AND THE BANNER STOPS CARRYING THE RULE RECORD WHEN THE CHAIN DRAWS IT.
	 * (2026-09-02) With the gate on its own edge, `› 1 rule` appeared TWICE on
	 * one screen — once under the banner and once under the clause 120px below
	 * — two labelled disclosures onto the same gate handle. That is the exact
	 * defect this page already cut between the banner and the waiting card.
	 * `showRules` exists for it: *"off where the surround already draws them."*
	 * The banner keeps its verdict sentence; the RECORD belongs with the
	 * DRAWING, which is the edge.
	 *
	 * ⚠️ ONLY WHEN THE TWO RECORDS WOULD BE THE SAME SET. A banner speaking for
	 * an environment whose block also includes a `promotion` gate holds a gate
	 * the narrowed hop story does not, and hiding it would lose a handle.
	 */
	const bannerRulesDrawn = $derived.by<boolean>(() => {
		if (!blockedEnv) return false;
		const story = blockedEnv.story;
		return (
			hopCauseKeys.has(causeKey(story)) && ownCause(story).length === story.gates.length
		);
	});
	const bannerStory = $derived.by<BlockingStory | null>(() => {
		if (!blockedEnv) return null;
		if (bannerPeers.length < 2) return blockedEnv.story;
		const deployed = envFacts.filter((f) => f.version).length;
		const names = bannerPeers.map((f) => f.title.toUpperCase());
		const where =
			bannerPeers.length === deployed
				? `all ${names.length} environments`
				: names.length <= 3
					? joinClauses(names)
					: `${names.length} environments`;
		return blockingStory(blockedEnv.cell.rollout, gateContext, {
			subject: `${appName} in ${where}`,
			now: $now
		});
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

<!--
	⛔ `Investigate` WAS A LINK WEARING A BUTTON, AND ONCE PER PAGE A FILLED
	BLUE ONE. (2026-09-02)

	> *"i also don't like this investigate button / choose version that act as
	> if they're doing something smart but are just navigating to a page."*

	The rule, applied here and on `/apps`:

	> A control that only changes WHAT YOU ARE LOOKING AT is navigation and must
	> look like navigation — a text link, a row that is a tap target, a chevron.
	> A control that changes CLUSTER STATE is an action and earns a button. A
	> FILLED button is reserved for the action that changes what is running.

	`Investigate` is `<a href={rolloutHref(...)}>`. It mutates nothing, it opens
	a page, and on the topmost broken task with no deployable candidate it was
	rendered `.btn-primary` — the loudest control in the product, promising a
	consequence and delivering a page. Beside it in the same row sit `Deploy`,
	`Release the hold`, `Pick a different version` and `Go back a version`, every
	one of which opens a modal that writes to the cluster. One row, two
	categories, one geometry.

	⭐ IT KEEPS THE 14px, WHICH IS THE HALF THAT USUALLY GETS LOST. Demoting a
	control to `.t-micro` is the reduction that produced the rejected pages;
	`COMPOSITION-GRAMMAR.md` §5 measures the reference page's controls at 14px
	and notes that is *"larger than the 10–12px the redesigned pages use for
	nearly everything."* `.nav-link` in `app.css` is that treatment — 14px/500
	with `.btn`'s own vertical padding, so the action row does not change
	height when a control changes class — and it is the SHARED class the same
	rule is being applied with on every other route. This page does not get a
	private spelling of it.

	AND IT NAMES ITS DESTINATION. `Investigate` is a verb with no object; this
	says which page it opens, which is the only honest label for navigation.
-->
{#snippet openRollout(f: EnvFacts)}
	<a href={rolloutHref(f.cell)} class="nav-link" title="Open the {f.title} rollout">
		Open the {f.label} rollout<ChevronRightOutline />
	</a>
{/snippet}

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this app page"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
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
		<!--
			⛔ WAS `Failed to load: <status code>` IN A ONE-LINE RED BOX. With
			`/api/rollouts` at 503 that left the page as a title and a whisper —
			indistinguishable at a glance from this page's own empty state, which
			is the reading that gets an operator to go back to bed at 3am. A
			request that FAILED is a different fact from one that succeeded and
			returned nothing, and `ErrorState` is the object that says so.
		-->
		<ErrorState
			error={query.error}
			subject="this app"
			backHref="/apps"
			backLabel="Back to all apps"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
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
		<!-- ═══ THE VERDICT LINE. No card. ══════════════════════════════════
		     `mb-5`, not `mb-6`: the head band is the same everywhere — the
		     container's 24px `py-6`, ONE head row, and 20px to the first
		     content. See `src/lib/CLAUDE.md`. -->
		<section class="mb-5">
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
		{:else if bannerStory}
			<!-- ⭐ THE SAME OBJECT, THE SAME WORDS, AS ROLLOUT DETAIL. Whatever
			     `Investigate` takes you to now agrees with what you clicked.
			     The SCOPE is this page's own — see `bannerStory`: one cause
			     holding three environments is headlined as three. -->
			<BlockingStoryPanel story={bannerStory} showRules={!bannerRulesDrawn} class="mb-6" />
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
			<div class="ab-grid {hasAct ? '' : 'ab-grid--noact'} {hasRail ? '' : 'ab-grid--norail'}">
				<!-- ── ACT ──────────────────────────────────────────────────
				     THE WRAPPER OWNS THE GRID AREA, not the `Card`. Svelte's
				     scoped CSS is compiled per component, so `.ab-act` passed
				     through a child's `class` prop would land on an element that
				     never carries this component's scoping hash and the grid
				     area would silently not apply. -->
				{#if hasAct}
				<div class="ab-act flex flex-col gap-4">
					{#if decisions.length > 0}
					<Card
						icon={ExclamationCircleSolid}
						iconClass={taskCount > 0
							? 'text-amber-600 dark:text-amber-400'
							: 'text-gray-500 dark:text-gray-400'}
						title="Needs you"
						verdict="{taskCount} environment{taskCount === 1 ? '' : 's'}"
						verdictTone={taskCount > 0 ? 'adverse' : 'neutral'}
						padded={false}
					>
						<!-- ⛔ THERE IS NO EMPTY BRANCH ANY MORE. The card renders
						     only when it has rows; see `hasAct`. A card whose body is
						     one sentence saying nothing is wrong was the page's most
						     prominent object spent on absence. -->
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each decisions as t (t.id)}
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
													<!-- ⛔ IT WAS `−{'{'}N{'}'}`, AND THAT SPELLING IS DEAD.
												     (2026-09-01) `env-rank.ts`: *"a signed integer
												     beside a build id reads as a diff and names no
												     unit"* — every other surface in the product
												     already says `N behind`, and this was the last
												     `−N` left. The minus also claimed a DIRECTION
												     the number does not have: it is a count of
												     upgrades this environment can still take, not a
												     negative quantity.

												     THE UNIT IS A SECOND LINE, NOT A LONGER STRING.
												     A 24px numeral over a 10px `t-label` names the
												     unit, keeps the mark a MARK, and buys a real
												     24 → 10 range inside a row that was otherwise
												     flat. The glyph column's floor moves 29 → 46px
												     to fit `behind`, uniformly, so the chip column
												     still starts at the same x on every task —
												     which is the whole reason that floor exists. -->
													<span
														class="tk-glyph tk-glyph--stat text-gray-500 dark:text-gray-400"
														title={rankTitle(
															rankByCell.get(f.cell) ?? { kind: 'unknown' },
															f.title
														)}
													>
														<span class="tk-glyph-num t-display-id">{f.rank}</span>
														<span class="tk-glyph-unit t-label">behind</span>
													</span>
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
											<!-- ⭐ ONE LINE, NOT THREE — and the component decides
										     that now, not this page. (2026-08-30) A gate block's
										     consequence is one clause; the long two-clause form
										     wrapped to two lines here and, with the `rule:` handle
										     under it, spent three rendered lines on one fact. The
										     `compact` prop that used to say so is GONE: two of five
										     callers passed it, so one object said one fact two ways
										     in one product. See `form` in `BlockReason.svelte`. -->
											<!-- ⭐ EVERY GATE, NOT THE FIRST ONE THAT MATCHED.
										     `BlockReason` returned one branch — `pinned`, then
										     `awaiting`, then `notPassing` — so PROD, held by an
										     environment-controller gate, an approval gate AND a
										     failing schedule gate, printed one line about the
										     approval and captioned the controller's gate `Needs a
										     person to approve`. Nobody can approve that object. -->
											{#if t.gate}
												<div class="tk-gate min-w-0">
													<BlockingStoryLines story={f.story} />
												</div>
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
															class="btn {t.id === primaryTaskId && mi === 0 ? 'btn-primary' : 'btn-secondary'}"
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
															class="btn {t.id === primaryTaskId ? 'btn-primary' : 'btn-secondary'}"
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
													<!-- NAVIGATION, NOT AN ACTION. See `openRollout`. -->
													{@render openRollout(f)}
												{:else if t.kind === 'held'}
													<!-- ⛔ THIS OPENED `Change Version`, WHICH CANNOT
												     CLEAR A PIN. The button named the act and then
												     did not perform it; the real control was two
												     pages away on rollout detail. It performs it
												     now, through the same dialog rollout detail
												     uses — including the sentence that says whether
												     anything will actually move once the pin is off.

												     `Pick a different version` stays beside it,
												     because moving the pin is the other real answer
												     and it is NOT what "release the hold" means. -->
													<button
														type="button"
														class="btn {t.id === primaryTaskId ? 'btn-primary' : 'btn-secondary'}"
														onclick={() => openReleaseHold(f.cell)}
													>
														<LockOpenOutline />
														Release the hold
													</button>
													<button
														type="button"
														class="btn btn-secondary"
														onclick={() => openChangeVersion(f.cell)}
													>
														<EditOutline />
														Pick a different version
													</button>
												{:else}
													<!-- THE DECISION FIRST, WHERE THERE IS ONE. A stuck
												     environment whose every queued build is refused by
												     an approval gate is broken AND waiting on a person;
												     the way out is the person, so the filled control is
												     the act.
												     ⛔ AND WHERE THERE IS NO DECISION THE ROW HAS NO
												     PRIMARY. It used to promote `Investigate` to
												     `.btn-primary` on exactly that row — a filled blue
												     button for a page load, on the one row where
												     nothing can be done. Absence of an action is the
												     honest thing for a row to say; inventing a loud
												     control to fill the slot is what the human
												     rejected. -->
													{#if t.promoteTag}
														<button
															type="button"
															class="btn {t.id === primaryTaskId ? 'btn-primary' : 'btn-secondary'}"
															onclick={() => openPromote(f.cell, t.promoteTag, t.promoteVersion)}
														>
															<ArrowRightOutline />
															Deploy {t.promoteVersion ?? ''}
														</button>
													{/if}
													<!-- ROLLBACK IS OFFERED ONLY WHERE THE BUILD ITSELF
												     IS THE SUSPECT — a failed deploy, or one wedged
												     mid-bake or mid-deploy. An environment held by
												     an approval gate deployed perfectly well and is
												     waiting on the NEXT build; putting `Rollback`
												     on it offers to undo something that is not
												     wrong. -->
													{#if previousTag(f.cell) && buildIsSuspect(f)}
														<button
															type="button"
															class="btn btn-secondary"
															onclick={() => openRollback(f.cell)}
														>
															<ReplyOutline />
															Go back a version
														</button>
													{/if}
													{#if f.cell.sourceURL && f.version && (buildIsSuspect(f) || f.diverged)}
														<!-- ⛔ NARROWED TO THE ROWS WHERE THE RUNNING BUILD
													     IS ACTUALLY THE SUSPECT (2026-08-30) — the same
													     predicate `Go back a version` above already
													     uses, and for the same reason. An environment
													     stuck behind an approval gate DEPLOYED FINE:
													     its running build is not what a person is here
													     to look at, the QUEUE is, and offering to open
													     that build on GitHub is a third control on a
													     row whose decision is a two-way one. On a
													     failed or wedged deploy the build IS the
													     suspect and the button stays. -->
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
													<!-- NAVIGATION, LAST, AND NOT A BUTTON. See
												     `openRollout`. The order in this row is now a
												     CLASSIFICATION and not a ranking: everything that
												     writes to the cluster, then the ways out that only
												     change what you are looking at. -->
													{@render openRollout(f)}
												{/if}
											</div>

											<!-- THE FOOT NOTE, NOW USUALLY ABSENT. See `footNote`.
										     The sha, the pod count and the `automatic` trigger
										     went on 2026-08-27; STALENESS and the NAMESPACE LINK
										     went on 2026-08-30.

										     ⛔ THE NAMESPACE LINK WAS A SECOND CONTROL AIMED AT
										     THE FIRST ONE'S TARGET. Its `href` was
										     `rolloutHref(f.cell)`, character for character the
										     `Investigate` button's — a bare-text link to the same
										     page as a 14px button 40px above it, on a row the
										     human counted eleven elements on. The namespace STRING
										     is not a fact this page owes a reader either: the app
										     name and the environment already name the rollout, and
										     the page it opens prints its own namespace in the
										     breadcrumb.

										     What can still print here is STALENESS on a failed
										     deploy that no `stuck` chip covers, and `by <name>`
										     when a PERSON triggered the deploy. Both are
										     deviations. The whole `<p>` disappears otherwise. -->
											{#if foot.state || foot.source}
												<p
													class="tk-foot t-code-sm flex min-w-0 flex-wrap items-baseline gap-x-4 text-gray-500 dark:text-gray-400"
												>
													{#if foot.state}
														<span class="min-w-0 truncate">{foot.state}</span>
													{/if}
													{#if foot.source}
														<span class="tk-foot-src truncate">{foot.source}</span>
													{/if}
												</p>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
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
					{/if}

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
					{#if loneWaitGroups.length > 0}
						{@const waitEnvs = loneWaitGroups.reduce(
							(n, g) => n + g.members.reduce((m, t) => m + t.members.length, 0),
							0
						)}
						<Card
							icon={ClockSolid}
							title="Waiting, nothing to do"
							verdict="{waitEnvs} environment{waitEnvs === 1 ? '' : 's'}"
							verdictTitle="On hold behind a check or a deploy window. These clear on their own."
							padded={false}
						>
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each loneWaitGroups as g (g.id)}
									<li class="px-4 py-3">
										<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
											<!-- ⭐ THE SET, NOT N ROWS. Promotion order, and every chip
											     is the link to its own rollout — the affordance the
											     namespace link used to carry at 11px, moved onto the
											     object that names the subject. `PromotionPipeline`
											     already wraps this exact chip in this exact anchor
											     200px below, so it is the page's own idiom and not a
											     new one. -->
											<span class="flex min-w-0 flex-wrap items-center gap-1.5">
												{#each g.members as m (m.id)}
													<a
														href={rolloutHref(m.lead.cell)}
														class="wg-env flex min-w-0"
														title="Open the {m.lead.title} rollout"
													>
														<Chip
															role="env"
															theme={m.lead.cell.theme}
															label={m.lead.label}
															wide
														/>
													</a>
												{/each}
											</span>
											<span class="t-dense min-w-0 text-gray-500 dark:text-gray-400">
												{g.candidates} newer version{g.candidates === 1 ? '' : 's'} ready
											</span>
											<!-- ⭐ THE ONE NAVIGATION THAT IS WORTH A CONTROL, AND IT
											     GOES WHERE THE PROBLEM IS. (2026-09-02) The row used
											     to end in a link to this app's own namespace — which
											     is not where anything is wrong. When a dependency
											     contract is the cause, the thing to go and look at is
											     the PROVIDER, and until now the product named it in a
											     sentence and offered no way to reach it.

											     IT IS A LINK AND LOOKS LIKE ONE. *"A control that only
											     changes what you are looking at is navigation and must
											     look like navigation."* Same 11px chevron idiom as the
											     reference page's `Show 8 ready resources ›`. -->
											{#if g.providerHref}
												<a
													href={g.providerHref}
													class="t-micro ms-auto inline-flex shrink-0 items-center gap-0.5 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
													title="Open {g.provider}, the app this is waiting on"
													>{g.provider}<ChevronRightOutline
														class="h-3 w-3 shrink-0"
													/></a
												>
											{/if}
										</div>
										<!-- The whole point of this card is that NOTHING has to be
										     done here, so the line that says WHY is the only thing
										     it owes the reader. Same object as everywhere else. -->
										<!-- ⚠️ AND THE SHORT FORM STOPPED RESTATING THIS CARD'S
										     TITLE. It used to read `Clears on its own` under a
										     header that says `Waiting, nothing to do` — an object
										     drawing the norm, once per row. It names the check or
										     the window now, which is the half the long line had
										     and the surround does not. -->
										<!-- ⚠️ `g.story`, NOT the lead's. On a folded row the
										     environment-controller's *"waiting for dev to deploy it
										     first"* clause is stripped: it is the PIPELINE, it is
										     true of every member below the first, and it is already
										     drawn as an ordered LINE by `PromotionPipeline`. What
										     survives is the cause the whole set shares. -->
										<!-- ⛔ AND NOT AT ALL WHEN THE BANNER IS ALREADY SAYING IT.
										     (2026-09-02) On `hello-frontend-app` the banner read
										     *"Nothing promotes itself until hello-api-app ships a
										     newer api than 1.66.0. › Details"* and this row, 40px
										     below, read *"Waiting for hello-api-app to ship a newer
										     api — it is on 1.66.0 › Details"*. One fact, two
										     objects, two disclosures onto the same gate handles —
										     the repetition defect that was cut out of the alert
										     banners two commits ago, reappearing between a banner
										     and a card.

										     THE DIVISION THIS PAGE ALREADY DOCUMENTS: *"the banner
										     states the single worst fact and its CAUSE; the SET of
										     things is the card below."* So the card keeps the SET —
										     the environment chips, the count, the way to the
										     provider — and stops restating the sentence. That is
										     also what the reference page does: rollout detail
										     prints the gate sentence ONCE in its banner, and its
										     `Available Version Upgrades` card carries the CANDIDATE
										     and a compact `Held by a gate` mark instead.

										     It comes straight back when the banner is speaking for
										     a different cause, or for a pin or a failure rather
										     than a gate. -->
										{#if g.id !== bannerCauseKey}
											<BlockingStoryLines story={g.story} />
										{/if}
									</li>
								{/each}
							</ul>
						</Card>
					{/if}
				</div>
				{/if}

				<!-- ── THE PIPELINE — criteria 2 AND 3, IN THE MAIN COLUMN ──
				     > *"App with no issues looks weird, like something is missing."*

				     ⛔ THIS OBJECT USED TO BE A 340px RAIL CARD CALLED
				     `Where it’s running`, AND THAT IS THE WHOLE BUG. Two of the three
				     questions `PAGE-CRITERIA.md` §03 puts to this page — *which env
				     runs what, and how far back*, *is its prod fleet consistent* — were
				     answered in a sidebar at 11px, while the main column spent its
				     entire width on a reverse-chronological log. On an app with
				     nothing wrong the act column does not render, so what was left was
				     the log and the sidebar, and half the viewport below them. A log is
				     what you read when you already know what you are looking for; it is
				     not a shape, and it cannot lead a page.

				     ⭐ SO THE SUBJECT TAKES THE MAIN COLUMN, IN EVERY STATE. Nothing is
				     added for the healthy case and nothing is removed for the alarmed
				     one: the banner still leads when there is a blocking fact, `Needs
				     you` still sits under it, and the pipeline is the object both of
				     them are ABOUT. A healthy app is the same page with the alarm
				     absent — an unbroken run of status circles down to the last
				     environment and a green `3 of 3 up to date` in the header's rollup.
				     That is a MEASUREMENT, not a reassurance: a fraction proves what a
				     sentence could only claim, and the human has rejected the sentence
				     on this page by name.

				     The rollup, the icon and the 47px header are `Card`'s, i.e. the
				     reference page's; the body is `PromotionPipeline`, which is the
				     reference page's `Deployment Pipeline` with environments as the
				     steps. See that component for why a settled station keeps its
				     circle here and loses it in `StageChain`. -->
				<div class="ab-pipe min-w-0">
					<Card
						icon={ChevronDoubleRightOutline}
						title="Promotion pipeline"
						verdict={stateCount}
						verdictTone={stateOnNewest ? 'good' : 'neutral'}
						verdictTitle="Environments running the newest version this app has"
					>
						<PromotionPipeline
							stages={chainNodes}
							hops={pipeHops}
							{entryHop}
							fleet={fleetNodes}
							fleetHop={pipeFleetHop}
							{fleetVerdict}
							{frontier}
						/>
					</Card>
				</div>

				<!-- ── STATE — THE RAIL, AS THE GRAMMAR DEFINES ONE ──────────
				     §7: *"Main column plus a rail of INDEPENDENT cards … each is
				     self-contained with its own header and rollup. The rail is not a
				     sidebar of scraps; it is a stack of small complete answers."* The
				     reference page's rail is four such cards. This one was ONE card
				     holding the page's whole answer plus two unheaded sub-sections;
				     with the chain moved out, what remains gets the treatment the
				     grammar specifies — a titled card each, with its own rollup. -->
				{#if hasRail}
				<div class="ab-state flex flex-col gap-4">
					<!-- ⭐ THE ONE WAY OFF THIS PAGE WHEN NOTHING IS WRONG. Every link
					     to the source lived on a BUTTON inside a task, and a healthy app
					     has no tasks — so the page that says an app is fine offered no
					     route to the code it is fine about. `External Links` is the
					     reference page's own first rail card and this is that card. It
					     renders only when the rollouts actually carry a source. -->
					{#if sourceRepos.length > 0}
						<Card icon={LinkOutline} title="Source" padded={false}>
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each sourceRepos as r (r.url)}
									<li>
										<a
											href={r.url}
											target="_blank"
											rel="noopener noreferrer"
											class="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40"
											title={r.url}
										>
											<span class="t-dense min-w-0 truncate text-gray-900 dark:text-white"
												>{r.label}</span
											>
											<ArrowUpRightFromSquareOutline
												class="ms-auto h-3 w-3 shrink-0 text-gray-500 dark:text-gray-400"
											/>
										</a>
									</li>
								{/each}
							</ul>
						</Card>
					{/if}

					<!-- ⭐ HOW IT'S GOING — the rail's second complete answer, and the
					     one the main column structurally cannot give. See the
					     derivation for why `Furthest behind` — the row both sibling
					     pages carry — is deliberately not here.

					     THE ROLLUP IS THE LEAD TIME, not a third row: §1 makes the
					     right-aligned verdict the thing a reader takes WITHOUT reading
					     the card, and *"how long does a change take to reach
					     production"* is the answer this card owes at a glance. -->
					{#if hasCadence}
						<Card icon={ChartMixedOutline} title="How it’s going">
							<!-- ⭐ THE ROLLUP IS THE CADENCE, AND IT IS A MARK PLUS A
							     NUMBER. §1 makes the right-aligned verdict the thing a
							     reader takes WITHOUT reading the card; the reference page's
							     own header rollups are exactly this shape (`↑ 19`, `3/3
							     healthy`). The sparkline is the mark — the seven-day shape
							     of this app's deploys — and it may not be a ROW as well,
							     because then the number would print twice.

							     ⛔ AND NOT THE LEAD TIME. That was the first spelling and
							     it put an em dash in the header on every app whose retained
							     history has not yet carried one build the whole way — which
							     is most of them. A card whose one-glance answer is `—` has
							     no answer; the em dash belongs in a ROW, where the label
							     beside it says what could not be measured. -->
							{#snippet rollup()}
								{#if deploys7d >= SPARK_MIN}
									<DeployVolumeSparkline
										rollouts={cells.map((c) => c.rollout)}
										days={SPARK_DAYS}
									/>
								{/if}
								<span
									class="t-code-sm whitespace-nowrap text-gray-500 dark:text-gray-400"
									title="{deploys7d} deploy{deploys7d === 1
										? ''
										: 's'} of this app across every environment in the last 7 days"
									>{deploys7d} in 7d</span
								>
							{/snippet}
							<dl class="space-y-3">
								<div class="flex items-baseline justify-between gap-3">
									<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
										<ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical deploy
									</dt>
									<dd
										class="t-headline text-gray-900 tabular-nums dark:text-white"
										title={medianBakeMs === null
											? 'No deploy of this app has a recorded start and end inside the history kept for it'
											: 'How long a deploy of this app usually takes to finish and be watched, measured across its whole history'}
									>
										{medianBakeMs === null ? '—' : formatDurationMs(medianBakeMs)}
									</dd>
								</div>
								<!-- `PAGE-CRITERIA.md`'s `/apps` criterion 3 — *"which ship
								     slowly? — lead time dev→prod"* — asked at app scope, and
								     the one measurement on this page that is about SPEED
								     rather than position. `—` where no build has been
								     observed at both ends inside the retained history:
								     never an estimate. -->
								<div class="flex items-baseline justify-between gap-3">
									<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
										<RocketSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical to prod
									</dt>
									<dd
										class="t-headline text-gray-900 tabular-nums dark:text-white"
										title={appLead === null
											? 'No version of this app has been seen in its first environment and then in production inside the deploy history kept for it'
											: `Median trip from ${appLead.fromLabel.toUpperCase()} to ${appLead.toLabel.toUpperCase()}, measured across ${appLead.samples} version${appLead.samples === 1 ? '' : 's'} observed at both ends`}
									>
										{appLead === null ? '—' : compactSpan(appLead.medianMs)}
									</dd>
								</div>
							</dl>
						</Card>
					{/if}

					<!-- EXPOSURE — AND IT DOES NOT RENDER WHEN THERE IS NOTHING TO
					     MEASURE. `/api/rollouts` carries no ready-pod counts; they come
					     from a per-rollout managed-resources call that answers nothing on
					     some clusters. The heading and the bar are guarded by the SAME
					     predicate, `hasExposure`, which lives in the component so the two
					     cannot disagree; the loading skeleton still shows while the answer
					     is on its way, because a pending fact is not an absent one. NO
					     NUMBER IS EVER INVENTED.

					     ⭐ IT IS A CARD NOW, not a sub-section under a `t-label` caption.
					     Its rollup is the percentage — the answer its own title asks for,
					     taken without reading the bar. -->
					{#if podsQuery.isLoading || hasExposure(exposure.newestPercent, exposure.segments)}
						<Card
							icon={ChartMixedOutline}
							title="How much is on the newest"
							verdict={exposure.newestPercent !== null ? `${exposure.newestPercent}%` : null}
							verdictTone={exposure.newestPercent === 100 ? 'good' : 'neutral'}
							verdictTitle="Share of this app's running pods on the newest build"
						>
							<ExposureBar
								segments={exposure.segments}
								totalPods={exposure.totalPods}
								newestPercent={exposure.newestPercent}
								unknownEnvironments={exposure.unknown}
								loading={podsQuery.isLoading}
							/>
						</Card>
					{/if}
				</div>
				{/if}

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
							<!-- THE CARD'S ANSWER, HARD RIGHT — `COMPOSITION-GRAMMAR.md` §1.
							     This card was the only region on the page with a header and
							     NO rollup, i.e. half the pattern: a reader could not take
							     its answer without reading a row of it. The answer a
							     history card owes is HOW MUCH history there is. -->
							<span class="t-code-sm text-gray-500 dark:text-gray-400"
								>{deployEvents} deploy{deployEvents === 1 ? '' : 's'}</span
							>
							<a
								href="/activity"
								class="t-micro text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
								aria-label="View all activity"
								>view all ›</a
							>
						{/snippet}
						<ActivityRail
							rollouts={cells.map((c) => c.rollout)}
							{environments}
							limit={activityLimit}
							{localClusterName}
							showAppName={false}
							chrome={false}
						/>
						<!-- ONE CONTROL FOR THE TAIL, and it disappears once the tail is
						     open — a button that says `show 0 more` is an object drawing
						     the norm. Same shape and same voice as the reference page's
						     `Show 8 ready resources ›`. -->
						{#if !activityExpanded && deployEvents > ACTIVITY_SHOWN}
							<button
								type="button"
								class="t-micro mt-3 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
								onclick={() => (activityExpanded = true)}
								>Show {Math.min(deployEvents, 40) - ACTIVITY_SHOWN} earlier deploys ›</button
							>
						{/if}
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

		<ClearPinModal
			bind:open={clearPinOpen}
			rollout={clearPinRollout}
			cluster={clearPinCluster}
			onSuccess={() => query.refetch()}
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
			'pipe'
			'state'
			'hist';
		gap: 24px;
		align-items: start;
	}

	.ab-act {
		grid-area: act;
	}
	.ab-pipe {
		grid-area: pipe;
	}
	/* NO ACT COLUMN → NO ACT ROW. Left as a template area with no element in
	   it the grid still spends a 24px gap on a row of zero height, which is a
	   visible seam under the page header on exactly the page that is supposed
	   to look calm. The pipeline takes the slot instead — which is the whole
	   point of moving it here: on a healthy app the page's LEAD is the app's
	   own chain, not a log. */
	.ab-grid--noact {
		grid-template-areas:
			'pipe'
			'state'
			'hist';
	}
	.ab-state {
		grid-area: state;
	}
	.ab-hist {
		grid-area: hist;
	}

	/* The study's own breakpoint. Above it the rail is a fixed 340px and the
	   main column runs tasks → pipeline → history down the 1fr track.

	   MOBILE ORDER IS DELIBERATE AND DIFFERENT: act → pipe → state → hist, so
	   a phone gets the decisions, then the chain, then the rail's small
	   answers, and the ten-row log last. The chain is what a reader came for
	   and it may not sit below a screenful of timestamps. */
	@container (min-width: 860px) {
		.ab-grid {
			grid-template-columns: minmax(0, 1fr) 340px;
			grid-template-areas:
				'act state'
				'pipe state'
				'hist state';
			column-gap: 24px;
		}
		.ab-grid--noact {
			grid-template-areas:
				'pipe state'
				'hist state';
		}
		/* ⛔ AND NO 340px TRACK WHEN THE RAIL IS EMPTY. See `hasRail`. */
		.ab-grid--norail {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'act'
				'pipe'
				'hist';
		}
		.ab-grid--noact.ab-grid--norail {
			grid-template-areas:
				'pipe'
				'hist';
		}
	}

	/* ── A CHIP THAT IS A DESTINATION SAYS SO ON HOVER ───────────────────
	   The waiting row's environment chips ARE the links to their rollouts, so
	   they need the affordance the 11px namespace link used to carry. Opacity
	   only: the chip's own identity hue is the one thing that may not move,
	   and this adds no colour value to a page with a closed budget. */
	.wg-env {
		border-radius: 4px;
		transition: opacity 120ms ease;
	}
	.wg-env:hover {
		opacity: 0.75;
	}
	.wg-env:focus-visible {
		outline: 2px solid var(--color-blue-600);
		outline-offset: 2px;
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
			'gate'
			'why'
			'act'
			'foot';
		align-items: start;
		column-gap: 16px;
		row-gap: 8px;
	}
	/* THE WHY LINE IS PLACED, NOT AUTO-FLOWED. Left to auto-placement it fell
	   into the first free implicit cell, which after the desktop template put
	   `why` and `act` on one row was the row BELOW the buttons — so the row
	   read chips, then the evidence and the action, then the reason for both.
	   It belongs under the chips it explains. */
	.tk-gate {
		grid-area: gate;
		min-width: 0;
	}

	/* A task with no build list — a failed deploy, a pin, a diverged
	   environment — loses the band rather than reserving an empty one. */
	.tk--nobody {
		grid-template-areas:
			'id'
			'gate'
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
		/* ⚠️ 29 → 52px (2026-09-01), AND THE GLYPH RIGHT-ALIGNS IN IT.
		   `−N` became a numeral over its unit, and `behind` at `t-label`
		   measures **51.61px** in-browser (10px/600, 0.16em tracking — measured
		   with `getBoundingClientRect`, not estimated). The floor moves for
		   EVERY task, not just the ranked ones, because a per-task floor is
		   what keeps the chip column at one x down the panel — the exact
		   stepping the note below warns about.

		   RIGHT-ALIGNED, because a 52px track left-aligning a 14.22px `!` put
		   50px between the mark and the row it marks. Aligning the glyphs to
		   the track's RIGHT edge puts every mark — `!`, `·`, the stat — a
		   constant 12px from the chips, which is the relationship that matters;
		   the left edge of a one-character glyph is not a thing a reader
		   tracks. */
		grid-template-columns: minmax(52px, auto) minmax(0, 1fr);
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
		justify-self: end;
		text-align: right;
	}
	.tk--circle .tk-glyph {
		line-height: 32px;
	}
	/* THE STAT FORM — a numeral over its unit. The 20px line box above still
	   governs the NUMERAL, so the digit centres on the chip band exactly as
	   `−N` did; the unit hangs below it and is the only thing that grew. */
	.tk-glyph--stat {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	/* The 20px line box has to be RESTATED here. It used to be inherited
	   because `tk-glyph` and `t-display-id` were the same element and a scoped
	   rule beats an unlayered class; split across two elements the child's own
	   `.t-display-id { line-height: 1.15 }` wins again and the digit stops
	   centring on the chip band. */
	.tk-glyph-num {
		display: block;
		line-height: 20px;
	}
	.tk-glyph-unit {
		display: block;
		margin-top: 2px;
		line-height: 1.2;
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
			grid-template-columns: minmax(52px, auto) auto minmax(0, 1fr);
			grid-template-areas: 'glyph chips reason';
		}
		.tk-reason {
			align-self: center;
		}
	}

	/* THE SUMMARY LINE SITS LEVEL WITH THE FIRST BUTTON, at every height the
	   block can take. `why` and `act` share a row from 620px up, and the row's
	   height is now whichever of the two is taller — which changed three times
	   in one pass: a closed summary (15px) under a button row (38px), an OPEN
	   ledger (400px) beside two buttons, and a folded `PROD ×10` task whose
	   buttons wrap to two rows beside a closed summary.

	   Centring the cell fixes only the first; pinning it fixes only the
	   second. A 38px FLOOR with the content centred inside it fixes all three:
	   38 is the measured `.btn` height, so a one-line summary lands on the
	   button's own centre, and anything taller than 38px simply exceeds the
	   floor and centres in its own box, which is a no-op. */
	.tk-why {
		grid-area: why;
		align-self: start;
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 38px;
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
			/* ⛔ THE `why` TRACK HAS A FLOOR NOW (2026-08-30). It was
			   `minmax(0, 1fr)`, which was survivable while the waiting builds
			   were a multi-line block that could compress — a folded `PROD ×10`
			   task carries FOUR region buttons plus `+6 more` in the `auto`
			   track, and on `edge-mesh` the 1fr collapsed to ~110px. Now that
			   `why` is ONE LINE and that line is the fact the ledger was reduced
			   to, collapsing it truncates the fact: measured, it rendered
			   `1 version ready · 1…`. 240px holds `N versions ready · oldest Nd
			   ago` at 11px, and past that floor the BUTTONS wrap instead, which
			   they are already laid out to do. */
			grid-template-columns: minmax(min(100%, 240px), 1fr) auto;
			grid-template-areas:
				'id id'
				'gate gate'
				'why act'
				'foot foot';
			align-items: center;
		}
		.tk--nobody {
			grid-template-areas:
				'id act'
				'gate gate'
				'foot foot';
		}
		.tk-act {
			justify-content: flex-end;
			/* PINNED TO THE TOP OF ITS ROW, not centred in it. `why` and `act`
			   share a row and `why` now OPENS: with the ledger expanded to 19
			   builds the row is ~400px tall and centred buttons floated halfway
			   down it, 200px from the line that names what they act on. Collapsed
			   the row's height IS the button height, so this changes nothing
			   there — the summary stays optically level with the labels. */
			align-self: start;
		}
	}
</style>
