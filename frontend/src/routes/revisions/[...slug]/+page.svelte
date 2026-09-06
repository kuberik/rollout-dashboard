<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, githubAbsenceSentence } from '$lib/api/github';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	import { repoBody, revisionPath, displayVersionForTag, shortRevision } from '$lib/version-utils';
	import { getDisplayVersion } from '$lib/utils';
	import { rolloutPath } from '$lib/source-dashboard';
	// THE PRODUCT'S ONE RANK VOCABULARY. This page prints exactly one of its
	// words — `unreleased` — and it takes it from here rather than spelling it.
	import { rankLabel } from '$lib/view-models/env-rank';
	import {
		buildRevisionLedger,
		findRow,
		rankSentence,
		resolveRevision,
		type RepoLedger,
		type RevisionRow,
		type RevisionService,
		type RevisionSlot
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageSwatch,
		releaseSplit,
		slotBakeStatus,
		type CoverageKey,
		type CoverageSlotVM
	} from '$lib/view-models/revision-coverage';
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
		type BlockingStory,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import { iconForStory } from '$lib/components/BlockingStoryPanel.svelte';
	// ⭐ THE OVERVIEW'S OWN WORDS. `GateRecord`'s `Kind` row already calls this
	// for `RulePopover`/`BlockingStoryPanel`, so a rule labelled here cannot
	// say something the Overview banner for the same rollout would disagree
	// with. See the `bannerEnvSections`/`reasonsFor` notes below (finding 1,
	// finding 4).
	import GateRecord, { gateMark } from '$lib/components/GateRecord.svelte';
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
	import { now } from '$lib/stores/time';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
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
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
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
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
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
	const serviceLadderLengths = $derived(row ? row.services.map((s) => s.ladderLength).join(' / ') : '');

	/**
	 * Canonicalise the URL once the revision is known, so an old label link and
	 * a short-sha link both settle on one address. `replaceState` rather than
	 * `goto`: this is the same page, and a redirect that pushes history makes
	 * the back button walk the resolution instead of leaving the page.
	 */
	$effect(() => {
		if (!ledger || !revision) return;
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
	 * ⭐ THE BANNER'S GLYPH, READ OFF THE SAME CLASSIFIED STORY EVERY OTHER
	 * SURFACE DRAWS. (2026-09-03) `blockedSlots.some((s) =>
	 * s.notPassingGates.length > 0) ? CalendarMonthSolid : UserCircleSolid`
	 * treated `awaitingApprovalGates` as "needs a person" — but that bucket is
	 * only "this gate published an allow-list", and the environment
	 * controller and the dependency controller both publish one (see
	 * `lib/CLAUDE.md`'s note on `promotionBlock.awaitingApprovalGates`). So a
	 * page whose only block is `hello-frontend-app` waiting on `hello-api-app`
	 * to ship `api ^1.67.0` — a `dependency` gate, no person anywhere —
	 * printed a person glyph for it, while `/apps`, `/apps/<name>`,
	 * `/environments` and rollout detail all draw a share-node for the exact
	 * same fact. Worst-first over every blocked slot's own classified story,
	 * same ordering `blockingStory` itself sorts gates in.
	 */
	/**
	 * ⭐ ONE `blockingStory` PER BLOCKED PLACE, BUILT ONCE. (finding 1 + 2,
	 * coordinator sweep) `bannerIcon` already called `blockingStory` per slot
	 * to pick a glyph; `bannerFacts` and the rule-count trigger below need the
	 * SAME classified gates, not a second pass over raw gate-name arrays —
	 * that second pass is exactly how a `RolloutDependency` contract gate
	 * ended up captioned `Approval` here while the Overview banner for the
	 * identical rollout said `service contract`. One list, three consumers.
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

	const bannerIcon = $derived.by(() => {
		let worst: BlockingStory | null = null;
		const rank: Record<string, number> = {
			person: 0,
			unknown: 1,
			dependency: 2,
			promotion: 2,
			check: 3,
			clock: 4,
			pinned: -1
		};
		for (const { story } of slotStories) {
			if (!worst || rank[story.iconKind] < rank[worst.iconKind]) worst = story;
		}
		return iconForStory(worst ?? blockingStory(null, gateContext));
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
	 * ⭐ THE DISCLOSED TIER IS GROUPED BY ENVIRONMENT, AND EACH RULE CARRIES
	 * THE RECORD `GateRecord` ALREADY DRAWS EVERYWHERE ELSE ON THIS PRODUCT.
	 * (2026-09-03, operator-walk finding 4) The old body was one flat
	 * `FactList` — `label: gateKindWord(g), value: g.id` pairs with no
	 * environment named on the row at all, so a reader looking at
	 * `ghd-p2fld` had no way to tell PROD's rule from DEV's without leaving
	 * the popover, and the classified story's own sentence (`g.clause`,
	 * `g.label`) never reached the screen — only the bare handle did.
	 * Grouping by environment and handing each group's gates to `GateRecord`
	 * (the same component the card and banner scale draw a rule with
	 * everywhere else — `BlockingStoryLines`, `BlockingStoryPanel`) means
	 * this disclosure can never say something about a rule that `GateRecord`
	 * itself would draw differently.
	 *
	 * ⭐ FINDING 1 (coordinator sweep, 2026-09-03), preserved: THE ALLOW-LIST
	 * BUCKET IS CLASSIFIED, THE CLOCK/CHECK BUCKET IS NOT. `g.clears !==
	 * 'clock' && g.clears !== 'check'` is the identical structural split
	 * `classifyGate` itself branches on (`hasAllowList`) — the same set
	 * `awaitingApprovalGates` names, but carrying each gate's real `kind`
	 * instead of just its id. Without `withSchedules` wired into this page's
	 * `gateContext`, a schedule gate and a bare health check are not yet
	 * distinguishable through `classifyGate` here (both fall through to
	 * `check`), so running THOSE through `GateRecord`/`gateKindWord` would
	 * mislabel a deploy window as a generic check — they keep the
	 * established, honest "Not passing" name instead, still grouped per
	 * environment, with that environment's own soonest `Opens` time from the
	 * separate per-slot `windows` fetch below.
	 */
	type BannerEnvSection = {
		envLabel: string;
		theme: EnvironmentTheme | null;
		classifiedGates: ClassifiedGate[];
		windowGateNames: string[];
		opensAt: string | null;
	};

	const bannerEnvSections = $derived.by<BannerEnvSection[]>(() => {
		const byEnv = new Map<string, BannerEnvSection>();
		const ensure = (envLabel: string, theme: EnvironmentTheme | null) => {
			let e = byEnv.get(envLabel);
			if (!e) {
				e = { envLabel, theme, classifiedGates: [], windowGateNames: [], opensAt: null };
				byEnv.set(envLabel, e);
			}
			return e;
		};
		for (const s of blockedSlots) {
			if (s.notPassingGates.length === 0) continue;
			const e = ensure(s.envLabel, s.slot.cell.theme);
			for (const name of s.notPassingGates) {
				if (!e.windowGateNames.includes(name)) e.windowGateNames.push(name);
			}
			const w = windows[slotKey(s)];
			if (
				w?.blocked &&
				w.nextTransition &&
				(!e.opensAt || new Date(w.nextTransition) < new Date(e.opensAt))
			) {
				e.opensAt = w.nextTransition;
			}
		}
		for (const { slot, story } of slotStories) {
			const gates = story.gates.filter((g) => g.clears !== 'clock' && g.clears !== 'check');
			if (gates.length === 0) continue;
			const e = ensure(slot.envLabel, slot.slot.cell.theme);
			for (const g of gates) {
				if (!e.classifiedGates.some((x) => x.id === g.id)) e.classifiedGates.push(g);
			}
		}
		return [...byEnv.values()].sort((a, b) => compareEnvironmentNames(a.envLabel, b.envLabel));
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
	 * ⭐ EVERYTHING ELSE HOLDING A PLACE, ONCE THE PRIMARY CAUSE IS DRAWN
	 * ABOVE. A promotion-order gate (`ghd-9qcnj`) that only refuses because
	 * the environment controller has not observed the contract's own fix
	 * yet CLEARS once the contract does — it is real, and it still holds
	 * the place today, but it is not what an operator should act on first.
	 * Filtered per-section (not a bare `bannerRuleCount`-style total) so a
	 * section left with nothing after removing the primary gate does not
	 * render an empty record.
	 */
	const secondaryEnvSections = $derived(
		bannerEnvSections
			.map((section) => ({
				...section,
				classifiedGates: section.classifiedGates.filter((g) => g.id !== primaryHold?.gateId)
			}))
			.filter((section) => section.classifiedGates.length > 0 || section.windowGateNames.length > 0)
	);

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
	const bannerTitle = $derived(
		heldReleaseLabel ? `${bannerSubject} ${heldReleaseLabel} is held` : `${row?.short} is held`
	);

	/** The SET the trigger counts: gate handles, both buckets, never the clock. */
	const bannerRuleCount = $derived(
		bannerEnvSections.reduce((n, s) => n + s.classifiedGates.length + s.windowGateNames.length, 0)
	);

	/**
	 * ⭐ FINDING 2 (coordinator sweep, 2026-09-03): NEVER A SILENT UNION.
	 *
	 * This banner can speak for several rollouts at once (one per blocked
	 * place), so `bannerRuleCount` above is a real total — but printing it
	 * bare as `3 rules` reads as a claim about ONE story when it is really
	 * `2 in prod, 1 in dev`, and comparing that bare total against a
	 * single-rollout page (`/envs/prod`'s `2 rules`, the Dependencies tab's
	 * own count) is what read as a contradiction. The trigger says the
	 * breakdown instead — per environment, worst first — so a reader who
	 * clicks through already knows which environment they are about to land
	 * on. Past three environments it names only the worst one: a
	 * `·`-joined clause per region is legible for dev/staging/prod and is
	 * not for a 13-region fan-out.
	 */
	const ruleCountBreakdown = $derived.by<string>(() => {
		const byEnv = new Map<string, Set<string>>();
		for (const { slot, story } of slotStories) {
			if (story.gates.length === 0) continue;
			const set = byEnv.get(slot.envLabel) ?? new Set<string>();
			for (const g of story.gates) set.add(g.id);
			byEnv.set(slot.envLabel, set);
		}
		const entries = [...byEnv.entries()]
			.filter(([, set]) => set.size > 0)
			.sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
		if (entries.length === 0) return '';
		if (entries.length === 1) return `${countLabel(entries[0][1].size, 'rule')} in ${entries[0][0]}`;
		if (entries.length > 3) {
			const [worstEnv, worstSet] = entries[0];
			return `${countLabel(worstSet.size, 'rule')} in ${worstEnv} — the worst of ${entries.length} held environments`;
		}
		return entries
			.map(([env, set], i) => `${i === 0 ? countLabel(set.size, 'rule') : String(set.size)} in ${env}`)
			.join(' · ');
	});

	/**
	 * ⭐ ITEM 2 (round-8 critique) — THE SUMMARY NAMES THE CAUSE, AND COUNTS
	 * ONLY WHAT IT DRAWS. Measured live on `9f10e494d560`: CLOSED, the
	 * banner read `2 rules in prod · 2 in staging · 1 in dev` — five —
	 * while OPENED the same disclosure draws exactly one cause
	 * (`primaryHold`, the dependency contract) plus two per-environment
	 * promotion-order records that only clear once that cause does
	 * (`secondaryEnvSections`, listed inside, never counted as causes
	 * themselves). Five was never the right number for a body that draws
	 * one cause. `Waiting on hello-api-app · 1 rule` says what actually
	 * opens: the provider that has to ship, and the one real cause — the
	 * same subject `primaryHold`'s own "Open hello-api-app" action names.
	 * Falls back to the old per-environment breakdown on the rarer page
	 * where nothing names a single provider (no dependency-type gate found
	 * anywhere — every hold is a bare promotion-order/window gate).
	 */
	const bannerDisclosureLabel = $derived.by<string>(() => {
		if (primaryHold) {
			return `Waiting on ${primaryHold.reason.subject ?? 'a service'} · ${countLabel(1, 'rule')}`;
		}
		return ruleCountBreakdown;
	});

	const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	function numberWord(n: number): string {
		return NUMBER_WORDS[n] ?? String(n);
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
		if (releaseSplitLines.length > 0) {
			const heldEnvs = new Set(releaseSplitLines.flatMap((l) => l.envLabels));
			return releaseSplitLines
				.map((l) => {
					const envs = joinClauses(l.envLabels.map((e) => e.toLowerCase()));
					const sameSet = l.envLabels.length === heldEnvs.size;
					const clause = l.held
						? `${l.aheadLabel} is held in ${sameSet ? `all ${numberWord(heldEnvs.size)}` : envs}`
						: `${l.aheadLabel} has not reached ${sameSet ? 'them' : envs} yet`;
					return `${envs} run ${l.behindLabel}; ${clause}.`;
				})
				.join(' ');
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
</script>

<svelte:head>
	<title>kuberik | {row ? row.short : urlKey}</title>
</svelte:head>

<div class="rev-cq mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!-- ⭐ ROUND-4 CRAFT REVIEW, ITEM B — see `cameFromList`'s own comment
	     above. `<button>`, not `<a>`, in the `history.back()` branch: it is
	     not a URL, the same reasoning `+error.svelte`'s own `Go back`
	     control already uses. -->
	{#if cameFromList}
		<button
			type="button"
			class="t-micro mb-4 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			onclick={() => history.back()}
		>
			<ArrowLeftOutline class="h-3 w-3" /> All revisions
		</button>
	{:else}
		<a
			href="/revisions"
			class="t-micro mb-4 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			<ArrowLeftOutline class="h-3 w-3" /> All revisions
		</a>
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

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-4 mb-0" />
		<!--
			⭐ THE BACK LINK + `h1` + THE SAME `.rev-buckets` 2-COLUMN GRID THE
			LOADED PAGE USES, NOT A LONE CENTRED SPINNER. (2026-09-04,
			load-state audit finding 11) The back link above this branch is
			already unconditional, so it never moved; the head row and the
			2×2 grid (`This build` / `What each service calls it` in row 1,
			measured 593×341 and 593×242, two more bucket cards in row 2) had
			no placeholder at all. `.rev-buckets` is this file's own scoped
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
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			{#if !ledger}
				<h1 class="t-body font-semibold text-gray-900 dark:text-white">Repository not found</h1>
				<!-- ⭐ ITEM 6 (2026-09-06 critique) — THE REPO AND THE SHA ARE TWO
				     FACTS, NEVER ONE GLUED STRING. `${repoPath}/${urlKey}` printed
				     `github.com/littlechimera/nope/064b655b5159 is known` — a sha
				     stitched onto a repo path reads as if the whole run-on were the
				     repository's name. `repoPath` is the object that is not known;
				     `urlKey` is named as the separate thing that was being looked
				     for inside it. -->
				<p class="t-body mt-1 max-w-md text-gray-500 dark:text-gray-400">
					{#if repoPath}
						No repository <span class="t-code">{repoPath}</span> is known to this dashboard, so it
						cannot hold the revision <span class="t-code">{urlKey}</span> either.
					{:else}
						No repository <span class="t-code">{urlKey}</span> is known to this dashboard.
					{/if}
				</p>
			{:else}
				<h1 class="t-body font-semibold text-gray-900 dark:text-white">Revision not found</h1>
				<p class="t-body mt-1 max-w-md text-gray-500 dark:text-gray-400">
					Nothing in <span class="t-code">{repoPath}</span> knows the revision
					<span class="t-code">{urlKey}</span>. This page covers every commit on a service's release
					ladder, deployed or not.
				</p>
			{/if}
			<!--
				⛔ THIS PAGE HAD NO WAY BACK OF ITS OWN. (2026-09-03,
				operator-walk) The breadcrumb 40px above the head band is easy to
				miss coming in on a bad link — every OTHER not-found/error state
				in the product (`ErrorState`'s `backHref`/`backLabel`) repeats its
				way out INSIDE the centred message, and this hand-rolled block
				was the one that did not.
			-->
			<a href="/revisions" class="nav-link mt-4">
				<ArrowLeftOutline class="h-4 w-4" /> All revisions
			</a>
		</div>
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
			<span class="t-display-id text-gray-900 dark:text-white">{row.short}</span>
			<!--
				⭐ ROUND-4 CRAFT REVIEW, ITEM 4 — THE FIGURE IS BOUND TO ITS OWN
				CAPTION, NOT TO THE ID BESIDE IT. The row's `gap-x-2` (8px) put an
				equal 8px between id→figure and figure→caption, so `064b655` and `8`
				— both 24px mono/tabular-nums, no visual difference between them but
				size — read as one token with the caption trailing behind. `.rev-head-figure`
				widens id→figure to 24px (8 + 16) while figure→caption stays the
				row's own 8, so the figure visibly belongs to the sentence it leads,
				not to the sha it happens to sit next to.

				⭐ ITEM 4 (2026-09-06 critique) — AND AT < 560, THE FIGURE MOVES TO
				ITS OWN LINE. The fix above only handles 1440: a narrow head band
				wraps AFTER the caption, not before the figure, because `row.short`
				and `coverage.liveCount` are both short enough to share the first
				line — `9f10e49  3` still read as one token at 390. `.rev-head-break`
				is a zero-height, `flex-basis: 100%` spacer — the standard
				forced-line-break idiom inside `flex-wrap` — so under 560 the id
				keeps its own line and the figure leads the second one, beside its
				own caption, where `ml-4`'s job is undone by `.rev-head-figure`'s own
				narrow-width rule.

				⭐ ITEM 2 (round-8 critique) — A RELEASE, NEVER A "BUILD". This sha
				has exactly one build; what is held is a newer RELEASE of it
				(`heldReleaseLabel`, e.g. `2.67.0-67` — the same line the banner
				below reads). "Held from a newer build" claimed a second commit
				exists somewhere ahead of this one; there is none — the newer
				release is on THIS commit, so the clause now names it instead.
			-->
			<span class="rev-head-break" aria-hidden="true"></span>
			<span class="t-display text-gray-900 tabular-nums dark:text-white rev-head-figure"
				>{coverage.liveCount}</span
			>
			<span
				class="t-body text-gray-500 dark:text-gray-400"
				title="A place is one service in one environment."
				>of {coverage.totalCount} places run this build{headBandDeployingCount > 0
					? ` · ${headBandDeployingCount} deploying`
					: ''}{headBandHeldCount > 0
					? ` · ${headBandHeldCount} ${headBandHeldCount === 1 ? 'is' : 'are'} held from a newer release${heldReleaseLabel ? ` (${heldReleaseLabel})` : ''}`
					: ''}</span
			>
		</div>

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
				⭐ ITEM 1 (2026-09-06 round-7 critique) — THE BLOCKING CAUSE
				LEADS, DRAWN ONCE, WITH ITS OWN ACTION. See `primaryHold`'s own
				comment: this used to render every classified gate through
				`GateRecord`, grouped only by environment, so a dependency
				contract (the actual, current blocker — someone has to ship
				`hello-api-app`) and a promotion-order gate (which clears BY
				ITSELF once the contract does) printed as five equal `KIND` /
				`RULE` records with no link anywhere. `primaryHold.reason.line`
				is the exact sentence the list page's own banner already draws
				for this fact (`Needs api ^1.67.0 from hello-api-app, which is
				on 1.66.0 …`), plus the `Open <service>` action; everything
				else that still holds a place (`secondaryEnvSections`) follows,
				demoted and labelled as clearing once the lead cause does.
			-->
			{#snippet gateFacts()}
				<div class="flex min-w-0 flex-col gap-3">
					{#if primaryHold}
						<div class="flex min-w-0 flex-col gap-1.5">
							<p class="t-body min-w-0">{primaryHold.reason.line}</p>
							{#if primaryHold.appHref}
								<a class="nav-link mt-1 inline-flex" href={primaryHold.appHref}>
									Open {primaryHold.reason.subject ?? 'the service'}
									<ArrowRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
								</a>
							{/if}
						</div>
					{/if}
					{#if secondaryEnvSections.length > 0}
						<div class="flex min-w-0 flex-col gap-3">
							<p class="t-micro min-w-0" style="opacity: 0.75">
								{primaryHold
									? 'Also in the way once that clears, by environment:'
									: 'By environment:'}
							</p>
							{#each secondaryEnvSections as section (section.envLabel)}
								<div class="flex min-w-0 flex-col gap-1.5">
									<!--
										⭐ ITEM 1 (round-8 critique) — INTRINSIC WIDTH, NEVER
										FULL-ROW. Measured live on `9f10e494d560`: STAGING and
										PROD rendered 696×20 with `justify-content: center` — the
										chip is `display: inline-flex`, but `.chip` becomes a flex
										ITEM the moment it sits in a `flex-col` parent (this `div`),
										and `align-items`'s initial value (`normal`) behaves as
										`stretch` for a flex container, so it grew to the column's
										full width regardless of its own `display`. An environment
										chip is never full-width — `self-start` opts it out of the
										stretch, same fix `.rev-disclosure-cell` already relies on
										one component up (`AlertPanel`'s own note on
										`flex flex-col items-start`).
									-->
									<Chip role="env" theme={section.theme} label={section.envLabel} wide class="self-start" />
									{#if section.classifiedGates.length > 0}
										<GateRecord gates={section.classifiedGates} tone="banner" />
									{/if}
									{#if section.windowGateNames.length > 0}
										<FactList
											tone="banner"
											facts={[
												...(section.opensAt
													? [
															{
																label: 'Opens',
																value: `in ${formatTimeUntil(section.opensAt, $now)} · ${new Date(section.opensAt).toLocaleString()}`
															}
														]
													: []),
												...section.windowGateNames.map((name) => ({
													label: 'Not passing',
													value: name,
													handle: true
												}))
											]}
										/>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/snippet}

			<!--
				⭐ ITEM 2 (round-8 critique) — ONE `HELD` COUNT, NOT TWO. `extra`'s
				`3 HELD` chip sat 72px under the head band's own
				`3 are held from a newer release` — the identical count, said
				twice on one screen a reader takes in as one glance. The title
				above already names the number IN WORDS (`bannerTitle`,
				`heldReleaseLabel`) and the count IS the head band's job; the
				chip is gone rather than the sentence, because a chip beside a
				headline and a sentence 72px up are not the same kind of
				statement — the sentence is the one this page commits to
				elsewhere (`headBandHeldCount`'s own doc comment).
			-->
			<AlertPanel
				severity="warning"
				icon={bannerIcon}
				title={bannerTitle}
				message={bannerMessage}
				footnoteBody={bannerRuleCount > 0 ? gateFacts : undefined}
				footnoteLabel={bannerRuleCount > 0 ? bannerDisclosureLabel : undefined}
				class="mt-5"
			/>
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
				⛔ THE HEADER ROLLUP IS GONE (ITEM 2, 2026-09-06 round-7 critique).
				`{coverage.liveCount} of {coverage.totalCount} places` here was the
				head band's own `9 of 9 places run this build`, repeated 45px below
				it — the same fact this pass's own "ONE FACT ONCE" rule elsewhere on
				this page argues against. The bar in the body below still draws the
				shortfall when there is one (round-4 craft review item 1); the card
				header now carries no rollup of its own, same as a card with nothing
				to summarise beyond its title.
			-->
			<div>
			<Card icon={RocketOutline} title="This build">
				<ul class="space-y-3">
					<li class="flex items-start gap-2.5">
						<!--
							⭐ ROUND-4 CRAFT REVIEW, ITEM 1 — ONE FILL, WIDTH = LIVE/TOTAL,
							NOT `<CoverageBar>`'S CELL STRIP. `coverageSegments()` almost
							always resolves to exactly one non-empty bucket (`live`), so the
							cells this component draws are `flex: 1` and fill the track
							whatever the count — measured live, "8 of 9" drew the identical
							fully-painted 9-cell strip a "9 of 9" row would. That is
							`RevisionLead`'s own "THE BAR LIED" defect (craft review item 1,
							`RevisionLead.svelte`), fixed there with a plain painted-track fill
							sized to a literal percentage; this card is the one call site that
							fix explicitly left untouched ("the detail page's own hero is gone
							from THIS page … keeps computing `segments` and rendering
							`<CoverageBar>` exactly as before") because this route was another
							lane's at the time. It is this lane's now, so the same geometry
							lands here — `.rev-build-bar`/`.rev-build-bar-fill` below are
							`RevisionLead`'s `.single-bar`/`.single-bar-fill` byte-for-byte
							(height 6, radius 4, painted neutral track), and the fill is
							omitted outright at 100% live, same as the list's `.bld-fill-track`
							(`/revisions`' own row geometry) — a fully-arrived build has no
							shortfall to draw.

							⭐ ITEM 4 / ROUND-7 RULING 11 (2026-09-06 critique) — AND NONE AT
							0% EITHER. `c1ecfe553070` drew a 559×6 all-gray track when nothing
							has arrived yet — a bar with no fill paints exactly the same pixels
							as no bar at all, so it is pure ink for zero information; the count
							above it already says `0 of N`. `coverage.liveCount > 0` is the
							other half of the same "no shortfall to draw" rule: at 100% there
							is nothing BEHIND to show, at 0% there is nothing ARRIVED to show.
						-->
						{#if coverage.liveCount > 0 && coverage.liveCount < coverage.totalCount}
							<div
								class="rev-build-bar w-full"
								role="img"
								aria-label="{coverage.liveCount} of {coverage.totalCount} places running {row.short} · {coverage.buckets
									.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`)
									.join(' · ')}"
								title="{coverage.liveCount} of {coverage.totalCount} places running {row.short}"
							>
								<div
									class="rev-build-bar-fill"
									style="width: {(coverage.liveCount / coverage.totalCount) * 100}%"
								></div>
							</div>
						{/if}
					</li>
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
						<span class="t-body text-gray-700 dark:text-gray-200"
							>{row.services.length} service{row.services.length === 1 ? '' : 's'}</span
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
				<div>
				<Card
					icon={TagSolid}
					title={allLabelsMatchSha ? 'Where it sits' : 'What each service calls it'}
					verdict={allLabelsMatchSha
						? `of ${serviceLadderLengths} builds`
						: `${row.services.length} service${row.services.length === 1 ? '' : 's'}`}
					verdictTitle={allLabelsMatchSha
						? 'No service names this build anything but its own sha — each figure is that service’s own ladder length, in row order'
						: 'One commit, one row per service — each service names and ranks it on its own'}
					padded={false}
				>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each row.services as svc (svc.appName)}
						{@const rank = rankSentence(svc)}
						{@const chip = rankChipFor(svc)}
						{@const pinned = pinnedEnvsOf(svc)}
						{@const ranBefore = ranBeforeOf(svc)}
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
									<Chip
										role={chip.role}
										label={chip.label}
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
									<!-- ⭐ THE DENOMINATOR CARRIES ITS OWN DEFINITION.
									     `newest` means different things in different corners of
									     this product; here it is rank 0 on THIS service's ladder,
									     and `newest of 1` beside `newest of 37` is only readable
									     once that is said. It was said in a 3-line footer under
									     the card (2026-09-02, cut with the page's other
									     definitions); it is said here, on the `of N` the sentence
									     is about. `scan.ts` reads `title`, so it stays pinned. -->
									<span
										class="t-micro text-gray-500 dark:text-gray-400"
										title="Every service counts its own builds, so newest here means newest for that service. Two services from one repo can be on different builds and both be on the newest."
										>{rank.of}</span
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
							<!--
								⭐ THE ROW'S SECOND FACT, ON THE SAME ROW. (2026-09-03,
								operator-walk finding 4) `HELD 2.67.0-67` names what this
								service is being kept FROM; it does not say what is actually
								running instead, and that answer lived in a different card
								(`Running it now`) forty pixels down. `runningLabelFor` reads
								the SAME `live` bucket `heldNewest` above already checked, so
								this can never name a different release than the chip does.
							-->
							{#if chip?.role === 'held'}
								{@const runningLabel = runningLabelFor(svc)}
								{#if runningLabel}
									<div
										class="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
									>
										<HourglassOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
										<span>Held — still running <span class="t-code-sm">{runningLabel}</span></span>
									</div>
								{/if}
							{/if}
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
							{#if ranBefore.length > 0}
								<!-- ⭐ "WHERE DID THIS BUILD RUN BEFORE?" (operator-walk finding 2)
								     `status.history[i > 0]` on this exact place, matched by the same
								     revision key `onIt`/`resolveRevision` use everywhere else on this
								     page — never a second opinion about identity. -->
								<div
									class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
								>
									<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
									<span>
										<!-- ⭐ ITEM 5 (2026-09-06 critique) — `ENV · Nd ago`, THE
										     LIST'S OWN CHIP+AGE ATOM GRAMMAR, NOT `ENV (N days
										     ago)`. -->
										Ran before in
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
							<!-- THE SWATCH IS THE BAR'S OWN FILL VALUE, at 12px, in the card
							     header — so the segment above and the card below are bound by
							     colour without a key row anywhere on the page. -->
							<span
								class="cov-swatch {coverageSwatch(bucket.key, coverage!.reachable)}"
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
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each groupSlots(bucket.slots) as g (g.appName)}
									<li class="rev-place-row px-4 py-3">
										{#each g.runs as rg, gi (rg.runs ?? '—')}
											{@const sharedAge = sharedAgeFor(bucket.key, rg.slots)}
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
											<div class="rev-group-row" class:mt-2={gi > 0}>
												<a
													href={placeHref(rg.slots[0])}
													class="rev-group-name t-body inline-flex min-w-0 items-center gap-1 text-gray-700 hover:underline dark:text-gray-200"
													aria-label="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
													title="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
													><span class="min-w-0 truncate">{g.appName}</span><ChevronRightOutline
														class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
														aria-hidden="true"
													/></a
												>
												<div class="rev-group-chips">
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
														     of on every atom. -->
														{#if age && !sharedAge}
															<span class="t-micro text-gray-500 dark:text-gray-400"
																>deployed <time datetime={age.iso} title={new Date(age.iso).toLocaleString()}
																	>{age.ago}</time
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
												<div class="rev-group-trail">
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
														class="t-micro flex items-center gap-1.5 text-gray-500 dark:text-gray-400"
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

	/* THE HERO'S GEOMETRY MOVED OUT OF THIS COMPONENT ENTIRELY. `RevisionLead`
	   still owns it for `/versions`, where it leads a card and is the page's
	   only object; here the object is named once, in the head band, in plain
	   markup (see the comment there). */

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
	 * ⛔ PARTIALLY SUPERSEDED, ITEM 6 (2026-09-06 round-7 critique); THE
	 * BREAK IS BACK (ITEM 5, round-8 critique). The round-7 fix forced the
	 * figure onto its OWN line under 560px, still at `t-display` (24px) —
	 * which orphaned a lone large numeral below its caption instead of
	 * solving the crowding it was meant to fix — and shrunk it to `t-body`
	 * (14px/400) instead, on the theory that a small figure sitting right
	 * next to the small caption would simply read as one flowing sentence.
	 *
	 * Measured live on `9f10e494d560` at 390: it does not. `flex-wrap`
	 * wraps each ITEM independently — the sha, the (now-inert) break, the
	 * small figure and the caption are four separate flex children, and a
	 * 14px "6" is narrow enough to keep fitting on the SHA's own line even
	 * though the long caption after it has to wrap. The result was
	 * `9f10e49  6` on line one and `of 6 places run this build · 3 are
	 * held …` orphaned on line two — the figure detached from the very
	 * sentence the size change was meant to weld it to.
	 *
	 * The fix is the ORIGINAL idea (force a break right after the sha) NOT
	 * disagreeing with round-7 the size fix (both are needed): under 560,
	 * `.rev-head-break` forces the figure onto a fresh line — where it now
	 * sits, at caption size, immediately before the caption text that
	 * follows it as the next flex child on that same fresh line, so `6` and
	 * `of 6 places run this build` are read, and wrap, as one sentence.
	 */
	.rev-head-figure {
		margin-left: 1rem;
	}

	@container (max-width: 559px) {
		.rev-head-figure {
			margin-left: 0;
			font-size: 14px;
			font-weight: 400;
			line-height: 1.5;
			letter-spacing: normal;
		}

		.rev-head-break {
			flex-basis: 100%;
		}
	}

	/*
	 * ⭐ ROUND-4 CRAFT REVIEW, ITEM 1 — `RevisionLead.svelte`'s
	 * `.single-bar`/`.single-bar-fill` AND `/revisions`' own
	 * `.bld-fill-track`/`.bld-fill`, BYTE-IDENTICAL GEOMETRY, THIRD SPELLING.
	 * Height 6 / radius 4 is the product's one "single fill, exact width"
	 * bar now, product-wide across both revision pages; `overflow: hidden`
	 * is what clips the fill's square end to the track's rounded one.
	 */
	.rev-build-bar {
		height: 6px;
		border-radius: 4px;
		overflow: hidden;
		background-color: var(--color-gray-200);
	}

	:global(.dark) .rev-build-bar {
		background-color: var(--color-gray-700);
	}

	.rev-build-bar-fill {
		height: 100%;
		border-radius: inherit;
		background-color: var(--color-green-700);
	}

	:global(.dark) .rev-build-bar-fill {
		background-color: var(--color-green-600);
	}

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
		 * OWN trailing fact sitting 745px from its chips) that round-7's
		 * OWN `.rev-group-row { max-width: 46rem }` fix (below) already
		 * closes independently of how wide the card itself is — so
		 * reinstating the span no longer reopens it.
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
	 * ⭐ OPERATOR-WALK ROUND 4, ITEM 2 — THE ENV+AGE ATOM, AND ITS OWN
	 * CONTAINER. `.rev-buckets` puts these rows in a 2-column grid at 640px+,
	 * so a card's own rendered width is narrower than the PAGE at every width
	 * between 640 and roughly 1200. `.rev-place-row` is its own nested
	 * container, sized to what this row actually renders at, whatever grid
	 * track it landed in — `.rev-group-row`'s own `@container (max-width:
	 * 560px)` stacking rule (below) still measures against it.
	 */
	.rev-place-row {
		container-type: inline-size;
	}

	/*
	 * `display: inline-flex` with the container's default `flex-wrap: nowrap`
	 * — an atom has exactly two children (the chip, and its own age) and they
	 * may never wrap apart from each other. The OUTER row (`.rev-group-chips`,
	 * `flex flex-wrap`) is what wraps BETWEEN atoms; this rule only stops the
	 * line break from landing inside one.
	 */
	.rev-env-atom {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	/*
	 * ⛔ THE "ONE ATOM PER LINE UNDER 560px" RULE IS GONE (ITEM 4, round-8
	 * critique). It forced every non-bare atom (one carrying its OWN age,
	 * printed when a row's places disagree on when they deployed) onto its
	 * own full-width line whenever `.rev-place-row`'s container measured
	 * 560px or less — and that container is the CARD COLUMN inside
	 * `.rev-buckets`' 2-column grid, whose CONTENT box (after the `<li>`'s
	 * own `px-4` padding) sits at ~558px for nearly the whole 640-1200px
	 * page-width range this page runs at. Measured live on `064b655b5159`
	 * at 1440: `hello-multi-app`'s three atoms (ages 2h/6d/6d, genuinely
	 * different) stacked one-per-line at a MEASURED 559px card width —
	 * comfortably wide enough to hold all three inline — because the rule
	 * fired on container WIDTH alone, never on whether the atoms actually
	 * fit. `hello-world-manifests`, whose three places share one age, was
	 * exempted by `.rev-env-atom--bare` and rendered inline on the SAME
	 * card at the SAME width — one card, two row grammars, decided by
	 * something the reader cannot see (whether the ages happen to agree).
	 * The same defect held even where an atom carried NO age at all (a
	 * non-`live` bucket, `age` always null): `sharedAge` is only computed
	 * for the `live` bucket, so `.rev-env-atom--bare` was never applied
	 * there either, and `Already moved on` on `c1ecfe553070` stacked nine
	 * bare chips one per line at 490px for the identical reason.
	 *
	 * `.rev-group-chips` (below) is already `display: flex; flex-wrap: wrap`
	 * — every atom now wraps the ordinary way: as many as fit on a line,
	 * the rest carried to the next, exactly what "chips always inline in
	 * one wrapping run" asks for, and identical whether the ages agree,
	 * disagree, or say nothing at all. `.rev-env-atom--bare` is gone with
	 * it — nothing reads it any more.
	 */

	/*
	 * ⭐ ITEM 3 (2026-09-06 round-7 critique) — `Running it now`/`Already
	 * moved on`'s OWN ROW GETS THE LEDGER'S TRACKS: a fixed name column, a
	 * chips column that starts at the same x on every row regardless of the
	 * app name's length, and a trail column for the row's one trailing fact
	 * (`now on <sha>`, the shared age, or the release clause). See the
	 * markup comment at the call site for the 45px/745px measurements this
	 * replaces. `max-width` is the reading-measure cap the same item asks
	 * for, independent of how wide the card itself happens to be.
	 */
	.rev-group-row {
		display: grid;
		grid-template-columns: 160px minmax(0, 1fr) auto;
		column-gap: 12px;
		row-gap: 4px;
		align-items: baseline;
		max-width: 46rem;
	}

	.rev-group-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		min-width: 0;
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
	 * Below 560px (the row's own rendered width — `.rev-place-row`, the
	 * `<li>` two levels up, is the container this measures) the fixed
	 * name column is what the phone ledger form already rejects (`lib/CLAUDE.md`'s
	 * "the service ledger" note): one column, name first, chips beneath,
	 * trail beneath that, each full width.
	 */
	@container (max-width: 560px) {
		.rev-group-row {
			grid-template-columns: minmax(0, 1fr);
			max-width: none;
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
