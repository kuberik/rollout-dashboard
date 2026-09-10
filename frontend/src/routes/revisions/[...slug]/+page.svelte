<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, githubAbsenceSentence } from '$lib/api/github';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	import { repoBody, revisionPath, displayVersionForTag, shortRevision, repoSlug } from '$lib/version-utils';
	import { getDisplayVersion } from '$lib/utils';
	import { rolloutPath } from '$lib/source-dashboard';
	// THE PRODUCT'S ONE RANK VOCABULARY. This page prints exactly one of its
	// words — `unreleased` — and it takes it from here rather than spelling it.
	// ⛔ LANE 9, ROUND 11 QA, ITEM 10 — `rankRole`/`RankVerdict` DELETED, dead
	// (eslint-reported, unreferenced anywhere else in this file).
	import { rankLabel } from '$lib/view-models/env-rank';
	import { detectRollback } from '$lib/rollout-cards';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import {
		buildRevisionLedger,
		findRow,
		rankSentence,
		ladderPositionLabel,
		resolveRevision,
		leadRowsFor,
		releaseLines,
		serviceLedger,
		matchesRevisionText,
		restRows,
		pastRows,
		type RepoLedger,
		type RevisionRow,
		type RevisionService,
		type RevisionSlot
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageWeight,
		weightFill,
		coverageSwatch,
		releaseSplit,
		slotBakeStatus,
		heldBehind,
		coverageBarSegments,
		coverageBarLabel,
		coverageCells,
		releaseHeldClause,
		repoHeroCoverage as coverageForServices,
		releaseSplitSentence,
		type CoverageKey,
		type CoverageSlotVM,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import BuildLists from '$lib/components/BuildLists.svelte';
	import HeldBanner from '$lib/components/HeldBanner.svelte';
	import RepoLedgerCard from '$lib/components/RepoLedgerCard.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	// ⭐ REVISIONS-2026-09-06 ROUND 5, ITEM 2 (IN-FLIGHT DETAIL, blocking) — THE
	// DEPLOYING ROW'S OWN WORD. `bakeWord` is `bake-status.ts`'s one exported
	// verb table (`Deploying` → `deploying`, `InProgress` → `checking` — the
	// file's own header comment records why `baking` was retired from every
	// user-facing surface in 2026-08-30; this row must not reinvent it).
	import { bakeWord, bakeTitle } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import {
		joinClauses,
		buildGateContext,
		blockingStory,
		type GateContext,
		type BlockingStory
	} from '$lib/view-models/blocking-story';
	// ⭐ THE OVERVIEW'S OWN WORDS. `GateRecord`'s `Kind` row already calls this
	// for `RulePopover`/`BlockingStoryPanel`, so a rule labelled here cannot
	// say something the Overview banner for the same rollout would disagree
	// with. See the `reasonsFor` notes below (finding 1, finding 4). The
	// `GateRecord` disclosure this comment used to describe (`bannerEnvSections`)
	// was Round 11's own dead code, deleted when `HeldBanner` replaced it — only
	// `gateMark` survives from this import.
	import { gateMark } from '$lib/components/GateRecord.svelte';
	import { countLabel } from '$lib/disclosure';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		formatDate,
		detectStuck,
		detectStuckBehind
	} from '$lib/utils';
	// ⭐ THE SAME THREE-STEP STUCK DERIVATION `/apps/<name>` USES (operator-walk
	// finding 3) — see `stuckFor` below for why `CoverageSlotVM.stuck` alone is
	// not trustworthy for the badge this page draws.
	import { detectStuckPromotion } from '$lib/view-models/promotion';
	// ⭐ "ABSENCE IS NOT EVIDENCE" — `status.history` is capped at
	// `spec.versionHistoryLimit`, so a build not found there may simply have
	// aged out. See `historyLimitNote` below (operator-walk finding 2).
	import { historyAtLimit } from '$lib/history-marks';
	import { isEventStreamHealthy } from '$lib/api/events';
	import { now } from '$lib/stores/time';
	import { shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import { sortEnvironmentNames } from '$lib/env-order';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowRightOutline,
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		ChevronRightOutline,
		CheckCircleSolid,
		ClockOutline,
		CodeBranchOutline,
		ExclamationCircleSolid,
		FolderOutline,
		HourglassOutline,
		LayersOutline,
		LockOpenOutline,
		LockSolid,
		QuestionCircleOutline,
		RefreshOutline,
		RocketOutline,
		TagOutline,
		TagSolid,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	// ⛔ LANE 9, ROUND 11 QA, ITEM 10 — `AlertPanel`/`FactList` DELETED, dead
	// (eslint-reported): neither is rendered anywhere in this file — the
	// blocking fact and the fact list are `HeldBanner`'s and `BuildLists`'
	// own components now.
	import Card from '$lib/components/Card.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import ClearPinModal from '$lib/components/ClearPinModal.svelte';
	import { CLEAR_PIN_LABEL } from '$lib/components/pin-copy';
	// ⭐ ITEM 3 (2026-09-06 critique) — THE DRAWN CONTRACT CLAUSE, NOT A FOURTH
	// PROSE SPELLING OF IT. `contractBlockReason` builds the same `provider →
	// contract → required range` relation `/dependencies` and `/apps` already
	// draw; `<BlockReason>` is the ONE renderer for it (`reason.subject` at
	// full ink, `subjectHref` when the provider is reachable, the
	// `[api|1.66.0] → [^1.67.0]` chip pair) so this page cannot spell the same
	// fact a fifth way.
	import BlockReason, { contractBlockReason } from '$lib/components/BlockReason.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import type { Rollout, Environment } from '../../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy, ApiError } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	// THE REPO, NOT THE URL IT IS FETCHED FROM — one spelling with `/versions`.
	import { repoTitle, repoTitleFull } from '../repo-title';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';

	/**
	 * ONE REVISION — RELEASE COVERAGE.
	 *
	 * The page's three questions, from `.agents-context/design/REVISION-PAGES.md`:
	 *
	 *   1. How far has this build reached across the fleet? → the hero count and
	 *      the coverage bar, `fleet-explore.js` concept 07 verbatim.
	 *   2. What is each service running it as? → `What each service ships it as`
	 *      gives each service ONE rank against ITS OWN denominator. `newest of 4`
	 *      beside `newest of 37` is the whole point: those two services share a
	 *      source repo and ship independent streams.
	 *   3. What is stopping it going further? → the `Not yet` card names the gate,
	 *      SAYS WHAT KIND IT IS, says when it clears if the cluster knows, links
	 *      to the rollout that is actually stuck, and carries `Promote` wherever
	 *      one is legal.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * ROUND FIVE — COMPOSED, NOT REARRANGED
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * The measured diagnosis (`COMPOSITION-GRAMMAR.md`): the page the human calls
	 * beautiful carries 115 SVG icons and 8px cards; this pair carried 0 and 1
	 * and got *"criminally underdesigned"*. Every rule the previous rounds
	 * enforced was a REDUCTION rule, and without a composition discipline they
	 * converge on small gray text in undifferentiated rows.
	 *
	 * So the page is now built from the grammar of the reference: TITLED CARDS
	 * with a 16px icon and a right-aligned rollup, a FILLED BANNER for the
	 * blocking fact with its 40px circular icon, BUTTONS AT 14px that look
	 * pressable, and a type range of 24 → 10.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * FOUR DEFECTS A LIVE UX CRITIQUE FOUND, AND WHAT THEY BECAME
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 *  1. *"`Not yet` rows link to `/apps/<name>`, not the stuck rollout. The
	 *     page knows the environment and discards it; DEV and STAGING resolve to
	 *     the same URL."* → every place row now links to
	 *     `/rollouts/<cluster>/<ns>/<name>`, the object the gate is attached to
	 *     and the page that can clear it. `rolloutRef` is carried on the slot.
	 *  2. *"Gates render as raw object names (`ghd-kw4lz`) with no type, owner or
	 *     clear-time — while rollout detail knows 'will be allowed in 2d 1h'."*
	 *     → `promotionBlock`'s STRUCTURAL split (allow-list published vs simply
	 *     not passing) now reaches the UI, each kind gets its own glyph and its
	 *     own sentence, and `api/schedules.ts` supplies the clear time from the
	 *     same endpoint `ScheduleStatus` reads.
	 *  3. *"The COVERAGE bar has two colours and no legend."* → the bucket cards
	 *     ARE the legend, and they always were; what was missing is that they
	 *     did not look like anything. Each bucket is now a titled card whose
	 *     header carries the bar's own fill as a 12px swatch, its name in 14px
	 *     semibold, and its count as the rollup. No dummy graphic, no key row:
	 *     the explanation is the object.
	 *  4. Revisions nobody has deployed had no page. → they do now
	 *     (`RepoLedger.pending`), and this page renders them unchanged: `0 of N
	 *     places live`, and the whole `Not yet` card naming the gates.
	 *
	 * WHAT THIS PAGE DELIBERATELY DOES NOT DO. No version ladder and no Gantt —
	 * both rejected, repeatedly. No `heat(rank)` ramp and no stable colour per
	 * sha: both recorded as measured-failed. The bar's segments are BUCKETS,
	 * four status hues the budget already owns, not ranks.
	 */

	/**
	 * ⭐ OPERATOR-WALK ROUND 4, ITEM B — "← All revisions" GOES BACK, WHEN
	 * BACK IS WHERE IT LEADS.
	 *
	 * `scroll-memory.ts` (root layout, 2026-09-05) already restores `<main>`'s
	 * scroll offset on a `popstate` arrival — Back/Forward — but a bare
	 * `<a href="/revisions">` is a forward, `pushState`-shaped navigation, so
	 * clicking this breadcrumb after scrolling `/revisions` 900px deep landed
	 * back at the top every time. `afterNavigate`'s `from` is the one moment
	 * this page can tell whether the PREVIOUS entry actually was the list
	 * (a client-side navigation FROM it) — a direct load, a refresh, or an
	 * arrival from anywhere else has no such entry, and `history.back()`
	 * there would leave the product entirely. `cameFromList` gates the two
	 * behaviours: `history.back()` when it is true (a real `popstate`, so
	 * `scroll-memory` fires), a plain link otherwise.
	 */
	let cameFromList = $state(false);
	afterNavigate((nav) => {
		cameFromList = nav.from?.route?.id === '/revisions';
	});

	// The route is /versions/[...slug]; the slug is "<repo path>/<key>" where
	// the repo path is real path segments and the key is the final one. The key
	// is a REVISION now, but every historical link put a display label there, so
	// the resolver below takes either and rewrites the URL.
	function safeDecode(s: string): string {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	}
	const parsed = $derived.by<{ repoPath: string; key: string }>(() => {
		const raw = (page.params.slug as string) || '';
		const parts = raw.split('/').filter((s) => s.length > 0);
		const keyRaw = parts.pop() ?? '';
		return { repoPath: parts.map(safeDecode).join('/'), key: safeDecode(keyRaw) };
	});
	const repoPath = $derived(parsed.repoPath);
	const urlKey = $derived(parsed.key);

	const query = createQuery(() =>
		rolloutsListQueryOptions({
			// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see RolloutGrid.svelte).
			options: {
				staleTime: staleTimeWhenHealthy(10000, 30000),
				refetchInterval: pollWhenHealthy(10000, 60000)
			}
		})
	);
	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));

	/**
	 * ⭐ ROUND 11, B.1 — RESOLUTION ORDER: THE WHOLE SLUG AS A REPOSITORY
	 * FIRST. `/revisions/<repoSlug>` is the repository page now;
	 * `/revisions/<repoSlug>/<key>` stays the build page. A repository's own
	 * last path segment is never a 12-char hex slug in practice, so the
	 * order has to be deterministic — match the WHOLE raw slug against
	 * every ledger's own `repoBody` FIRST, before ever popping a segment
	 * off for a build key. Only once that whole-slug match fails does the
	 * route fall back to `parsed` (below), which pops the last segment and
	 * resolves it as a build.
	 */
	const wholeSlugPath = $derived.by<string>(() => {
		const raw = (page.params.slug as string) || '';
		return raw
			.split('/')
			.filter((s) => s.length > 0)
			.map(safeDecode)
			.join('/');
	});
	const repoPageLedger = $derived.by<RepoLedger | null>(
		() => ledgers.find((l) => repoBody(l.repoKey) === wholeSlugPath) ?? null
	);
	/**
	 * The URL's LAST segment, un-popped — used only to guess which loading
	 * skeleton to draw before the fleet has answered (see the loading
	 * branch below). Heuristic, not authoritative: once `ledgers` is real,
	 * `repoPageLedger` is the only thing that decides the page's mode.
	 */
	function looksLikeBuildKey(seg: string): boolean {
		return /^[0-9a-f]{7,40}$/i.test(seg) || /^\d+\.\d+\.\d+/.test(seg);
	}
	const guessRepoPageWhileLoading = $derived.by<boolean>(() => {
		const raw = (page.params.slug as string) || '';
		const parts = raw.split('/').filter((s) => s.length > 0);
		if (parts.length === 0) return false;
		return !looksLikeBuildKey(parts[parts.length - 1]);
	});

	const ledger = $derived.by<RepoLedger | null>(
		() => ledgers.find((l) => repoBody(l.repoKey) === repoPath) ?? null
	);

	/**
	 * RESOLUTION: REVISION FIRST, THEN LABEL — and now across BOTH halves of the
	 * ledger. A 12-char slug, a 7-char sha pasted from a terminal and a full
	 * 40-char revision all resolve as prefixes of the same string; a
	 * pre-migration link (`…/1.66.0-66`) resolves through the label map; and a
	 * build that has never been deployed resolves through `ledger.pending`
	 * rather than 404ing, which is what made eighteen of this repo's
	 * thirty-four revisions unreachable.
	 */
	const revision = $derived(resolveRevision(ledger, urlKey));
	const row = $derived.by<RevisionRow | null>(() => findRow(ledger, revision));
	/** True when no service has ever run this build. Changes the words, not the shape. */
	const neverDeployed = $derived(!!row && !!ledger && !ledger.rows.includes(row));
	const rowIndex = $derived(ledger && row ? ledger.rows.indexOf(row) : -1);
	const prev = $derived(ledger && rowIndex >= 0 ? (ledger.rows[rowIndex + 1] ?? null) : null);

	/**
	 * ⭐ ITEM 3 (round-8 critique) — "WHAT EACH SERVICE CALLS IT" WHEN
	 * NOTHING CALLS IT ANYTHING. Measured live on `064b655b5159`: all three
	 * services print the row's own sha as their `value` chip
	 * (`NEWEST 064b655` × 3) because none of them has a differing label —
	 * `svc.labelDiffers` (`revision-ledger.ts`'s own rule, "print the label
	 * only when it differs from the row's own identifier") was computed but
	 * never consulted at this call site. Guarding `value`/`valueTitle` on it
	 * stops the repeat; once nothing differs, the card is no longer
	 * answering "what does each service call it" — the honest question left
	 * is "where does this build sit on each service's own ladder", so the
	 * title and verdict follow this flag rather than staying captioned for
	 * a fact the card no longer states.
	 */
	const allLabelsMatchSha = $derived(!!row && row.services.every((s) => !s.labelDiffers));

	/**
	 * Canonicalise the URL once the revision is known, so an old label link and
	 * a short-sha link both settle on one address. `replaceState` rather than
	 * `goto`: this is the same page, and a redirect that pushes history makes
	 * the back button walk the resolution instead of leaving the page.
	 */
	$effect(() => {
		if (repoPageLedger || !ledger || !revision) return;
		const canonical = revisionPath(ledger.repoKey, revision);
		if (page.url.pathname !== canonical) replaceState(canonical, page.state);
	});

	// ⚠️ NOT COVERED BY THE CHANGE STREAM — GitHub connection state isn't an
	// informer-cached kind (`KNOWN_KINDS`), so nothing ever invalidates
	// `github-status`. It had no `refetchInterval` here, which meant it
	// silently inherited the app-wide default (`+layout.svelte`'s
	// `pollWhenHealthy(5000, 60000)`) — a 5s poll while the stream is down,
	// for a fact this page's own comment already calls session-scoped ("the
	// connection state does not change mid-visit"). `refetchInterval: false`
	// matches the other 3 call sites of this exact query
	// (`apps/[name]/+page.svelte`, `ChangeList.svelte`, `CommitSummary.svelte`).
	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const githubConnected = $derived(githubStatus.data?.connected ?? false);

	/**
	 * A COARSE CLOCK, DELIBERATELY — not `$now`, which ticks every 100ms.
	 * Bucketing calls `detectStuck`, whose thresholds are 1h and 24h, so a 30s
	 * clock is three orders of magnitude inside the shortest one.
	 */
	let coarse = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (coarse = new Date()), 30_000);
		return () => clearInterval(id);
	});

	// THE COVERAGE.
	const coverage = $derived(row ? revisionCoverage(row, coarse) : null);
	const rep = $derived.by(() => {
		const cell = row?.services[0]?.slots[0]?.cell;
		if (!cell) return null;
		return {
			ns: cell.rollout.metadata?.namespace ?? '',
			name: cell.rollout.metadata?.name ?? '',
			cluster: cell.sourceCluster ?? ''
		};
	});

	/**
	 * A CARD PER BUCKET, AND THE ICON IS THE BUCKET'S OWN MEANING.
	 *
	 * Five buckets, five glyphs, each one saying in a second channel what the
	 * swatch says in colour — which is how the bar reads with no legend and no
	 * dummy graphic. The human has rejected legends twice; a card that IS the
	 * explanation is not one.
	 */
	const BUCKET_ICON: Record<CoverageKey, typeof CheckCircleSolid> = {
		live: CheckCircleSolid,
		// ⭐ ITEM 10 (coverage contract, 2026-09-06) — `RefreshOutline` +
		// `tone-active`, the SAME glyph/hue pair `BuildStateMark.svelte`
		// (the list lane's own bucket icon) already ships for `deploying` —
		// blue is `Deploying`'s own colour product-wide, reused rather than
		// invented for a sixth in-flight spelling.
		deploying: RefreshOutline,
		failing: ExclamationCircleSolid,
		ahead: ArrowRightOutline,
		notYet: HourglassOutline,
		unplaceable: QuestionCircleOutline
	};

	/**
	 * ⭐ ROUND-4B REVIEW, ITEM 4 — THE `live` HEADER'S GLYPH IS A VERDICT,
	 * NOT A STATUS DOT. (2026-09-05, verified live on
	 * `github.com/littlechimera/kuberik-testing/6f9524e28087`:
	 * `hello-multi-app`'s DEV ran this exact build, pinned, two releases
	 * behind its own newest — and `Running it now` still drew a green check
	 * over `1 place`.) A green check says "this is the frontier"; a `live`
	 * bucket whose every occupant is BEHIND its own service's newest is the
	 * opposite fact and the row an operator actually has to look at, so it
	 * earns the same neutral glyph and ink `ahead` ("Already moved on")
	 * already uses for "not the frontier" — never a sixth spelling of that
	 * idea. `true` (frontier, keep green) whenever no service data is
	 * available yet, so this never flips the header before `coverage`/`row`
	 * resolve.
	 *
	 * ⭐ REVISIONS-2026-09-06 ROUND 5, ITEM 3 — AND NOT WHILE ANYTHING IS STILL
	 * DEPLOYING. `Running it now`'s green check is a claim that this build has
	 * SETTLED here; a bake in progress elsewhere on this same build is the
	 * identical "not done yet" fact the rank check above already earns the
	 * neutral glyph for. Checked first, and independent of rank, so a build
	 * that IS everyone's newest but still has one place mid-canary does not
	 * draw a premature green check — the same defect item 2 closed for the
	 * coverage count, one glyph over.
	 */
	const liveIsFrontier = $derived.by<boolean>(() => {
		if (!coverage || !row) return true;
		const deploying = coverage.buckets.find((b) => b.key === 'deploying');
		if (deploying && deploying.slots.length > 0) return false;
		const live = coverage.buckets.find((b) => b.key === 'live');
		if (!live || live.slots.length === 0) return true;
		const runningApps = new Set(live.slots.map((s) => s.appName));
		return row.services.some((svc) => runningApps.has(svc.appName) && svc.rank === 0);
	});

	// ── GATE CLEAR TIMES ────────────────────────────────────────────────────
	//
	// One GET per blocked rollout, cached by key, never blocking a render. The
	// endpoint is the one `ScheduleStatus` already reads and the arithmetic
	// lives in `api/schedules.ts` so the two surfaces cannot disagree about when
	// a window opens. Read-only.
	let windows = $state<Record<string, ScheduleWindow>>({});

	function slotKey(s: CoverageSlotVM): string {
		return s.rolloutRef
			? `${s.rolloutRef.cluster}/${s.rolloutRef.namespace}/${s.rolloutRef.name}`
			: '';
	}

	/**
	 * ⛔ NOT ONLY `notYet` ANY MORE. (2026-09-03, operator-walk BLOCKING item)
	 * `classify()` no longer routes a place on an OLDER release of this
	 * revision through `notYet` — it is `live`, correctly, because it IS
	 * running the revision. It still has exactly the same gate question a
	 * `notYet` place has (`onOwnRelease: false` on a `live` slot is the same
	 * evidence `revision-coverage.ts` computes `blockingGates` for now), so
	 * the banner below must keep seeing it or the disclosure — the rule
	 * names, the clock — silently vanishes the moment the false `Not here
	 * yet` count is fixed.
	 */
	const blockedSlots = $derived.by<CoverageSlotVM[]>(() => {
		if (!coverage) return [];
		const notYet = coverage.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
		const behind =
			coverage.buckets.find((b) => b.key === 'live')?.slots.filter((s) => !s.onOwnRelease) ?? [];
		return [...notYet, ...behind].filter((s) => s.blockingGates.length > 0);
	});

	/**
	 * ⭐ THE GATE JOIN TABLE, so the banner can ask `blocking-story.ts` the
	 * same classification question every other surface asks instead of the
	 * bare `notPassingGates.length > 0` coin-flip it used to run its icon on.
	 * Built from the same `/api/rollouts` payload as `/envs/<name>`'s and
	 * `/apps/<name>`'s own `gateContext`.
	 */
	const gateContext = $derived.by<GateContext>(() =>
		buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null,
			// This page never loads schedules, so a check gate is its final answer, not pending.
			schedulesExpected: false
		})
	);

	/**
	 * ⭐ ONE `blockingStory` PER BLOCKED PLACE, BUILT ONCE. (finding 1 + 2,
	 * coordinator sweep) `bannerFacts` and the rule-count trigger below need
	 * the SAME classified gates, not a second pass over raw gate-name
	 * arrays — that second pass is exactly how a `RolloutDependency`
	 * contract gate ended up captioned `Approval` here while the Overview
	 * banner for the identical rollout said `service contract`. One list,
	 * several consumers.
	 *
	 * ⛔ LANE 9, ROUND 11 QA, ITEM 10 — `bannerIcon` (the glyph-picking
	 * `$derived.by` that used to sit here, worst-first over these same
	 * stories via `iconForStory`) is DELETED, dead: nothing reads it —
	 * `HeldBanner` (round 11) draws its own icon now.
	 */
	const slotStories = $derived.by<{ slot: CoverageSlotVM; story: BlockingStory }[]>(() => {
		const out: { slot: CoverageSlotVM; story: BlockingStory }[] = [];
		for (const s of blockedSlots) {
			if (!s.rolloutRef) continue;
			out.push({
				slot: s,
				story: blockingStory(s.slot.cell.rollout, gateContext, { place: s.envLabel, now: $now })
			});
		}
		return out;
	});

	/**
	 * ⭐ THE RELEASE-LINE CLAUSE, AS ITS OWN SENTENCE. (2026-09-03,
	 * operator-walk BLOCKING item) `coverage.liveCount` of `coverage.totalCount`
	 * answers "does this place run the revision" — the head band's job. It
	 * says nothing about WHICH release, and folding that into the count is
	 * the defect this whole pass exists to close: a place on an older release
	 * sharing the revision is not "not here yet". `releaseSplit` is the
	 * missing half, read straight off the SAME `live` bucket, and this turns
	 * it into the sentence the head band prints under the count: *"3 of them
	 * on 2.66.0-66; 2.67.0-67 is held in dev, staging and prod."*
	 */
	const releaseSplitLines = $derived(coverage ? releaseSplit(coverage) : []);

	/**
	 * ⭐ THE HEAD BAND'S OWN CLAUSE — ONE SENTENCE, NO BARE `HELD` BESIDE A
	 * COUNT. (2026-09-03, operator-walk finding 4) `6 of 6 places running it`
	 * sat directly above a banner titled `9f10e49 is held` next to a chip
	 * reading `3 HELD` — true on their own terms (all six run the commit,
	 * three of them under an older, held release of it) but unreadable as a
	 * pair: the hero says "running", the banner says "held", and nothing ties
	 * the two counts together. This sums `releaseSplitLines`' own `held`
	 * lines — the same evidence the banner below is built from, never a
	 * second count of its own — so the two can never disagree.
	 */
	const headBandHeldCount = $derived(
		releaseSplitLines.filter((l) => l.held).reduce((n, l) => n + l.count, 0)
	);

	/**
	 * ⭐ ROUND 11 OPERATOR-WALK, FINDING 1 — `releaseHeldClause`, NOT A HAND-
	 * ROLLED "held from a newer release". This sha's held sibling is THIS
	 * SAME COMMIT under a newer label, never a second build — see that
	 * function's own doc comment, which is the exact wording this head
	 * band used to get wrong ("held from a newer release" implies a
	 * different commit exists ahead of this one; there is none).
	 */
	const headBandHeldClause = $derived(
		headBandHeldCount > 0
			? releaseSplitLines
					.filter((l) => l.held)
					.map(releaseHeldClause)
					.join('; ')
			: ''
	);

	/**
	 * ⭐ REVISIONS-2026-09-06 ROUND 5, ITEM 2 — THE HEAD BAND NAMES THE PLACE IN
	 * FLIGHT TOO. `8 of 9 places run this build` was silent on the ninth during
	 * a real canary — it is neither `live` (excluded from the numerator, see
	 * `revision-coverage.ts`'s own `classify()` doc) nor `notYet`, so the count
	 * alone made it look absent rather than in progress. Read off the same
	 * `deploying` bucket the bar/card already draw, never a second count.
	 */
	const headBandDeployingCount = $derived(
		coverage?.buckets.find((b) => b.key === 'deploying')?.slots.length ?? 0
	);

	/**
	 * ⭐ ROUND 11 OPERATOR-WALK, FINDING 2 — THE HERO SENTENCE NAMES A
	 * ROLLBACK TOO. Read off the same `live` bucket the "Running it now"
	 * card draws its own rollback chips from (`rollbackFor`), so the head
	 * band and the card can never disagree about which places arrived here
	 * via a rollback.
	 */
	const headBandRolledBackCount = $derived(
		coverage?.buckets.find((b) => b.key === 'live')?.slots.filter((s) => !!rollbackFor(s)).length ?? 0
	);

	$effect(() => {
		for (const s of blockedSlots) {
			if (s.notPassingGates.length === 0 || !s.rolloutRef) continue;
			const key = slotKey(s);
			if (windows[key]) continue;
			fetchScheduleWindow(s.rolloutRef.namespace, s.rolloutRef.name, s.rolloutRef.cluster)
				.then((w) => {
					windows = { ...windows, [key]: w };
				})
				.catch(() => {});
		}
	});

	/**
	 * ⭐ ITEM 1 (2026-09-06 round-7 critique) — THE BLOCKING CAUSE, DRAWN
	 * ONCE, LEADING THE DISCLOSURE. Measured live on `9f10e494d560`: the
	 * head-band's `2 rules in prod · 2 in staging · 1 in dev` disclosure
	 * expanded to FIVE equal `GateRecord` entries (`KIND service contract /
	 * RULE dependency-hello-frontend-needs-api`, `KIND promotion order /
	 * RULE ghd-9qcnj`, …) with zero links — a dependency contract and a
	 * promotion-order gate that clears itself once the contract does,
	 * printed as if they were the same kind of fact. The list page's own
	 * banner (`heldGateReason` there) already draws this correctly: the
	 * contract leads, in prose, with an `Open <service>` action. This is
	 * the same shape, reused rather than re-derived — `slotStories` already
	 * carries every classified gate this page needs; a dependency gate
	 * with a full provider/contract/have/need relation IS the current
	 * blocker (nobody clicks anything to clear it — a person has to ship
	 * the other service), so it is the first one found, across every
	 * blocked place, deduped by its own id.
	 */
	const primaryHold = $derived.by<{
		reason: NonNullable<ReturnType<typeof contractBlockReason>>;
		appHref: string | null;
		gateId: string;
	} | null>(() => {
		for (const { story } of slotStories) {
			const dep = story.gates.find(
				(g) => g.kind === 'dependency' && g.subject && g.contract && g.have && g.need
			);
			if (dep) {
				return {
					reason: contractBlockReason({
						provider: dep.subject!,
						contract: dep.contract!,
						requiredVersion: dep.need,
						providedVersion: dep.have,
						gateName: dep.id
					}),
					appHref: `/apps/${encodeURIComponent(dep.subject!)}`,
					gateId: dep.id
				};
			}
		}
		return null;
	});

	/**
	 * ⭐ ITEM 2 (2026-09-06 round-7 critique) — THE HEADLINE NAMES THE
	 * RELEASE AND THE SERVICE WHEN THE SHA CARRIES SEVERAL. `9f10e49 is
	 * held` was true and unhelpful the moment the sha resolved to two
	 * releases (`2.66.0-66`, running everywhere; `2.67.0-67`, held
	 * everywhere) — the bare sha does not say WHICH release is the one
	 * actually stuck. `releaseSplitLines`' own `held` line already carries
	 * the answer (`aheadLabel`), the same evidence the (now-removed)
	 * page-level sentence read — reused here rather than a second lookup.
	 */
	const bannerSubject = $derived.by(() => {
		const apps = [...new Set(blockedSlots.map((s) => s.appName))];
		return apps.length === 1 ? apps[0] : `${apps.length} services`;
	});
	const heldReleaseLabel = $derived(releaseSplitLines.find((l) => l.held)?.aheadLabel ?? null);

	/**
	 * ⭐ ROUND 11 CRAFT FINDING 7 — HELDBANNER TAKES A BARE `subject`
	 * (it composes "{subject} is held" itself); this is what the deleted
	 * `bannerTitle` (round 11 QA, item 10 — dead, nothing read it; `HeldBanner`
	 * composes the same sentence from `subject` itself) used to build, minus
	 * that suffix, so the two can never say a different subject for the
	 * same fact.
	 */
	const bannerBuildSubject = $derived(
		heldReleaseLabel ? `${bannerSubject} ${heldReleaseLabel}` : row?.short ?? ''
	);
	/** One `blockingStory` per DISTINCT held rollout, deduped the same way `repoHeldStories` is. */
	const distinctBuildStories = $derived.by<BlockingStory[]>(() => {
		const seen = new Set<string>();
		const out: BlockingStory[] = [];
		for (const { slot, story } of slotStories) {
			const key = slotKey(slot);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(story);
		}
		return out;
	});
	const buildHasSchedule = $derived(slotStories.some(({ story }) => story.iconKind === 'clock'));
	/** ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 — the places `distinctBuildStories` covers, for `HeldBanner`'s own `orderClause`. */
	const buildHeldEnvLabels = $derived([...new Set(blockedSlots.map((s) => s.envLabel))]);

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 5 (HOIST) — `numberWord` and
	 * `releaseSplitSentence` moved into `revision-coverage.ts` (imported
	 * above), so the repository page's own held banner can read the exact
	 * same rollback-aware grammar without this route growing a second copy.
	 * See that module's own doc comment for the rollback-flattening defect
	 * this function exists to avoid.
	 */

	/**
	 * ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — `HeldBanner`'s own
	 * `indefinite` prop existed (`heldExplanation`'s doc comment, above) but
	 * neither call site on this page ever PASSED it, so both banners kept
	 * defaulting to `false` and printing "N newer builds are waiting" for a
	 * hold no candidate can actually clear. A `dependency` gate with a known
	 * `have`/`need` pair IS that case by construction: the gate is blocking
	 * RIGHT NOW precisely because the provider's served version does not
	 * satisfy the required range, so there is nothing to "wait" for until
	 * someone ships one — the same fact `/apps/<provider>` and this banner's
	 * own `clause` (just fixed to state the range) already carry. One
	 * function, both call sites, so the repository and build pages cannot
	 * disagree about when a hold has no ETA.
	 */
	function storiesAreIndefinite(stories: BlockingStory[]): boolean {
		return stories.some((s) => s.upstream.some((g) => g.kind === 'dependency' && g.have && g.need));
	}

	/**
	 * ⭐ ITEM 2 (round-8 critique) — THE BANNER SENTENCE IS AT LEAST THE
	 * LIST'S. Measured live: the list page's own banner for this identical
	 * hold says `dev, staging and prod run 2.66.0-66; 2.67.0-67 is held in
	 * all three.` (`releaseSplitSentence`, `/revisions`' own script) — it
	 * names BOTH releases and where each one sits. This page's banner said
	 * only `hello-frontend-app is held in dev, staging and prod.`, which
	 * drops the running release entirely — less informative than the list
	 * for the same fact. `releaseSplitLines` is read off the same
	 * `revision-coverage.ts` evidence the list's own sentence uses, so the
	 * two can never disagree; this is the identical grammar, reused rather
	 * than re-derived; `own-view-model duplication is deliberate — this
	 * route does not own `revision-ledger.ts`/`+page.svelte` on `/revisions`.
	 */
	const bannerMessage = $derived.by(() => {
		if (!coverage || blockedSlots.length === 0) return '';
		// ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — `releaseSplitSentence`
		// (`revision-coverage.ts`, hoisted there round 11 item 5), not this
		// inline `.map` over `releaseSplitLines` — the inline form flattened
		// a rollback (see that function's own doc comment). Reads `coverage`
		// directly rather than the already-derived
		// `releaseSplitLines`, because it needs the raw slot each line's
		// `envLabels` had already discarded.
		if (releaseSplitLines.length > 0) {
			return releaseSplitSentence(coverage);
		}
		// ⭐ ITEM 4 (2026-09-06 critique) — `joinClauses`, NOT A BARE `.join(', ')`.
		// The head band's own release-split line already reads "dev, staging
		// and prod" (`joinClauses`, imported above); this banner said "dev,
		// staging, prod" — the same list, one comma short of the rest of the
		// page's grammar.
		const envs = joinClauses([...new Set(blockedSlots.map((s) => s.envLabel))].map((e) => e.toLowerCase()));
		const apps = [...new Set(blockedSlots.map((s) => s.appName))];
		const who = apps.length === 1 ? apps[0] : `${apps.length} services`;
		// THE BANNER SAYS THE BLOCK AND ONLY THE BLOCK — the hero directly under
		// it states the coverage at 24px over the bar that draws it.
		return `${who} ${apps.length === 1 ? 'is' : 'are'} held in ${envs}.`;
	});

	// THE ONE MUTATING CONTROL, and the same wiring as before: preselect
	// `ChangeVersionModal` on a tag `isDeployable` has already cleared. No new
	// mutation path, no one-click promote.
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(slot: RevisionSlot, tag: string) {
		modalRollout = slot.cell.rollout;
		modalVersion = tag;
		modalCluster = slot.cell.sourceCluster || undefined;
		modalOpen = true;
	}

	// ⭐ ROUND-4 CRAFT REVIEW, ITEM C — CLEARING THE PIN IS THE OTHER MUTATING
	// CONTROL ON THIS PAGE, WIRED THE SAME WAY. `ClearPinModal` is the one
	// component the product already uses for this act (rollout detail,
	// `/apps`, `/environments`, `RolloutGrid`) — its own doc comment records
	// that duplicating the markup a second time is exactly how the product
	// lost the copy once already, so this page opens THAT component rather
	// than re-deriving a dialog.
	let clearPinOpen = $state(false);
	let clearPinRollout = $state<Rollout | null>(null);
	let clearPinCluster = $state<string | undefined>(undefined);
	let clearPinEnvLabel = $state<string | null>(null);

	function openClearPin(slot: RevisionSlot, envLabel: string) {
		clearPinRollout = slot.cell.rollout;
		clearPinCluster = slot.cell.sourceCluster || undefined;
		clearPinEnvLabel = envLabel;
		clearPinOpen = true;
	}

	/**
	 * ⭐ ROUND-4 CRAFT REVIEW, ITEM 5 — `.btn-primary` IS ASSERTED BY
	 * CAPABILITY, NOT HARD-CODED TO SECONDARY.
	 *
	 * The button below has carried `.btn-secondary` since it shipped, with a
	 * reasoned comment: *"the loudest control on a deploy surface must not be
	 * the one that changes production … a place with an action never shares a
	 * row, so this button always has exactly one target."* That reasoning is
	 * about ONE ROW never holding two targets — true, and unchanged here — not
	 * about how many such rows the PAGE can have; `notYetGroups` keys any
	 * slot with a `promoteTag` to its own solo row precisely so several can
	 * coexist (one per environment with a live candidate and no gate).
	 * `lib/CLAUDE.md`'s own rule is "`.btn-primary` … at most one per page,"
	 * so a page with three such rows may not fill all three — but the one
	 * this branch was reviewed against genuinely has ONE: `Deploy 064b655 to
	 * dev` was the page's only control that changes what is running, wearing
	 * the same secondary chrome as `Cancel`. Counted here, the same way
	 * `/apps/<name>`'s own primary was re-derived "by CAPABILITY … not
	 * position" when its topmost row stopped being a reliable proxy for it.
	 */
	const deployableGroups = $derived.by<NotYetGroup[]>(() => {
		if (!coverage) return [];
		const bucket = coverage.buckets.find((b) => b.key === 'notYet');
		if (!bucket) return [];
		return notYetGroups(bucket.slots).filter((g) => g.slots.length === 1 && g.slots[0].promoteTag);
	});
	const singleDeployAction = $derived(deployableGroups.length === 1 ? deployableGroups[0] : null);

	const commitUrl = $derived.by<string | null>(() => {
		if (!ledger || !revision) return null;
		if (!ledger.repoKey.startsWith('repo:')) return null;
		const body = repoBody(ledger.repoKey);
		if (!body.includes('/')) return null;
		return `https://${body}/commit/${revision}`;
	});

	type BuildRelease = { label: string; createdMs: number };

	/**
	 * ⭐ ROUND-4 CRAFT REVIEW, ITEM E — PER-RELEASE `built`, WHEN A REVISION HAS
	 * MORE THAN ONE.
	 *
	 * `row.createdMs` (`revision-ledger.ts`) is the MAX `createdMs` across
	 * every release sharing this revision — right for sorting rows newest
	 * first, wrong for naming a single build time: `9f10e49` has two releases
	 * (`2.66.0-66` built 07-29, `2.67.0-67` built 08-31), and the bare `built 5
	 * days ago` this used to print is true of the newer one and silently
	 * false of the other, with no release named to tell them apart.
	 * `revision-ledger.ts` is another lane's file, so this reads the raw
	 * `availableReleases` directly rather than asking that module to expose
	 * the breakdown — the same array `displayVersionForTag` above already
	 * walks, on the same rollouts this row already carries.
	 *
	 * ⭐ ITEM 6 (2026-09-06 critique) — SCANS `coverage`, NOT `row.services`.
	 * `row.services` is scoped to ONE release-line (round-4's "a row is
	 * about one release") — measured live, `9f10e494d560`'s `row` was built
	 * around release `2.67.0-67` (held everywhere), so its `services` never
	 * included the rollouts actually running the sibling release
	 * `2.66.0-66` in three places, and their `availableReleases` — the only
	 * place that release's own `created` timestamp lives — never got
	 * scanned. `coverage` (`revisionCoverage`, another lane's file but
	 * already exposed to this page) carries every slot touching this
	 * revision across EVERY bucket, so flattening it here reaches the
	 * missing rollouts without this file guessing at `revision-ledger.ts`'s
	 * own row-per-release grouping.
	 */
	const buildReleases = $derived.by<BuildRelease[]>(() => {
		if (!row || !coverage) return [];
		// ⭐ FOLLOW-UP (a), 2026-09-06 coordinator re-check — KEYED BY LABEL,
		// NOT BY THE RAW TAG. Measured live on `9f10e494d560`: `hello-api-app`
		// and `hello-frontend-app` are two SEPARATE services built off the
		// SAME monorepo git tag (`rel-66`) — `hello-api-app`'s release prints
		// as `1.66.0-66`, `hello-frontend-app`'s as `2.66.0-66`, distinct facts
		// sharing one tag string. Keying the map on `rel.tag` let whichever
		// service's `rel-66` was scanned FIRST claim that key, so the second
		// service's own release of this commit was silently dropped —
		// `2.66.0-66`, the release actually running in 3 places, never made it
		// into the list. The label (`getDisplayVersion`) is what a service
		// actually calls its own release and is what gets printed, so it is
		// also the right identity to dedupe on.
		const byLabel = new Map<string, BuildRelease>();
		for (const bucket of coverage.buckets) {
			for (const s of bucket.slots) {
				for (const rel of s.slot.cell.rollout?.status?.availableReleases ?? []) {
					if (rel.revision !== row.revision || !rel.created) continue;
					const label = getDisplayVersion(rel);
					if (byLabel.has(label)) continue;
					const createdMs = new Date(rel.created).getTime();
					if (Number.isNaN(createdMs)) continue;
					byLabel.set(label, { label, createdMs });
				}
			}
		}
		// ⭐ ITEM 6 (2026-09-06 critique) — FALL BACK TO `history[].version`
		// WHEN `availableReleases` HAS AGED THE BUILD OUT. Measured live:
		// `c1ecfe553070` printed no `built …` line at all — `availableReleases`
		// is a live, size-bounded OCI catalog (the provider's own image
		// policy), and on every one of the nine rollouts that once ran this
		// build it had scrolled the entry off by the time this page asked. The
		// deploy that happened DID record its own `version.created`, though —
		// `history[]` is per-rollout and durable up to `versionHistoryLimit`,
		// not the provider's catalog window — so this is a second, independent
		// source for the SAME fact, never a guess. Only fills labels
		// `availableReleases` did not already answer for.
		for (const bucket of coverage.buckets) {
			for (const s of bucket.slots) {
				for (const h of s.slot.cell.rollout?.status?.history ?? []) {
					const v = h.version;
					if (!v || v.revision !== row.revision || !v.created) continue;
					const label = getDisplayVersion(v);
					if (byLabel.has(label)) continue;
					const createdMs = new Date(v.created).getTime();
					if (Number.isNaN(createdMs)) continue;
					byLabel.set(label, { label, createdMs });
				}
			}
		}
		return [...byLabel.values()].sort((a, b) => a.createdMs - b.createdMs);
	});

	/**
	 * ⭐ FINDING 2 (operator sweep, 2026-09-07) — `N SERVICES` ALONE
	 * UNDERCOUNTS THE MOMENT A SHA CARRIES A HELD SIBLING RELEASE. Measured
	 * live on `9f10e494d560`: `This build` said `2 services` while
	 * `buildReleases`, three lines down the same card, listed THREE rows —
	 * `hello-frontend-app` ships this commit as both `2.66.0-66` (running)
	 * and `2.67.0-67` (held), plus `hello-api-app`'s own release of it. A
	 * reader who only reads the count line never learns a release split even
	 * exists. `buildReleases` is already this file's one count of distinct
	 * releases on the revision (its own doc comment); this only prints the
	 * clause when it says something `row.services.length` does not — the
	 * ordinary one-release-per-service commit never grows a `· 1 releases`
	 * tail nobody asked for.
	 */
	const serviceReleaseCountLabel = $derived.by<string>(() => {
		const services = row?.services.length ?? 0;
		const base = `${services} service${services === 1 ? '' : 's'}`;
		return buildReleases.length > services ? `${base} · ${buildReleases.length} releases` : base;
	});

	/**
	 * ⭐ ITEM 6 (2026-09-06 critique) — THE SINGLE-RELEASE `built` LINE'S OWN
	 * FALLBACK. `row.createdMs` (`revision-ledger.ts`) is computed the SAME
	 * `availableReleases`-only way `buildReleases` used to be — so on a build
	 * every rollout's OCI catalog has since aged out, `revision-ledger.ts`
	 * has nothing to report either and the whole `built …` line vanished
	 * (`c1ecfe553070`, measured live). `buildReleases[0]` now also carries
	 * the `history[].version` fallback, so preferring it here reaches the
	 * same durable evidence rather than asking `revision-ledger.ts` (another
	 * lane's file) to grow the identical fallback a second time.
	 */
	const singleBuiltMs = $derived(buildReleases[0]?.createdMs || row?.createdMs || 0);

	/**
	 * ⭐ FOLLOW-UP (a), 2026-09-06 coordinator re-check — THE 60s "TOO CLOSE
	 * TO BOTH TO BOTHER" GUARD WAS THE REAL REASON `c1ecfe553070` PRINTED NO
	 * `Built …` LINE, NOT A MISSING DATA SOURCE. Measured precisely from the
	 * live payload: `availableReleases` puts this build's `created` at
	 * 11:18:30-46Z; the only surviving `history` entry for it deploys at
	 * 11:19:14Z — a real, 28-44 SECOND gap (a build-then-deploy pipeline),
	 * not the "pushed and deployed in the same instant" case the old
	 * `> 60_000` threshold was written for. That threshold was rounding a
	 * genuine two-step pipeline into "restates the same fact" and hiding a
	 * fact the API plainly has. Narrowed to `> 1_000`: still skips the true
	 * same-instant case (both fields sourced from one webhook timestamp,
	 * sub-second apart or bit-identical), shows everything else.
	 */
	const builtDiffersFromDeploy = $derived(
		!!singleBuiltMs && !!row && Math.abs(singleBuiltMs - row.lastDeployMs) > 1_000
	);

	/**
	 * ⛔ THE HEIGHT-MATCH OPT-IN IS GONE (ITEM 3, 2026-09-06 round-7
	 * critique). F9's 25%-gap heuristic still stretched `What each service
	 * calls it` to match `This build` on `9f10e494d560` — measured live,
	 * 593×315 with ~92px of dead body below the last service row. `start` is
	 * the grid's own default for every OTHER pair on this page (the bucket
	 * cards); this top pair now gets the same honest rule — its own content
	 * height, never a neighbour's.
	 */

	/**
	 * ⭐ PER-PLACE AGE, FOR THE `live` BUCKET ONLY. (F13, 2026-09-03)
	 *
	 * `Running it now` used to print an environment's chip and stop —
	 * `hello-api-app › DEV STAGING PROD` — leaving 65.9% of the card's
	 * height-matched row empty while `This build` beside it ran to 249px of
	 * real content. The fact was already on the wire and unused: a slot in
	 * this bucket is CURRENTLY running the row's own revision, which by
	 * `revision-ledger.ts`'s own `onIt = cur === revision` derivation means
	 * `history[0]` IS that deploy — the same entry `currentKeyOf` reads to
	 * decide `onIt` in the first place. So the age is not a new fetch or a
	 * new field, only a read of a timestamp that was already being compared.
	 *
	 * Three environments running one build rarely arrived at the same
	 * moment — DEV got it days before PROD did — so this also answers a
	 * question the bare chip row could not: how long has EACH place actually
	 * had it, not just the row's own single `last deployed N ago`.
	 */
	function slotDeployedAgo(s: CoverageSlotVM): { ago: string; iso: string } | null {
		// ⭐ ITEM 5 (2026-09-06 critique) — THE LIST'S OWN GRAMMAR
		// (`formatTimeAgoCompact`), NOT THE FULL-WORD FORM. This page printed
		// `deployed 6 days ago`; `/revisions` says `Deployed 6d ago`. One
		// spelling, product-wide.
		const ts = s.slot.cell.rollout?.status?.history?.[0]?.timestamp;
		return ts ? { ago: formatTimeAgoCompact(ts, $now), iso: ts } : null;
	}

	/**
	 * ⭐ ITEM 7 (2026-09-06 round-7 critique) — "WHAT DID THIS PLACE RUN
	 * BEFORE THIS?" HAD NO ANSWER ON AN ENV CHIP ANYWHERE ON THIS PAGE.
	 * `history[0]` is the place's CURRENT deploy (whatever this row already
	 * reads it as — live, held, ahead, deploying); `history[1]` is the one
	 * immediately before it, a real timestamped record regardless of
	 * whether it matches this row's own revision. Distinct from
	 * `ranBeforeOf` (which searches the WHOLE history for a match to THIS
	 * row's revision, for the service-ledger card) — this is the simpler,
	 * always-available fact an operator asks of any single chip: what was
	 * here immediately before what's here now, and until when.
	 */
	function wasOnClause(s: CoverageSlotVM): string {
		const prev = s.slot.cell.rollout?.status?.history?.[1];
		const prevRevision = prev?.version?.revision;
		if (!prevRevision || !prev?.timestamp) return '';
		return ` · was on ${shortRevision(prevRevision)} until ${formatDate(prev.timestamp)}`;
	}

	/**
	 * ⛔ SUPERSEDED — ITEM 5 (2026-09-06 round-7 critique), measured on a
	 * real canary (Clear pin on `hello-multi-dev`, 2m45s): this caption
	 * printed `Deploying 064b655 · started 32s ago` under a card titled
	 * `Deploying`, on a page whose own `h1` is already `064b655` — the sha
	 * said three times in one screenful for no new information. Round-7
	 * ruling 4: "In flight is one mark per row … no inserted word, no
	 * second chip." The env chip now carries `bakeWord()` itself, inside
	 * its own box (`BakeStatusIcon` — see the call site), so this caption
	 * is left with exactly the one fact the chip cannot carry: since when.
	 */
	function deployingCaption(s: CoverageSlotVM): string {
		const started = slotDeployedAgo(s);
		if (started) return `started ${started.ago} ago`;
		// Defensive fallback only — every `deploying`-bucket slot has a
		// `history[0]` timestamp in practice (it is what put it in this
		// bucket at all). Stay honest rather than print nothing if it does not.
		return bakeTitle(slotBakeStatus(s.slot));
	}

	/**
	 * ⭐ ITEM 2 (2026-09-06 critique) — ONE AGE PER ROW, WHEN EVERY PLACE
	 * AGREES. `Running it now` on `064b655` repeated `deployed 6d ago` on
	 * every one of three atoms in a row — the container query below forces
	 * one atom per line under 560px, and three atoms each carrying a full
	 * `[chip][age]` pair do not fit ABOVE 560 either once padding is spent,
	 * so the row still stacked at a measured 591px container. Removing the
	 * repeated fact (not widening the breakpoint) is what actually lets the
	 * chips flow: three bare env chips fit in far less width than three
	 * chip+age pairs. Returns the shared age only when EVERY slot in the row
	 * has one and they all agree; a genuine split (one place newer than its
	 * siblings) keeps each atom's own age, which is the fact worth the extra
	 * width.
	 */
	function sharedAgeFor(
		bucketKey: string,
		slots: CoverageSlotVM[]
	): { ago: string; iso: string } | null {
		if (bucketKey !== 'live' || slots.length < 2) return null;
		// ⭐ ROUND 11, FINDING 2 — A ROLLBACK NEVER FOLDS INTO THE SHARED LINE.
		// Two places can coincidentally report the identical `ago` string
		// while only ONE of them actually arrived there via a rollback — the
		// shared line has no per-place slot to carry that distinction, so a
		// rollback place always keeps its own dedicated line instead.
		if (slots.some((s) => rollbackFor(s))) return null;
		const ages = slots.map((s) => slotDeployedAgo(s));
		const first = ages[0];
		if (!first) return null;
		return ages.every((a) => a?.ago === first.ago) ? first : null;
	}

	/** One pinned place, ready to draw as a `[PINNED][ENV]` chip pair. */
	type PinnedPlace = { envLabel: string; theme: EnvironmentTheme | null; title: string };

	/**
	 * ⭐ PER-SERVICE ENV PINS, ON `What each service calls it`. (F13,
	 * 2026-09-03)
	 *
	 * The card's row was a name, a rank chip and an `of N` — one line, done,
	 * while its neighbour `This build` ran on for five. `spec.wantedVersion`
	 * is already on every slot's own `rollout` (the same object `promoteTag`
	 * reads three lines up in `revision-ledger.ts`), so a service pinned
	 * somewhere is a fact this page already has and was not saying — and it
	 * is directly relevant to the row it sits under: a reader looking at
	 * `hello-api-app · NEWEST · of 1` benefits from knowing PROD will not
	 * move off it even though nothing is holding it, because it is pinned.
	 *
	 * ⭐ ROUND-4B REVIEW, ITEM 2 — RETURNS A CHIP-READY RECORD NOW, NOT A
	 * BARE STRING. The row used to say `Pinned in DEV — automatic updates
	 * are off there`, a second spelling of the ONE canonical pin sentence
	 * this file already prints, unabbreviated, in `reasonsFor`'s pin branch
	 * two hundred pixels below. Prose is gone from this row; the theme and
	 * the canonical sentence (per place, with THAT place's own pinned tag —
	 * `displayVersionForTag`, the same lookup `reasonsFor` uses) travel with
	 * the label so the render side draws chips and puts the full sentence on
	 * `title` instead of retyping a shorter one.
	 */
	function pinnedEnvsOf(svc: RevisionService): PinnedPlace[] {
		return svc.slots
			.filter((s) => s.cell.rollout?.spec?.wantedVersion)
			.map((s) => {
				const pinnedTo = s.cell.rollout!.spec!.wantedVersion!;
				const display = displayVersionForTag(s.cell.rollout, pinnedTo) || pinnedTo;
				return {
					// ⭐ ROUND-4 CRAFT REVIEW, ITEM D — THE ENVIRONMENT'S OWN LABEL,
					// NOT ITS RAW `envName`. `RevisionSlot.envName` is the rollout's
					// own name (`hello-world-staging`), not the environment tier
					// every chip on this page prints (`STAGING`) — `shortEnvLabel`
					// off the slot's own theme is the same lookup
					// `envSlots`/`Chip`'s `label={s.envLabel}` resolve through
					// elsewhere on this page.
					envLabel: (shortEnvLabel(s.cell.theme) || s.envName).toUpperCase(),
					theme: s.cell.theme,
					title: `Pinned to ${display} — automatic deploys are paused until the pin is cleared.`
				};
			});
	}

	/**
	 * ⭐ "WHERE DID THIS BUILD RUN BEFORE?" HAD NO ANSWER. (operator-walk
	 * finding 2) `status.history[0]` is the environment's CURRENT deploy;
	 * everything after it is a real, timestamped record of what this exact
	 * place ran previously, and this page never read past index 0. A place
	 * that has since moved on (or been rolled further back) still carries the
	 * evidence that this revision was here — `history[i].version.revision` is
	 * the same key `resolveRevision`/`onIt` use to decide identity everywhere
	 * else on this page, so this cannot name a match the rest of the page
	 * would disagree with.
	 *
	 * ⭐ FOLLOW-UP (b), 2026-09-06 coordinator re-check — SKIPS `onRevision`,
	 * NOT JUST `onIt`. Measured live: `hello-frontend-app` printed `Ran
	 * before in DEV · 2d ago` directly under `Held — still running
	 * 2.66.0-66` — DEV is CURRENTLY running this commit (under the sibling
	 * release), so "ran before" is a contradiction, not a second fact. Round
	 * 5's own rule is that coverage counts the REVISION: a place on ANY
	 * release of it is running it now, not merely "before". `onIt` alone
	 * (the row's own EXACT release) is too narrow a guard now that `live`
	 * itself means `onRevision`, not `onIt`.
	 */
	function ranBeforeOf(svc: RevisionService): { envLabel: string; timestamp: string }[] {
		if (!revision) return [];
		const out: { envLabel: string; timestamp: string }[] = [];
		for (const s of svc.slots) {
			if (s.onRevision) continue;
			const history = s.cell.rollout?.status?.history ?? [];
			// index 0 is the CURRENT deploy, already excluded by `!s.onRevision` above
			// when it matches — start the search one entry back regardless, so a
			// stale `onIt` never double-counts the running deploy as "before."
			const match = history.slice(1).find((h) => h.version?.revision === revision);
			// ⭐ ROUND-4 CRAFT REVIEW, ITEM D — SEE `pinnedEnvsOf`'s OWN NOTE, THE
			// IDENTICAL DEFECT: `s.envName` printed `HELLO-WORLD-STAGING`, not
			// `STAGING`, the label every other chip on this page prints.
			if (match?.timestamp)
				out.push({
					envLabel: (shortEnvLabel(s.cell.theme) || s.envName).toUpperCase(),
					timestamp: match.timestamp
				});
		}
		return out;
	}

	/**
	 * ⭐ ABSENCE FROM `status.history` IS NOT EVIDENCE IT NEVER RAN THERE.
	 * (operator-walk finding 2) `spec.versionHistoryLimit` bounds the array
	 * this page just searched — `historyAtLimit` (`lib/history-marks.ts`,
	 * already the product's one definition of "this array may have been
	 * truncated") is true once a rollout has deployed at least that many
	 * times, and past that point the oldest entry is evicted on every new
	 * deploy.
	 *
	 * ⭐ ROUND-4B REVIEW, ITEM 3 — PER SERVICE, BUT NO LONGER PRINTED PER
	 * SERVICE. (2026-09-05, verified live: `6f9524e28087` printed this
	 * sentence three times, once under each of `hello-multi-app`'s three
	 * services, byte-identical each time.) The caveat is about the card's
	 * data source, not about any one service, so it is still computed here —
	 * `cardHistoryLimitNote` below calls this once per service to find
	 * whether ANY of them tripped it — but it is drawn once, as the card's
	 * footer. See that function for the render-side half of this split.
	 */
	function historyLimitNote(svc: RevisionService): string | null {
		const limited = svc.slots.find((s) => !s.onIt && historyAtLimit(s.cell.rollout));
		if (!limited) return null;
		const limit = limited.cell.rollout?.spec?.versionHistoryLimit ?? 10;
		// ⭐ ROUND-4 CRAFT REVIEW, ITEM 6 — THE LIST PAGE'S OWN WORDING, NOT A
		// SECOND SPELLING OF IT. `/revisions`' `HISTORY_LIMIT_NOTE` says this
		// once, product-wide; this file cannot import it (`revision-ledger.ts`'s
		// lane owns the list route this constant lives in), so the words are
		// copied verbatim rather than re-authored — a second wording of the
		// same caveat is exactly the sprawl the vocabulary passes exist to cut.
		return `History keeps the last ${limit} deploys per service; a build deployed earlier is not recorded.`;
	}

	/**
	 * ⭐ ROUND-4B REVIEW, ITEM 3 — THE CARD'S OWN FOOTER LINE, SAID ONCE.
	 * `historyLimitNote` is per-service by construction (it reads that
	 * service's own `spec.versionHistoryLimit`), but the sentence it returns
	 * names no service — it is a caveat about truncated history in general —
	 * so printing it once per service that happened to hit the limit was
	 * pure repetition, not three different facts. This reads every service
	 * on the row and stops at the first hit: the card draws the sentence
	 * only when it is true of AT LEAST ONE of them.
	 */
	function cardHistoryLimitNote(): string | null {
		if (!row) return null;
		for (const svc of row.services) {
			const note = historyLimitNote(svc);
			if (note) return note;
		}
		return null;
	}

	/**
	 * ⭐ FINDING 1's SECOND LOCATION: THE PER-PLACE REASON ROW. (coordinator
	 * sweep, 2026-09-03) A lookup off `slotStories` (built once, above), keyed
	 * the same way `windows` is, so `reasonsFor` can ask for the classified
	 * gates behind ONE place without re-running `blockingStory` per row.
	 */
	const storyBySlotKey = $derived.by<Map<string, BlockingStory>>(() => {
		const map = new Map<string, BlockingStory>();
		for (const { slot, story } of slotStories) map.set(slotKey(slot), story);
		return map;
	});

	/** Where a place actually lives. Never `/apps/<name>` — see the header block. */
	function placeHref(s: CoverageSlotVM): string {
		if (!s.rolloutRef) return `/apps/${encodeURIComponent(s.appName)}`;
		return rolloutPath(
			s.rolloutRef.cluster || localClusterName,
			s.rolloutRef.namespace,
			s.rolloutRef.name
		);
	}

	/**
	 * ⭐ ONE STUCK DERIVATION, THE SAME ONE `/apps/<name>` USES. (operator-walk
	 * finding 3) `CoverageSlotVM.stuck` (`revision-coverage.ts`) runs
	 * `detectStuckBehind` with no `GateContext`, so a promotion/dependency gate
	 * CORRECTLY refusing a candidate has no way to classify as anything but
	 * `unknown` — and `unknown` still counts as stuck. Measured live:
	 * `hello-multi-app` read `STAGING [STUCK] PROD [STUCK]` on this page while
	 * both rollouts sat at rank 0, `Ready`, every gate `passing: true` — the
	 * exact defect `lib/CLAUDE.md`'s "a gate correctly refusing a candidate is
	 * not a stoppage" rule exists to kill, just not closed here yet.
	 *
	 * This page already builds `gateContext` for the banner above, so the fix
	 * is to feed it through the same three-step derivation `/apps/<name>`'s own
	 * `stuckFor` uses — own bake timeout, then a classified promotion stuck,
	 * then peer staleness guarded by `refusedNotStalled` — not a sixth,
	 * page-local spelling of "stuck." `CoverageSlotVM.stuck` itself is left
	 * alone (`revision-coverage.ts` is another lane's file); this page just
	 * stops trusting it for the badge it draws.
	 */
	function refusedNotStalled(story: BlockingStory): boolean {
		return story.blocked && story.person.length === 0 && story.unknown.length === 0;
	}

	/**
	 * ⭐ ITEM 7 (2026-09-06 critique) — TRANSIENT STUCK, WHEN THE CONTROLLER
	 * HAS NOT ACTED YET. Measured live: one second after Clear pin, the
	 * place read `2 BEHIND · STUCK · Ready to deploy` — the dashboard's own
	 * data was still the pre-clear snapshot (the mutation lands, but the
	 * controller has not reconciled it yet), and every downstream check
	 * below ran on stale evidence. Round-5 ruling 9: *"a place whose
	 * generation the controller has not observed yet (or that changed in
	 * the last minutes) is queued/deploying; STUCK needs eligibility plus
	 * stillness."*
	 *
	 * The precise signal named in that ruling — `metadata.generation !==
	 * status.observedGeneration` — is NOT on the wire: the dashboard's own
	 * condensed `KubernetesMetadata` type carries no `generation` field, and
	 * `RolloutStatus` has no top-level `observedGeneration` (only individual
	 * `conditions[].observedGeneration`, which is a different question per
	 * condition, not one comparable number). Falls back, as the ruling
	 * allows, to the newest history timestamp: a place that changed in the
	 * last 5 minutes has not held still long enough to call STUCK, whatever
	 * the three checks below would otherwise say.
	 */
	function recentlyChanged(rollout: Rollout | null | undefined): boolean {
		const ts = rollout?.status?.history?.[0]?.timestamp;
		if (!ts) return false;
		const ageMs = $now.getTime() - new Date(ts).getTime();
		return ageMs >= 0 && ageMs < 5 * 60 * 1000;
	}

	function stuckFor(s: CoverageSlotVM) {
		const rollout = s.slot.cell.rollout;
		if (recentlyChanged(rollout)) return null;
		const own = detectStuck(rollout, { now: $now });
		if (own) return own;
		const promo = detectStuckPromotion(rollout, { now: $now, gateContext });
		if (promo) return promo;
		const story = blockingStory(rollout, gateContext, { place: s.envLabel, now: $now });
		if (refusedNotStalled(story)) return null;
		const peers = (row?.services.find((sv) => sv.appName === s.appName)?.slots ?? []).filter(
			(p) => p.envName !== s.envName
		);
		for (const peer of peers) {
			const r = detectStuckBehind(rollout, peer.cell.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}

	/** The one predicate the chip-mark row actually renders. */
	function isStuck(s: CoverageSlotVM): boolean {
		return !!stuckFor(s);
	}

	/**
	 * ⭐ ROUND-4B REVIEW, ITEM 1 — THE SAME PIN CHIP THE LIST ROW CARRIES,
	 * HERE TOO. (2026-09-05, verified live on
	 * `github.com/littlechimera/kuberik-testing/6f9524e28087`:
	 * `hello-multi-app`'s `Running it now` card printed `[DEV] deployed 1
	 * day ago` with no sign DEV is pinned to this exact build — the fact
	 * was stated only in `What each service calls it`, 300px up, and
	 * `/revisions`' own row already carries a `pinned` chip for the
	 * identical fact via `lineState`.) Same role and label as that chip
	 * (`role="unranked"`, `label="pinned"`), rendered as a loose mark inside
	 * the row's `.chip-mark` group, the same slot `STUCK` already uses. The
	 * canonical sentence rides on `title` — never a second prose spelling of
	 * it beside the chip.
	 */
	function pinnedChipTitle(s: CoverageSlotVM): string | null {
		const pinnedTo = s.slot.cell.rollout?.spec?.wantedVersion;
		if (!pinnedTo) return null;
		const display = displayVersionForTag(s.slot.cell.rollout, pinnedTo) || pinnedTo;
		return `Pinned to ${display} — automatic deploys are paused until the pin is cleared.`;
	}

	/**
	 * ⭐ ROUND 11 OPERATOR-WALK, FINDING 2 — A HELD PLACE WHOSE HISTORY SHOWS
	 * THIS BUILD DEPLOYED THERE AND ROLLED BACK MUST READ "ROLLED BACK", NOT
	 * JUST "HELD". Verified against the live cluster: `hello-frontend-app`
	 * DEV history reads `2.66.0-66 → 2.67.0-67 → 2.66.0-66` — both releases
	 * share ONE revision, so `detectRollback` (`rollout-cards.ts`, the same
	 * predicate `/apps` reads to print `DEV ROLLED BACK 2.67.0-67 →
	 * 2.66.0-66`) sees `history[0]` land at an OLDER position in
	 * `availableReleases` than `history[1]` and flags it — a real rollback
	 * event, not merely "hasn't been promoted yet". `null` on any place
	 * with fewer than two history entries (nothing to compare) or no genuine
	 * backward move, same guard `detectRollback` itself applies.
	 */
	function rollbackFor(s: CoverageSlotVM) {
		return detectRollback(s.slot.cell.rollout);
	}

	/**
	 * WHY IT HAS NOT ARRIVED — NAMED ONLY FROM THE FIELD THAT ESTABLISHED IT.
	 *
	 * `blockingGates` is non-empty only when `promotionBlock` found real gates
	 * refusing every candidate; with no gate evidence this describes the
	 * OBSERVABLE and stops. `DESIGN.md`: *"`waiting on a gate` is a lie with
	 * better grammar."*
	 *
	 * WHAT CHANGED IS THE VOCABULARY, NOT THE EVIDENCE. It used to print
	 * `waiting on ghd-p2fld, schedule-gate-nwm62` — two generated object names
	 * and nothing else. The split is `promotionBlock`'s own and it is
	 * STRUCTURAL, never name-based: a gate that published an allow-list has an
	 * opinion and the answer is no, and only a person or an external system
	 * changes that; a gate with no allow-list that is simply not passing is
	 * time- or condition-bounded and clears on its own.
	 */
	type Reason = {
		icon: typeof HourglassOutline;
		tone: string;
		text: string;
		gates: string[];
		/**
		 * ⭐ ROUND-4 CRAFT REVIEW, ITEM 3 — A RAW, UNBREAKABLE IDENTIFIER GOES
		 * HERE, NEVER INTO `text`. The pin branch below used to interpolate the
		 * FULL OCI tag (`main-1788002339-6f9524e…`, 56 characters with no break
		 * opportunity) straight into the sentence; under this row's `overflow:
		 * hidden`/`min-w-0` it clipped 59px short with no ellipsis at 390.
		 * `record` is rendered the same way `gates` already is two lines
		 * down — mono, `break-all`, its own row under the claim — so a long
		 * identifier can wrap instead of vanishing.
		 */
		record?: string;
		recordTitle?: string;
		/**
		 * ⭐ ITEM 3 (2026-09-06 critique) — SET ONLY FOR A `dependency` GATE
		 * WHOSE PROVIDER/CONTRACT/HAVE/NEED ARE ALL KNOWN, SO THE ROW CAN BE
		 * DRAWN INSTEAD OF NARRATED. Measured live: `9f10e49`'s "Not here
		 * yet" printed *"Waiting for hello-api-app to ship a newer api — it
		 * is on 1.66.0"* once per environment (dev/staging/prod each carry
		 * their OWN `RolloutDependency` gate object, so the raw gate id in
		 * `text`/`gates` differed per place even though the SENTENCE was
		 * byte-identical) — the exact violation `lib/CLAUDE.md` names: *"ONE
		 * CAUSE IS DRAWN ONCE, ON THE MOST UPSTREAM EDGE IT BITES."*
		 * `notYetGroups` below keys a drawn reason on the RELATION
		 * (`subject`/`contract`/`need`), not on the per-environment gate id,
		 * so the same upstream cause always folds into one row regardless of
		 * which generated object published it; `text`/`gates` are left empty
		 * on a drawn reason; the render side switches on this field.
		 */
		drawn?: {
			subject: string;
			subjectHref: string;
			contract: string;
			have: string | null;
			need: string | null;
			gateName: string | null;
		};
	};

	function reasonsFor(s: CoverageSlotVM): Reason[] {
		/**
		 * ⭐ A PIN OUTRANKS EVERY GATE, HERE TOO. (operator-walk finding 1)
		 * `blocking-story.ts`'s own `blockingStory()` short-circuits on
		 * `spec.wantedVersion` before it looks at a single gate — "a gate holds
		 * the NEXT build; a pin refuses all of them" — but `promotionBlock()`
		 * (what `s.blockingGates`/`s.notPassingGates`/`s.awaitingApprovalGates`
		 * are built from) never sees the pin at all, because a pin is not a
		 * gate. Measured live: `hello-multi-app` DEV read `Pinned in DEV —
		 * automatic updates are off there` in the rail above and, 200px below,
		 * `[2 BEHIND] — Ready to deploy — still on 6f9524e` with a bare
		 * `Promote to dev` button — no gate anywhere, so this branch never ran
		 * and the "ready to deploy" fallback below spoke instead, contradicting
		 * the rail's own sentence about the same place. The pin is checked
		 * FIRST, unconditionally, and wins outright — same precedence
		 * `blockingStory()` itself uses, and the same canonical sentence
		 * `rollout-cards.ts`/`RolloutGrid.svelte`/`/environments`/rollout detail
		 * already ship everywhere a pin is named (`vocabulary.test.ts`'s
		 * `allow` list carries this file's own line for it now).
		 */
		const pinnedTo = s.slot.cell.rollout?.spec?.wantedVersion;
		if (pinnedTo) {
			/**
			 * ⭐ ROUND-4 CRAFT REVIEW, ITEM 3 — TWO DEFECTS IN ONE ROW, BOTH FROM
			 * PRINTING THE RAW TAG INLINE.
			 *
			 * ⛔ BLUE WAS RIGHT IN GENERAL AND WRONG HERE, SPECIFICALLY BECAUSE OF
			 * WHAT SITS ABOVE IT. The banner hue rule ("a state a person chose is
			 * blue") still holds everywhere this sentence is the ONLY statement of
			 * the fact — `AlertPanel`, `RolloutGrid`, rollout detail. On THIS card,
			 * measured live, `What each service calls it` already prints `Pinned in
			 * DEV — automatic updates are off there` in the row's own gray, 200px
			 * above this one — so the louder blue ink here read as a SECOND, more
			 * urgent claim about the identical fact, not as elaboration. Dropped to
			 * `tone-mute`, the row's own default ink, matching the sentence it was
			 * duplicating rather than out-shouting it.
			 *
			 * ⛔ THE TAG ITSELF WAS THE UNBREAKABLE STRING. `pinnedTo` is the raw
			 * OCI tag (`main-1788002339-6f9524e…`, 56 characters, no hyphenatable
			 * break the CSS line-breaker will use inside a `min-w-0` column) —
			 * printed inline it clipped 59px short with no ellipsis at 390.
			 * `displayVersionForTag` is the ONE lookup the product already uses to
			 * turn a raw tag into the short name every other surface calls this
			 * build (`blocking-story.ts`'s own `pinnedToDisplay`, established
			 * there); the raw tag itself does not disappear, it moves to `record`
			 * — its own truncated-mono row, `break-all`, never inline prose.
			 */
			const pinnedToDisplay = displayVersionForTag(s.slot.cell.rollout, pinnedTo) || pinnedTo;
			return [
				{
					icon: LockSolid,
					tone: 'tone-mute',
					text: `Pinned to ${pinnedToDisplay} — automatic deploys are paused until the pin is cleared.`,
					gates: [],
					record: pinnedTo,
					recordTitle: `The pinned tag: ${pinnedTo}`
				}
			];
		}
		const out: Reason[] = [];
		if (s.notPassingGates.length > 0) {
			const w = windows[slotKey(s)];
			const until = w?.blocked && w.nextTransition ? formatTimeUntil(w.nextTransition, $now) : null;
			out.push({
				icon: CalendarMonthSolid,
				tone: 'tone-mute',
				// ⭐ `HELD BY ghd-p2fld` IS GONE. The human named it as a string that
				// assumes the domain, and it is worse than that: `ghd-p2fld` is a
				// GENERATED object name, so the sentence's only content was an
				// identifier the reader has never seen. The names are evidence and
				// they still print, under the claim, in `gates` — where a reader who
				// does know the cluster can use them and one who does not can ignore
				// them.
				text: until
					? `Held for another ${until}`
					: w?.names.length
						? 'Held by a deploy window'
						: 'A check has not passed yet — it clears on its own',
				gates: s.notPassingGates
			});
		}
		if (s.awaitingApprovalGates.length > 0) {
			// ⭐ FINDING 1 (coordinator sweep, 2026-09-03): CLASSIFIED, NOT A
			// BLANKET "Needs an approval." `s.awaitingApprovalGates` means only
			// "these gates published an allow-list" — the environment controller
			// (`promotion`) and the RolloutDependency controller (`dependency`)
			// both do, and only ONE actual writer is a person. This printed
			// "Needs an approval or an external check" for every member of that
			// bucket, so a contract gate on this exact row read as an approval
			// while the Overview banner for the same rollout said "No approval
			// will unblock this."
			//
			// `storyBySlotKey` carries this SLOT's own `blockingStory` — the same
			// classified gates the Overview reads — and one Reason row per
			// classified gate keeps a person, a contract and a promotion order
			// each in their own icon and their own sentence (`g.short`, the exact
			// words `classifyGate` already computed) rather than folding all
			// three into one caption.
			const story = storyBySlotKey.get(slotKey(s));
			const allowListed =
				story?.gates.filter((g) => g.clears !== 'clock' && g.clears !== 'check') ?? [];
			if (allowListed.length > 0) {
				for (const g of allowListed) {
					// ⭐ ITEM 3 (2026-09-06 critique) — DRAW THE CONTRACT, DON'T
					// NARRATE IT. See `Reason.drawn`'s own comment: a dependency
					// gate with a full provider/contract/have/need relation is
					// what `BlockReason`'s `contract` branch already draws
					// everywhere else on this product.
					if (g.kind === 'dependency' && g.subject && g.contract && g.have && g.need) {
						out.push({
							icon: gateMark(g),
							tone: 'tone-mute',
							text: '',
							gates: [],
							drawn: {
								subject: g.subject,
								subjectHref: `/apps/${encodeURIComponent(g.subject)}`,
								contract: g.contract,
								have: g.have,
								need: g.need,
								gateName: g.id
							}
						});
						continue;
					}
					out.push({ icon: gateMark(g), tone: 'tone-mute', text: g.short, gates: [g.id] });
				}
			} else {
				// Defensive fallback only — a slot naming allow-list gates should
				// always resolve a story from `slotStories`. Stay honest rather
				// than silently drop the fact if it somehow does not.
				out.push({
					icon: UserCircleSolid,
					tone: 'tone-mute',
					text: 'Held by a rule this dashboard has not classified yet',
					gates: s.awaitingApprovalGates
				});
			}
		}
		if (out.length === 0) {
			// NO GATE EVIDENCE. State the observable and stop.
			//
			// TWO DIFFERENT OBSERVABLES, AND THEY ARE NOT THE SAME SENTENCE. A
			// build the controller lists as a candidate here is one this place
			// could take next; a build it does not list is one the place will
			// never take, because newer builds sit in front of it. Printing
			// "not yet" over both is how the old page came to say *"blocked from
			// going further"* about a build nine steps back that no gate has an
			// opinion on.
			//
			// ⭐ AND A THIRD CASE, FOUND ON THE LIVE CLUSTER: THE ENVIRONMENT IS
			// ALREADY ON THIS REVISION. (2026-09-02, design re-check.) `s.slot.onIt`
			// is a git-sha match — true whenever the running release shares the
			// row's own commit, whatever RANK that release sits at. Two releases
			// of one revision are how a rollback re-deploys a build already
			// shipped once, under a new tag (`revision-coverage.ts`'s
			// two-denominator note): rel-66 and rel-67 can be the SAME commit,
			// with rel-67 simply the newer, still-held release of it. "Newer
			// builds are ahead of this one" is a lie there — nothing newer has
			// arrived, this place is already running the row's revision, just
			// under an older label than the row's own newest release of it.
			const heldNewerRelease =
				s.slot.onIt && s.runs && s.label && s.runs !== s.label ? s.label : null;
			out.push({
				icon: HourglassOutline,
				tone: 'tone-mute',
				// NUMBER-NEUTRAL ON PURPOSE. Places sharing a reason render as ONE
				// row (see `notYetGroups`), so `this place runs X` would read as a
				// singular claim over thirteen chips.
				text: s.candidate
					? s.runs
						? `Ready to deploy — still on ${s.runs}`
						: 'Ready to deploy here'
					: heldNewerRelease
						? `Running ${s.runs} of this revision; ${heldNewerRelease} is held`
						: s.runs
							? `Already on ${s.runs}, and newer builds are ahead of this one`
							: 'Skipped — newer builds are ahead of this one',
				gates: []
			});
		}
		return out;
	}

	/**
	 * ⭐ PLACES HELD FOR THE SAME REASON ARE ONE ROW, NOT THIRTEEN.
	 *
	 * Found by running the page against a 13-region fan-out under `MOCK_API=1`:
	 * `Not here yet` printed one row per place, and thirteen of them carried the
	 * byte-identical sentence *"Skipped — this place runs 7c14e2a, and newer
	 * builds are ahead of this one"*. That is the furniture the good pages never
	 * draw — a graphic (or a sentence) that is the same on every row carries no
	 * information after the first one, and it buried the two rows that DID have
	 * their own story.
	 *
	 * The bucket's design note said each place here has its own story, and that
	 * is true of a 3-environment app and false at 13 regions. So the grouping is
	 * on the STORY, not on a count: places whose reasons and gate names are
	 * identical collapse into one row whose environments are wrapped chips.
	 *
	 * A PLACE WITH AN ACTION NEVER GROUPS. `promoteTag` means a button, the
	 * button names its environment, and two buttons cannot share a row without
	 * the reader inferring the target from position — so those keep one row
	 * each, which is also where the reader most needs the room.
	 */
	type NotYetGroup = { key: string; appName: string; slots: CoverageSlotVM[]; reasons: Reason[] };

	/**
	 * ⭐ ITEM 3 (2026-09-06 critique) — A DRAWN REASON GROUPS ON THE RELATION,
	 * NOT ON THE GATE ID. dev/staging/prod each carry their own
	 * `RolloutDependency` object for the identical upstream cause, so keying
	 * on `r.gates` (the raw id) never folded them — three rows, one sentence
	 * each, byte-identical. Keying on `subject|contract|need` instead means
	 * every place this exact contract bites folds into one row regardless of
	 * which generated gate published it, which is what lets the row draw the
	 * clause once.
	 *
	 * ⛔ A NAMED FUNCTION, NOT A TERNARY INLINE INSIDE THE OUTER TEMPLATE
	 * LITERAL (`lib/CLAUDE.md`: "no nested template literals in a `.ts` fact
	 * value" — `lib/messages/scan.ts`'s regex reads the fragment up to the
	 * first line break, so a multi-line ternary nested inside `${…}` came
	 * back to the census as the unreadable tail `) .join('§')}`). Building
	 * the part first keeps every template literal here single-line.
	 */
	function reasonGroupKey(r: Reason): string {
		if (r.drawn) return `drawn:${r.drawn.subject}|${r.drawn.contract}|${r.drawn.need}`;
		return `${r.text}·${r.gates.join(',')}`;
	}

	function notYetGroups(slots: CoverageSlotVM[]): NotYetGroup[] {
		const out: NotYetGroup[] = [];
		for (const s of slots) {
			const reasons = reasonsFor(s);
			const key = s.promoteTag
				? `solo:${s.appName}/${s.envName}`
				: `${s.appName}|${reasons.map(reasonGroupKey).join('§')}`;
			let g = out.find((o) => o.key === key);
			if (!g) {
				g = { key, appName: s.appName, slots: [], reasons };
				out.push(g);
			}
			g.slots.push(s);
		}
		return out;
	}

	/**
	 * A BUCKET'S SLOTS, GROUPED TWICE — BY SERVICE, THEN BY WHAT EACH PLACE IS
	 * ACTUALLY RUNNING. Grouping by SERVICE makes criterion 2 structural;
	 * grouping again by RUNNING BUILD is what lets `Moved ahead` say `now on
	 * 9f10e49` once per service instead of once per environment. Environments
	 * become CHIPS THAT WRAP rather than rows that stack, so a 13-region service
	 * costs one wrapped line instead of thirteen rows.
	 */
	type RunsGroup = { runs: string | null; slots: CoverageSlotVM[] };
	type ServiceGroup = { appName: string; runs: RunsGroup[] };

	function groupSlots(slots: CoverageSlotVM[]): ServiceGroup[] {
		const out: ServiceGroup[] = [];
		for (const s of slots) {
			let g = out.find((o) => o.appName === s.appName);
			if (!g) {
				g = { appName: s.appName, runs: [] };
				out.push(g);
			}
			let r = g.runs.find((o) => o.runs === s.runs);
			if (!r) {
				r = { runs: s.runs, slots: [] };
				g.runs.push(r);
			}
			r.slots.push(s);
		}
		return out;
	}

	/**
	 * ⭐ ROUND 11 r11c ITEM 4 — ONE GRID COLUMN PER ENVIRONMENT, SHARED BY
	 * EVERY ROW IN THE BUCKET. Measured live at 1024: `STAGING` sat at x=443
	 * on `hello-api-app`'s row and x=641 on `hello-frontend-app`'s — each
	 * `.rev-group-row` was an independent `flex-wrap` packing its own atoms
	 * left to right, so the SAME environment landed wherever the PRECEDING
	 * atom's own width (which differs row to row — a rolled-back place's
	 * atom carries an extra badge and its own age, an ordinary one does not)
	 * happened to end. `envColumnsFor` is the bucket-wide environment
	 * universe, sorted dev → staging → prod (`sortEnvironmentNames`, the
	 * product's one pipeline order); every row's OWN grid (`.rev-place-row`,
	 * below) shares the SAME `grid-template-columns` built from it, and
	 * every atom is placed by environment IDENTITY (`envColumnLine`), not by
	 * DOM position — a row missing an environment simply leaves that column
	 * empty rather than shifting everything after it.
	 *
	 * ⛔ `CSS subgrid` WAS THE FIRST DRAFT AND MEASURED BROKEN. The intent
	 * was `.rev-place-row` adopting the `<ul>`'s own tracks so every column
	 * sizes to the widest content any row puts in it, coordinated across
	 * rows for free — clean in theory, but the live Chromium build behind
	 * this dev server resolved the PARENT's own `max-content` columns to
	 * `0px` (nothing propagated up through the subgrid boundary) while each
	 * `<li>` independently resolved a DIFFERENT, unrelated width for the
	 * "same" column (140px on one row, 127px on the sibling) — measured via
	 * `getComputedStyle` on both the `<ul>` and each `<li>`, not a guess.
	 * FIXED-length columns sidestep the whole negotiation: every row's own
	 * grid, given the identical literal template string, resolves
	 * IDENTICALLY with no cross-row coordination required at all.
	 */
	function envColumnsFor(slots: CoverageSlotVM[]): string[] {
		return sortEnvironmentNames([...new Set(slots.map((s) => s.envLabel))]);
	}

	/**
	 * `160px` (name) then one FIXED-width track per environment, then the
	 * trailing fact's own flexible track. `145px` holds an ordinary env chip
	 * (`PROD`, ~40px) on one line; a chip carrying its own age suffix
	 * (`STAGING deployed 11d ago`, ~166px measured) or the rare compound
	 * case (a rolled-back place's badge plus its own age, ~235px measured)
	 * wraps onto a second line within its own cell instead of overflowing
	 * into the next column — see `.rev-env-atom`'s own `flex-wrap: wrap`.
	 *
	 * ⛔ MEASURED, NOT GUESSED, AND NARROWER THAN THE FIRST DRAFT (`170px`).
	 * At 170px/env, three environments plus the 160px name column and four
	 * 12px gaps already consumed 718 of a 751px content width at 1024 (the
	 * odd-card full-span rule does not fire here — this bucket card shares
	 * `.rev-buckets`' row with none other, but the row itself is still
	 * `.rev-buckets`' own single track at this width), leaving the trailing
	 * `minmax(0, 1fr)` column 33px — not enough for `on 2.66.0-66 [HELD]`
	 * (129px on one line, measured), and it visibly overlapped the PROD
	 * atom's own age text. `minmax(90px, 1fr)` on the trail column (below)
	 * gives it a real floor — `held`/`on 2.66.0-66` each fit that alone, and
	 * the trail's own `flex-wrap` (unchanged) still lets the two share a
	 * line when there is room.
	 */
	function envGridTemplate(envCols: string[]): string {
		return `minmax(160px, max-content) ${envCols.map(() => '145px').join(' ')} minmax(90px, 1fr)`;
	}

	/** 1-based grid line for this environment's OWN column — line 1 is the
	 *  name column, so environment index 0 starts at line 2. Falls back to
	 *  the trailing column if somehow asked for an environment the bucket
	 *  itself never named (defensive; every slot's `envLabel` comes from the
	 *  same set `envColumnsFor` built). */
	function envColumnLine(envCols: string[], envLabel: string): number {
		const idx = envCols.indexOf(envLabel);
		return idx >= 0 ? idx + 2 : envCols.length + 2;
	}

	/**
	 * ⛔ `NEWEST` ON A RELEASE DEPLOYED NOWHERE IS THE SAME LIE AS `NEWEST` ON
	 * ONE DEPLOYED EVERYWHERE. (2026-09-03, operator-walk BLOCKING item)
	 * `svc.rank === 0` is true of the row's own headline release whether or
	 * not anyone has actually taken it — it is a fact about the LADDER, not
	 * about deployment. `NEWEST` beside `2.67.0-67` here read exactly like
	 * `NEWEST` beside `1.66.0-66` on an ordinary, fully-arrived row: one badge,
	 * two different meanings, and nothing on the card said which one this
	 * was. `heldNewest` is true only when the coverage bar's OWN `live`
	 * bucket agrees nobody is on this exact release yet (`onOwnRelease` —
	 * same field the release-line clause above reads), so the chip and the
	 * clause cannot disagree about the same fact.
	 */
	function heldNewest(svc: RevisionService): boolean {
		if (!coverage || svc.rank !== 0) return false;
		const live = coverage.buckets.find((b) => b.key === 'live');
		const mine = live?.slots.filter((s) => s.appName === svc.appName) ?? [];
		return mine.length > 0 && mine.every((s) => !s.onOwnRelease);
	}

	/**
	 * ⭐ WHAT A `held` SERVICE ROW ACTUALLY RUNS, ON THE SAME ROW. (2026-09-03,
	 * operator-walk finding 4) `What each service calls it` printed `HELD
	 * 2.67.0-67` and stopped; forty pixels down, `Running it now` printed the
	 * SAME service on `2.66.0-66` — true, but reachable only by reading two
	 * cards and holding both in mind at once, which one live read out loud as
	 * a contradiction. This reads the identical `live` bucket `heldNewest`
	 * already checks, so the two can never name different releases. `null`
	 * when the places running it disagree on WHAT they run — a genuine split
	 * is not sayable as one label, and `DESIGN.md` forbids naming half of it.
	 */
	function runningLabelFor(svc: RevisionService): string | null {
		if (!coverage) return null;
		const live = coverage.buckets.find((b) => b.key === 'live');
		const mine = live?.slots.filter((s) => s.appName === svc.appName && !s.onOwnRelease) ?? [];
		if (mine.length === 0) return null;
		const runs = new Set(mine.map((s) => s.runs).filter((r): r is string => Boolean(r)));
		return runs.size === 1 ? [...runs][0] : null;
	}

	function rankChipFor(svc: RevisionService): {
		role: 'newest' | 'rank' | 'diverged' | 'held';
		label: string;
	} | null {
		const r = rankSentence(svc);
		if (!r) return null;
		// ⛔ THE WORD COMES FROM `rankLabel`, NOT FROM THIS FILE. (2026-09-01)
		// It said `diverged` — git's word for two branches — while `/apps`,
		// `/environments` and `/envs/*` all said `unreleased`, which is the
		// fact: this build is on no environment's release list. One fact, one
		// spelling, and it is now READ from the product's one formatter so
		// this call site cannot drift again. Same `diverged` Chip ROLE, same
		// colour value; only the string moves.
		if (svc.diverged) return { role: 'diverged', label: rankLabel({ kind: 'diverged' }) };
		if (heldNewest(svc)) return { role: 'held', label: 'held' };
		return { role: svc.rank === 0 ? 'newest' : 'rank', label: r.rank };
	}

	/* ════════════════════════════════════════════════════════════════════
	 * ROUND 11, B.4 — THE REPOSITORY PAGE. Everything below backs
	 * `/revisions/<repoSlug>` (rendered only when `repoPageLedger` resolves
	 * — B.1's resolution order, above). The build-page derived values above
	 * this point are untouched; this is a second, parallel set scoped to
	 * the whole repository rather than to one row.
	 * ════════════════════════════════════════════════════════════════════ */

	/** `?q=` at repository scope — same box, same behaviour as `/revisions`' own (B.5). */
	let repoSearchQuery = $state(page.url.searchParams.get('q') ?? '');
	const repoSearchActive = $derived(repoSearchQuery.trim().length > 0);
	const repoSearchNeedle = $derived(repoSearchQuery.trim().toLowerCase());

	$effect(() => {
		if (!repoPageLedger) return;
		const trimmed = repoSearchQuery.trim();
		if ((page.url.searchParams.get('q') ?? '') === trimmed) return;
		const params = new URLSearchParams(page.url.searchParams);
		if (trimmed) params.set('q', trimmed);
		else params.delete('q');
		const qs = params.toString();
		replaceState(qs ? `?${qs}` : page.url.pathname, page.state);
	});

	/**
	 * ⭐ B.5 — THE QUERY CARRIED IN THE BREADCRUMB, REGARDLESS OF MODE. The
	 * build page ignores `?q=` for its own filtering but still round-trips
	 * it through both breadcrumb links; the repository page's own live
	 * search box is the source of truth there instead.
	 */
	const carriedQuery = $derived(
		repoPageLedger ? repoSearchQuery.trim() : (page.url.searchParams.get('q') ?? '').trim()
	);
	function withQuery(href: string): string {
		return carriedQuery ? `${href}?q=${encodeURIComponent(carriedQuery)}` : href;
	}

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE LEDGER ITSELF IS
	 * `RepoLedgerCard` NOW (`filterable`), NOT A SECOND COPY OF ITS GRAMMAR.
	 * This route used to carry its own `.svc-name-btn` toggles and its own
	 * `.svc-ledger` grid, byte-similar to but drifting from the index's copy
	 * (item 2's grid-inset defects existed in one and not the other). The
	 * multi-select filter (B.4 item 4) is `RepoLedgerCard`'s own internal
	 * state now; `repoLines`/`repoMultiLine` survive here because the HERO
	 * cards below still need them.
	 */
	const repoLines = $derived(repoPageLedger ? releaseLines(repoPageLedger) : []);
	const repoMultiLine = $derived(repoLines.length > 1);

	/* ── THE HERO CARDS — one per release line (B.4 item 6, A.6.2's body) ── */
	const repoLeadRows = $derived(repoPageLedger ? leadRowsFor(repoPageLedger, repoLines) : []);
	/**
	 * ⭐ ROUND 11 OPERATOR-WALK, FINDING 3 — HEROES AND THE HELD BANNER
	 * FOLLOW `?q=` TOO. A query that excludes `hello-frontend-app` must not
	 * go on naming it in a hero title or counting its held places into the
	 * banner — both are read off THIS filtered set now, never off
	 * `repoLeadRows` directly. A row survives the filter if the query
	 * matches its own sha/label (`matchesRevisionText`) OR names at least
	 * one of its services — the same two-part test the index's own
	 * `heroMatchedServices` idiom applies, generalised to "does this row
	 * belong in the filtered view at all" rather than just "which of its
	 * services does the title still name".
	 */
	function repoRowMatchesFilter(row: RevisionRow): boolean {
		if (!repoSearchActive) return true;
		if (matchesRevisionText(row, repoSearchNeedle)) return true;
		return row.services.some((s) => s.appName.toLowerCase().includes(repoSearchNeedle));
	}
	const repoVisibleLeadRows = $derived(repoLeadRows.filter(repoRowMatchesFilter));
	function repoHeroMatchedServices(row: RevisionRow): RevisionService[] {
		if (!repoSearchActive) return row.services;
		const matched = row.services.filter((s) => s.appName.toLowerCase().includes(repoSearchNeedle));
		return matched.length > 0 ? matched : row.services;
	}
	function repoHeroServicesLabel(names: string[]): string {
		if (names.length <= 3) return names.join(' · ');
		return `${names.slice(0, 3).join(' · ')} +${names.length - 3} more`;
	}

	/**
	 * ⭐ SECOND OPERATOR WALK, ITEM 2 (BLOCKING) — RECOUNT, NOT DIM.
	 * `?q=hello-api` on `kuberik-testing` used to compute the hero's coverage
	 * bar, count and `HELD` chip from `revisionCoverage(leadRow, coarse)` —
	 * every service on the release line, `hello-frontend-app` included —
	 * while the hero's own TITLE already narrowed to the matching service
	 * alone (`repoHeroMatchedServices`). That printed `hello-api-app`'s own
	 * hero as `6 of 6 places · … held`, a fact about a service the query
	 * never named. THE DECISION: a filtered view recounts on the matching
	 * services — coverage, the held banner and the head band all read this
	 * one function rather than the unfiltered row, so a query narrows every
	 * number on the page in lockstep, not just the rows a reader can see.
	 * `repoHeroMatchedServices` already falls back to every service when the
	 * query matched the BUILD itself (sha/label) rather than a service name,
	 * so the "whole build matched" case still gets full, honest coverage.
	 */
	function repoHeroCoverage(row: RevisionRow): RevisionCoverage {
		// ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 5 (HOIST) — the narrowing
		// arithmetic itself now lives in `revision-coverage.ts` as
		// `repoHeroCoverage` (imported here as `coverageForServices` to keep
		// this route's own, query-aware wrapper name); this only supplies
		// the services `?q=` actually matched and the page's clock.
		return coverageForServices(row, repoHeroMatchedServices(row), coarse);
	}
	function repoCommitUrlFor(revision: string): string | null {
		if (!repoPageLedger || !repoPageLedger.repoKey.startsWith('repo:')) return null;
		const body = repoBody(repoPageLedger.repoKey);
		return body.includes('/') ? `https://${body}/commit/${revision}` : null;
	}

	/* ── THE HELD BANNER — one per repository, aggregated across every lead row (B.4 item 5) ── */
	const repoHeldSlots = $derived.by<CoverageSlotVM[]>(() => {
		const out: CoverageSlotVM[] = [];
		for (const row of repoVisibleLeadRows) {
			const cov = repoHeroCoverage(row);
			out.push(...heldBehind(cov).filter((s) => s.blockingGates.length > 0));
		}
		return out;
	});
	/** Distinct held ROLLOUTS — two places blocked by the identical contract get one story, not two. */
	const repoHeldStories = $derived.by<BlockingStory[]>(() => {
		const seen = new Set<string>();
		const out: BlockingStory[] = [];
		for (const s of repoHeldSlots) {
			const key = `${s.slot.cell.sourceCluster}/${s.slot.cell.rollout.metadata?.namespace}/${s.slot.cell.rollout.metadata?.name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(blockingStory(s.slot.cell.rollout, gateContext, { place: s.envLabel, now: coarse }));
		}
		return out;
	});
	const repoHeldSubject = $derived.by<string>(() => {
		const apps = [...new Set(repoHeldSlots.map((s) => s.appName))];
		return apps.length === 1 ? apps[0] : `${apps.length} services`;
	});
	const repoHeldPrimary = $derived.by<{ appHref: string; appName: string } | null>(() => {
		for (const s of repoHeldSlots) {
			const story = blockingStory(s.slot.cell.rollout, gateContext, { place: s.envLabel, now: coarse });
			const dep = story.gates.find((g) => g.kind === 'dependency' && g.subject);
			if (dep) return { appHref: `/apps/${encodeURIComponent(dep.subject!)}`, appName: dep.subject! };
		}
		return null;
	});
	/**
	 * One sentence per held release line — `releaseSplitSentence`
	 * (`revision-coverage.ts`, imported above), the SAME rollback-aware
	 * grammar the build page's own banner uses. This repo-page wrapper only
	 * adds the per-lead-row loop `releaseSplitSentence` itself does not
	 * know about.
	 */
	const repoHeldMessage = $derived.by<string>(() => {
		const parts: string[] = [];
		for (const row of repoVisibleLeadRows) {
			const cov = repoHeroCoverage(row);
			if (heldBehind(cov).filter((s) => s.blockingGates.length > 0).length === 0) continue;
			const sentence = releaseSplitSentence(cov);
			if (sentence) parts.push(sentence);
		}
		return parts.join(' ');
	});
	const repoHasSchedule = $derived(repoHeldStories.some((story) => story.iconKind === 'clock'));
	/** ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 — the places `repoHeldStories` covers, for `HeldBanner`'s own `orderClause`. */
	const repoHeldEnvLabels = $derived([...new Set(repoHeldSlots.map((s) => s.envLabel))]);

	/**
	 * ⭐ SECOND OPERATOR WALK, ITEM 2 (BLOCKING) — RECOUNTS ON `?q=` TOO.
	 * This used to walk `repoLeadRows` (every release line, unfiltered) and
	 * `revisionCoverage(row, coarse)` (every service on it) regardless of
	 * `?q=`, so `/revisions/…/kuberik-testing?q=hello-api` kept printing
	 * "3 held" — the SAME figure the unfiltered page shows — while the
	 * ledger three lines below it drew one row. Now reads `repoVisibleLeadRows`
	 * (lines `?q=` excludes entirely are not counted) and `repoHeroCoverage`
	 * (a line `?q=` narrows to one service is counted on that service alone),
	 * the identical two functions the hero and the held banner already use —
	 * one recount, three consumers, so they cannot disagree again.
	 */
	const repoAttention = $derived.by(() => {
		let held = 0;
		let deploying = 0;
		let behind = 0;
		for (const row of repoVisibleLeadRows) {
			const cov = repoHeroCoverage(row);
			deploying += cov.buckets.find((b) => b.key === 'deploying')?.slots.length ?? 0;
			held += heldBehind(cov).filter((s) => s.blockingGates.length > 0).length;
			const notYet = cov.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
			behind += notYet.filter((s) => !s.slot.onRevision).length;
		}
		return { held, deploying, behind, total: held + deploying + behind };
	});
	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE HEAD BAND'S OWN
	 * "no match" GUARD, DECOUPLED FROM THE LEDGER CARD. This used to read
	 * the ledger's own `repoLedgerNoMatch` (which also folded in the
	 * ledger's row-toggle SELECTION, not just `?q=`) — now that the ledger
	 * lives in its own component, the head band asks the same question a
	 * different way: did an ACTIVE search leave nothing for the hero rows
	 * to show. Without this guard, a search matching nothing would fall
	 * through to `repoAttention.total === 0`'s "Everything on its newest
	 * build" — a false convergence claim for a repo the search excluded
	 * entirely, not one that has actually converged.
	 */
	const repoSearchNoMatch = $derived(repoSearchActive && repoVisibleLeadRows.length === 0);
	function repoAttentionSentence(a: {
		held: number;
		deploying: number;
		behind: number;
		total: number;
	}): string {
		if (a.total === 0) return 'every place is on its newest build';
		const parts: { n: number; w: string }[] = [];
		if (a.deploying > 0) parts.push({ n: a.deploying, w: 'deploying' });
		if (a.held > 0) parts.push({ n: a.held, w: 'held' });
		if (a.behind > 0) parts.push({ n: a.behind, w: 'behind' });
		const clause = parts.length === 1 ? parts[0].w : parts.map((p) => `${p.n} ${p.w}`).join(' · ');
		return `${clause} · every other place on its newest build`;
	}
	const repoStreamHealthy = $derived(isEventStreamHealthy());

	/* ── SKELETON — B.8, repository page ── */
	const REPO_SHAPE_KEY = 'revisions/repo';
	type RepoShape = {
		services: number;
		heroes: number;
		heldBanner: boolean;
		running: number;
		retired: number;
		pending: number;
	};
	const repoRemembered = recallShape<RepoShape>(REPO_SHAPE_KEY);
	const repoSkelServices = repoRemembered?.services ?? 3;
	const repoSkelHeroes = repoRemembered?.heroes ?? 1;
	const repoSkelHeldBanner = repoRemembered?.heldBanner ?? false;
	const repoSkelRunning = repoRemembered?.running ?? 3;
	const repoSkelRetired = repoRemembered?.retired ?? 2;
	const repoSkelPending = repoRemembered?.pending ?? 2;

	$effect(() => {
		if (query.isLoading || query.isError || !repoPageLedger) return;
		const headRevisions = new Set(repoLeadRows.map((r) => r.revision));
		rememberShape(REPO_SHAPE_KEY, {
			services: Math.min(serviceLedger(repoPageLedger).length, 5),
			heroes: Math.min(repoLeadRows.length, 5),
			heldBanner: repoHeldSlots.length > 0,
			running: Math.min(restRows(repoPageLedger, headRevisions).length, 5),
			retired: Math.min(pastRows(repoPageLedger, headRevisions).length, 5),
			pending: Math.min(repoPageLedger.pending.length, 5)
		});
	});
</script>

<svelte:head>
	<title
		>kuberik | {repoPageLedger
			? repoTitle(repoPageLedger.repoLabel)
			: row
				? row.short
				: urlKey}</title
	>
</svelte:head>

<div class="rev-cq mx-auto w-full px-4 py-6 sm:px-6">
	<!--
		⭐ ROUND 11, B.4 ITEM 1 — THE TRAIL. `All revisions` on the repository
		page; `All revisions › kuberik-testing` on the build page (the repo
		item linking to `/revisions/<repoSlug>{?q}`). The CURRENT object is
		never in its own trail — the head band names it — and there is no
		arrow glyph and no `.btn`: this is navigation, and it looks like it.
		Both links carry `?q=` (B.5) via `withQuery`.

		⭐ ROUND-4 CRAFT REVIEW, ITEM B — see `cameFromList`'s own comment
		above. `<button>`, not `<a>`, in the `history.back()` branch: it is
		not a URL, the same reasoning `+error.svelte`'s own `Go back`
		control already uses.
	-->
	<nav
		class="t-dense mb-4 flex min-w-0 flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400"
		aria-label="Breadcrumb"
	>
		{#if cameFromList}
			<button type="button" class="nav-link" onclick={() => history.back()}>All revisions</button>
		{:else}
			<a class="nav-link" href={withQuery('/revisions')}>All revisions</a>
		{/if}
		{#if !repoPageLedger && ledger}
			<ChevronRightOutline class="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
			<a class="nav-link min-w-0 truncate" href={withQuery(`/revisions/${repoSlug(ledger.repoKey)}`)}
				>{repoTitle(ledger.repoLabel)}</a
			>
		{/if}
	</nav>

	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this revision"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-4 mb-0" />
		{#if guessRepoPageWhileLoading}
			<!--
				⭐ ROUND 11, B.8 — REPOSITORY PAGE SKELETON RESERVE. head band
				(28px) → search (36px) → ledger card (47 + services×26 + 53) →
				held-banner skeleton, only when last remembered as present →
				heroes (47px header + 48px bar body each) → `.rev-cols` block
				sized from the remembered running/retired/pending counts.
			-->
			<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1" aria-hidden="true">
				<span class="skel-block h-6 w-32"></span>
				<span class="skel-block h-7 w-8"></span>
				<span class="skel-block h-3.5 w-56"></span>
			</div>
			<div class="relative mt-1 w-full sm:max-w-sm" aria-hidden="true">
				<input
					type="text"
					disabled
					placeholder="Find a build or service"
					class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
				/>
			</div>
			<div
				class="mt-5 flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
				aria-hidden="true"
			>
				<div
					class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60"
				>
					<span class="skel-block h-3.5 w-48"></span>
					<span class="skel-block h-4 w-20 shrink-0"></span>
				</div>
				<div class="flex flex-col gap-1.5 p-2">
					{#each Array(repoSkelServices) as _, r (r)}
						<span class="skel-block h-[26px] w-full"></span>
					{/each}
				</div>
				<div class="skel-block h-[53px] w-full border-t border-gray-100 dark:border-gray-700/60"></div>
			</div>
			{#if repoSkelHeldBanner}
				<div class="skel-block mx-4 my-4 h-[122px] w-[calc(100%-2rem)] sm:h-[122px]" aria-hidden="true"
				></div>
			{/if}
			{#each Array(repoSkelHeroes) as _, h (h)}
				<div
					class="mt-5 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
					aria-hidden="true"
				>
					<div
						class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
					>
						<span class="skel-block h-3.5 w-48"></span>
						<span class="skel-block h-4 w-24 shrink-0"></span>
					</div>
					<div class="p-4">
						<span class="skel-block block h-4 w-full"></span>
					</div>
				</div>
			{/each}
			<div class="rev-cols mt-4" aria-hidden="true">
				<div class="flex min-w-0 flex-col gap-4">
					<CardSkeleton titleWidth="w-32" rollupWidth="w-16" rows={repoSkelRunning} rowHeight={37} />
					<CardSkeleton titleWidth="w-36" rollupWidth="w-16" rows={repoSkelRetired} rowHeight={37} />
				</div>
				<div class="flex min-w-0 flex-col gap-4">
					<CardSkeleton titleWidth="w-28" rollupWidth="w-16" rows={repoSkelPending} rowHeight={35} />
				</div>
			</div>
		{:else}
			<!--
				⭐ THE `h1` + THE SAME `.rev-buckets` 2-COLUMN GRID THE LOADED
				BUILD PAGE USES, NOT A LONE CENTRED SPINNER. (2026-09-04,
				load-state audit finding 11) The head row and the 2×2 grid
				(`This build` / `What each service calls it` in row 1, measured
				593×341 and 593×242, two more bucket cards in row 2) had no
				placeholder at all. `.rev-buckets` is this file's own scoped
				class, so the identical 640px container query that reflows the
				real grid reflows this one too.
			-->
			<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1" aria-hidden="true">
				<span class="skel-block h-6 w-24"></span>
				<span class="skel-block h-7 w-8"></span>
				<span class="skel-block h-3.5 w-56"></span>
			</div>
			<div class="rev-buckets mt-4">
				<CardSkeleton titleWidth="w-24" rollupWidth="w-20" rows={6} rowHeight={37} />
				<CardSkeleton titleWidth="w-44" rollupWidth="w-16" rows={6} rowHeight={37} />
				<CardSkeleton titleWidth="w-28" rollupWidth="w-16" rows={4} rowHeight={35} />
				<CardSkeleton titleWidth="w-24" rollupWidth="w-16" rows={4} rowHeight={35} />
			</div>
		{/if}
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
			subject="this revision"
			backHref="/revisions"
			backLabel="Back to all revisions"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-4"
		/>
	{:else if repoPageLedger}
		<!--
			⭐ ROUND 11, B.4 — THE REPOSITORY PAGE, LOADED. Order: head band →
			search → ledger card (§7a, the multi-select filter lives here now,
			B.2's own closing rule) → held banner → hero card(s), one per
			release line → `.rev-cols` (BuildLists, the three build lists
			Lane 2 extracted). Landmark order pinned by B.6:
			['<repo>', 'What each service runs', /^Newest build ·/,
			'Also still running', 'No longer running anywhere',
			'No deploy on record'] — round 11 QA, item 13 renamed the rail's
			heading from the old, conditional 'Never deployed'/'No deploy on
			record' pair to one fixed string; see `BuildLists.svelte`'s own
			`pendingTitle` for why.
		-->
		<div class="mb-5">
			<!--
				⭐ B.4 ITEM 2 — `repoTitle(repoLabel)` IS THE PAGE'S REAL `h1` HERE,
				not `sr-only`: the navbar prints the ROUTE name (`Revisions`), so
				the repository's own name is not a duplicate — the rule the
				`sr-only h1` exists for does not bite on this page.

				⭐ ROUND 11 REVISIONS-PASS-6, ITEM 2 — THE NAME IS ITS OWN LINE.
				The `h1` used to share a `flex` row with the verdict figure,
				which put `kuberik-testing 3` on one baseline — the repo's name
				jammed against the count as if `3` were part of it. The name is
				a block on its own line now; the figure + sentence below it is
				the SAME second line the index's own head band draws (just the
				`h1` there is `sr-only`, so visually it was already only ever
				one line).
			-->
			<h1 class="t-display block text-gray-900 leading-[1.15] dark:text-white">
				{repoTitle(repoPageLedger.repoLabel)}
			</h1>
			<div class="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
				<!--
					⭐ SECOND OPERATOR WALK, ITEM 6 — RULES 2-4 CARRY NO NUMERAL.
					A bare `0` printed here every time this repository's head
					was already on its newest build everywhere — the SAME rule
					`RepoLedgerCard`'s own verdict rollup already follows (a
					chip only when `held`, otherwise words with no leading
					digit). The figure draws only when it is actually counting
					something.
				-->
				{#if repoSearchNoMatch}
					<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
						No build matches “{repoSearchQuery.trim()}”.
					</p>
				{:else}
					{#if repoAttention.total > 0}
						<span class="t-display text-gray-900 tabular-nums dark:text-white"
							>{repoAttention.total}</span
						>
					{/if}
					<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
						<!--
							⭐ SECOND OPERATOR WALK, ITEM 2 — THE HEAD BAND NAMES THE
							FILTER IT IS RECOUNTING ON. Without this prefix, a
							recounted "held · every other place on its newest
							build" reads exactly like the UNFILTERED sentence — the
							reader has no way to tell the page is not describing the
							whole repository any more.
						-->
						{repoSearchActive ? `matching “${repoSearchQuery.trim()}”: ` : ''}{repoAttentionSentence(
							repoAttention
						)}
					{#if repoStreamHealthy}
						· live
					{:else if query.dataUpdatedAt}
						· updated
						<time
							datetime={new Date(query.dataUpdatedAt).toISOString()}
							title="Change stream disconnected; showing data fetched at {new Date(
								query.dataUpdatedAt
							).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"
							>{new Date(query.dataUpdatedAt).toLocaleTimeString([], {
								hour: '2-digit',
								minute: '2-digit'
							})}</time
						>, stream down
					{/if}
					</p>
				{/if}
			</div>
		</div>

		<RevisionSearch bind:value={repoSearchQuery} />

		<!--
			⭐ ROUND 11 CRAFT FINDING 4 — DECISION: A CONTAINER QUERY, NOT AN
			IN-PAGE LINK. Below `sm` the ledger card can run to many rows
			(one per service), which would otherwise put the held banner
			three screens down on a repository with a real roster. Chose the
			reorder over "the head band's alarm chip is an in-page link to
			the banner" because this page's head band carries no alarm CHIP
			of its own to anchor from (B.4 item 2 is a figure + sentence, not
			a chip — unlike the index's header) — inventing one only to link
			it somewhere else on the same screen is a second control for a
			fact the reorder answers structurally, for free, with no new
			affordance to explain. `.rev-repo-top` is `display: flex;
			flex-direction: column` with `order` swapped in the container
			query below `sm`, so the banner (when present) always precedes
			the ledger there.
		-->
		<div class="rev-repo-top">
		<div class="rev-repo-ledger">
		<!--
			⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — ONE LEDGER. This used
			to be a second, hand-rolled copy of `RepoLedgerCard`'s own grammar
			(`.svc-name-btn` toggles, its own `.svc-ledger` grid) — now the
			SAME component the index renders, with `filterable` turning row
			names into the multi-select toggle B.4 item 4 asks for and the
			header into the plain "What each service runs" / "N services"
			shape instead of the index's link-out header.
		-->
		<RepoLedgerCard
			repo={repoPageLedger}
			now={coarse}
			query={repoSearchQuery}
			filterable
			repoUrl={repoPageLedger.repoKey.startsWith('repo:') && repoBody(repoPageLedger.repoKey).includes('/')
				? `https://${repoBody(repoPageLedger.repoKey)}`
				: null}
			class=""
		/>
		</div>

		<!--
			⭐ B.4 ITEM 5 — THE HELD BANNER, UNDER THE LEDGER AT `sm`+, NEVER
			COLLAPSIBLE (round 7.3, unchanged — only its address moved, from
			the index to here). Whenever a hold exists anywhere in this
			repository. See the finding-4 decision comment above
			`.rev-repo-top` for why it precedes the ledger below `sm` instead.
		-->
		{#if repoHeldSlots.length > 0}
			<div class="rev-repo-banner">
				<HeldBanner
					subject={repoHeldSubject}
					releaseSplitMessage={repoHeldMessage}
					stories={repoHeldStories}
					heldEnvLabels={repoHeldEnvLabels}
					primaryHref={repoHeldPrimary?.appHref ?? null}
					primaryLabel={repoHeldPrimary?.appName ?? null}
					hasSchedule={repoHasSchedule}
					indefinite={storiesAreIndefinite(repoHeldStories)}
				/>
			</div>
		{/if}
		</div>

		<!--
			⭐ B.4 ITEM 6 — ONE HERO PER RELEASE LINE, A.6.2's ALWAYS-DRAWN-BAR
			BODY. Round 11, finding 3 — `repoVisibleLeadRows`, not
			`repoLeadRows`: a hero for a line `?q=` excludes is not drawn at
			all, the same rule the held banner above already follows.
		-->
		{#each repoVisibleLeadRows as leadRow, li (leadRow.revision)}
			{@const cov = repoHeroCoverage(leadRow)}
			{@const heroServices = repoHeroMatchedServices(leadRow)}
			{@const heroNames = heroServices.map((s) => s.appName)}
			{@const heroTitleTail = repoHeroServicesLabel(heroNames)}
			{@const heldSlotsForRow = heldBehind(cov).filter((s) => s.blockingGates.length > 0)}
			{@const heldLabel =
				heldSlotsForRow.length > 0
					? leadRow.services.find((s) => heldSlotsForRow.some((hs) => hs.appName === s.appName))
							?.label ?? leadRow.short
					: null}
			<!--
				⭐ ROUND 11 r11c FINDING 8 — THE HEADER ROLLUP NAMES ONLY THE
				HELD/OTHER FACT, NEVER THE COUNT. `heroVerdict` used to open
				with `${cov.liveCount} of ${cov.totalCount} places` — the exact
				sentence `RevisionLead`'s own `.lead-compact-count` already
				prints 48px below it (`compact`'s count line, above the bar).
				One header saying the identical figure twice with 48px of
				vertical distance between them is the repetition this file's
				own `heroVerdict` note elsewhere warns against.

				⛔ ⭐ LANE 9, ROUND 11 QA, ITEM 12 — BUT `null` WAS "PRINT
				NOTHING", NOT "NOTHING HELD". `Card`'s own `{:else if verdict}`
				guard hides the rollup slot entirely on `null`, so a hero with
				no held sibling had NO right-hand rollup at all — measured
				live, ink covering only 57% of the header width, the release
				label(s) this build ships under simply missing. The head band
				always prints its release label(s) (`064b655` when the only
				label is the sha itself; `2.66.0-66 · 2.67.0-67` when the
				commit ships under several) — the hero's own header rollup
				must too, falling back to that same fact rather than to
				nothing. `heldLabel` still wins when it exists (the held fact
				is the more important one to lead with).
			-->
			{@const heroLabels = leadRow.labelGroups.map((g) => g.label).join(' · ')}
			{@const heroVerdict = heldLabel ? `${heldLabel} held` : heroLabels}
			<Card
				icon={RocketOutline}
				title="Newest build {leadRow.short} · {heroTitleTail}"
				verdict={heroVerdict}
				verdictTitle="Everything below is counted across the services that have a release for this commit."
				titleHref={revisionPath(repoPageLedger.repoKey, leadRow.revision)}
				class={repoMultiLine && li < repoVisibleLeadRows.length - 1 ? 'mt-4 mb-4' : 'mt-4'}
			>
				<RevisionLead
					short={leadRow.short}
					href={null}
					eyebrow="Newest build"
					coverage={cov}
					spread={false}
					showHeldChip
					compact
				>
					{#if repoCommitUrlFor(leadRow.revision)}
						<a
							class="nav-link"
							href={repoCommitUrlFor(leadRow.revision)}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`View the commit for ${leadRow.short} on GitHub — opens in a new tab`}
						>
							View commit
							<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
						</a>
					{/if}
				</RevisionLead>
			</Card>
		{/each}

		<!-- ⭐ B.4 ITEM 7 — `.rev-cols`, EXTRACTED TO `BuildLists` (Lane 2). -->
		<BuildLists
			repo={repoPageLedger}
			now={coarse}
			query={repoSearchQuery}
			storageKey={page.url.pathname}
		/>
	{:else if !row || !ledger || !coverage}
		<!--
			⛔ A REPO THAT DOES NOT EXIST WAS CALLED A "REVISION NOT FOUND", AND
			THE REVISION IT NAMED WAS A REPO SEGMENT. (2026-09-03,
			operator-walk) `/versions/github.com/littlechimera/no-such-repo` —
			three path segments, no revision anywhere in it — printed `Nothing
			in github.com/littlechimera knows the revision no-such-repo.`. The
			URL scheme (`repoPath` + `/` + `key`) always pops the LAST segment
			as the "revision", so a bare repo path with nothing after it gets
			its own final segment relabelled as one; `repoPath` is then an
			OWNER, not a repo, and matches nothing by construction.

			`!ledger` is exactly that case — the split-based lookup found no
			repo AT ALL — and is now told apart from the real "revision not
			found IN a real repo" case (`ledger` resolved, `row`/`coverage`
			did not). The rejoined FULL path is what the reader actually
			typed or followed; that is the object that does not exist, not a
			revision inside a truncated one.
		-->
		<!--
			⛔ ⭐ ROUND 6, LANE 10 — THIS WAS BARE CENTRED TEXT WITH A `←`, THE
			ONLY NOT-FOUND STATE IN THE PRODUCT THAT WAS NOT `ErrorState`.
			`/rollouts/<cluster>/<namespace>/<name>` draws its own "does not
			exist" fact (a successful fetch, object absent — the identical
			CLASS of fact this branch is) as `ErrorState`'s own filled
			`AlertPanel`, `Try again` and a trailing `›`; this page instead
			hand-rolled a centred icon, an `<h1>`, and a leading `←` — a
			SECOND not-found grammar, and the one arrow in the product
			pointing the wrong way. `ApiError`'s own `isMissing` branch is
			built for exactly "this address does not resolve to a real
			object" — a synthetic `404` carries the same headline
			(`errorHeadline`: "This repository/revision does not exist") and
			consequence (`errorConsequence`: "It may have been deleted, or
			the address may be wrong.") `ErrorState` already renders for a
			REAL 404 twelve lines up this same branch chain, so the two read
			as one fact, not two dialects — same as the rollout precedent's
			own note on this. The specific address the reader typed still
			survives, in `errorFacts`'s "Address" field (the URL each
			synthetic error carries below), which is exactly where `/rollouts`'
			own missing-object case puts its `namespace/name` pair.
		-->
		<ErrorState
			error={!ledger
				? new ApiError(404, 'not found', '', `/revisions/${wholeSlugPath}`)
				: new ApiError(404, 'not found', '', `/revisions/${repoPath}/${urlKey}`)}
			subject={!ledger ? 'this repository' : 'this revision'}
			backHref="/revisions"
			backLabel="Back to all revisions"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-4"
		/>
	{:else}
		<!--
			⭐ THE HERO IS THE HEAD BAND NOW, THE SAME ROW `/versions`, `/activity`
			AND `/dependencies` LEAD WITH. (2026-09-02, design re-check: *"the
			hero is eight ungrouped lines on the page ground … the page's rollup
			floating 1180px away top-right; it is the one region with no card."*)

			`RevisionLead`'s two-column hero (eyebrow / sha / count / bar) is gone
			from THIS page — it stays exactly as it was on `/versions`, where it
			leads a card and is the page's only object. Here the object is named
			ONCE, at display scale, in one row: an `sr-only` `h1` (the object's
			full name, for the outline and for a screen reader), the sha at
			`t-display-id`, and the coverage count at `t-display` on its baseline.
			Everything else this build has to say — the commit, the repo, the
			services, when it last moved, the outbound link — moved into ONE
			titled card below (`This build`), which is also the card that gives
			the page's previously 39%-empty viewport something to hold. See the
			`rev-buckets` block for it.

			⛔ `BuildStateMark` USED TO SIT HERE TOO, AND IT WAS A SECOND
			STATEMENT OF THE SAME NUMBER. (2026-09-02, residue.) `3 of 6 places
			running it` and, 40px later, `⧗ 3 places still to go` say one fact
			twice — the second is `buildState()`'s word for whichever bucket
			dominates, and on THIS page that bucket already has its own titled
			card with its own count (`Not here yet · 3 places`). The count stays
			here ONCE; the state word lives on the card that owns it. `/versions`'
			list row had the identical duplication (the word beside the sha,
			`Running in N of M places` in the roll column) and is fixed the same
			way — see the comment there.
		-->
		<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
			<h1 class="sr-only">Tracking build {row.short} in {repoTitle(ledger.repoLabel)}</h1>
			<!--
				⭐ ROUND 11 CRAFT FINDING 7 — THE NUMERAL LEADS, LARGER AND LIGHTER
				THAN THE SHA. `REVISION-PAGES.md`'s own hero anatomy: the places
				figure is the largest mark on the row (light weight, so its SIZE
				— not its boldness — is what makes it lead), the sha sits beside
				it at a smaller, heavier mono weight. `.rev-hero-figure`/
				`.rev-hero-sha` are this file's own scoped sizes (Svelte-scoped
				rules outrank a utility class per `lib/CLAUDE.md`'s layering note)
				— `t-display`/`t-display-id` stay at their product-wide 24px
				everywhere else this pair is used.

				⭐ ROUND 11 REVISIONS-PASS-6, ITEM 3 — THE DENOMINATOR MOVES INTO
				THE FIGURE, AND THE SENTENCE ALWAYS WRAPS BENEATH. Measured live
				at 1440: figure, sha and the full caption sentence all shared one
				row with no break (`.rev-head-break` only forced a line below
				559px), so `6 9f10e49 of 6 places run this build · 1 place rolled
				back to it · …` ran as one 150-character line — the "jam" was
				the caption crowding the sha, not a spacing bug between the two.
				`.rev-hero-denom` is the smaller "of M" REVISION-PAGES.md's own
				anatomy attaches to the numerator (`N`, smaller `/M` suffix) — so
				the figure alone answers "how many, out of how many" as one visual
				unit, and the caption below it no longer repeats the denominator
				("of 6 places run this build" → "places run this build"). The
				break is UNCONDITIONAL now, not gated to `max-width: 559px` — the
				sentence is always the head band's own second line, capped at
				`.rev-head-caption`'s `80ch` — and never orphans the figure alone
				the way the break's old position (between sha and figure) could.

				⭐ ITEM 2 (round-8 critique) — A RELEASE, NEVER A "BUILD". This sha
				has exactly one build; what is held is a newer RELEASE of it,
				via `headBandHeldClause` (round 11 finding 1 — `releaseHeldClause`,
				not a hand-rolled "held from a newer release": the held sibling is
				THIS SAME COMMIT under a newer label, never a second build).
			-->
			<span class="rev-hero-figure text-gray-900 tabular-nums dark:text-white"
				>{coverage.liveCount}<span class="rev-hero-denom text-gray-500 dark:text-gray-400"
					>&nbsp;of {coverage.totalCount}</span
				></span
			>
			<span class="rev-hero-sha t-display-id text-gray-900 dark:text-white">{row.short}</span>
			<span class="rev-head-break" aria-hidden="true"></span>
			<!--
				⚠️ THE SENTENCE STAYS "places run this build …", BYTE FOR BYTE
				after its own "of {N}" lead — `deploying.svelte.test.ts` pins the
				remainder in one text node. The denominator moved into the figure
				above (this comment's own block); the caption keeps naming what
				it is a caption OF.
			-->
			<span
				class="rev-head-caption t-body text-gray-500 dark:text-gray-400"
				title="A place is one service in one environment."
				>places run this build{headBandDeployingCount > 0
					? ` · ${headBandDeployingCount} deploying`
					: ''}{headBandRolledBackCount > 0
					? ` · ${countLabel(headBandRolledBackCount, 'place')} rolled back to it`
					: ''}{headBandHeldClause ? ` · ${headBandHeldClause}` : ''}</span
			>
		</div>

		<!--
			⭐ ROUND 11, A.6.3 — THE BAR COMES BACK TO THE HEAD BAND, AND IT
			ALWAYS DRAWS. Replaces the old painted-track fallback (which
			lived inside `This build`, below, and was gated on
			`liveCount > 0 && liveCount < totalCount` — false on every 0% and
			every 100% build, i.e. false on this fleet's every fully-arrived or
			never-deployed row). `CoverageBar` at its default (16px) scale,
			under the figure line, full width — the same object the list's own
			hero draws, at the same scale.
		-->
		<!--
			⭐ LANE 6B ADDITION — `cells`, so each cell in this bar carries its
			own "dev · hello-api-app · running this build" title the same way
			`RevisionLead`'s hero bar already does; without it this bar was
			the one `CoverageBar` caller left titling the GROUP only.

			⭐ LANE 9, ROUND 11 QA, ITEM 4 — `neverDeployed` (declared above,
			at `row`/`revision` resolution — it was computed and then never
			read, an eslint-reported dead assignment) is exactly "zero live
			and zero ran-before": `!ledger.rows.includes(row)` is true only
			when this build lives in `ledger.pending`, i.e. no service has
			EVER deployed it. Passed through so this build page's own bar
			draws all track, not "moved past", on that one build — the same
			fix `BuildLists`' rail already applies to every pending row.
		-->
		<CoverageBar
			segments={coverageBarSegments(coverage, neverDeployed)}
			cells={coverageCells(coverage, neverDeployed)}
			label={coverageBarLabel(coverage, row.short)}
			class="mt-3 w-full"
		/>

		<!--
			⛔ THE RELEASE-LINE PARAGRAPH IS GONE (ITEM 2, 2026-09-06 round-7
			critique). `3 of them on 2.66.0-66; 2.67.0-67 is held in dev,
			staging and prod.` restated two facts the page already states
			elsewhere: how many are held is the head band's own
			`headBandHeldCount` sentence 12px up, and WHICH release is held
			and WHERE is now the banner's own headline (`bannerTitle`, named
			below) and its `message` (`held in dev, staging and prod` — see
			`bannerMessage`'s own comment). One fact, once, named by the
			banner's subject rather than restated in prose above it.
		-->

		<!--
			THE ONE BLOCKING FACT, AS A FILLED FIELD. `AlertPanel` IS the object
			rollout detail draws its schedule gate in — 40px circular icon, bold
			headline, the concrete consequence underneath, a chip on the right.
			ONE banner: a page with three has none.
		-->
		{#if blockedSlots.length > 0}
			<!--
				⭐ ROUND 11 CRAFT FINDING 7 — `HeldBanner`, NOT A HAND-ROLLED
				`AlertPanel` WITH A `footnoteBody`/`footnoteLabel` DISCLOSURE.
				The old `‹ Waiting on … › then dev → staging → prod` trigger was
				`AlertPanel`'s own disclosure summary — `whitespace-nowrap` by
				that component's contract, right for a short label and wrong
				for this one: measured live at 390 it clipped mid-sentence with
				no way to read the rest. `HeldBanner` (Lane 2's extraction from
				this exact banner shape) prints the same facts as a plain,
				always-visible, wrapping paragraph instead — nothing here hides
				behind a `<summary>` any more. `distinctBuildStories` is one
				`blockingStory` per rollout (`slotStories` deduped by place,
				the identical predicate `repoHeldStories` uses on the
				repository page, so the two pages cannot converge on two
				different held vocabularies for the same kind of fact).
			-->
			<div class="mt-4">
			<HeldBanner
				subject={bannerBuildSubject}
				releaseSplitMessage={bannerMessage}
				stories={distinctBuildStories}
				heldEnvLabels={buildHeldEnvLabels}
				primaryHref={primaryHold?.appHref ?? null}
				primaryLabel={primaryHold?.reason.subject ?? null}
				hasSchedule={buildHasSchedule}
				indefinite={storiesAreIndefinite(distinctBuildStories)}
			/>
			</div>
		{/if}

		<!--
			⭐ ONE FLAT 2-COLUMN GRID NOW, NOT A RAIL. (2026-09-02, design
			re-check, two rounds: first *"the three cards in the side-by-side row
			end at 460 / 538 / 546 — 86px of rag"*, then *"`This build | Running
			it now | Not here yet` on row 1 and `What each service calls it`
			alone on row 2 with two empty tracks beside it."*) `This build`, the
			bucket cards and `What each service calls it` used to split across
			two grid levels — a `rev-buckets` sub-grid plus a fixed-340px rail —
			each with its OWN `align-items: start`, so a rail taller than the
			buckets (or the reverse) just left a gap. Cards are `flex flex-col`
			with a `grow` body for exactly this case (see the comment on
			`Card.svelte`'s `<section>`) — used at the time to STRETCH every
			card sharing a row to that row's height.

			⛔ THE STRETCH ITSELF IS GONE, ITEM 1 (2026-09-06 critique). It
			traded ragged bottoms for the opposite defect: `Running it now`
			ran 417px beside a 161px `Not here yet`, 61% empty. `.rev-buckets`
			is `align-items: start` now (see its own CSS comment) — every card
			on the grid, including `This build` / `What each service calls
			it`, is its own height now (round-7 item 3 removed the pair's own
			height-match opt-in too — see the CSS comment on `.rev-buckets`).

			AND `auto-fit` GAVE WAY TO A FIXED 2 COLUMNS, because a THIRD track
			at 1440 is exactly what stranded the fourth card alone. `What each
			service calls it` moved up to sit right beside `This build` — both
			are about the BUILD — so the bucket cards, both about PLACES, fill
			row 2 on. See the CSS for the rest (the 2-column breakpoint and the
			odd-card-spans-both-tracks rule).
		-->
		<div class="rev-buckets mt-4">
			<!--
				⭐ `This build` — THE CARD THE HERO'S FACTS MOVED INTO. (2026-09-02)
				Commit, repo, services, last deployed and the outbound link were
				eight ungrouped lines on the page ground with no card of their own —
				the one region on this page without one. The coverage bar shrinks to
				a ROW-SCALE mark in the header (`compact`, same object the list rows
				carry at 8px) rather than repeating the head band's `N of M` in
				digits a fourth time; its accessible name carries the full sentence
				for anyone who cannot see the segments.
			-->
			<!--
				⭐ ROUND 11 CRAFT FINDING 7 — THE ROLLUP IS BACK. The header
				rollup and the bar both left this card the same round (A.6.3
				moved the bar to the head band above); with neither, `This
				build` measured a 128px shorter body than its row-mate `Where
				it sits`/`What each service calls it` — a rollup (the release
				count — a fact this card's own body does not otherwise
				summarise in one line) so the header is no longer the one on
				the page with nothing on its right.

				⛔ `.rev-card-span` (THIS CARD SPANS BOTH TRACKS ALONE) IS GONE
				— ROUND 11 REVISIONS-PASS-6, ITEM 4. It fixed the 128px gap by
				giving `This build` its own full-width row, which pushed `What
				each service calls it` onto its OWN row below it, alone at
				half width with an empty right half — the hole moved rather
				than closing. `.rev-card-pair` puts the two back side by side
				in one grid row with `align-self: stretch` (the grid's own
				`align-items: start` stays the default for every OTHER row —
				see that rule's own comment — this is an opt-IN on exactly
				these two cells), so both cards share the row's height and
				neither is ragged beside the other.
			-->
			<div class="rev-card-pair">
			<!--
				⭐ SECOND OPERATOR WALK, ITEM 10 — `This build`'s ROLLUP MUST NOT
				RESTATE ITS NEIGHBOUR'S. `{n} services` here and `{n} services`
				on `What each service calls it`, 380px to the right, printed the
				IDENTICAL rollup for two different cards on the same row — a
				reader scanning right-aligned figures sees one fact twice. This
				card's own body already counts RELEASES, not services
				(`serviceReleaseCountLabel`, the `LayersOutline` row below); the
				rollup states that count instead, which is also the number
				`buildReleases` (3 lines down) actually lists.
			-->
			<Card
				icon={RocketOutline}
				title="This build"
				verdict="{buildReleases.length} release{buildReleases.length === 1 ? '' : 's'}"
				verdictTitle="Every release of this commit any service has ever shipped"
			>
				<ul class="space-y-3">
					<!--
						THE COMMIT — DEGRADES HONESTLY. Concept 07 puts the commit message
						and author here. GitHub is not connected on this cluster — that is
						the SHIPPED STATE, not an edge case — so the row says which fact is
						missing and why, and takes no data row and no second button.
						`CommitSummary` draws its own branch glyph, so the row's icon track
						is not doubled with a second one in the connected case.

						⭐ THE SENTENCE IS `githubAbsenceSentence`'s NOW, NOT A PRIVATE
						SPELLING. (2026-09-03) This used to say "which is not connected"
						whatever the reason — the same fact `ChangeVersionModal`'s dialog
						worded as "did not answer" and the app-detail `Source` card said
						nothing about at all. `githubStatus.data` distinguishes "nobody
						has set this dashboard up for GitHub" from "configured, but this
						account is not the one connected", which are different facts with
						different remedies.
					-->
					{#if githubConnected && rep && prev}
						<li class="flex items-start gap-2.5">
							<CommitSummary
								namespace={rep.ns}
								name={rep.name}
								cluster={rep.cluster}
								base={prev.revision}
								head={row.revision}
								verb={`in this build · since ${prev.short}`}
								showMessages
								showAvatars
							/>
						</li>
					{/if}
					<li class="flex items-start gap-2.5">
						<FolderOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<span
							class="t-body min-w-0 truncate text-gray-700 dark:text-gray-200"
							title={repoTitleFull(ledger.repoLabel) ?? undefined}
							>{repoTitle(ledger.repoLabel)}</span
						>
					</li>
					<li class="flex items-start gap-2.5">
						<LayersOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<!--
							⭐ FINDING 2 (operator sweep, 2026-09-07) — THE COUNT NAMES
							BOTH UNITS WHEN THEY DIFFER. See `serviceReleaseCountLabel`'s
							own comment: `2 services` said nothing untrue on its own, but
							the list three lines below it (`buildReleases`) went on to
							print THREE rows for this exact build — a real, sayable fact
							this line was silently hiding a count for.
						-->
						<span class="t-body text-gray-700 dark:text-gray-200"
							>{serviceReleaseCountLabel}</span
						>
					</li>
					<!--
						⭐ `built` NAMED, NOT JUST `deployed`. (2026-09-03, operator-walk
						finding 4) This page said `last deployed 10 hours ago` and left
						`row.createdMs` — when the commit itself was built — unprinted
						anywhere on it, so the ONE other bare age on the page (each
						place's own deploy time, in `Running it now`) had nothing to be
						confused WITH by name, only by omission. Both clocks get their
						verb now. Omitted only when it would restate `lastDeployMs` to
						within a second — the one case that is truly the same instant
						(`builtDiffersFromDeploy`, its own comment) — never merely
						close: `c1ecfe553070` built at :18:46 and first deployed at
						:19:14, a real 28s build pipeline, and a `> 60_000` guard here
						used to read that as "the same moment" and hide it.
					-->
					{#if buildReleases.length > 1}
						<!-- ⭐ ROUND-4 CRAFT REVIEW, ITEM E — ONE `built` PER RELEASE. See
						     `buildReleases`'s own comment: a bare, unnamed `built N ago`
						     is a claim about ONE of this revision's releases stated as
						     if it were about all of them.

						     ⭐ ITEM 6 (2026-09-06 round-7 critique) — A LIST, NOT A
						     WRAPPING SENTENCE. `flex flex-wrap` alternated mono (the
						     release label) and sans (`built … ago`) six times for a
						     three-release commit, and at 390 wrapped mid-sentence with a
						     leading `·` orphaned at the start of a line — the same "no
						     separator at a line start" defect the env-age atom was
						     already fixed for, two cards up. Each release is its own
						     row now (`flex flex-col`), so there is nothing to wrap
						     mid-clause and no join character to strand. -->
						<li class="flex items-start gap-2.5">
							<CalendarMonthSolid
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<span class="flex min-w-0 flex-col gap-1">
								{#each buildReleases as rel (rel.label + rel.createdMs)}
									<span class="t-body flex flex-wrap items-baseline gap-x-1.5 text-gray-700 dark:text-gray-200">
										<span class="t-code-sm">{rel.label}</span> built <time
											datetime={new Date(rel.createdMs).toISOString()}
											title={new Date(rel.createdMs).toLocaleString()}
											>{formatTimeAgoCompact(new Date(rel.createdMs).toISOString(), $now)}</time
										>
										ago
									</span>
								{/each}
							</span>
						</li>
					{:else if builtDiffersFromDeploy}
						<li class="flex items-start gap-2.5">
							<CalendarMonthSolid
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<span class="t-body text-gray-700 dark:text-gray-200">
								<!-- ⭐ ITEM 5 (2026-09-06 critique) — TITLE CASE: this word
								     LEADS the line (only an icon precedes it), the same rule
								     that gives `/revisions` its `Deployed`/`Built`. -->
								Built <time
									datetime={new Date(singleBuiltMs).toISOString()}
									title={new Date(singleBuiltMs).toLocaleString()}
									>{formatTimeAgoCompact(new Date(singleBuiltMs).toISOString(), $now)}</time
								>
								ago
							</span>
						</li>
					{/if}
					<li class="flex items-start gap-2.5">
						<ClockOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<!--
							⭐ ITEM 5 / 6 (2026-09-06 round-7 critique) —
							`last deployed` LEADS THE LINE THE SAME WAY `Built` DOES (only
							an icon precedes it), so it takes the same title case — ONE
							CASE across every fact in this list (`Built`, this, `Never
							deployed`), not this the one lowercase holdout. And while the
							row's own newest deploy is still in flight (`headBandDeployingCount`
							— the same `deploying` bucket the head band and the bar already
							read), the clock is not settled yet: `last deployed 32s ago`
							read as a completed fact about a deploy that was, measured live,
							32 seconds into a 2m45s canary. `Last deployed` is reserved for a
							SETTLED deploy now; an in-flight one reads `Deploying since`.
						-->
						<span class="t-body text-gray-700 dark:text-gray-200">
							{#if row.lastDeployMs}
								{#if headBandDeployingCount > 0}
									Deploying since
								{:else}
									Last deployed
								{/if}
								<time
									datetime={new Date(row.lastDeployMs).toISOString()}
									title={new Date(row.lastDeployMs).toLocaleString()}
									>{formatTimeAgoCompact(new Date(row.lastDeployMs).toISOString(), $now)}</time
								>
								ago
							{:else}
								Never deployed
							{/if}
						</span>
					</li>
					<!--
						⛔ `View commit` WAS A `.btn` AND IT IS NAVIGATION. (2026-09-02,
						from the human: *"two navigation controls wearing button chrome"*,
						filed against the list and true here for the same control.) It
						changes no cluster state — it opens someone else's website — so it
						is `.nav-link` with the external glyph, which is the rule's stated
						answer for an outbound link.
					-->
					{#if commitUrl}
						<li class="flex items-start gap-2.5">
							<TagOutline
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<a
								class="nav-link"
								href={commitUrl}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`View the commit for ${row.short} on GitHub — opens in a new tab`}
							>
								View commit
								<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
							</a>
						</li>
					{/if}
					<!--
						⭐ ITEM 6 (2026-09-06 round-7 critique) — DEMOTED TO THE END OF
						THE FACT LIST, AT `t-micro`. The absence sentence used to sit
						second in this list, at `t-body` — the first and largest line a
						reader hit on the card the moment coverage reached 100% and the
						bar above it stopped drawing, which is the SHIPPED state on this
						cluster (GitHub is not connected here). An apology for a fact
						this card cannot show is not the card's leading fact; it moves
						after every fact the card CAN state, in the same gray micro-copy
						`historyLimitNote`'s own card-footer caveat uses elsewhere on
						this page.
					-->
					{#if !(githubConnected && rep && prev)}
						<li class="flex items-start gap-2.5">
							<CodeBranchOutline
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
								aria-hidden="true"
							/>
							<span class="t-micro text-gray-500 dark:text-gray-400">
								Commit message and author need GitHub. {githubAbsenceSentence(
									githubStatus.data
								)}
							</span>
						</li>
					{/if}
				</ul>
			</Card>
			</div>

				<!--
					CRITERION 2, NOW A PEER TILE IN THE SAME FLAT GRID, NOT A FIXED-WIDTH
					RAIL. One rank per service, against that service's OWN denominator,
					with the denominator named. `newest of 4` beside `newest of 37` is
					the page's whole point — those two services share a source repo and
					nothing else, and collapsing them onto one ladder is the defect
					revision keying was built to close, one level down. It does NOT
					restate the buckets: the buckets say WHERE, this says WHAT EACH
					SERVICE CALLS IT and how far down its own ladder it now sits.
				-->
				<div class="rev-card-pair">
				<!--
					⭐ ROUND 11 CRAFT FINDING 5 — "OF 33 / 26 / 34 BUILDS" IS
					UNREADABLE ALONE, AND IT IS DROPPED RATHER THAN REWORDED.
					`serviceLadderLengths` is three services' own ladder lengths
					joined with " / " (e.g. `33 / 26 / 34`) with no service name
					attached to any one figure — a reader cannot tell which number
					belongs to which service, and each row ALREADY states its own
					`of N builds` beside its own name two lines down. A header
					rollup that repeats one of those three numbers, unlabelled,
					teaches nothing a row does not already say better.
				-->
				<Card
					icon={TagSolid}
					title={allLabelsMatchSha ? 'Where it sits' : 'What each service calls it'}
					verdict={allLabelsMatchSha
						? null
						: `${row.services.length} service${row.services.length === 1 ? '' : 's'}`}
					verdictTitle={allLabelsMatchSha
						? undefined
						: 'One commit, one row per service — each service names and ranks it on its own'}
					padded={false}
				>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each row.services as svc (svc.appName)}
						{@const rank = rankSentence(svc)}
						{@const chip = rankChipFor(svc)}
						{@const pinned = pinnedEnvsOf(svc)}
						{@const ranBefore = ranBeforeOf(svc)}
						<!-- ⭐ ROUND 11 r11c FINDING 9 — see the comment beside this
						     row's "No earlier deploy on record." branch, below. -->
						{@const elsewhere = svc.slots.some((s) => !s.onRevision)}
						<!--
							⭐ FINDING 2 (operator sweep, 2026-09-07) — THE RUNNING RELEASE
							LEADS. `chip?.role === 'held'` used to print `HELD 2.67.0-67`
							alone, with the release actually running (`2.66.0-66`) folded
							into a small gray line BELOW the row — a reader who stopped at
							the chip (the loudest thing on the row) came away thinking
							`2.67.0-67` was live. `runningLabelFor` reads the SAME `live`
							bucket `heldNewest` already checked, so this can never name a
							different release than the chip below it. `null` when the
							places running it disagree on WHAT they run (a genuine split
							`DESIGN.md` forbids naming half of) — same case that printed
							nothing before, unchanged.
						-->
						{@const runningLabel = chip?.role === 'held' ? runningLabelFor(svc) : null}
						<!--
							ONE INK FOR A SERVICE NAME, ON BOTH REVISION PAGES. A service is
							never the subject of either page — the revision is — so it takes
							the secondary ink everywhere, and the three places that print it
							stop disagreeing about how important it is.
						-->
						<li class="rev-svc-row">
							<a
								href="/apps/{encodeURIComponent(svc.appName)}"
								class="t-body min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
								>{svc.appName}</a
							>
							<span class="rev-svc-build">
								{#if chip && rank}
									<!--
										⭐ FINDING 2, CONTINUED — TWO CHIPS, RUNNING FIRST. A row
										with a `runningLabel` is the ONE case this file's own
										"one name, one badge, one denominator" rule (below, on
										`.rev-svc-row`) grows a second badge: the release actually
										live, then the release being held from replacing it —
										`.chip-mark` is the product's existing loose-group idiom
										for two adjacent, independently-joined boxes (already used
										two rows down for `[PINNED][DEV]`), so this spends no new
										geometry.
									-->
									<span class="chip-mark min-w-0">
										{#if runningLabel}
											<Chip
												role="unranked"
												label="running"
												title="{svc.appName} is running {runningLabel} right now — the newer {svc.label} has not replaced it"
												value={runningLabel}
												wide
												class="min-w-0"
											/>
										{/if}
									<!--
										⭐ ROUND 11 CRAFT FINDING 5 — ONE HELD VOCABULARY, THE
										LIST'S OWN. `Chip role="alarm" label="HELD"` is exactly
										`RepoLedgerCard`'s own held-row chip (and the index
										header's `{n} held`) — the softer `role="held"` (the
										same `TRAILING`/orange tone `N behind` uses) said the
										identical fact in a quieter vocabulary than the list
										already committed to for it.
									-->
										<Chip
										role={chip.role === 'held' ? 'alarm' : chip.role}
										label={chip.role === 'held' ? 'HELD' : chip.label}
											title={svc.diverged
												? 'On no environment’s release list — promotion does not arrive at it'
												: chip.role === 'held'
													? `The newest of the ${rank.of.replace(/^of /, '')} ${svc.appName} can deploy — not running anywhere yet`
													: chip.role === 'newest'
														? `The newest of the ${rank.of.replace(/^of /, '')} ${svc.appName} can deploy`
														: `${chip.label} the newest of the ${rank.of.replace(/^of /, '')} ${svc.appName} can deploy`}
											value={svc.labelDiffers ? svc.label : undefined}
											valueTitle={svc.labelDiffers ? svc.label : undefined}
											wide
											class="min-w-0"
										/>
									</span>
									<!-- ⭐ THE DENOMINATOR CARRIES ITS OWN DEFINITION.
									     `newest` means different things in different corners of
									     this product; here it is rank 0 on THIS service's ladder.
									     It was said in a 3-line footer under the card
									     (2026-09-02, cut with the page's other definitions); it is
									     said here. `scan.ts` reads `title`, so it stays pinned.

									     ⛔ ROUND 11 REVISIONS-PASS-6, ITEM 5 — `rank.of` ("of 4
									     builds") beside a WORD chip (`NEWEST`, never a numerator
									     digit) completed to "1 of 4 builds" as if the row drew a
									     fraction it never actually draws the top half of.
									     `ladderPositionLabel` states this build's own POSITION
									     on the ladder instead ("1 of this service's 4 builds") —
									     or, at a ladder of one, that there is nothing to count. -->
									<span
										class="t-micro text-gray-500 dark:text-gray-400"
										title="Every service counts its own builds, so newest here means newest for that service. Two services from one repo can be on different builds and both be on the newest."
										>{ladderPositionLabel(svc)}</span
									>
								{:else}
									<!-- No number at all. A `0` here would read as "newest".
									     The WORD is `rankLabel`'s, like the `unreleased` above it:
									     `unknown` is a legible answer and the product spells it in
									     exactly one place. -->
									<Chip
										role="unranked"
										label={rankLabel({ kind: 'unknown' })}
										title="This service does not list this build, so it has no position for it"
										value={svc.label}
										wide
										class="min-w-0"
									/>
								{/if}
							</span>
							{#if pinned.length > 0}
								<!--
									⭐ ROUND-4B REVIEW, ITEM 2 — A CHIP PAIR, NOT A SECOND
									SPELLING OF THE PIN SENTENCE. `Pinned in DEV — automatic
									updates are off there` and `Pinned to 6f9524e — automatic
									deploys are paused until the pin is cleared.` (this row's
									own `reasonsFor` pin branch, when the place also sits in
									`Not here yet`) said the same fact in two different
									sentences on one page. The canonical sentence survives —
									on `title`, per place, with that place's own pinned tag —
									and this row draws the fact instead of narrating it:
									`[PINNED][DEV]`, the same loose `.chip-mark` grouping the
									STUCK mark already uses beside an env chip.
								-->
								<div class="mt-1 flex flex-wrap items-center gap-1.5">
									{#each pinned as p (p.envLabel)}
										<span class="chip-mark">
											<Chip role="unranked" label="pinned" title={p.title} />
											<Chip role="env" theme={p.theme} label={p.envLabel} wide title={p.title} />
										</span>
									{/each}
								</div>
							{/if}
							<!--
								⭐ ROUND 11 r11c FINDING 9 — "NO EARLIER DEPLOY ON RECORD" IS
								ONLY A QUESTION WHERE THE BUILD IS NOT LIVE EVERYWHERE FOR
								THIS SERVICE. Measured live: `hello-api-app` NEWEST
								everywhere still printed "No earlier deploy on record." —
								`ranBeforeOf` only ever searches slots that are NOT
								currently on this revision (`!s.onRevision`), so a service
								running it on every one of its own slots has nothing left to
								search and `ranBefore.length === 0` by construction, not
								because history was checked and came up empty. `elsewhere`
								(declared with the row's other `{@const}`s, above — a
								`{@const}` may only be an immediate child of the `{#each}`)
								is true only when at least one slot is on a DIFFERENT build —
								the case this sentence (either branch) is actually about.
							-->
							{#if elsewhere}
								{#if ranBefore.length > 0}
									<!-- ⭐ "WHERE DID THIS BUILD RUN BEFORE?" (operator-walk finding 2)
									     `status.history[i > 0]` on this exact place, matched by the same
									     revision key `onIt`/`resolveRevision` use everywhere else on this
									     page — never a second opinion about identity. -->
									<div
										class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
									>
										<!-- ⛔ ROUND 6, LANE 10 — THE ICON AND ITS FIRST WORD ARE ONE
										     `inline-flex flex-nowrap` UNIT, NOT TWO SEPARATE FLEX
										     ITEMS. Measured live at 390: `flex-wrap` on the OUTER row
										     let the icon (item 1) and the whole "Ran before in …"
										     span (item 2) land on different lines whenever the row
										     ran out of width — a 12px clock glyph alone on its own
										     line, above the sentence it decorates. Gluing the icon to
										     "Ran before in" inside a `flex-nowrap` child makes that
										     pair ATOMIC from the outer row's point of view: the row
										     can still wrap (the env/time list below still does, at
										     any `·`), it just can never split the icon from the words
										     it introduces. -->
										<span class="inline-flex flex-nowrap items-center gap-1.5">
											<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
											<!-- ⭐ ITEM 5 (2026-09-06 critique) — `ENV · Nd ago`, THE
											     LIST'S OWN CHIP+AGE ATOM GRAMMAR, NOT `ENV (N days
											     ago)`. -->
											<span>Ran before in</span>
										</span>
										<span>
											{#each ranBefore as rb, i (rb.envLabel)}
												{rb.envLabel} · <time
													datetime={rb.timestamp}
													title={new Date(rb.timestamp).toLocaleString()}
													>{formatTimeAgoCompact(rb.timestamp, $now)}</time
												>
												ago{i < ranBefore.length - 1 ? ', ' : ''}
											{/each}
										</span>
									</div>
								{:else if !historyLimitNote(svc)}
									<!--
										⭐ SECOND OPERATOR WALK, ITEM 10 — NEVER-RAN AND OUTSIDE-THE-
										WINDOW MUST NOT LOOK THE SAME. Both used to render NOTHING
										here — `hello-world-manifests` on `991829b` and a service
										whose retained history simply does not reach far enough
										back were both silent, and a silent line answers "did this
										ever run before" with nothing at all. `historyLimitNote(svc)`
										already knows whether THIS service's history could be
										truncated (the card's own footer caveat, drawn once); when
										it is `null` — every slot's history is provably complete —
										the absence of a match is itself the answer, so it is said
										rather than left blank. When the note IS non-null, this
										stays silent: the footer already carries the uncertainty,
										and a per-slot guess here would contradict it.
									-->
									<div
										class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
									>
										<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
										<span>No earlier deploy on record.</span>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
				<!-- ⛔ THE FOOTER THAT SAID THIS IS GONE, THE SENTENCE IS NOT.
				     (2026-09-02.) It is the `title` on `of N` in every row above —
				     on the term it defines, which is where a definition belongs and
				     is the only place it is legible without counting rows. -->
				<!--
					⭐ ROUND-4B REVIEW, ITEM 3 — A DIFFERENT SENTENCE, AND IT DOES GET
					A FOOTER. The comment above this one is about the `of N`
					definition, which lives on the term it defines and stays gone.
					This caveat names no term on any row — it is a fact about the
					CARD'S data source, true or false once for the whole list — and
					printing it under whichever service happened to trip it first
					was the only reason it looked page-repeated at 3× on
					`hello-multi-app`. `text-gray-500` matches `ranBefore`'s own
					secondary ink two rows up (`text-gray-400` measured 2.60:1, the
					only contrast failure either revision page had).
				-->
				{@const cardNote = cardHistoryLimitNote()}
				{#if cardNote}
					<div
						class="border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
					>
						{cardNote}
					</div>
				{/if}
			</Card>
			</div>

			<!--
				THE BUCKETS, AS TITLED CARDS. One per NON-EMPTY bucket, so a fully
				converged revision renders one card and a mid-promotion head renders
				three. The card lists its places, which is what makes the design hold
				at 4 prod regions and at 13: the bar is proportional and the buckets
				are LISTS, so N environments cost wrapped chips inside one card rather
				than columns across the page.
			-->
			{#each coverage.buckets as bucket (bucket.key)}
					<Card
						icon={bucket.key === 'live' && !liveIsFrontier
							? ArrowRightOutline
							: BUCKET_ICON[bucket.key]}
						iconClass={bucket.key === 'live'
							? liveIsFrontier
								? 'tone-live'
								: 'tone-mute'
							: bucket.key === 'failing'
								? 'tone-bad'
								: bucket.key === 'deploying'
									? 'tone-active'
									: 'tone-mute'}
						title={bucket.title}
						verdict="{bucket.slots.length} place{bucket.slots.length === 1 ? '' : 's'}"
						verdictTitle={bucket.description}
						padded={false}
					>
						{#snippet rollup()}
							<!--
								THE SWATCH IS THE BAR'S OWN FILL VALUE, at 12px, in the card
								header — so the segment above and the card below are bound by
								colour without a key row anywhere on the page.

								⭐ LANE 9, ROUND 11 QA, ITEM 3 — AND IT MUST READ `weightFill`,
								NOT `coverageSwatch`. Round 11 recoloured the BAR to one hue,
								three weights (`WEIGHT_FILL`) — `ahead`'s cells are `movedOn`,
								the SAME green as `here`, one step down. `COVERAGE_SWATCH` is
								a different, older table (A.3's own "untouched" exception for
								the six BUCKET-CARD colours) that still paints `ahead` neutral
								gray — measured live, this exact swatch, on "Already moved
								on": gray while the bar's own `movedOn` cells above it are
								green. The comment above promises the swatch IS the bar's fill;
								it has to read the bar's own table to keep that promise.
								`coverageWeight` maps every bucket to its bar weight first
								(`live`/`failing`/`deploying`→`here`, `ahead`→`movedOn`,
								`notYet`→`notReached`, `unplaceable`→`unplaceable`), so this is
								correct for every bucket this card renders, not only `ahead`.
								EXCEPT the two that are a state, not a depth: `failing` keeps
								its red and `deploying` its blue swatch (tech lead, r11 lane 9
								review) — the bar never carries those hues, but the bucket card
								is the one place that names the state, and one mark per fact
								means the swatch may not lie green beside a red title.
							-->
							<span
								class="cov-swatch {bucket.key === 'failing' || bucket.key === 'deploying'
									? coverageSwatch(bucket.key)
									: weightFill(coverageWeight(bucket.key))}"
								aria-hidden="true"
							></span>
							<span class="text-xs font-medium text-gray-500 dark:text-gray-400"
								>{bucket.slots.length} place{bucket.slots.length === 1 ? '' : 's'}</span
							>
						{/snippet}

						{#if bucket.key === 'notYet'}
							<!--
								ONE ROW PER PLACE, AND ONLY HERE. `Not yet` is the bucket whose
								places each have their OWN story — a different gate holding them,
								a different action — so a group heading cannot carry it, and this
								is the bucket that must stay actionable.
							-->
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each notYetGroups(bucket.slots) as g (g.key)}
									{@const solo = g.slots.length === 1 ? g.slots[0] : null}
									<li class="px-4 py-3">
										<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
											<!-- ⭐ THE SERVICE LEADS, ITS ENVIRONMENTS WRAP AFTER IT.
											     One row per REASON, not per place, so a 13-region fan-out
											     held by one gate is one row with thirteen chips instead
											     of thirteen rows carrying one sentence thirteen times.
											     The link goes to the ROLLOUT, never to `/apps/<name>`:
											     the rollout is the object the gate is attached to and
											     the page that can clear it. -->
											<a
												href={placeHref(g.slots[0])}
												class="t-body inline-flex min-w-0 items-center gap-1 text-gray-700 hover:underline dark:text-gray-200"
												aria-label="Open the {g.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
												title="Open the {g.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
												><span class="min-w-0 truncate">{g.appName}</span><ChevronRightOutline
													class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
													aria-hidden="true"
												/></a
											>
											{#each g.slots as s (s.envName)}
												<!-- `[ENV][−N]` and nothing more, with `STUCK` loose 4px
												     beside it in the same `.chip-mark` group — the form
												     `StuckBadge` already ships on `/`, `/rollouts` and the
												     rollout detail page.

												     ⭐ OPERATOR-WALK ROUND 4, ITEM A — THE GROUP IS ITS OWN
												     LINK NOW. The row's one chevron (above) points at
												     `g.slots[0]` — the environment this row's own action, if
												     any, targets — so every OTHER environment sharing this
												     row's reason was unreachable: `hello-multi-app
												     [STAGING][STUCK] [PROD][STUCK]` linked to staging only.
												     `.chip-mark` becomes the `<a>` itself (`.hit-32` for the
												     touch floor, same escape hatch `/envs/<name>`'s own
												     env-chain chip links use) so every environment in the
												     row opens its own rollout, chevron or not. -->
												<a
													href={placeHref(s)}
													class="chip-mark hit-32"
													aria-label="Open the {s.envLabel.toUpperCase()} rollout for {g.appName}"
													title="Open the {s.envLabel.toUpperCase()} rollout for {g.appName}"
												>
													{#if s.currentRank !== null && s.currentRank > 0}
														<span class="chip-joined">
															<Chip
																role="env"
																theme={s.slot.cell.theme}
																label={s.envLabel}
																wide
																title="{s.envLabel.toUpperCase()} — {s.statusWord}{wasOnClause(s)}"
															/>
															<!-- ⛔ `−N` → `N behind`. (2026-08-30) The last
															     `−N` in the product. Same `rank` role, same
															     joined box; a signed integer beside a build id
															     reads as a diff and names no unit.

															     ⭐ ROUND-4 CRAFT REVIEW, ITEM 7 — JOINED WITH A
															     BUILD, LIKE `/rollouts`. `NEWEST` in `What each
															     service calls it` carries the tag glyph because it
															     is joined with `svc.label` (`value={svc.label}`);
															     this chip named no value at all, so `hasGlyph`
															     (`Chip.svelte`) never fired for it — 250px away,
															     the same rank vocabulary carrying its glyph on one
															     side and not the other. `/rollouts` pairs EVERY
															     rank chip with the build the environment actually
															     runs (`RolloutGrid.svelte`'s `value={c.version}`);
															     `s.runs` is that same fact here, so the two chips
															     converge on one spelling instead of one only. -->
															<Chip
																role="rank"
																label={`${s.currentRank} behind`}
																value={s.runs}
																valueTitle={s.runs ?? undefined}
																title="{s.envLabel.toUpperCase()} can still take {s.currentRank} newer version{s.currentRank ===
																1
																	? ''
																	: 's'}"
															/>
														</span>
													{:else}
														<Chip
															role="env"
															theme={s.slot.cell.theme}
															label={s.envLabel}
															wide
															title="{s.envLabel.toUpperCase()} — {s.statusWord}{wasOnClause(s)}"
														/>
													{/if}
													{#if isStuck(s)}
														<Chip
															role="alarm"
															label="stuck"
															title="{s.envLabel.toUpperCase()} is stuck"
														/>
													{/if}
												</a>
											{/each}
										</div>

										<!-- CRITERION 3, ON THE ROW THAT STATES THE PROBLEM — and
										     each reason carries a glyph naming WHAT KIND of gate it
										     is, plus the clear time when the cluster publishes one. -->
										<div class="mt-2 flex flex-col gap-2">
											{#each g.reasons as r, i (i)}
												{#if r.drawn}
													<!-- ⭐ ITEM 3 (2026-09-06 critique) — THE CONTRACT, DRAWN
													     ONCE. `notYetGroups` already folded every environment
													     this exact upstream cause bites into `g`, so this
													     renders exactly once for the whole group — never the
													     per-environment prose the list banner already replaced
													     (`lib/CLAUDE.md`: "ONE CAUSE IS DRAWN ONCE"). -->
													<div class="min-w-0">
														<BlockReason
															reason={contractBlockReason({
																provider: r.drawn.subject,
																contract: r.drawn.contract,
																requiredVersion: r.drawn.need,
																providedVersion: r.drawn.have,
																gateName: r.drawn.gateName
															})}
															subjectHref={r.drawn.subjectHref}
														/>
														<a
															class="nav-link mt-1 inline-flex"
															href={r.drawn.subjectHref}
															aria-label={`Open ${r.drawn.subject}`}
														>
															Open {r.drawn.subject}
															<ArrowRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
														</a>
													</div>
												{:else}
													{@const ReasonIcon = r.icon}
													<div class="flex items-start gap-2">
														<ReasonIcon class="mt-0.5 h-4 w-4 shrink-0 {r.tone}" aria-hidden="true" />
														<div class="min-w-0">
															<!-- THE SENTENCE FIRST, THE OBJECT NAMES UNDER IT.
															     Inline, the gate name's `whitespace-nowrap` pushed the
															     break INTO the sentence and orphaned `3h` on its own
															     line — the clear time, which is the one thing on the
															     row a reader came for, split in half to keep a
															     generated identifier whole. The names are evidence, so
															     they go under the claim they support and wrap among
															     themselves. -->
															<div class="t-body text-gray-600 dark:text-gray-300">{r.text}</div>
															{#if r.gates.length > 0}
																<div class="mt-0.5 flex flex-wrap gap-x-2">
																	{#each r.gates as gate (gate)}
																		<span
																			class="t-code-sm text-gray-500 dark:text-gray-400"
																			title="Rule {gate}">{gate}</span
																		>
																	{/each}
																</div>
															{:else if r.record}
																<!-- ⭐ ROUND-4 CRAFT REVIEW, ITEM 3 — THE RAW TAG AS A
																     RECORD ROW, NEVER INLINE PROSE. Same treatment as
																     `r.gates` above (mono, its own row under the claim),
																     plus `break-all`: a gate id is short and hyphenated
																     and wraps on its own; an OCI tag is one 56-character
																     unbroken run and needs the harder break rule to avoid
																     the silent `overflow: hidden` clip this replaces. -->
																<div class="mt-0.5">
																	<span
																		class="t-code-sm text-gray-500 dark:text-gray-400 break-all"
																		title={r.recordTitle ?? r.record}>{r.record}</span
																	>
																</div>
															{/if}
														</div>
													</div>
												{/if}
											{/each}
										</div>

									{#if solo?.promoteTag}
										{@const soloPinnedTo = solo.slot.cell.rollout?.spec?.wantedVersion}
										{@const isOnlyAction = singleDeployAction?.key === g.key}
										<!--
											⭐ ROUND-4 CRAFT REVIEW, ITEMS 5 + C.

											PRIMARY IS ASSERTED BY CAPABILITY (item 5, see the
											`deployableGroups`/`singleDeployAction` comment in the
											script block): `.btn-secondary` stays the default — the
											reasoned rule that a deploy surface's loudest control must
											not be the one that changes production still holds when
											several such rows coexist — and steps up to `.btn-primary`
											only when this is the ONE row on the page with a live
											candidate and no gate, which is what this build actually
											measured.

											CLEAR PIN LEADS WHEN THERE IS ONE TO CLEAR (item C, from
											the operator walk: *"When the blocker is a pin, the
											primary remedy is clearing it."*) A pinned environment's
											real remedy is removing the pin, not re-pinning it to a
											different build — `ClearPinModal` is the SAME component
											rollout detail, `/apps` and `RolloutGrid` already open, so
											there is one clear-pin flow and one confirmation dialog,
											not a second one authored here. When it renders, it takes
											the row's primary weight and `Deploy … to …` (which
											re-pins, per its own modal's pre-checked toggle) drops to
											secondary regardless of `isOnlyAction` — clearing the
											block is the leading remedy, deploying a specific build
											over it is the fallback.

											⭐ `Promote` → `Deploy … to …` WHEN THE PLACE IS PINNED.
											(operator-walk finding 1) `Promote to dev` on a pinned
											environment reads as the ordinary, automatic advance — it
											is not: the pin already refuses every candidate, and this
											button's own `title` has said `Deploy …` the whole time (a
											one-verb-per-action mismatch between the visible label and
											its own accessible name). `deploy` is the right verb here
											regardless — `promote` is reserved for the AUTOMATIC
											advance (`lib/CLAUDE.md` vocabulary (d)) and this has
											always been a person clicking a button. The click still
											opens the same `ChangeVersionModal` ceremony as every other
											deploy on this product (typed build, a production note
											where `deploy-risk.ts` requires one) — never a one-click
											mutation — and that modal's own pin toggle (pre-checked
											here — `pinVersionToggleComputed` in `ChangeVersionModal`)
											is what decides whether the pin follows the new build or
											is cleared. This label does not guess which, because the
											operator has not chosen yet.
										-->
										<div class="mt-2.5 flex flex-wrap items-center gap-2">
											{#if soloPinnedTo}
												<button
													type="button"
													class="btn {isOnlyAction ? 'btn-primary' : 'btn-secondary'}"
													onclick={() => openClearPin(solo.slot, solo.envLabel)}
													title={`Clear the pin on ${solo.appName} in ${solo.envLabel}`}
												>
													<LockOpenOutline class="h-4 w-4" />
													{CLEAR_PIN_LABEL}
												</button>
											{/if}
											<button
												type="button"
												class="btn {soloPinnedTo || !isOnlyAction ? 'btn-secondary' : 'btn-primary'}"
												onclick={() => openPromote(solo.slot, solo.promoteTag!)}
												title={`Deploy ${row.short} to ${solo.appName} in ${solo.envName}`}
											>
												<ArrowRightOutline class="h-4 w-4" />
												{soloPinnedTo ? `Deploy ${row.short} to ${solo.envLabel}` : `Promote to ${solo.envLabel}`}
											</button>
										</div>
									{/if}
									</li>
								{/each}
							</ul>
						{:else}
							{@const envCols = envColumnsFor(bucket.slots)}
							{@const envTemplate = envGridTemplate(envCols)}
							<!--
								⭐ ROUND 11 r11c ITEM 4 — EVERY ROW'S OWN GRID, BUILT FROM
								THE SAME `envGridTemplate` STRING. `envColumnsFor` computes
								the bucket-wide environment universe once; every `<li>`
								below gets the IDENTICAL literal `grid-template-columns`
								(fixed-length env tracks — see that function's own doc
								comment for why fixed, not `subgrid`), which is what makes
								`DEV`/`STAGING`/`PROD` share one x per column across every
								app in this card without any cross-row coordination.
							-->
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each groupSlots(bucket.slots) as g (g.appName)}
									<!--
										⭐ ROUND 11 REVISIONS-PASS-6, ITEM 9 — THE LABEL, FOLDED
										IN BELOW `sm` ONLY. `What each service calls it` and
										`Running it now` restated each other at 390: both listed
										`hello-api-app` with a chip beside it and neither said
										anything the other did not, once the two cards were far
										enough apart on a phone that a reader could not hold both
										in mind. `.rev-group-label` is `display: none` above
										560px (see its own CSS, below the `.rev-group-row` rules)
										— at desktop width the two cards sit close enough that
										restating it there would be the opposite defect.
									-->
									<li class="rev-place-row px-4 py-3" style="--env-grid: {envTemplate}">
										{#each g.runs as rg, gi (rg.runs ?? '—')}
											{@const sharedAge = sharedAgeFor(bucket.key, rg.slots)}
											<!--
												⭐ ITEM 9, CONTINUED — `rg.runs` IS THIS GROUP'S OWN
												RUNNING LABEL, NOT `row.services.find(...)`. This
												build's commit can resolve to TWO rows (a held sibling
												splits one revision into a "running" row and a "held"
												row — see `revisionLookup`'s own doc comment) — on the
												HELD row, `row.services.find(...).label` names the
												HELD release, and folding THAT into `Running it now`
												would print `2.67.0-67` beside slots that are actually
												running `2.66.0-66`, a wrong-build claim this exact
												`<li>` disproves four lines down (`on 2.66.0-66`).
												`rg.runs` is read off the SAME per-slot fact the group
												was partitioned by, so it can never name a release
												other than what these specific slots report. -->
											{@const groupLabel =
												bucket.key === 'live' && rg.runs && rg.runs !== row.short && rg.runs !== row.revision
													? rg.runs
													: null}
											<!--
												⭐ ITEM 3 (2026-09-06 round-7 critique) — THE LEDGER'S
												OWN TRACKS (name / chips / age), NOT A FREE-FLOWING
												FLEX ROW. Measured live on `c1ecfe553070`'s "Already
												moved on": the chip run started wherever the app
												name's own width happened to end, a 45px spread
												between rows with `hello-multi-app` and
												`hello-world-manifests` as their names. `.rev-group-row`
												is a fixed-first-column grid — same fix `.rev-svc-row`'s
												neighbour applies for the identical reason — so the
												chips column starts at the same x on every row in this
												card regardless of name length. `max-width: 46rem`
												caps the row's own reading measure so the trailing
												`now on <sha>` (below) sits close to the chips it is
												about rather than at the far edge of however wide the
												card happens to be (745px away, measured on the same
												row, before the odd-card full-span rule above was
												also removed).
											-->
											<div class="rev-group-row">
												<a
													href={placeHref(rg.slots[0])}
													class="rev-group-name t-body inline-flex min-w-0 items-center gap-1 text-gray-700 hover:underline dark:text-gray-200"
													style="--rg-row: {gi + 1}"
													aria-label="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
													title="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
													><span class="min-w-0 truncate">{g.appName}</span><ChevronRightOutline
														class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
														aria-hidden="true"
													/></a
												>
												{#if groupLabel}
													<span
														class="rev-group-label t-code-sm text-gray-500 dark:text-gray-400"
														style="--rg-row: {gi + 1}"
														title="{g.appName} calls this {groupLabel}"
														>{groupLabel}</span
													>
												{/if}
												<div class="rev-group-chips" style="--rg-row: {gi + 1}">
												{#each rg.slots as s (s.envName)}
													{@const age = bucket.key === 'live' ? slotDeployedAgo(s) : null}
													{@const pinTitle = pinnedChipTitle(s)}
													<!--
														`/apps`'s unit, character for character: the
														environment's badge, and nothing beside it unless the
														environment is stuck.
														`wide` IS LOAD-BEARING: `.chip` caps at 12ch, which is
														right in a fixed table track and wrong here —
														`prod-ap-south`, `prod-us-east` and `prod-us-west` all
														ellipsise to the same eight characters, the exact defect
														that killed the `/apps` convergence bar.

														⭐ OPERATOR-WALK ROUND 4, ITEMS 2 + A — ONE NON-WRAPPING
														ATOM, AND THE ATOM IS THE LINK.

														ITEM 2: the chip and its own age used to be SIBLING flex
														children of the row (`flex flex-wrap`), so the wrap
														could land BETWEEN a chip and the age that names it —
														measured live at 1440, a `5 days ago` sitting 84px left
														of the `PROD` chip it looked like it was labelling, and
														at 390 wrong on every row. `.rev-env-atom` is
														`display: inline-flex` with its own `flex-wrap: nowrap`,
														so the pair can only ever wrap as ONE unit between
														atoms, never inside one; the container query below
														forces one atom per line under 560px, chip first.

														ITEM A: every environment chip elsewhere on this page
														was inert — only the row's own appName link (above)
														went anywhere, so `hello-multi-app [STAGING] [PROD]`
														here could only ever open staging. The atom becomes the
														`<a>` itself (`.hit-32` for the touch floor), so each
														place opens its own rollout regardless of which one the
														row's own chevron happens to point at.
													-->
													<a
														href={placeHref(s)}
														class="rev-env-atom hit-32"
														style="--env-col: {envColumnLine(envCols, s.envLabel)}; --rg-row: {gi + 1}"
														aria-label="Open the {s.envLabel.toUpperCase()} rollout for {g.appName}"
														title="Open the {s.envLabel.toUpperCase()} rollout for {g.appName}"
													>
														<span class="chip-mark">
															<!--
																⭐ ITEM 5 / ROUND-7 RULING 4 (2026-09-06 critique) —
																THE BAKE STATE IS ONE MARK, INSIDE THE CHIP'S OWN
																BOX, NEVER AN INSERTED WORD. Mirrors the list
																page's `inFlightGlyph` byte for byte: the spinner
																replaces the chip's glyph slot at the same width
																the tag glyph already reserves, in the bake's own
																hue — the chip's identity colour (the environment's
																own theme) is untouched. The trailing caption below
																(`deployingCaption`) no longer repeats the verb or
																the sha; this icon plus `title` is where that fact
																now lives.
															-->
															{#if bucket.key === 'deploying'}
																{@const bs = slotBakeStatus(s.slot)}
																{#snippet inFlightGlyph()}
																	<span class="mr-[3px] inline-flex shrink-0 items-center">
																		<BakeStatusIcon bakeStatus={bs} size="small" decorative />
																	</span>
																{/snippet}
																<Chip
																	role="env"
																	theme={s.slot.cell.theme}
																	label={s.envLabel}
																	wide
																	icon={inFlightGlyph}
																	title="{s.envLabel.toUpperCase()} — {bakeTitle(bs)}{wasOnClause(s)}"
																/>
															{:else}
																<Chip
																	role="env"
																	theme={s.slot.cell.theme}
																	label={s.envLabel}
																	wide
																	title="{s.envLabel.toUpperCase()} — {s.statusWord}{wasOnClause(s)}"
																/>
															{/if}
															{#if pinTitle}
																<!-- ⭐ ROUND-4B REVIEW, ITEM 1 — SEE
																     `pinnedChipTitle`'s OWN NOTE. Same mark the
																     list row's `lineState` already draws for this
																     fact, loose beside the env chip like `STUCK`. -->
																<Chip role="unranked" label="pinned" title={pinTitle} />
															{/if}
															{#if isStuck(s)}
																<Chip
																	role="alarm"
																	label="stuck"
																	title="{s.envLabel.toUpperCase()} is stuck"
																/>
															{/if}
															<!--
																⭐ ROUND 11 OPERATOR-WALK, FINDING 2 — "ROLLED BACK",
																NOT JUST "HELD". See `rollbackFor`'s own doc
																comment: real, verified against the live cluster
																(`hello-frontend-app` DEV). Same role/label the
																`/apps` list already ships for this exact fact
																(`ROLLED BACK`), loose beside the env chip like
																`STUCK`/`pinned`.
															-->
															{#if rollbackFor(s)}
																{@const rb = rollbackFor(s)!}
																<Chip
																	role="unranked"
																	label="rolled back"
																	title="Rolled back {rb.by} release{rb.by === 1 ? '' : 's'}: {rb.from} → {rb.to}."
																/>
															{/if}
														</span>
														<!-- ⭐ PER-PLACE AGE — `live` ONLY. (F13, 2026-09-03) See
														     `slotDeployedAgo`'s own note: three environments
														     running one build rarely arrived together, and this
														     is the one card on the page that can say when EACH
														     place actually got it, from data already read to
														     decide the place belongs in this bucket at all.
														     ⛔ `{age}` PRINTED BARE — the same "4h ago" a `built`
														     time on `This build` could just as easily be — and an
														     operator walk read them as the same clock. The verb
														     is always in front of the number now.
														     ⛔ SUPPRESSED WHEN `sharedAge` IS SET (ITEM 2,
														     2026-09-06 critique) — every place in this row agrees,
														     so the row states it once, after the chips, instead
														     of on every atom.
														     ⭐ ROUND 11, FINDING 2 — "ROLLED BACK", NOT "DEPLOYED",
														     WHEN THIS PLACE'S OWN CURRENT DEPLOY IS ONE. Same
														     verb the chip beside it just named; the two can never
														     disagree because both read `rollbackFor(s)`. -->
														{#if age && !sharedAge}
															<span class="t-micro text-gray-500 dark:text-gray-400"
																>{rollbackFor(s) ? 'rolled back' : 'deployed'} <time
																	datetime={age.iso}
																	title={new Date(age.iso).toLocaleString()}>{age.ago}</time
																> ago</span
															>
														{/if}
														<!-- ⭐ REVISIONS-2026-09-06 ROUND 5, ITEM 1 — THE IN-FLIGHT
														     CAPTION, PER PLACE. Bake phase is a fact about THIS
														     slot, not the row (two places sharing a build rarely
														     started their deploy at the same instant), so it is
														     read here rather than hoisted to the group like the
														     `deployed …` age above — the ordinary case (one place
														     in flight) still prints once. -->
														{#if bucket.key === 'deploying'}
															<span class="t-micro text-gray-500 dark:text-gray-400"
																>{deployingCaption(s)}</span
															>
														{/if}
													</a>
												{/each}
												</div>
												<!-- ⭐ ITEM 3 (2026-09-06 round-7 critique) — THE TRAILING
												     FACT IS ITS OWN GRID COLUMN NOW, `justify-self: end`
												     INSTEAD OF `ml-auto`. `ml-auto` pushed to the far edge
												     of whatever the row happened to measure — 745px from
												     the chips when the card behind it was full-width (see
												     the removed odd-card span rule, above). Capped by
												     `.rev-group-row`'s own `max-width: 46rem` and anchored
												     to column 3, it now sits at a fixed, close distance
												     from the chips it is about. -->
												<div class="rev-group-trail" style="--rg-row: {gi + 1}">
												<!-- ⭐ ITEM 2 (2026-09-06 critique) — THE AGE, HOISTED ONCE.
												     `sharedAgeFor` only returns non-null when EVERY slot in
												     this row printed the identical `formatTimeAgoCompact`
												     string, so dropping the per-atom age above and printing
												     it here once can never disagree with what the atoms
												     would have said individually. Lowercase — it follows the
												     chips, it does not lead the line (`lib/CLAUDE.md`'s age
												     grammar note). -->
												{#if sharedAge}
												<!-- ⭐ FOLLOW-UP (d), 2026-09-06 coordinator re-check — NO LEADING
												     SEPARATOR. `· deployed 7d ago` wrapped to its own line at 390
												     (three stacked chips left no room beside it), and a leading `·`
												     with nothing before it on THAT line reads as a stray dot. The
												     row's own `gap-x-4` already separates this span from the chips
												     when they share a line; nothing is lost relying on it instead
												     of a mark that can end up alone. -->
													<span class="t-micro text-gray-500 dark:text-gray-400"
														>deployed <time
															datetime={sharedAge.iso}
															title={new Date(sharedAge.iso).toLocaleString()}>{sharedAge.ago}</time
														> ago</span
													>
												{/if}
												<!-- WHAT TOOK ITS PLACE — once per (service, build), not
												     once per environment. `deploying` is excluded: it is
												     STILL this row's own build going out, never something
												     that "took its place" — see `deployingCaption`, drawn
												     per atom above instead. -->
												{#if bucket.key !== 'live' && bucket.key !== 'failing' && bucket.key !== 'deploying' && rg.runs}
													<span class="t-micro text-gray-500 dark:text-gray-400"
														>now on <span class="t-code-sm">{rg.runs}</span></span
													>
												{:else if bucket.key === 'live' && rg.slots.some((s) => !s.onOwnRelease)}
													<!--
														⭐ THE RELEASE EACH PLACE RUNS, SAID ONCE THE ROW HAS
														TWO TO CHOOSE FROM. (2026-09-03, operator-walk
														BLOCKING item) `live` used to mean "running the row's
														OWN release" by construction, so a place here never
														needed to say which release — it was always this
														one. Now `live` means "running the revision", and a
														place on an OLDER release sharing it (rel-66 while
														the row is named for rel-67) is exactly the deviation
														this product's whole design marks: the ordinary case
														(every place onOwnRelease) prints nothing extra, same
														as before.
													-->
													<span
														class="t-micro flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400"
													>
														on <span class="t-code-sm">{rg.runs}</span>
														{#if rg.slots.some((s) => s.blockingGates.length > 0)}
															<Chip
																role="held"
																label="held"
																title="A newer release of this build exists and no rule lets it through yet"
															/>
														{:else}
															<span>— on an older release of it</span>
														{/if}
													</span>
												{/if}
											</div>
											</div>
										{/each}
									</li>
								{/each}
							</ul>
						{/if}

						<!-- ⛔ A FOOTER `<p>` PRINTED `bucket.description`, WHICH IS THE
						     CARD'S OWN `verdictTitle` AND, WORSE, ITS OWN TITLE RESTATED.
						     (2026-09-02, from the human: definitions belong in a record,
						     not in the printed tier.) `Running it now` sat 130px above
						     `These are running this build right now.` — one card, one
						     fact, twice, and the second copy in prose. The record on the
						     `N places` rollup keeps every word of it. -->
					</Card>
				{/each}

		</div>
	{/if}

	<ChangeVersionModal
		bind:open={modalOpen}
		rollout={modalRollout}
		initialSelectedVersion={modalVersion}
		cluster={modalCluster}
	/>
	<ClearPinModal
		bind:open={clearPinOpen}
		rollout={clearPinRollout}
		cluster={clearPinCluster}
		environmentName={clearPinEnvLabel}
	/>
</div>

<style>
	/*
	 * GEOMETRY AND THE THREE GLYPH INKS ONLY — everything else stays in
	 * utilities, per the `app.css` layering note: a Svelte-scoped rule outranks
	 * a Tailwind utility, so anything declared here is un-overridable from the
	 * markup.
	 */

	/*
	 * ⭐ THE BUILD PAGE'S OWN HERO STAYS PLAIN MARKUP — the object is named
	 * once, in the head band (see the comment there). `RevisionLead` DOES
	 * have a call site in this file now: the REPOSITORY page's hero cards
	 * (B.4 item 6), one per release line, each hosted inside its own
	 * `<Card>` — see the `{#each repoLeadRows}` block above.
	 */

	/*
	 * ⭐ ROUND 11 CRAFT FINDING 4 — THE HELD BANNER PRECEDES THE LEDGER
	 * BELOW `sm`. See the markup comment above `.rev-repo-top` for the
	 * decision record (container query over an in-page link). `order` is
	 * the standard flex reorder idiom; the DOM order (ledger first,
	 * matching B.4's own item numbering) stays the source of truth for
	 * every reader that does not see CSS at all (screen readers walk DOM
	 * order, not visual order).
	 */
	.rev-repo-top {
		display: flex;
		flex-direction: column;
		/* The gap belongs to the container, not to the banner: whichever
		   order the children take below `sm`, every pair is 16px apart. */
		gap: 16px;
		margin-top: 20px;
	}

	.rev-repo-ledger {
		order: 1;
	}

	.rev-repo-banner {
		order: 2;
	}

	@container (max-width: 639px) {
		.rev-repo-ledger {
			order: 2;
		}

		.rev-repo-banner {
			order: 1;
		}
	}

	/*
	 * ⛔ THE REPOSITORY-PAGE LEDGER'S OWN `.svc-*` GRID IS GONE (ROUND 11
	 * REVISIONS-PASS-6, ITEM 1, r11c). It was a second, hand-rolled copy of
	 * `RepoLedgerCard.svelte`'s own geometry — this route renders that
	 * component directly now (`filterable`), so its CSS lives in exactly
	 * one place.
	 */

	/*
	 * ⛔ THE FIXED-WIDTH RAIL IS GONE, AND SO IS THE SECOND GRID LEVEL.
	 * (2026-09-02, design re-check: *"the three cards in the side-by-side row
	 * end at 460 / 538 / 546 — 86px of rag in one row."*) `.rev-cols` held
	 * `.rev-buckets` in one column and `What each service calls it` fixed at
	 * 340px in the other, each with its OWN `align-items: start` — so a
	 * card's height never had anything to answer to but its own content, in
	 * either grid. ONE flat grid now holds every card on the page (`This
	 * build`, the service-rank card, the bucket cards) as equal siblings.
	 *
	 * ⛔ `align-items: stretch` LASTED FOUR DAYS AND WAS REVERSED (ITEM 1,
	 * 2026-09-06 critique). It made every card sharing a ROW share that
	 * row's height, and measured live that put `Running it now` at 417px
	 * beside a 161px `Not here yet` — 61% empty, 85% on the one-place state.
	 * `Card.svelte`'s `flex flex-col` root and `grow` body are unused for
	 * height-matching now — round-7 item 3 removed the `This build` / `What
	 * each service calls it` opt-in too, so `align-items: start` is the
	 * grid's ONLY rule and every card, with no exception, answers to its own
	 * content and nothing else.
	 *
	 * ⛔ AND `auto-fit` IS GONE TOO — A RESIDUE OF THE FIRST FIX. (2026-09-02,
	 * design re-check: *"`This build | Running it now | Not here yet` on row
	 * 1 and `What each service calls it` alone on row 2 with two empty tracks
	 * beside it."*) `auto-fit` packs as many 300px tracks as the width allows,
	 * so a 1440 row fit THREE cards and left a fourth stranded with two empty
	 * columns beside it — the rag this file's own previous fix was written to
	 * remove, one level up. TWO FIXED TRACKS, always, from `sm` up: no width
	 * ever earns a third, so no card count can strand a lone survivor beside
	 * more than one empty track.
	 *
	 * THE ORDER PAIRS BY SUBJECT, NOT BY ARRIVAL. `This build` and `What each
	 * service calls it` are both about the BUILD (identity, then what each
	 * service calls it) and sit in row 1; the bucket cards are all about
	 * PLACES (where it is, where it isn't) and fill row 2 on. Markup order is
	 * the row order in a 2-column grid, so the Card for `What each service
	 * calls it` moved up to sit right after `This build` in the template —
	 * see the comment there.
	 */
	/*
	 * ⭐ F3: A CONTAINER QUERY, NOT `@media (min-width: 640px)`. (2026-09-03,
	 * breakpoints pass) The sidebar is 175px from `sm` (640px) viewport width
	 * on, so this page's own content box is not monotonic in viewport width
	 * — a 639px viewport gives it ~624px, a 640px viewport gives it ~449px.
	 * The old media query flipped to two columns at the exact viewport where
	 * the box available to `.rev-buckets` SHRANK below what two tracks need,
	 * so every card here truncated at 640 (`What each service calls it`
	 * 202→62px = `What …`, `This build`→`Thi…`). `.rev-cq`
	 * (`container-type: inline-size` on the page's own content container,
	 * two lines up) makes the query subject the box `.rev-buckets` actually
	 * has, at the same 640px number — moved from the wrong signal to the
	 * right one, not re-tuned.
	 */
	.rev-cq {
		container-type: inline-size;
	}

	/*
	 * ⭐ ROUND 11 CRAFT FINDING 7 — THE NUMERAL LEADS THE ROW: LARGER THAN
	 * THE SHA, LIGHT WEIGHT (`REVISION-PAGES.md`'s own hero anatomy — sha
	 * ~30px, numeral large and light). Both are markup order now
	 * (`.rev-hero-figure` before `.rev-hero-sha`), so no `margin-left` trick
	 * is needed to bind the figure to anything — it is simply first.
	 * ⛔ THE DENOMINATOR MOVED FROM THE CAPTION INTO THE FIGURE, ROUND 11
	 * REVISIONS-PASS-6 ITEM 3 — see `.rev-hero-denom`, below.
	 */
	.rev-hero-figure {
		font-family: var(--font-montserrat);
		font-size: 32px;
		font-weight: 300;
		line-height: 1.15;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 3 — THE DENOMINATOR, ATTACHED TO THE
	 * NUMERATOR. `REVISION-PAGES.md`'s own hero anatomy: "a very large light
	 * numeral N with a SMALLER /M suffix". Half the figure's size and the
	 * caption's own ink (not the figure's near-black), so `6 of 6` reads as
	 * one figure at two weights rather than a second number competing with
	 * the first.
	 */
	.rev-hero-denom {
		font-size: 16px;
		font-weight: 400;
	}

	.rev-hero-sha {
		font-size: 26px;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 3 — THE BREAK IS UNCONDITIONAL NOW.
	 * (Was `@container (max-width: 559px)` only — ITEM 5/round-8 critique,
	 * REPOSITIONED round 11 craft finding 7.) Measured live at 1440: with no
	 * break, the figure, the sha AND the full caption sentence shared one
	 * 150-character row — "jammed" was the caption crowding the sha, not a
	 * spacing defect between the two. The figure and the sha are always a
	 * short pair that fits one line together; the caption is a full
	 * sentence that never should have shared it at any width. `.rev-head-
	 * caption`'s own `max-width: 80ch` (below) is what "nothing orphans at
	 * 390" needs on TOP of the break — a full-width sentence at 390 already
	 * wraps on its own, `80ch` is what keeps it from stretching the same
	 * sentence into one 150-character line at 1440+ instead.
	 */
	.rev-head-break {
		flex-basis: 100%;
	}

	.rev-head-caption {
		max-width: 80ch;
	}

	/*
	 * ⛔ THE OLD PAINTED-TRACK FALLBACK IS GONE, ROUND 11 A.6.3.
	 * That painted-track fallback lived inside `This build` and was gated
	 * on `liveCount > 0 && liveCount < totalCount` — false on every 0% and
	 * every 100% build on this fleet. `CoverageBar` (`coverageBarSegments`
	 * + `coverageBarLabel`) replaces it in the head band, above, and draws
	 * at every count, including 0% and 100%.
	 */

	/*
	 * ⭐ ITEM 1 (2026-09-06 critique) — REVERSED: `align-items: start`, NOT
	 * `stretch`. Measured live: `Running it now` ran 417px on `…/9f10e494d560`
	 * beside a 161px neighbour — 256px of slack, 61% empty — and 85% empty on
	 * the one-place state. The "ONE FLAT GRID" fix above (2026-09-02) chose
	 * `stretch` to kill RAGGED bottoms between cards of similar shape; it did
	 * not anticipate two bucket cards of wildly different content length
	 * sharing a row, which is the ordinary case once a build has both a
	 * `live` and a `notYet` bucket. A card's height is its own content's now;
	 * ragged bottoms are the honest shape of two different amounts of fact.
	 * `This build` / `What each service calls it` no longer opt back into
	 * matching either (round-7 item 3) — `start` is now the grid's one and
	 * only rule, for every card on the page.
	 */
	.rev-buckets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}

	@container (min-width: 640px) {
		.rev-buckets {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		/*
		 * ⭐ ITEM 4 (round-8 critique) — A LONE TRAILING CARD SPANS BOTH
		 * COLUMNS, RATHER THAN LEAVING ITS ROW HALF EMPTY. Measured live on
		 * `064b655b5159`: `This build` and `What each service calls it` fill
		 * row 1, one bucket card (`Running it now`) lands alone under `This
		 * build` in row 2 — and the round-7 "odd-card full-span rule is
		 * gone" comment below the `.rev-group-row` block chose to leave that
		 * second cell an honest, deliberate gap. Measured: 590px wide,
		 * 692px tall — 32% of the whole block, pure ground. The round-7
		 * removal was reacting to a DIFFERENT defect (a full-span card's
		 * OWN trailing fact sitting 745px from its chips) that
		 * `.rev-group-row`'s own `max-content` chips column (below, round
		 * 11 craft finding 7) already closes independently of how wide the
		 * card itself is — so reinstating the span no longer reopens it.
		 *
		 * `:last-child:nth-child(odd)` is the standard "orphan grid item"
		 * selector: it matches only when the LAST child of `.rev-buckets`
		 * sits at an odd position among ALL of this grid's children — which
		 * is exactly when 2-column, row-major placement would otherwise
		 * leave it alone (`This build` + `What each service calls it]` are
		 * always exactly 2, so the last bucket card is odd iff the bucket
		 * COUNT itself is odd). An even bucket count fills both columns on
		 * every row already and this rule does not match at all.
		 *
		 * ⚠️ `:global(...)` ON THE CHILD COMBINATOR IS LOAD-BEARING. Every
		 * bucket card is a `<Card>` — a CHILD COMPONENT — so its root
		 * element never carries THIS file's scoping hash (the exact
		 * Svelte 5 gap this file's own note on the glyph inks records,
		 * two rules below). Scoped as `.rev-buckets.HASH >
		 * :where(.HASH):last-child`, the rule compiled clean and matched
		 * nothing — measured live, `gridColumn` stayed `auto` on every
		 * child. `:global()` drops the scoping requirement from the
		 * selected element while `.rev-buckets` above it stays scoped.
		 */
		.rev-buckets > :global(:last-child:nth-child(odd)) {
			grid-column: 1 / -1;
		}

	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 4 — `THIS BUILD` AND `WHAT EACH
	 * SERVICE CALLS IT` SHARE ONE ROW'S HEIGHT, NEVER SPAN. Replaces round
	 * 11 craft finding 7's `.rev-card-span` (`grid-column: 1 / -1`), which
	 * fixed the 128px ragged-bottom gap by giving `This build` its own
	 * full-width row — moving the hole under `What each service calls it`
	 * instead of closing it (measured live: that card alone at half width,
	 * an empty right track beside it). `.rev-buckets`' own `align-items:
	 * start` (above) is unchanged for every OTHER row — a bucket card still
	 * answers to its own content, per that rule's comment — this is an
	 * `align-self` OPT-IN on exactly these two cells, the one row on the
	 * page where two cards about the same subject (the build's identity)
	 * belong side by side at equal height.
	 *
	 * ⛔ `display: flex` ON THE WRAPPER COLLAPSED THE CARD TO 2px WIDE AT
	 * 390 — CAUGHT LIVE, NOT IN THE FIRST DRAFT. `Card.svelte`'s root is
	 * `.card-cq { container-type: inline-size }` for its OWN `@container`
	 * queries, and `contain: inline-size` (which that property sets)
	 * REMOVES an element's content from its INLINE-axis (width) intrinsic
	 * size contribution to its ancestors — by spec, exactly so a container
	 * query cannot create a sizing loop. A flex ROW child with no explicit
	 * width sizes itself from that same intrinsic contribution
	 * (`flex-basis: auto` = content size); with the content stripped out by
	 * containment, the browser measured it as ~0 and `flex-shrink: 1`
	 * finished the job. `Card` is exempt from the same failure on the
	 * BLOCK axis — `contain: inline-size` only strips the INLINE dimension
	 * — which is why the wrapper's own HEIGHT (967px, measured) was
	 * correct while its WIDTH (2px) was not: the two axes hit two
	 * different CSS mechanisms and only one of them was broken.
	 *
	 * The fix does not put the wrapper in the flex model at all. `align-
	 * self: stretch` on a plain block `<div>` GRID ITEM stretches its
	 * BLOCK size (height) to the row's — a grid track's own width is fr-
	 * distributed independently of any item's content in the first place,
	 * so nothing here depends on `Card`'s intrinsic size for WIDTH either.
	 * `height: 100%` on `Card`'s own root then fills that stretched
	 * wrapper — a block child resolves a percentage height against its
	 * parent's own (now explicit, stretched) height with no containment
	 * interaction on the block axis to break it.
	 */
	.rev-buckets > .rev-card-pair {
		align-self: stretch;
	}

	.rev-buckets > .rev-card-pair > :global(.card-cq) {
		height: 100%;
	}

	/*
	 * ⭐ ROUND 11 r11c ITEM 4 — ONE COLUMN PER ENVIRONMENT, EVERY ROW'S OWN
	 * GRID BUILT FROM THE IDENTICAL TEMPLATE STRING. Measured live at 1024:
	 * `STAGING` sat at x=443 on one app's row and x=641 on another's —
	 * `.rev-group-row` was an independent `flex-wrap` per row, so identical
	 * environments landed wherever THAT row's own preceding atom happened
	 * to end (a rolled-back place's atom is wider than an ordinary one).
	 *
	 * ⛔ `subgrid` WAS THE FIRST DRAFT (`envColumnsFor`'s own doc comment has
	 * the measured failure) — this uses `grid-template-columns` set INLINE
	 * per `<li>` instead (`envGridTemplate`, script-side; identical fixed-
	 * length string for every row in the bucket), which needs no
	 * cross-row negotiation: two independent grids given the same literal
	 * template always agree, where two independent `max-content` grids
	 * (or, it turns out, a subgrid asked to size `max-content` through a
	 * parent) do not.
	 *
	 * `container-type: inline-size` stays for the mobile container query
	 * below, which measures this element's own rendered width inside
	 * `.rev-buckets`' 2-column layout.
	 *
	 * ⚠️ `--env-grid` (A CUSTOM PROPERTY), NOT `grid-template-columns`
	 * DIRECTLY, IN THE INLINE `style`. An inline style always wins over a
	 * stylesheet rule regardless of specificity or source order — if the
	 * per-row template were set as a literal inline `grid-template-columns`,
	 * the mobile `@container` override below could never replace it with
	 * `minmax(0, 1fr)`. Routing it through a custom property lets the
	 * MOBILE rule set the real property directly (which always beats a
	 * `var()` reference at equal specificity), the same fix this file's
	 * `CoverageBar`-adjacent width bug and the ledger toggle's pressed state
	 * both needed for the identical reason.
	 */
	.rev-place-row {
		container-type: inline-size;
		display: grid;
		grid-template-columns: var(--env-grid);
		column-gap: 12px;
		row-gap: 8px;
		align-items: baseline;
	}

	/*
	 * ⭐ ITEM 4 — `.rev-group-row`/`.rev-group-chips` ARE `display: contents`
	 * AT DESKTOP: their own boxes disappear so their CHILDREN (the name
	 * link, the optional label, each environment atom, the trail) become
	 * direct items of `.rev-place-row`'s subgrid — which is what lets each
	 * atom be placed by ENVIRONMENT IDENTITY (`--env-col`, set inline per
	 * atom from `envColumnLine`) instead of by flex-wrap's left-to-right
	 * packing order. `--rg-row` (also set inline, from the `{#each g.runs as
	 * rg, gi}` index) keeps a service with TWO release-runs — one held
	 * environment on an older label, the rest on the row's own — on two
	 * separate grid rows instead of letting auto-placement interleave their
	 * cells wherever a column happens to be free.
	 *
	 * ⛔ BELOW 560px BOTH REVERT (see the `@container` block) — the mobile
	 * layout is unchanged from before this round: one column, name then
	 * chips (still a real `flex-wrap` box there, so short atoms keep
	 * sharing a line) then trail, each its own line.
	 */
	.rev-group-row,
	.rev-group-chips {
		display: contents;
	}

	.rev-group-name {
		grid-column: 1;
		grid-row: var(--rg-row, auto);
	}

	.rev-group-label {
		grid-row: var(--rg-row, auto);
	}

	/*
	 * `display: inline-flex`, its own `--env-col`/`--rg-row` placing it in
	 * its row's fixed-width env column at desktop (the rule two above this
	 * one makes its immediate parent, `.rev-group-chips`, transparent to
	 * layout there).
	 *
	 * ⛔ `flex-wrap: nowrap` IS GONE (r11c item 4). It existed so the chip
	 * and its own age could never split across a LINE BREAK BETWEEN atoms
	 * in the old free-flowing `flex-wrap` row; now each atom has its own
	 * FIXED-width cell (170px, `envGridTemplate`) and the rare compound
	 * content (a rolled-back place's badge plus its own age, ~235px
	 * measured) needs to wrap onto a second line WITHIN that cell instead
	 * of overflowing into the next column — `wrap` is what lets it.
	 */
	.rev-env-atom {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
		grid-column: var(--env-col, auto);
		grid-row: var(--rg-row, auto);
	}

	.rev-group-trail {
		grid-column: -2;
		grid-row: var(--rg-row, auto);
	}

	.rev-group-trail {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-end;
		justify-self: end;
		text-align: right;
		gap: 4px;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 9 — HIDDEN ABOVE 560px. `display:
	 * none` removes it from layout entirely at desktop, so it costs the
	 * subgrid no track. Un-hidden inside the `@container` block below.
	 */
	.rev-group-label {
		display: none;
	}

	/*
	 * ⭐ ROUND 11 r11c ITEM 4 — BELOW 560px, THE SUBGRID STANDS DOWN. One
	 * column (name, chips, trail each their own full-width line — the phone
	 * ledger form `lib/CLAUDE.md`'s "the service ledger" note already
	 * asks for), and the two elements that went `display: contents` for the
	 * desktop subgrid (`.rev-group-row`, `.rev-group-chips`) become real
	 * boxes again: `.rev-group-chips` reverts to the ORIGINAL `flex-wrap`
	 * row so its own atoms keep sharing a line the ordinary way (this was
	 * never broken at mobile — the misalignment item 4 fixes is a desktop-
	 * width, multi-row-per-card defect; `.rev-place-row`'s own container
	 * query already only fires when THIS row itself is narrow). `grid-row:
	 * auto` on every element that carried an explicit `--rg-row` lets two
	 * release-runs stack in DOM order instead of overlapping in the single
	 * remaining column — an explicit row number front the desktop subgrid
	 * would otherwise still apply.
	 */
	@container (max-width: 560px) {
		.rev-place-row {
			grid-template-columns: minmax(0, 1fr);
		}

		.rev-group-chips {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px 16px;
			min-width: 0;
			grid-row: auto;
		}

		.rev-group-name,
		.rev-group-label,
		.rev-env-atom,
		.rev-group-trail {
			grid-row: auto;
		}

		.rev-group-label {
			display: inline;
		}

		.rev-group-trail {
			justify-self: start;
			justify-content: flex-start;
			text-align: left;
		}
	}

	/*
	 * ⛔ `.rev-pair-natural`/`.rev-pair-match` ARE GONE (ITEM 3, 2026-09-06
	 * round-7 critique). F9's height-match opt-in still stretched `What each
	 * service calls it` on `9f10e494d560` — 593×315 with ~92px of dead body
	 * below its last row. The grid's own default, `align-items: start`, now
	 * applies uniformly to `This build`/`What each service calls it` AND the
	 * bucket cards after them: every card on this page answers to its own
	 * content height, never a neighbour's.
	 */

	/*
	 * ⛔ THE ODD-CARD FULL-SPAN RULE WAS GONE, AND IT IS BACK (ITEM 3,
	 * 2026-09-06 round-7 critique; reinstated, ITEM 4, round-8 critique).
	 * Round-7 removed it because it fired unconditionally on `Running it
	 * now` whenever a build's bucket set held exactly one non-empty bucket,
	 * stretching a 340-ish px card to the full ~1200px row and dragging
	 * every `ml-auto` trailer inside it out to the far edge — a measured
	 * 745px gap between the chips and `now on 064b655` on `c1ecfe553070`.
	 * The SAME round-7 pass also gave `.rev-group-row` its own
	 * `max-width: 46rem` reading-measure cap, which independently closes
	 * that 745px gap regardless of how wide the card around it is — so the
	 * full-span removal was solving a defect its sibling fix had already
	 * solved. What round-7 called "an honest gap" (measured live on
	 * `064b655b5159`: 590×692px, 32% of the block) is round-8's own
	 * complaint: a real second column with nothing to say is still 32% of
	 * dead ground when the thing beside it has plenty to say. `.rev-buckets
	 * > :last-child:nth-child(odd)` (above, scoped to the same
	 * `min-width: 640px` container query the 2-column grid itself needs)
	 * reinstates the span, now safe. A row with an EVEN card count is
	 * unaffected either way — it never matches.
	 */

	/* THE THREE GLYPH INKS. Every value is one the product already owns: the
	   mint is the `newest` chip's and `ExposureBar`'s newest segment, so the
	   `Live here` card's tick is literally the same colour as the bar segment
	   it explains. Zero new colour values. */
	/* ⛔ THE THREE GLYPH INKS MOVED TO `app.css` AND MUST STAY THERE.
	   Declared here they were SCOPED, and the class lands on a `<Glyph>` —
	   a child component's `<svg>`, which Svelte 5 does not give the scoping
	   hash. The rules matched nothing; every glyph rendered PURE BLACK
	   (1.43:1 on the dark card). Do not move them back into a component. */

	/*
	 * NAME OVER BUILD — STACKED, AT EVERY WIDTH.
	 *
	 * It was `name | badge` on one line, right-aligned, which worked in a
	 * 1024px column and does not in a 340px rail: `hello-world-manifests` +
	 * a joined `[NEWEST][0afab6f]` + `of 32` measured 396px and the NAME was
	 * what ellipsised — `hello-world-mani…`. Truncating the identifier to keep
	 * a column is the same defect that killed the `/apps` convergence bar, in
	 * the other direction.
	 *
	 * Stacked, the binding is the line break, which is a stronger grouping cue
	 * than a shared right edge anyway; and every row is one name, one badge and
	 * one denominator, so the badge has exactly one possible referent.
	 *
	 * ⛔ FINDING 2 (operator sweep, 2026-09-07) GROWS ONE EXCEPTION. A `held`
	 * row now carries TWO badges — the release running, then the release held
	 * from replacing it (`.chip-mark`, in the template) — because printing
	 * only the held one is the exact defect this finding names: the loudest
	 * thing on the row claimed a build that was not actually live anywhere.
	 * `.rev-svc-build` gains `flex-wrap` so that pair can drop under the name
	 * at 390 instead of forcing the row wider than its column.
	 */
	.rev-svc-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 16px;
		min-width: 0;
	}

	/* The DENOMINATOR gets a fixed track, so the badges right-align to one x
	   instead of to `of 4` / `of 35` / `of 37` — three different string widths,
	   which would leave the boxes ragged by 12px while claiming to be a column. */
	.rev-svc-build {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	/*
	 * PHONE WIDTH IS A DESIGN, NOT A FALLBACK.
	 *
	 * THE HEAD BAND WRAPS AT 390 rather than keeping a fixed two-column split —
	 * it is one `flex-wrap` row now (sha, then the count), so it costs
	 * whatever it costs at the width it is read at, same as `/versions` and
	 * `/activity`'s own head bands. The card grid below it drops to one column
	 * under the `sm` breakpoint, so `This build`, the service-rank card and
	 * every bucket card stack in reading order with no breakpoint of their own.
	 *
	 * The service rows become a two-line stack, because a name track plus a
	 * joined badge plus a denominator cannot share 358px without the badge
	 * ellipsising, and the badge is the one thing on the row that carries
	 * information the reader came for.
	 */
</style>
