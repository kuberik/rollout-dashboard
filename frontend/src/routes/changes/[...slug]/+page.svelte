<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, githubAbsenceSentence } from '$lib/api/github';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	import { commitPullsQueryOptions } from '$lib/api/commit-pulls';
	import { commitQueryOptions, FetchCommitError } from '$lib/api/commit';
	import { parseChangeSlug } from '$lib/pr-ref';
	import { connectGithub } from '$lib/api/github';
	import { FetchPullError } from '$lib/api/pulls';
	import { ensurePrMeta, notifyRevisionSeen, prMetaKey } from '$lib/stores/pr-meta.svelte';
	import { buildPrPipeline, type PrPipelineMeta, type PrCell } from '$lib/view-models/pr-pipeline';
	import { buildLandingGrid, orderByVerdict, classify, worstCell } from '$lib/view-models/landing-grid';
	import { checksLine, cellStateSentence, reasonTail } from '$lib/pr-cell-copy';
	import { changesQueryOptions } from '$lib/api/changes';
	import { buildChangeRows } from '$lib/view-models/changes';
	import LandingGrid from '$lib/components/LandingGrid.svelte';
	import PipelineCard from '$lib/components/PipelineCard.svelte';
	import ChangeRow from '$lib/components/ChangeRow.svelte';
	import {
		repoBody,
		changeBuildPath,
		displayVersionForTag,
		shortRevision,
		repoSlug,
		githubOwnerRepo
	} from '$lib/version-utils';
	import { getDisplayVersion } from '$lib/utils';
	import { repoKeyFromSource } from '$lib/version-utils';
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
		CloseCircleOutline,
		CodeBranchOutline,
		CodePullRequestOutline,
		ExclamationCircleSolid,
		FolderOutline,
		GithubSolid,
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
	import type { Rollout, Environment } from '../../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy, ApiError } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	// THE REPO, NOT THE URL IT IS FETCHED FROM — one spelling with `/versions`.
	import { repoTitle, repoTitleFull } from '$lib/repo-title';
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
		cameFromList = nav.from?.route?.id === '/changes';
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
		// ⭐ CHANGES-2026-09-10 §1 — canonicalise onto `/changes/<repo>/<sha>`,
		// never onto the superseded `/revisions/...` form, and never for a
		// `pull/<n>` URL (that address is already canonical).
		if (repoPageLedger || !ledger || !revision || isPullChange) return;
		const canonical = changeBuildPath(ledger.repoKey, revision, revision);
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

	/**
	 * ⛔ FIX PASS ITEM 9, 2026-09-10 — "CHANGES IN THIS REPOSITORY", THE
	 * REPOSITORY PAGE'S OWN TOP SECTION. §3's own accounting: the index
	 * answers "what changed, across every repo, by time"; this repo page
	 * answers "what does this repo run, per service" (the ledger/held-
	 * banner/`BuildLists` below, unchanged) — this section is the bridge:
	 * the index's OWN rows, filtered to this one repo, so a reader lands
	 * here from a change row and can keep reading forward in the SAME
	 * grammar before falling into the ops view. Reads the SAME
	 * `/api/github/changes` cache the index and Home already warm
	 * (`changesQueryOptions` — TanStack dedupes by key), so mounting this
	 * page after either has been open this session costs no second fetch.
	 */
	const repoChangesQuery = createQuery(() =>
		changesQueryOptions({ days: 30, enabled: githubConnected && !!repoPageLedger })
	);
	const repoChangesOwnerRepo = $derived(repoPageLedger ? githubOwnerRepo(repoPageLedger.repoKey) : null);
	const repoChangeRows = $derived.by(() => {
		if (!repoChangesOwnerRepo) return [];
		const key = `${repoChangesOwnerRepo.owner}/${repoChangesOwnerRepo.repo}`.toLowerCase();
		const all = buildChangeRows(
			repoChangesQuery.data?.changes ?? [],
			rollouts,
			environments,
			query.data?.rolloutDependencies ?? null,
			coarse
		);
		return all.filter((r) => r.repoKey === key);
	});
	const repoChangesShown = $derived(repoChangeRows.slice(0, 10));

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

	// ══════════════════════════════════════════════════════════════════════
	// CHANGES-2026-09-10 — THE CHANGE PAGE (PULL AND SHA FORMS)
	//
	// §1's ONE disambiguation rule, evaluated only once the whole-slug repo
	// match above (`repoPageLedger`) has failed: a slug whose last two
	// segments are `pull/<digits>` is a change page keyed on a PR; everything
	// else splits the last segment off as a build key, exactly as `parsed`
	// above already does for the repository/build split. `parseChangeSlug`
	// (`pr-ref.ts`, Lane 1) is that one rule; this file does not re-derive it.
	//
	// §3: "the change page is ONE page kind" — `/changes/<repo>/pull/<n>` and
	// `/changes/<repo>/<sha>` render the SAME body (verdict → the compact
	// `LandingGrid` → one `PipelineCard` per service), built off the SAME
	// `PrPipelineMeta`/`buildPrPipeline` a real PR already used on the
	// (superseded) `/pr/…` route. A bare commit constructs the meta the design
	// doc names verbatim: `{mergeCommitSha: sha, containedIn: [],
	// containedInAll: false}` — exact membership, no truncation fallback.
	// §3 also settles the "does the old build page survive" question: it does
	// not, verbatim — "what each service calls it" IS `cell.releaseLabel` and
	// "running it now" IS the `live` cells, both already drawn by
	// `PipelineCard`/`PipelineRow`, so nothing is lost and the coverage bar is
	// correctly dropped ("a change's coverage is the grid").
	// ══════════════════════════════════════════════════════════════════════

	const changeSlugParsed = $derived.by(() => {
		if (repoPageLedger) return null;
		const raw = (page.params.slug as string) || '';
		const segments = raw
			.split('/')
			.filter((s) => s.length > 0)
			.map(safeDecode);
		return parseChangeSlug(segments);
	});

	/**
	 * owner/repo parsed straight off the URL's own repo slug — independent of
	 * the fleet's ledger, exactly like the (superseded) `/pr/…` route always
	 * worked. `null` when the slug names something other than a well-formed
	 * `github.com/owner/repo` — an `app:`-fallback repo (no linked source) or
	 * a repo on a non-GitHub host has no PR/commit concept at all, and a
	 * malformed slug is the existing "repository not found" case below,
	 * unchanged.
	 */
	const changeOwnerRepo = $derived.by<{ owner: string; repo: string } | null>(() => {
		const repoSlugPath = changeSlugParsed?.repoSlug ?? '';
		const parts = repoSlugPath.split('/').filter((s) => s.length > 0);
		if (parts.length !== 3 || parts[0] !== 'github.com') return null;
		return { owner: parts[1], repo: parts[2] };
	});

	const isPullChange = $derived(changeSlugParsed?.ref.kind === 'pull' && !!changeOwnerRepo);
	const isShaChange = $derived(changeSlugParsed?.ref.kind === 'sha' && !!changeOwnerRepo);
	const changeOwner = $derived(changeOwnerRepo?.owner ?? '');
	const changeRepo = $derived(changeOwnerRepo?.repo ?? '');
	const changeNumber = $derived(
		changeSlugParsed?.ref.kind === 'pull' ? changeSlugParsed.ref.number : NaN
	);

	// ── THE PULL FORM — byte-identical machinery to the superseded `/pr/…`
	// route (`ensurePrMeta` memoises by `owner/repo#n`, so this is a cache
	// lookup, not a re-fetch, for a tab that already had this PR open there).
	const prEntry = $derived(isPullChange ? ensurePrMeta(changeOwner, changeRepo, changeNumber) : null);
	const prData = $derived(prEntry?.data ?? null);
	const prError = $derived(prEntry?.error ?? null);
	const prLoading = $derived(!!prEntry?.loading && !prData && !prError);
	const pullError = $derived(prError instanceof FetchPullError ? prError : null);

	const expectedChangeRepoKey = $derived(repoKeyFromSource(`github.com/${changeOwner}/${changeRepo}`, ''));
	const notifiedChangeRevisions = new Set<string>();
	let changeSnapshotKey = '';
	let changeSnapshotRevisions = new Set<string>();
	let changeSnapshotTaken = false;
	$effect(() => {
		if (!isPullChange || !prData) return;
		if (!query.data) return; // wait for the list's own first settle
		const key = prMetaKey(changeOwner, changeRepo, changeNumber);
		if (changeSnapshotKey !== key) {
			changeSnapshotKey = key;
			changeSnapshotRevisions = new Set<string>();
			changeSnapshotTaken = false;
			notifiedChangeRevisions.clear();
		}
		if (!changeSnapshotTaken) {
			changeSnapshotTaken = true;
			for (const rollout of rollouts) {
				if (repoKeyFromSource(rollout.status?.source, '') !== expectedChangeRepoKey) continue;
				for (const rel of rollout.status?.availableReleases ?? []) {
					if (rel.revision) changeSnapshotRevisions.add(rel.revision);
				}
			}
			return;
		}
		for (const rollout of rollouts) {
			if (repoKeyFromSource(rollout.status?.source, '') !== expectedChangeRepoKey) continue;
			for (const rel of rollout.status?.availableReleases ?? []) {
				const rev = rel.revision;
				if (!rev || notifiedChangeRevisions.has(rev) || changeSnapshotRevisions.has(rev)) continue;
				notifiedChangeRevisions.add(rev);
				notifyRevisionSeen(key, rev);
			}
		}
	});

	const mergedAgo = $derived(
		prData?.mergedAt ? `${formatTimeAgoCompact(prData.mergedAt, coarse)} ago` : null
	);
	/** See the (superseded) `/pr/…` route's own comment: composed as ONE
	 *  string, not a template built across `{#if}` branches, so Svelte never
	 *  gets a chance to trim a leading space across a block boundary. */
	const subtitleTail = $derived(
		prData
			? mergedAgo
				? `merged ${mergedAgo} by @${prData.author}`
				: prData.state === 'closed'
					? `closed by @${prData.author}`
					: `opened by @${prData.author}`
			: ''
	);
	const checks = $derived(checksLine(prData?.checks));
	const openAge = $derived(prData?.openedAt ? formatTimeAgoCompact(prData.openedAt, coarse) : null);
	const openHeadShort = $derived(prData?.headSha ? prData.headSha.slice(0, 7) : null);
	const openFilesLabel = $derived(
		prData?.changedFiles != null
			? `${prData.changedFiles} file${prData.changedFiles === 1 ? '' : 's'}`
			: null
	);

	const pullMeta = $derived<PrPipelineMeta | null>(
		isPullChange && prData && prData.state === 'merged'
			? {
					owner: changeOwner,
					repo: changeRepo,
					number: changeNumber,
					mergedAt: prData.mergedAt,
					mergeCommitSha: prData.mergeCommitSha,
					containedIn: prData.containedIn,
					containedInAll: prData.containedInAll
				}
			: null
	);

	// ── THE SHA FORM — a bare commit. `revision` (already resolved above via
	// `resolveRevision(ledger, urlKey)`, prefix-matched against every known
	// build on this repo) wins when this cluster has ever built it; the raw
	// URL segment is the fallback, so a sha this cluster has NEVER built still
	// renders a valid page ("not built yet", §3/item 8 — never a 404 for an
	// honest question).
	const shaForChange = $derived(changeSlugParsed?.ref.kind === 'sha' ? (revision ?? changeSlugParsed.ref.sha) : null);

	/**
	 * ⭐ APPROACH B, ITEM D, RETARGETED FOR CHANGES-2026-09-10 §3 — THE CHANGE
	 * PAGE'S OWN TITLE RESOLUTION FOR A BARE SHA. Lazily fetched ONCE PER PAGE
	 * (`enabled` gates on `githubConnected` and a resolved owner/repo/sha —
	 * never on the repository list rows). `changeOwnerRepo`/`shaForChange`
	 * (below) are URL-derived, not ledger-derived, so this fires even for a
	 * sha this cluster has never built (§3/item 8: "not built yet" still
	 * gets a page, and a PR title if GitHub happens to know one anyway).
	 */
	const buildPullsQuery = createQuery(() =>
		commitPullsQueryOptions({
			owner: changeOwnerRepo?.owner ?? '',
			repo: changeOwnerRepo?.repo ?? '',
			sha: shaForChange ?? '',
			enabled: isShaChange && githubConnected && !!shaForChange
		})
	);
	const buildPulls = $derived(buildPullsQuery.data ?? []);

	/**
	 * ITEM 4 (CHANGES-2026-09-10.md) — THE BARE-SHA TITLE/SUBTITLE, WHEN NO
	 * PR RESOLVES ONE. Fires in PARALLEL with `buildPullsQuery` (not gated
	 * on it resolving first — see `commit.ts`'s own doc comment): a commit
	 * that never landed via a PR this cluster can see is the common case for
	 * a bare-sha change page, and there is no reason to pay a sequential
	 * round trip for it.
	 */
	const commitDetailQuery = createQuery(() =>
		commitQueryOptions({
			owner: changeOwnerRepo?.owner ?? '',
			repo: changeOwnerRepo?.repo ?? '',
			sha: shaForChange ?? '',
			enabled: isShaChange && githubConnected && !!shaForChange
		})
	);
	const commitDetail = $derived(commitDetailQuery.data ?? null);

	/**
	 * ⛔ FIX PASS ITEM 7, 2026-09-10 — A SHA THAT DOES NOT EXIST IN THIS
	 * REPO IS A SCOPE ERROR, NOT "NOT BUILT YET". `buildPullsQuery` resolving
	 * nothing rules out a PR too (both queries fire in parallel — see the
	 * doc comment above `buildPullsQuery`). `commit.ts`'s own `not_found`
	 * reason is exactly this case. Once confirmed, `ledgers` (every repo
	 * THIS CLUSTER deploys, already built above) is searched for the one
	 * repo whose own revision history actually contains this sha — "a link
	 * to the repo it IS in when the ledger knows it".
	 */
	const commitNotFoundInRepo = $derived(
		isShaChange &&
			!buildPullsQuery.isLoading &&
			buildPulls.length === 0 &&
			commitDetailQuery.error instanceof FetchCommitError &&
			commitDetailQuery.error.reason === 'not_found'
	);
	const commitFoundInOtherRepo = $derived.by<{ repoKey: string; label: string } | null>(() => {
		if (!commitNotFoundInRepo || !shaForChange) return null;
		for (const other of ledgers) {
			if (other.repoKey === ledger?.repoKey) continue;
			if (resolveRevision(other, shaForChange)) {
				return { repoKey: other.repoKey, label: repoTitle(other.repoLabel) };
			}
		}
		return null;
	});

	/** §3's title rule: the PR title when `commits/:sha/pulls` resolves one
	 *  (reusing the SAME lazy client `buildPullsQuery` below already wired
	 *  for the (now-superseded) build page's own "Pull requests" line — one
	 *  request, not a second endpoint), else the commit's own subject
	 *  (`commitDetail`, item 4), else the short sha. Prefers a MERGED
	 *  result so a still-open PR naming this exact commit does not outrank
	 *  the record GitHub itself would call authoritative for a landed change. */
	const changeCommitPull = $derived(
		buildPulls.find((p) => p.state === 'merged') ?? buildPulls[0] ?? null
	);

	const shaMeta = $derived<PrPipelineMeta | null>(
		isShaChange && shaForChange
			? {
					owner: changeOwner,
					repo: changeRepo,
					mergedAt: changeCommitPull?.mergedAt ?? null,
					mergeCommitSha: shaForChange,
					containedIn: [],
					containedInAll: false
				}
			: null
	);

	const changeMeta = $derived(pullMeta ?? shaMeta);
	const changeVm = $derived(
		changeMeta
			? buildPrPipeline(changeMeta, rollouts, environments, query.data?.rolloutDependencies ?? null, coarse)
			: null
	);

	/**
	 * ⛔ FIX PASS ITEM 4, 2026-09-10 — `orderByVerdict`, `landing-grid.ts`'s
	 * own exported ordering (ruling 6: "the SAME order function is
	 * exported for the change page's own cards"), not a second hand-rolled
	 * sort. `classify(worstCell(...).state)` is the identical fold
	 * `buildLandingGrid` uses for `LandingServiceVM.verdictWord`, so the
	 * head grid above and this per-service card list below can never
	 * disagree about which service leads. */
	const changeOrderedServices = $derived.by(() => {
		if (!changeVm) return [];
		return orderByVerdict(
			changeVm.services,
			(s) => (s.cells.length ? classify(worstCell(s.cells).state) : 'live'),
			(s) => s.appName
		);
	});
	const changeNotBuiltServiceNames = $derived.by(() => {
		if (!changeVm) return [];
		return changeVm.services
			.filter((s) => s.cells.every((c) => c.state === 'not-built'))
			.map((s) => s.appName)
			.sort((a, b) => a.localeCompare(b));
	});

	/**
	 * ⛔ FIX PASS ITEM 7, 2026-09-10 — READS `pr-pipeline.ts`'s OWN COUNTS
	 * NOW (`rolloutsTotal`/`rolloutsWithBuild`/`rolloutsLive`, ruling 3's
	 * additive fields), not a second hand-rolled `flatMap` over
	 * `changeVm.services` computed here. "N of M rollouts have a build of
	 * this change · live in K" — a build-progress fact (N of M), not the
	 * "would get it" framing the old wording used, which only ever counted
	 * M and could not say how many of them actually have it yet. */
	const changeRolloutsTotal = $derived(changeVm?.rolloutsTotal ?? 0);
	const changeRolloutsWithBuild = $derived(changeVm?.rolloutsWithBuild ?? 0);
	const changeRolloutsLive = $derived(changeVm?.rolloutsLive ?? 0);

	/**
	 * ⛔ FIX PASS ITEM 7, 2026-09-10 — THE BLOCKING FACT IS A `HeldBanner`,
	 * NOT AN `h2`. The verdict already NAMES the frontier
	 * (`buildChangeVerdict`, ruling 3) — this finds the actual FRONTIER
	 * CELL behind that word (same selection: earliest env-rank cell, among
	 * cells whose service has a build, that is not live) so the banner can
	 * carry a real subject, sentence and action. `pr-pipeline.ts` does not
	 * export the cell itself (only the word/tone pair), so this mirrors
	 * `buildChangeVerdict`'s own selection — a small, stable selection, not
	 * a second gate-classification pass (this page invents no new gate
	 * facts; `cell.reason`/`gateSubject`/`gateLabel` are already computed by
	 * `pr-pipeline.ts`).
	 */
	const changeFrontier = $derived.by<{ cell: PrCell; appName: string; builtElsewhere: boolean } | null>(() => {
		if (!changeVm) return null;
		const withBuild = changeVm.services
			.flatMap((s) => s.cells.map((cell) => ({ cell, appName: s.appName, builtElsewhere: s.builtElsewhere })))
			.filter((x) => x.cell.state !== 'not-built');
		if (withBuild.length === 0 || withBuild.every((x) => x.cell.state === 'live')) return null;
		const candidates = withBuild
			.filter((x) => x.cell.state !== 'live')
			.sort((a, b) => a.cell.envRank - b.cell.envRank || a.cell.cluster.localeCompare(b.cell.cluster));
		return candidates[0] ?? null;
	});

	// `frontierTone`'s own classification (pr-pipeline.ts): held-like states
	// are `gated`/`pinned`/`waiting-upstream`. Matches `changeVm.verdictTone
	// === 'held'` exactly — restated here as a cell-level check because the
	// banner needs the CELL, not just the tone.
	const changeHeld = $derived(
		changeFrontier != null &&
			(changeFrontier.cell.state === 'gated' ||
				changeFrontier.cell.state === 'pinned' ||
				changeFrontier.cell.state === 'waiting-upstream')
	);
	/**
	 * ⭐ FIX PASS ITEM 2, 2026-09-10 — THE JOINED REASON REACHES THE BANNER.
	 * `cellStateSentence` alone prints only "waiting on hello-api-app" for a
	 * `waiting-upstream` frontier — `joinDependencyReasons` (`pr-pipeline.ts`,
	 * RULING 4) already computed the more useful ADDED fact ("its build of
	 * this change does not exist yet") onto `cell.reason`, but nothing read
	 * it here. `reasonTail` strips the shared "waiting on X" prefix so it is
	 * not printed twice — the banner's one message line ends up "waiting on
	 * hello-api-app — its build of this change does not exist yet" instead
	 * of stopping short.
	 */
	const changeHeldMessage = $derived.by(() => {
		if (!changeFrontier) return '';
		const sentence = cellStateSentence(changeFrontier.cell, coarse, {
			builtElsewhere: changeFrontier.builtElsewhere
		});
		const tail = reasonTail(changeFrontier.cell, coarse);
		return tail ? `${sentence} — ${tail}` : sentence;
	});
	const changeHeldPrimary = $derived.by<{ href: string; label: string } | null>(() => {
		if (!changeFrontier || changeFrontier.cell.gateSubjectKind !== 'service' || !changeFrontier.cell.gateSubject) {
			return null;
		}
		return { href: `/apps/${encodeURIComponent(changeFrontier.cell.gateSubject)}`, label: changeFrontier.cell.gateSubject };
	});
	const changeHeldHasSchedule = $derived(changeFrontier?.cell.gateSubjectKind === 'schedule');

	const landingGrid = $derived(changeVm ? buildLandingGrid(changeVm, coarse) : null);

	const changePageTitle = $derived(
		isPullChange
			? prData
				? `#${changeNumber} ${prData.title} · kuberik`
				: `#${changeNumber} · kuberik`
			: isShaChange
				? changeCommitPull
					? `${changeCommitPull.title} · kuberik`
					: commitDetail?.subject
						? `${commitDetail.subject} · kuberik`
						: `${shaForChange ? shortRevision(shaForChange) : changeSlugParsed?.ref.kind === 'sha' ? changeSlugParsed.ref.sha : ''} · kuberik`
				: ''
	);

	const commitHtmlUrl = $derived(
		isShaChange && shaForChange ? `https://github.com/${changeOwner}/${changeRepo}/commit/${shaForChange}` : ''
	);

	/**
	 * ⭐ ONE STRING, NOT A TEMPLATE BUILT ACROSS `{#if}` BRANCHES — same
	 * reasoning as the pull form's own `subtitleTail` above (Svelte trims the
	 * leading whitespace of a text node that OPENS a block branch, which
	 * swallowed the space here too and rendered `kuberik-testing· merged …`
	 * with no gap before the dot, live on `bf5be49`).
	 *
	 * ITEM 4 — a resolved PR's own merge sentence still wins when one
	 * exists (it is the more specific fact: WHO merged it and WHEN, not
	 * just when the commit was made); `commitDetail`'s `committed N ago by
	 * @who` is the fallback for the common "no PR" case this item exists
	 * for, not a replacement for the PR sentence.
	 */
	const shaSubtitleTail = $derived(
		changeCommitPull?.mergedAt
			? `merged ${formatTimeAgoCompact(changeCommitPull.mergedAt, coarse)} ago by @${changeCommitPull.author}`
			: commitDetail?.committedAt
				? `committed ${formatTimeAgoCompact(commitDetail.committedAt, coarse)} ago by @${commitDetail.author}`
				: null
	);

	/* ── SKELETON — remembers the last service-card count, like the
	   (superseded) `/pr/…` route. */
	const CHANGE_SHAPE_KEY = 'changes/pipeline';
	const changeRemembered = recallShape<{ services: number }>(CHANGE_SHAPE_KEY);
	const changeSkelServices = changeRemembered?.services ?? 2;
	$effect(() => {
		if (!changeVm) return;
		rememberShape(CHANGE_SHAPE_KEY, { services: Math.min(changeVm.services.length, 5) });
	});
</script>

<svelte:head>
	<!-- CHANGES-2026-09-10.md §1's title table: the repository page keeps the
	     `kuberik | <repo> changes` shape; the pull/sha change-page forms use
	     their OWN title (`changePageTitle`, `#N <title> · kuberik` or
	     `<sha> · kuberik`) — not the `kuberik | ` prefix, matching the
	     superseded `/pr/…` route's own title exactly. -->
	<title
		>{repoPageLedger
			? `kuberik | ${repoTitle(repoPageLedger.repoLabel)} changes`
			: isPullChange || isShaChange
				? changePageTitle
				: row
					? `kuberik | ${row.short}`
					: `kuberik | ${urlKey}`}</title
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
	{#if !isPullChange && !isShaChange}
		<!-- ⛔ NO BREADCRUMB ON THE CHANGE PAGE ITSELF (pull or sha form) —
		     explicit, not an oversight, carried over from the superseded
		     `/pr/{owner}/{repo}/{number}` route's own comment: "a PR is not
		     a rollout, and the palette is how a reader got here and how they
		     leave." The repository page (and the not-found / unlinked-repo
		     branches below it) keep the trail. -->
		<nav
			class="t-dense mb-4 flex min-w-0 flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400"
			aria-label="Breadcrumb"
		>
			{#if cameFromList}
				<button type="button" class="nav-link" onclick={() => history.back()}>All changes</button>
			{:else}
				<a class="nav-link" href={withQuery('/changes')}>All changes</a>
			{/if}
			{#if !repoPageLedger && ledger}
				<ChevronRightOutline class="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
				<a class="nav-link min-w-0 truncate" href={withQuery(`/changes/${repoSlug(ledger.repoKey)}`)}
					>{repoTitle(ledger.repoLabel)}</a
				>
			{/if}
		</nav>
	{/if}

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

	<!--
		⭐ CHANGES-2026-09-10 §3 — "THE CHANGE PAGE IS ONE PAGE KIND." The body
		below the head band is byte-identical whether `changeVm` was built from
		a merged PR's `PrPipelineMeta` or a bare commit's — one snippet, two
		callers (the `isPullChange`/`isShaChange` branches further down), so
		the verdict/`LandingGrid`/`PipelineCard` composition cannot drift
		between the two forms the way two independently-maintained templates
		eventually would.
	-->
	{#snippet changeBody()}
		{#if changeVm}
			{#if changeHeld && changeFrontier}
				<!-- ⛔ FIX PASS ITEM 7, 2026-09-10 — THE BLOCKING FACT IS A
				     `HeldBanner` (filled, icon, action), NOT AN `h2`. Replaces
				     the plain verdict headline for exactly the held case — the
				     banner's own title already says "{subject} is held", so
				     printing the bare verdict word above it too would restate
				     the same fact twice. `stories={[]}` deliberately: this VM
				     does not carry a full `BlockingStory` (`pr-pipeline.ts`
				     supplies `reason`/`gateSubject`/`gateLabel` per cell, not a
				     `rolloutGates` classification this page can stand behind —
				     see that module's own `containmentKnown` doc) — the banner
				     degrades cleanly to just `releaseSplitMessage` with no
				     stories, which is exactly the one sentence this page has. -->
				<div class="mb-4">
					<HeldBanner
						subject={changeFrontier.appName}
						releaseSplitMessage={changeHeldMessage}
						stories={[]}
						primaryHref={changeHeldPrimary?.href ?? null}
						primaryLabel={changeHeldPrimary?.label ?? null}
						hasSchedule={changeHeldHasSchedule}
					/>
				</div>
			{:else}
				<h2 class="t-headline mb-1 text-gray-900 dark:text-white">{changeVm.verdict}</h2>
			{/if}
			{#if changeNotBuiltServiceNames.length > 0 && changeNotBuiltServiceNames.length < changeVm.services.length}
				<!-- Only when it's NEW information — a page whose verdict is
				     already "Not built yet" (every service) would restate itself. -->
				<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
					Not built yet for {changeNotBuiltServiceNames.join(', ')}.
				</p>
			{/if}
			{#if changeRolloutsTotal > 0}
				<!-- ⛔ FIX PASS ITEM 7, 2026-09-10 — "N of M rollouts have a build
				     of this change · live in K", off `pr-pipeline.ts`'s own
				     `rolloutsWithBuild`/`rolloutsTotal`/`rolloutsLive` counts
				     (ruling 3), not the old "M rollouts would get it" framing,
				     which only ever counted the destination and could not say
				     how many of them actually have the change yet. -->
				<p class="t-dense mb-4 text-gray-500 dark:text-gray-400">
					{changeRolloutsWithBuild} of {changeRolloutsTotal} rollout{changeRolloutsTotal === 1 ? '' : 's'} have a
					build of this change{#if changeRolloutsLive > 0}
						· live in {changeRolloutsLive}{/if}
				</p>
			{/if}
			{#if landingGrid}
				{#if landingGrid.allSameLabel}
					<!-- §2b's fold rule 1: every service agrees — one label, not a
					     grid of identical rows. -->
					<p class="t-dense mb-4 text-gray-500 dark:text-gray-400">{landingGrid.allSameLabel}</p>
				{:else if landingGrid.visible.length > 0}
					<!-- ⛔ FIX PASS ITEM 4, 2026-09-10 — `landingGrid.visible` is now
					     `landing-grid.ts`'s FULL adverse-first list (ruling 6, no
					     longer 3-capped); `LandingGrid` owns its own fold (a real
					     button, ≥1024px shows every service). Passing the SAME list
					     here as `ChangeRow` passes on the index means the row a
					     reader clicked is a strict prefix of this page. -->
					<div class="mb-4">
						<LandingGrid services={landingGrid.visible} />
					</div>
				{/if}
			{/if}
			{#if changeOrderedServices.length > 0}
				<div class="space-y-4">
					{#each changeOrderedServices as service (service.appName)}
						<PipelineCard
							{service}
							{localClusterName}
							{environments}
							rolloutDependencies={query.data?.rolloutDependencies ?? null}
							now={coarse}
						/>
					{/each}
				</div>
			{/if}
		{/if}
	{/snippet}

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
			backHref="/changes"
			backLabel="Back to all changes"
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

		{#if repoChangesShown.length > 0}
			<!--
				⛔ FIX PASS ITEM 9, 2026-09-10 — "CHANGES IN THIS REPOSITORY"
				FIRST, THEN THE OPS CONTENT AS TODAY. The index's own rows
				(`ChangeRow`, unchanged — same component, same grammar), capped
				at 10, newest first (`buildChangeRows`' own order), so a reader
				who landed here from a change row can keep reading forward
				before falling into "what each service runs" below. Absent
				entirely when GitHub is not connected or nothing has merged in
				the window — never an empty card.
			-->
			<div class="mb-5">
				<Card icon={CodePullRequestOutline} title="Changes in this repository" padded={false}>
					{#snippet rollup()}
						<a
							href={`/changes?repo=${encodeURIComponent(`${repoChangesOwnerRepo?.owner}/${repoChangesOwnerRepo?.repo}`.toLowerCase())}`}
							class="nav-link shrink-0"
							aria-label="All changes in {repoTitle(repoPageLedger.repoLabel)}"
						>
							All changes in {repoTitle(repoPageLedger.repoLabel)}
							<ChevronRightOutline class="h-3.5 w-3.5" />
						</a>
					{/snippet}
					<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
						{#each repoChangesShown as row (`${row.owner}/${row.repo}:${row.kind}:${row.number ?? row.sha}`)}
							<!-- `dense` — a bridging preview of up to 10 changes should
							     read like Home's own card, not re-run the change page's
							     full per-column-header grid ten times over. -->
							<ChangeRow {row} dense now={coarse} />
						{/each}
					</ul>
				</Card>
			</div>
		{/if}

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
		{#each repoVisibleLeadRows as leadRow, li (leadRow.key)}
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
				titleHref={changeBuildPath(repoPageLedger.repoKey, leadRow.revision, leadRow.revision)}
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
	{:else if isPullChange}
		<!-- ══ THE CHANGE PAGE — PULL FORM (CHANGES-2026-09-10 §3) ═══════════
		     Moved from the superseded `/pr/{owner}/{repo}/{number}` route,
		     which now 308s here (`routes/pr/**`). ⛔ NO BREADCRUMB — a PR is
		     not a rollout, and the palette is how a reader got here and how
		     they leave; the head band (title, `#N · owner/repo`, "View on
		     GitHub ↗") is the page's only orientation, unchanged from the
		     superseded route. -->
		{#if prLoading}
			<!-- THE SKELETON KEEPS THE HEAD BAND'S SHAPE (CardSkeleton's own
			     rule: a placeholder is the whole composition, header included). -->
			<div class="mb-6 space-y-2" aria-hidden="true">
				<div class="h-7 w-2/3 max-w-xl animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/2 max-w-sm animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<div class="space-y-4">
				{#each Array.from({ length: changeSkelServices }, (_, i) => i) as i (i)}
					<CardSkeleton titleWidth="w-32" rollupWidth="w-40" rows={3} rowHeight={28} padded={false} />
				{/each}
			</div>
		{:else if pullError?.reason === 'not_connected'}
			<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
				#{changeNumber} · {changeOwner}/{changeRepo}
			</p>
			<h1 class="t-display text-gray-900 dark:text-white">Connect GitHub to see this pull request</h1>
			<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
				This dashboard reads pull request details as you, through your own GitHub account — connect
				it to see #{changeNumber} on {changeOwner}/{changeRepo}.
			</p>
			<button type="button" class="btn btn-primary mt-4" onclick={() => connectGithub()}>
				<GithubSolid aria-hidden="true" />
				Connect GitHub
			</button>
		{:else if pullError?.reason === 'not_found' && pullError.scope === 'pr'}
			<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
				#{changeNumber} · {changeOwner}/{changeRepo}
			</p>
			<h1 class="t-display text-gray-900 dark:text-white">PR not found</h1>
			<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
				PR #{changeNumber} not found in {changeOwner}/{changeRepo} (or you cannot see it). Check the
				number, or
				<a
					href={`https://github.com/${changeOwner}/${changeRepo}/pulls?q=is%3Apr`}
					target="_blank"
					rel="noopener noreferrer"
					class="nav-link">search {changeOwner}/{changeRepo}'s pull requests on GitHub ↗</a
				>. You can also press <kbd class="t-code-sm">⌘K</kbd> to look it up here.
			</p>
		{:else if pullError?.reason === 'not_found'}
			<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
				#{changeNumber} · {changeOwner}/{changeRepo}
			</p>
			<h1 class="t-display text-gray-900 dark:text-white">Not on this cluster</h1>
			<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
				No service on this cluster deploys {changeOwner}/{changeRepo}.
			</p>
		{:else if prError}
			<ErrorState
				error={prError}
				subject="this pull request"
				backHref="/"
				backLabel="Back to the dashboard"
				isRetrying={prEntry?.loading ?? false}
				onRetry={() => void prEntry?.fetch()}
			/>
		{:else if prData}
			<!-- ══ HEAD BAND — THE PAGE'S ONLY ORIENTATION, NO BREADCRUMB ═══════ -->
			<header class="mb-6">
				<h1 class="t-display text-gray-900 dark:text-white">{prData.title}</h1>
				<p
					class="t-dense mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
				>
					<span>#{prData.number} · {changeOwner}/{changeRepo} · {subtitleTail}</span>
					<a
						href={prData.htmlUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="nav-link inline-flex items-center gap-1"
					>
						<GithubSolid class="h-3.5 w-3.5" aria-hidden="true" />
						View on GitHub
						<span aria-hidden="true">↗</span>
					</a>
				</p>
				{#if checks}
					<!-- ⭐ APPROACH B, ITEM E — ONE HEAD-BAND LINE, NEVER FOLDED INTO A
					     CELL. -->
					<p class="t-dense mt-1 text-gray-500 dark:text-gray-400">
						{#if checks.href}
							<a
								href={checks.href}
								target="_blank"
								rel="noopener noreferrer"
								class="nav-link inline-flex items-center gap-1"
							>
								{checks.text}
								<span aria-hidden="true">↗</span>
							</a>
						{:else}
							{checks.text}
						{/if}
					</p>
				{/if}
			</header>

			{#if prData.state === 'open'}
				<Card icon={ClockOutline} title="Not merged yet">
					<p class="t-body text-gray-600 dark:text-gray-300">
						This pull request has not merged yet — it targets <code class="t-code-sm">{prData.base}</code
						>. Once it merges, this page fills in per service.
					</p>
					<p class="t-dense mt-2 text-gray-500 dark:text-gray-400">
						{#if openAge}open {openAge} · {/if}{#if openFilesLabel}{openFilesLabel} · {/if}{#if openHeadShort}head
							<code class="t-code-sm">{openHeadShort}</code> · {/if}not built anywhere
					</p>
				</Card>
			{:else if prData.state === 'closed'}
				<Card icon={CloseCircleOutline} title="Closed without merging">
					<p class="t-body text-gray-600 dark:text-gray-300">
						This pull request was closed without merging, so no build ever contained it.
					</p>
				</Card>
			{:else}
				{@render changeBody()}
			{/if}
		{/if}
	{:else if isShaChange && commitNotFoundInRepo}
		<!-- ⛔ FIX PASS ITEM 7, 2026-09-10 — "COMMIT NOT IN THIS REPO". A scope
		     error (the sha simply is not part of this repository's history),
		     told apart from the honest "not built yet" degrade every other
		     sha renders. A link to the repo the ledger DOES find it in, when
		     one exists — never a dead end. -->
		<h1 class="t-display text-gray-900 dark:text-white">
			Commit {shaForChange ? shortRevision(shaForChange) : ''} is not in {changeOwner}/{changeRepo}
		</h1>
		{#if commitFoundInOtherRepo}
			<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
				It looks like it belongs to
				<a class="nav-link" href={withQuery(`/changes/${repoSlug(commitFoundInOtherRepo.repoKey)}`)}
					>{commitFoundInOtherRepo.label} ›</a
				>
			</p>
		{/if}
	{:else if isShaChange}
		<!-- ══ THE CHANGE PAGE — SHA FORM (CHANGES-2026-09-10 §3) ═══════════
		     A bare commit, no PR behind it (or GitHub simply not asked). The
		     SAME page kind as the pull form above — `changeBody()` renders
		     the identical verdict/grid/card composition off a `PrPipelineMeta`
		     constructed with `containedIn: []`, `containedInAll: false`
		     (exact membership: only this one sha counts, never a truncation
		     fallback). §3's own accounting: today's build page's three unique
		     facts survive inside these rows without restating them — "what
		     each service calls it" IS `cell.releaseLabel`, "running it now"
		     IS the `live` cells — so the coverage bar is correctly dropped. -->
		<header class="mb-6">
			<h1 class="t-display text-gray-900 dark:text-white">
				{changeCommitPull
					? changeCommitPull.title
					: commitDetail?.subject
						? commitDetail.subject
						: shaForChange
							? shortRevision(shaForChange)
							: ''}
			</h1>
			<p
				class="t-dense mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
			>
				<span
					>{shaForChange ? shortRevision(shaForChange) : ''} · {changeOwner}/{changeRepo}{shaSubtitleTail
						? ` · ${shaSubtitleTail}`
						: ''}</span
				>
				<a
					href={commitHtmlUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="nav-link inline-flex items-center gap-1"
				>
					<GithubSolid class="h-3.5 w-3.5" aria-hidden="true" />
					View commit
					<span aria-hidden="true">↗</span>
				</a>
			</p>
		</header>
		{@render changeBody()}
	{:else if ledger && row}
		<!-- ══ A BUILD WITH NO LINKED GITHUB REPOSITORY ═══════════════════════
		     CHANGES-2026-09-10 is a GitHub-shaped page kind (a PR or a commit
		     reference) — an `app:`-fallback repo (no `status.source` at all)
		     or a non-GitHub host has no PR/commit concept to build one from.
		     Honest degrade rather than a broken page: name the build and
		     where it runs, and point back at the repository page, which still
		     answers "what runs where" for it. -->
		<h1 class="t-display text-gray-900 dark:text-white">{row.short}</h1>
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			This build has no linked GitHub repository, so there is no change page for it — changes need a
			pull request or a commit on a GitHub-hosted repo.
			<a class="nav-link" href={withQuery(`/changes/${repoSlug(ledger.repoKey)}`)}
				>See what {repoTitle(ledger.repoLabel)} runs ›</a
			>
		</p>
		{#if row.services.length > 0}
			<ul class="mt-4 space-y-1">
				{#each row.services as svc (svc.appName)}
					{#each svc.slots.filter((s) => s.onIt) as slot (slot.envName)}
						<li class="t-dense text-gray-600 dark:text-gray-300">
							<a
								class="nav-link"
								href={rolloutPath(
									slot.cell.sourceCluster || localClusterName,
									slot.cell.rollout.metadata?.namespace ?? '',
									slot.cell.rollout.metadata?.name ?? ''
								)}
							>
								{svc.appName} · {slot.envName}
							</a>
						</li>
					{/each}
				{/each}
			</ul>
		{/if}
	{:else}
		<!--
			⛔ A REPO THAT DOES NOT EXIST WAS CALLED A "REVISION NOT FOUND", AND
			THE REVISION IT NAMED WAS A REPO SEGMENT — preserved from the
			superseded `/revisions/[...slug]` route's own finding (2026-09-03,
			operator-walk). `!ledger` is the split-based lookup finding no repo
			AT ALL; told apart from "a real repo, but this ref/build does not
			resolve" (`ledger` known, non-GitHub, `row` absent), which is the
			one remaining case reaching this branch after CHANGES-2026-09-10 —
			the GitHub pull/sha forms above render "not built yet" rather than
			404ing (§3/item 8: an honest question always gets a page).
		-->
		<ErrorState
			error={!ledger
				? new ApiError(404, 'not found', '', `/changes/${wholeSlugPath}`)
				: new ApiError(404, 'not found', '', `/changes/${repoPath}/${urlKey}`)}
			subject={!ledger ? 'this repository' : 'this revision'}
			backHref="/changes"
			backLabel="Back to all changes"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-4"
		/>
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
