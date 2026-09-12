<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { commitPullsQueryOptions } from '$lib/api/commit-pulls';
	import { commitQueryOptions, FetchCommitError } from '$lib/api/commit';
	import { parseChangeSlug } from '$lib/pr-ref';
	import { connectGithub } from '$lib/api/github';
	import { FetchPullError, containmentKnownFor } from '$lib/api/pulls';
	import { ensurePrMeta, notifyRevisionSeen, prMetaKey } from '$lib/stores/pr-meta.svelte';
	import {
		buildPrPipeline,
		buildChangeHistory,
		changeHistoryRetentionNote,
		type PrPipelineMeta,
		type PrCell
	} from '$lib/view-models/pr-pipeline';
	import {
		buildLandingGrid,
		orderByVerdict,
		classify,
		worstCell
	} from '$lib/view-models/landing-grid';
	import { checksLine, cellStateSentence, cellReasonText } from '$lib/pr-cell-copy';
	import { changesQueryOptions } from '$lib/api/changes';
	import {
		buildChangeRows,
		repoProgress,
		orderHomeChangeRows,
		changesSummary
	} from '$lib/view-models/changes';
	import { median, compactSpan } from '$lib/view-models/lead-time';
	import LandingGrid from '$lib/components/LandingGrid.svelte';
	import PipelineCard from '$lib/components/PipelineCard.svelte';
	import ChangeLine from '$lib/components/ChangeLine.svelte';
	import ChangeHistoryCard from '$lib/components/ChangeHistoryCard.svelte';
	import HowChangesAreGoing from '$lib/components/HowChangesAreGoing.svelte';
	import {
		repoBody,
		changeBuildPath,
		shortRevision,
		repoSlug,
		githubOwnerRepo
	} from '$lib/version-utils';
	import { repoKeyFromSource } from '$lib/version-utils';
	import { rolloutPath } from '$lib/source-dashboard';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import {
		buildRevisionLedger,
		findRow,
		resolveRevision,
		leadRowsFor,
		releaseLines,
		serviceLedger,
		matchesRevisionText,
		restRows,
		pastRows,
		type RepoLedger,
		type RevisionRow,
		type RevisionService
	} from '$lib/view-models/revision-ledger';
	import {
		heldBehind,
		repoHeroCoverage as coverageForServices,
		releaseSplitSentence,
		type CoverageSlotVM,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import RevisionSearch from '$lib/components/RevisionSearch.svelte';
	import BuildLists from '$lib/components/BuildLists.svelte';
	import HeldBanner from '$lib/components/HeldBanner.svelte';
	import RepoLedgerCard from '$lib/components/RepoLedgerCard.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	import {
		buildGateContext,
		blockingStory,
		type GateContext,
		type BlockingStory
	} from '$lib/view-models/blocking-story';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { isEventStreamHealthy } from '$lib/api/events';
	import {
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		CheckCircleSolid,
		ChevronRightOutline,
		ClockOutline,
		CloseCircleOutline,
		CodeBranchOutline,
		CodePullRequestOutline,
		FolderOutline,
		GithubSolid,
		GridOutline,
		HourglassOutline,
		LayersOutline,
		RocketOutline,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	// ⛔ LANE 9, ROUND 11 QA, ITEM 10 — `AlertPanel`/`FactList` DELETED, dead
	// (eslint-reported): neither is rendered anywhere in this file — the
	// blocking fact and the fact list are `HeldBanner`'s and `BuildLists`'
	// own components now.
	import Card from '$lib/components/Card.svelte';
	// ⛔ ROUND 3, ITEM 5 (2026-09-10) — `ChangeVersionModal`/`ClearPinModal`/
	// `<BlockReason>`/`contractBlockReason` ALL DELETED, dead: the change
	// page renders no mutation UI by design, and the one live call site each
	// of these had (`openPromote`/`openClearPin`/`primaryHold`) was itself
	// unreachable — see the note further down where that apparatus used to
	// live.
	import type { Rollout, Environment } from '../../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy, ApiError } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	// THE REPO, NOT THE URL IT IS FETCHED FROM — one spelling with `/versions`.
	import { repoTitle } from '$lib/repo-title';
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
	const repoChangesOwnerRepo = $derived(
		repoPageLedger ? githubOwnerRepo(repoPageLedger.repoKey) : null
	);
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
	/** ⭐ ROUND 3 RULING B — the repo page's own compact-row list, paginated
	 *  at 30, same idiom as the index's "Your changes" block. */
	const REPO_CHANGES_CAP = 30;
	let repoChangesExpanded = $state(false);
	/**
	 * ⭐ ROUND 3B (2026-09-10) — "NO RELEASE MEANS NOT AFFECTED, AND MUST NOT
	 * COMPETE". This is the exact list a live fleet measured at 43 of 61 rows
	 * being bare commits with no release, interleaved by time with the four
	 * PRs that matter. `repoReleasedRows` competes for the section's own
	 * count/pagination; `repoNoReleaseRows` folds behind one muted footer
	 * line that expands in place — same idiom as the index's "Your changes".
	 */
	const repoReleasedRows = $derived(repoChangeRows.filter((r) => !r.noRelease));
	const repoNoReleaseRows = $derived(repoChangeRows.filter((r) => r.noRelease));
	/**
	 * ⭐ ROUND 3, ITEM 4 (2026-09-10 fix pass) — THE HEAD BAND IS THE CHANGES
	 * SUMMARY, NOT THE OLD SLOT-ATTENTION SENTENCE. `repoAttentionSentence`
	 * below (`"N slots — 2 held · 4 behind …"`) counts deploy SLOTS off the
	 * ops ledger and predates GitHub changes existing on this page at all —
	 * it duplicates a fact the repository's own `Changes` section (just
	 * below) already states per-row and disagrees with it in vocabulary
	 * ("slots" vs "changes"). `repoProgress` (`changes.ts`) is the SAME
	 * function the index's own Repositories card reads, so this page's head
	 * band cannot drift from that card's own "N changes · N not everywhere"
	 * grammar for the identical repository.
	 */
	const repoChangesProgress = $derived(
		repoChangesOwnerRepo
			? repoProgress(
					repoChangeRows,
					`${repoChangesOwnerRepo.owner}/${repoChangesOwnerRepo.repo}`.toLowerCase()
				)
			: null
	);
	let repoNoReleaseExpanded = $state(false);

	/**
	 * ⛔ FIX PASS ITEM 1, 2026-09-11 — THIS SECTION IS A `Card`, FOLDED LIKE
	 * `/changes`' OWN "Your changes" — a titled card (icon, "Changes", a
	 * count-plus-deviation rollup) whose deviations always show, whose
	 * live run folds behind one `.nav-link` line, and whose no-release
	 * commits fold behind a second — never a bare heading over a flat,
	 * 1201px list (the shape a live screenshot of this page measured).
	 *
	 * ⛔ FIX PASS ITEM 11 — ONE SORT KEY. `repoReleasedRows` is re-ordered
	 * stuck-first (`orderHomeChangeRows`, RULING 5's own definition — the
	 * SAME key `/changes`' "Your changes" and Home's identical card apply
	 * to this exact row shape) before it is split into the always-visible
	 * deviations prefix and the foldable live-run suffix, rather than
	 * re-deriving a second ordering for the identical population.
	 */
	const repoOrderedChangeRows = $derived(orderHomeChangeRows(repoReleasedRows));
	const repoDeviations = $derived(repoOrderedChangeRows.filter((r) => r.notEverywhere));
	const repoLiveRun = $derived(repoOrderedChangeRows.filter((r) => !r.notEverywhere));
	const repoDeviationsShown = $derived(
		repoChangesExpanded ? repoDeviations : repoDeviations.slice(0, REPO_CHANGES_CAP)
	);
	const repoDeviationsHiddenCount = $derived(repoDeviations.length - repoDeviationsShown.length);
	let repoLiveExpanded = $state(false);
	function repoChangesRollupText(): string {
		if (repoReleasedRows.length === 0) return 'No changes in 30 days';
		if (repoDeviations.length > 0)
			return `${repoReleasedRows.length} · ${repoDeviations.length} not everywhere yet`;
		return `${repoReleasedRows.length} all live`;
	}
	/** The rail card beside it — `HowChangesAreGoing`'s own grammar, scoped
	 *  to THIS repository's released rows rather than the viewer's own. */
	const repoRailSummary = $derived(changesSummary(repoReleasedRows));

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

	// ⛔ ROUND 3, ITEM 5 (2026-09-10) — THE MUTATION APPARATUS THIS BLOCK USED
	// TO HOLD (`ChangeVersionModal`/`ClearPinModal` state, `openPromote`,
	// `openClearPin`, `deployableGroups`/`singleDeployAction`,
	// `notYetGroups`/`NotYetGroup`/`reasonGroupKey`) WAS DEAD: nothing in the
	// rendered template called `openPromote`/`openClearPin`, so the two
	// modals could never open, and `singleDeployAction` (their only reader)
	// was itself never read by anything else. Deleted, whole tree — "the
	// change page has no mutations by design" (item 5's own ruling); a
	// repository's OWN deploy/pin controls live on its rollout/app pages,
	// not here.
	/**
	 * ⛔ THE HEIGHT-MATCH OPT-IN IS GONE (ITEM 3, 2026-09-06 round-7
	 * critique). F9's 25%-gap heuristic still stretched `What each service
	 * calls it` to match `This build` on `9f10e494d560` — measured live,
	 * 593×315 with ~92px of dead body below the last service row. `start` is
	 * the grid's own default for every OTHER pair on this page (the bucket
	 * cards); this top pair now gets the same honest rule — its own content
	 * height, never a neighbour's.
	 */

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
			const story = blockingStory(s.slot.cell.rollout, gateContext, {
				place: s.envLabel,
				now: coarse
			});
			const dep = story.gates.find((g) => g.kind === 'dependency' && g.subject);
			if (dep)
				return { appHref: `/apps/${encodeURIComponent(dep.subject!)}`, appName: dep.subject! };
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
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE HEAD BAND'S OWN
	 * "no match" GUARD, DECOUPLED FROM THE LEDGER CARD. This used to read
	 * the ledger's own `repoLedgerNoMatch` (which also folded in the
	 * ledger's row-toggle SELECTION, not just `?q=`) — now that the ledger
	 * lives in its own component, the head band asks the same question a
	 * different way: did an ACTIVE search leave nothing for the hero rows
	 * to show.
	 *
	 * ⛔ ROUND 3, ITEM 4 (2026-09-10 fix pass) — `repoAttention`/
	 * `repoAttentionSentence` (the old "N slots — 2 held · 4 behind …"
	 * sentence this guard used to protect) are DELETED: the head band is
	 * `repoChangesProgress`'s "N changes · N not everywhere" now (see that
	 * derived value's own comment), never a per-slot recount of the ops
	 * ledger. This guard still protects the ONE thing it always also
	 * guarded — the hero cards below still recount on `?q=` and still need
	 * to say so distinctly from "nothing merged yet".
	 */
	const repoSearchNoMatch = $derived(repoSearchActive && repoVisibleLeadRows.length === 0);
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
	// ⭐ FIX PASS ITEM 2 (2026-09-10): `shaMeta` below now fills `containedIn`/
	// `containedInAll` from the real `commits/:sha` ancestry once it
	// resolves (`api/commit.ts`), rather than leaving this stub's `[]`/
	// `false` in place forever — see that constant's own doc comment.
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
	const prEntry = $derived(
		isPullChange ? ensurePrMeta(changeOwner, changeRepo, changeNumber) : null
	);
	const prData = $derived(prEntry?.data ?? null);
	const prError = $derived(prEntry?.error ?? null);
	const prLoading = $derived(!!prEntry?.loading && !prData && !prError);
	const pullError = $derived(prError instanceof FetchPullError ? prError : null);

	const expectedChangeRepoKey = $derived(
		repoKeyFromSource(`github.com/${changeOwner}/${changeRepo}`, '')
	);
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
					containedInAll: prData.containedInAll,
					// ⭐ FIX PASS ITEM 1 (2026-09-10). `fetchPull` always returns a real,
					// server-computed containment set — never leave this to
					// `buildPrPipeline`'s own ambiguous default (see
					// `containmentKnownFor`'s own doc in `api/pulls.ts`).
					containmentKnown: containmentKnownFor(prData)
				}
			: null
	);

	// ── THE SHA FORM — a bare commit. `revision` (already resolved above via
	// `resolveRevision(ledger, urlKey)`, prefix-matched against every known
	// build on this repo) wins when this cluster has ever built it; the raw
	// URL segment is the fallback, so a sha this cluster has NEVER built still
	// renders a valid page ("not built yet", §3/item 8 — never a 404 for an
	// honest question).
	const shaForChange = $derived(
		changeSlugParsed?.ref.kind === 'sha' ? (revision ?? changeSlugParsed.ref.sha) : null
	);

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

	/**
	 * ⭐ FIX PASS ITEM 2 (2026-09-10). `commitDetail` (`commitDetailQuery`
	 * above) now carries the SAME `containedIn`/`containedInAll` ancestry a
	 * merged PR gets from `fetchPull` — this used to be hardcoded to
	 * `containedIn: []`, which is why every head newer than this commit
	 * (proof it shipped) was invisible and the page fell back to reading
	 * "rolled back in dev" for a commit that is actually live via a later
	 * build. `containmentKnown` is `true` only once the commit fetch has
	 * actually resolved — while it is still loading, or if it failed,
	 * this stays the old ambiguous stub and `buildPrPipeline` degrades to
	 * "not built (unverified)" exactly as before, never a confident wrong
	 * answer.
	 */
	const shaMeta = $derived<PrPipelineMeta | null>(
		isShaChange && shaForChange
			? {
					owner: changeOwner,
					repo: changeRepo,
					mergedAt: changeCommitPull?.mergedAt ?? null,
					mergeCommitSha: shaForChange,
					containedIn: commitDetail?.containedIn ?? [],
					containedInAll: commitDetail?.containedInAll ?? false,
					containmentKnown: !!commitDetail
				}
			: null
	);

	const changeMeta = $derived(pullMeta ?? shaMeta);
	const changeVm = $derived(
		changeMeta
			? buildPrPipeline(
					changeMeta,
					rollouts,
					environments,
					query.data?.rolloutDependencies ?? null,
					coarse
				)
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
			// ⛔ ROUND 2, R2.3 — "A SERVICE WITH NO BUILD OF THIS CHANGE IS A
			// NAME IN A SENTENCE. A SERVICE WITH A BUILD GETS A PIPELINE CARD."
			// Was every service, unfiltered — `PipelineCard`'s own item-7 fold
			// still rendered a titled `Card` (one gray folded sentence) for a
			// service whose every cell is `not-built`, which is exactly the
			// "four near-empty cards" defect this round exists to delete. Those
			// services are named ONCE, together, in `changeNotBuiltServiceNames`
			// below (inside the grid's own card) — they get no card of their
			// own here at all now.
			//
			// ⭐ ROUND 3, ITEM 1(c) (2026-09-10 fix pass) — AND A SERVICE THAT IS
			// `live` EVERYWHERE IS ALSO A NAME IN A SENTENCE, ONCE THE GRID CARD
			// ALREADY DRAWS IT. `PipelineCard`'s own fold (`foldedSentence`)
			// prints ONE prose line — "live since 2h ago in dev · staging ·
			// prod" — for exactly this shape, which restates a fact the grid's
			// own per-service row (every mark green) already shows, in the same
			// card grammar the "no-build" services were just cut from for the
			// identical reason. Only cut when the grid card actually renders
			// (`showEveryRolloutCard`) — with one service, there is no grid row
			// to restate, and this card is the reader's only answer.
			changeVm.services.filter((s) => {
				if (!s.cells.some((c) => c.state !== 'not-built')) return false;
				// ⭐ ROUND 3, ITEM 1(c) — ONLY WHEN THE CARD WOULD ACTUALLY FOLD TO
				// ONE PROSE LINE. `PipelineCard`'s own `foldedSentence` requires
				// ≥2 cells (`service.cells.length < 2` returns `null` there,
				// unconditionally) — a single-environment service's card is
				// already just ONE real row, never the "twelve identical rows"
				// shape this item exists to cut, so it is not dropped merely for
				// being live; the grid restates it, but so does every other
				// single-row card on this page.
				if (
					showEveryRolloutCard &&
					s.cells.length >= 2 &&
					s.cells.every((c) => c.state === 'live')
				) {
					return false;
				}
				return true;
			}),
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
	 * NOW (`rolloutsTotal`/`rolloutsLive`, ruling 3's additive fields), not a
	 * second hand-rolled `flatMap` over `changeVm.services` computed here.
	 *
	 * ⭐ ROUND 3, ITEM 5 (2026-09-10) — "DEPLOYED TO N OF M ROLLOUTS", NEVER
	 * "HAVE THIS BUILD". `rolloutsLive` is the only one of `pr-pipeline.ts`'s
	 * three counts that means "deployed" — `rolloutsWithBuild` (deleted here)
	 * counted a held/queued/rolled-back rollout as if the change had already
	 * shipped there, which is exactly the false claim this ruling retires.
	 */
	const changeRolloutsTotal = $derived(changeVm?.rolloutsTotal ?? 0);
	const changeRolloutsLive = $derived(changeVm?.rolloutsLive ?? 0);
	/**
	 * ⭐ ROUND 3B (2026-09-10, coordinator correction) — WITH EXACTLY ONE
	 * AFFECTED SERVICE, THE "EVERY ROLLOUT" CARD SAYS NOTHING A READER DOES
	 * NOT ALREADY HAVE. "Every rollout" exists to answer "how far across the
	 * FLEET did this go" when several services carry the change — with one
	 * service, that card's own body collapses to "all 1 service" (the
	 * `allSameLabel` fold), a card-sized restatement of the one service card
	 * already below it. The card is omitted in that case; the ONE fact it
	 * carried ("deployed to N of M rollouts") moves into the head band
	 * instead, so the reader still gets it without a card that answers a
	 * question only relevant once there is more than one service.
	 */
	const showEveryRolloutCard = $derived(
		changeRolloutsTotal > 0 && (changeVm?.services.length ?? 0) !== 1
	);
	const changeRolloutsHeadBandLine = $derived(
		changeRolloutsTotal > 0 && changeVm?.services.length === 1
			? `deployed to ${changeRolloutsLive} of ${changeRolloutsTotal} rollouts`
			: null
	);

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
	const changeFrontier = $derived.by<{
		cell: PrCell;
		appName: string;
		builtElsewhere: boolean;
	} | null>(() => {
		if (!changeVm) return null;
		const withBuild = changeVm.services
			.flatMap((s) =>
				s.cells.map((cell) => ({ cell, appName: s.appName, builtElsewhere: s.builtElsewhere }))
			)
			.filter((x) => x.cell.state !== 'not-built');
		if (withBuild.length === 0 || withBuild.every((x) => x.cell.state === 'live')) return null;
		const candidates = withBuild
			.filter((x) => x.cell.state !== 'live')
			.sort(
				(a, b) => a.cell.envRank - b.cell.envRank || a.cell.cluster.localeCompare(b.cell.cluster)
			);
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
	 * ⭐ ROUND 3B (2026-09-10, coordinator correction) — THE CONSTRAINT
	 * SENTENCE REACHES THE BANNER, NEVER THE RETIRED JOIN. `cellStateSentence`
	 * alone prints only "waiting on hello-api-app" for a `waiting-upstream`
	 * frontier — the fuller fact worth showing is `cellReasonText`'s own
	 * reason, `blocking-story.ts`'s dependency clause ("Waiting for
	 * hello-api-app to ship api ^1.68.0 — it is on 1.67.0"), which already
	 * names the provider, the contract, the required range and what it
	 * currently serves. Previously this composed `cellStateSentence` with
	 * `reasonTail`'s stripped-prefix join, which (before that join was
	 * retired) printed the false "its build of this change does not exist
	 * yet" — under ruling A the provider is simply unaffected and needs an
	 * ordinary new release, not "a build of this change". The verdict's own
	 * "will not move on its own" tail (`buildChangeVerdict`) is unaffected —
	 * it is a separate fact, drawn once, up in the head band.
	 */
	const changeHeldMessage = $derived.by(() => {
		if (!changeFrontier) return '';
		const reason = cellReasonText(changeFrontier.cell, coarse);
		return (
			reason ??
			cellStateSentence(changeFrontier.cell, coarse, {
				builtElsewhere: changeFrontier.builtElsewhere
			})
		);
	});
	/**
	 * ⭐ ROUND 3, ITEM 1(e) (2026-09-10 fix pass) — "OPEN ROLLOUT ›" ON AN
	 * APPROVAL HOLD, "OPEN <service> ›" ON A DEPENDENCY HOLD. A dependency
	 * hold names a DIFFERENT service as the thing to act on (`gateSubject`,
	 * the upstream provider) — the existing branch, unchanged. Every other
	 * `gated` hold (approval, a check, an unresolved rule) has no other
	 * party to point at; the one control that can actually clear it is the
	 * rollout itself, the same object `PipelineRow`'s own tap-zone already
	 * opens for this cell.
	 */
	const changeHeldPrimary = $derived.by<{ href: string; label: string } | null>(() => {
		if (!changeFrontier) return null;
		const cell = changeFrontier.cell;
		if (cell.gateSubjectKind === 'service' && cell.gateSubject) {
			return { href: `/apps/${encodeURIComponent(cell.gateSubject)}`, label: cell.gateSubject };
		}
		if (cell.state === 'gated') {
			// `HeldBanner`'s own `openAction` snippet composes "Open {primaryLabel}"
			// — `rollout`, not `Open rollout`, or the button would read "Open
			// Open rollout".
			return {
				href: rolloutPath(cell.cluster || localClusterName, cell.namespace, cell.rolloutName),
				label: 'rollout'
			};
		}
		return null;
	});
	const changeHeldHasSchedule = $derived(changeFrontier?.cell.gateSubjectKind === 'schedule');

	/**
	 * ⛔ FIX PASS ITEM 17, 2026-09-11 — THE BANNER GAINS "› N rules", THE
	 * ROLLOUT DETAIL'S OWN DISCLOSURE. The comment this replaces recorded a
	 * real gap: `pr-pipeline.ts`'s `PrCell` carries a fused reason sentence,
	 * not a `BlockingStory` classification — but the cell already names the
	 * exact rollout it is about (`namespace`/`rolloutName`), and this page
	 * already holds the SAME `rollouts` list and the SAME `gateContext`
	 * (`buildGateContext`) the repo page's own `repoHeldStories` reads two
	 * hundred lines down. So rather than stub `stories={[]}`, look the real
	 * `Rollout` up and run it through `blockingStory` — the identical
	 * classification every other banner in the product stands behind, not a
	 * second, page-local approximation of it.
	 */
	const changeFrontierRollout = $derived.by<Rollout | null>(() => {
		if (!changeFrontier) return null;
		const cell = changeFrontier.cell;
		return (
			rollouts.find(
				(r) => r.metadata?.namespace === cell.namespace && r.metadata?.name === cell.rolloutName
			) ?? null
		);
	});
	const changeHeldStory = $derived.by<BlockingStory | null>(() => {
		if (!changeFrontierRollout || !changeFrontier) return null;
		return blockingStory(changeFrontierRollout, gateContext, {
			place: changeFrontier.cell.envName,
			now: coarse
		});
	});

	const landingGrid = $derived(changeVm ? buildLandingGrid(changeVm, coarse) : null);

	// ══ ROUND 2, R2.3 — THE RAIL'S OWN FACTS ═════════════════════════════════
	// "This change" (repo, services · rollouts, merged/committed, author,
	// first deployed, View on GitHub) reads off whichever of the two forms
	// (pull/sha) actually resolved — one set of derived values, not two
	// copies of the same six facts.

	/** `prData.author` (pull form) or the resolved commit's own author (sha
	 *  form: a resolved PR first, else the bare commit's own `author`). */
	const changeAuthor = $derived(
		isPullChange
			? (prData?.author ?? null)
			: (changeCommitPull?.author ?? commitDetail?.author ?? null)
	);

	/** "merged 5h ago" (pull form, or a sha resolved to a merged PR) / "committed
	 *  5h ago" (a bare commit with no PR behind it) — the verb names WHICH kind
	 *  of record this change actually is, never guessed. */
	const changeMergedLine = $derived.by<string | null>(() => {
		if (isPullChange) return mergedAgo ? `merged ${mergedAgo}` : null;
		if (changeCommitPull?.mergedAt)
			return `merged ${formatTimeAgoCompact(changeCommitPull.mergedAt, coarse)} ago`;
		if (commitDetail?.committedAt)
			return `committed ${formatTimeAgoCompact(commitDetail.committedAt, coarse)} ago`;
		return null;
	});

	/** The earliest `live` cell across every service/environment — "first
	 *  deployed", a whole-change fact distinct from any one environment's own
	 *  "live since" (which `cellStateSentence` already prints per row). */
	const changeFirstDeployed = $derived.by<{ since: string } | null>(() => {
		if (!changeVm) return null;
		const lives = changeVm.services
			.flatMap((s) => s.cells)
			.filter((c): c is PrCell & { since: string } => c.state === 'live' && !!c.since);
		if (lives.length === 0) return null;
		return lives.reduce((a, b) =>
			new Date(a.since).getTime() < new Date(b.since).getTime() ? a : b
		);
	});

	/**
	 * "How it's going"-style facts, `HowItsGoing`'s own `dl` grammar (a
	 * glyph + `dt` label, a `dd` figure): this REPO's own typical dev→prod
	 * trip (median of `PrService.leadTimeMs` across services — each already
	 * ≥2-sample-guarded on its own history, `pr-pipeline.ts`'s own doc
	 * comment) and how long this change has sat in its CURRENT state (the
	 * frontier cell's own `since` when something is not yet live, else the
	 * earliest environment this change went live).
	 */
	const changeTypicalToProdMs = $derived.by<number | null>(() => {
		if (!changeVm) return null;
		const samples = changeVm.services
			.map((s) => s.leadTimeMs)
			.filter((x): x is number => x != null);
		return samples.length > 0 ? median(samples) : null;
	});
	const changeStateSince = $derived.by<{ label: string; since: string } | null>(() => {
		if (changeFrontier?.cell.since)
			return { label: 'In this state', since: changeFrontier.cell.since };
		return changeFirstDeployed ? { label: 'Live since', since: changeFirstDeployed.since } : null;
	});

	/** `ChangeHistoryCard`'s own feed — every `status.history` entry, any
	 *  service/environment, that carries this change; see `pr-pipeline.ts`'s
	 *  own doc comment for the containment test it reuses. */
	const changeHistoryRows = $derived(
		changeVm ? buildChangeHistory(changeVm.services, localClusterName) : []
	);
	const changeHistoryRetention = $derived(
		changeVm ? changeHistoryRetentionNote(changeVm.services) : null
	);

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
		isShaChange && shaForChange
			? `https://github.com/${changeOwner}/${changeRepo}/commit/${shaForChange}`
			: ''
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
				<!-- ⛔ `truncate` MUST NOT SIT ON THE ANCHOR: `.nav-link` IS
				     `display:inline-flex`, AND `text-overflow: ellipsis` DOES NOT
				     APPLY TO A FLEX CONTAINER. (2026-09-10) It only styles a BLOCK
				     container's own inline content, so on the flex box the
				     `overflow:hidden` half still bit and the ellipsis half did
				     not — measured at 390 on this page, the repository name
				     rendered with 6px hard-cut off its right edge and no `…` to
				     say so. The clip belongs on an inline child; the anchor keeps
				     its flex layout and `min-w-0` so the child still has something
				     to shrink against. (Repo-wide sweep: this was the only element
				     in the product with `text-overflow: ellipsis` on a flex/grid
				     box.) -->
				<a class="nav-link min-w-0" href={withQuery(`/changes/${repoSlug(ledger.repoKey)}`)}
					><span class="min-w-0 truncate">{repoTitle(ledger.repoLabel)}</span></a
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
			<!--
				⭐ COORDINATOR, 2026-09-10 (after round 2 shipped) — "I'd generally
				avoid having pages that have a single column layout." Beside
				`/rollouts/<cluster>/<ns>/<name>` this page was ONE column even
				after the "Every rollout"/service-card work above — the rail this
				lane owns (`This change`/`ChangeHistoryCard`/"How it's going") was
				still missing entirely. `.rail-wrap`/`.rail-grid`/`.rail-main`/
				`.rail-side` are LB's own extraction (`app.css`, landed on this
				branch already — see that file's own header comment for the
				shape); this is the THIRD call site, not a fourth hand-copy.
				MAIN first in document order (so it is the tab-forward/reading
				order at every width, same as `/` and `/apps/[name]`), rail
				second — the container query alone decides beside-vs-below.
			-->
			<div class="rail-wrap">
				<div class="rail-grid">
					<div class="rail-main">
						{#if changeHeld && changeFrontier}
							<!-- ⛔ FIX PASS ITEM 7, 2026-09-10 — THE BLOCKING FACT IS A
							     `HeldBanner` (filled, icon, action), NOT AN `h2`. Replaces
							     the plain verdict headline for exactly the held case — the
							     banner's own title already says "{subject} is held", so
							     printing the bare verdict word above it too would restate
							     the same fact twice.

							     ⛔ FIX PASS ITEM 17, 2026-09-11 — `stories={changeHeldStory
							     ? [changeHeldStory] : []}`, SUPERSEDING THE OLD `stories={[]}`.
							     `changeHeldStory` (above) runs the real rollout through the
							     SAME `blockingStory` classification `repoHeldStories` and
							     rollout detail's own banner already stand behind, so this
							     banner now gains the "› N rules" disclosure too — the rows
							     inside it state only what differs from the sentence already
							     printed (the environment, the version it is on), per
							     `dedupedCauses`' own dedup. A `null` story (no rollout match
							     — should not happen once `changeHeld` is true, but the page
							     must not crash if it ever does) degrades to the empty array,
							     same as before. -->
							<div class="mb-4">
								<HeldBanner
									subject={changeFrontier.appName}
									releaseSplitMessage={changeHeldMessage}
									stories={changeHeldStory ? [changeHeldStory] : []}
									indefinite={changeHeldStory ? storiesAreIndefinite([changeHeldStory]) : false}
									primaryHref={changeHeldPrimary?.href ?? null}
									primaryLabel={changeHeldPrimary?.label ?? null}
									hasSchedule={changeHeldHasSchedule}
								/>
							</div>
						{:else}
							<h2 class="t-headline text-gray-900 dark:text-white" class:mb-4={!changeVm.noRelease}>
								{changeVm.verdict}
							</h2>
							{#if changeVm.noRelease}
								<!-- ⭐ ROUND 3B (2026-09-10) — `docs/changes.md`'s own honesty
								     limit, named rather than implied. This dashboard has no
								     signal for "CI decided not to build this" vs. "CI tried
								     and failed" — printing an ETA or a bare silence would both
								     claim more than it knows. -->
								<p class="t-dense mb-4 text-gray-500 dark:text-gray-400">
									CI did not publish a build for this commit; the dashboard cannot tell whether it
									failed or was skipped.
								</p>
							{/if}
						{/if}

						{#if showEveryRolloutCard}
							<!--
								⭐ ROUND 2, R2.3 — "THE GRID GETS A CARD." Was two bare
								`<p>` sentences ("N of M rollouts have a build…", "Not
								built yet for…") floating above the grid — a titled card
								is this product's unit for an answer, and "deployed to 3
								of 15 rollouts" is exactly that answer, so it is the
								card's own `verdict` rollup now, not prose above it.

								⭐ ROUND 3, ITEM 5 (2026-09-10) — "DEPLOYED" MEANS `live`,
								NEVER "HAVE THIS BUILD". `rolloutsWithBuild` counts every
								rollout that carries a RELEASE of this change somewhere in
								its own history/candidates — held, queued, rolled back, or
								actually running it all count. "Have this build" claimed all
								of those as if the change were already deployed there, which
								is false for a held/queued rollout. `rolloutsLive` (already
								computed by `pr-pipeline.ts`, ruling 3) is the one count that
								actually means "deployed": the change is the frontier's
								`live` cell right now.
							-->
							<div class="mb-4">
								<Card
									icon={GridOutline}
									title="Every rollout"
									verdict={`deployed to ${changeRolloutsLive} of ${changeRolloutsTotal} rollouts`}
									padded={false}
								>
									<div class="px-4 py-3">
										{#if landingGrid?.allSameLabel && landingGrid.services[0]?.verdictWord !== 'live'}
											<!-- §2b's fold rule 1: every service agrees — one
											     label, not a grid of identical rows.

											     ⛔ FIX PASS ITEM 7, 2026-09-11 — NEVER FOR THE
											     LIVE CASE. "Not built yet · all 3 services" loses
											     nothing by folding — a dashed mark carries no
											     information the words don't already say. "Live
											     everywhere · all 3 services" is the opposite: the
											     grid IS the confirmation the reader opened this
											     card for (which environments, not just that they
											     agree), and collapsing it left a titled card whose
											     entire body was three words under a "deployed to 9
											     of 9 rollouts" rollup that had just promised detail.
											     Draw the grid whenever the uniform state is `live`,
											     same as a change whose services disagree already
											     does — a bare-commit sha with a fully-uniform grid
											     (pull/1's own live-everywhere shape) reads exactly
											     the same way now. -->
										{:else if landingGrid && landingGrid.visible.length > 0}
											<!-- ⛔ FIX PASS ITEM 4, 2026-09-10 — `landingGrid.visible`
											     is `landing-grid.ts`'s FULL adverse-first list
											     (ruling 6, no longer 3-capped); `LandingGrid` owns
											     its own fold. -->
											<LandingGrid services={landingGrid.visible} />
										{/if}
										{#if changeNotBuiltServiceNames.length > 0 && changeNotBuiltServiceNames.length < changeVm.services.length}
											<!-- Only when it's NEW information — a card whose
											     grid already says "Not built yet" for every
											     service (the all-same fold above) would restate
											     itself. R2.3: "That line is where the no-build
											     services live. They do not get cards." -->
											<p class="t-dense mt-2 text-gray-500 dark:text-gray-400">
												Not built yet for {changeNotBuiltServiceNames.join(', ')}.
											</p>
										{/if}
									</div>
								</Card>
							</div>
						{/if}

						{#if changeOrderedServices.length > 0}
							<!--
								⛔ FIX PASS ITEM 4, 2026-09-11 — THE SECTION-HEADER GRAMMAR,
								APPLIED HERE TOO: a 5px dot in the section's state ink,
								`text-base font-semibold` title, mono count — the SAME
								shape `/changes`' "Repositories" and this page's own
								"Changes" card grid use. This service-cards group had no
								header of its own at all.
							-->
							<div class="mb-3 flex items-center gap-2">
								<span
									aria-hidden="true"
									class="h-[5px] w-[5px] shrink-0 rounded {changeHeld
										? 'bg-orange-500'
										: changeVm?.verdictTone === 'live'
											? 'bg-green-500'
											: 'bg-gray-400'}"
								></span>
								<h2 class="text-base font-semibold text-gray-900 dark:text-white">Services</h2>
								<span class="font-mono text-xs text-gray-500 dark:text-gray-400"
									>{changeOrderedServices.length}</span
								>
							</div>
							<!--
								⭐ COORDINATOR, 2026-09-10 — service cards run 2-up at
								≥1280 of MAIN-column width (a container query, not a
								viewport one — the rail steals 320px+24px at ≥860px of
								PAGE width first). `minmax(min(28rem,100%),1fr)` — the
								`min(...,100%)` guard is load-bearing: a bare `28rem`
								floor would force a 448px track inside a narrower main
								column (e.g. 390 viewport, ~350px of content) and
								overflow, the exact defect `ChangeCard`'s own grid
								(R2.2) already guards against with the identical clamp.
							-->
							<div
								class="grid [grid-template-columns:repeat(auto-fill,minmax(min(28rem,100%),1fr))] gap-4"
							>
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
					</div>

					<div class="rail-side flex flex-col gap-4">
						<!--
							⭐ ROUND 2, R2.3 — RAIL CARD 1, "This change". The round-11
							build page's `This build` card verbatim in grammar: icon
							rows at `t-body`. `checks` is deliberately NOT repeated
							here — `pr-cell-copy.ts`'s own `checksLine` is HEAD-BAND
							SCOPE ONLY ("never fold into a cell fact"), and this page's
							head band already prints it for the pull form; a second
							copy on the rail would be the same fact stated twice.
						-->
						<Card
							icon={CodeBranchOutline}
							title="This change"
							verdict={`${changeVm.services.length} service${changeVm.services.length === 1 ? '' : 's'}`}
						>
							<ul class="space-y-2">
								<li class="t-body flex items-start gap-2 text-gray-900 dark:text-white">
									<FolderOutline
										class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
										aria-hidden="true"
									/>
									<span class="min-w-0 truncate">{changeOwner}/{changeRepo}</span>
								</li>
								<li class="t-body flex items-start gap-2 text-gray-900 dark:text-white">
									<LayersOutline
										class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
										aria-hidden="true"
									/>
									<span
										>{changeVm.services.length} service{changeVm.services.length === 1 ? '' : 's'} ·
										{changeRolloutsTotal}
										rollout{changeRolloutsTotal === 1 ? '' : 's'}</span
									>
								</li>
								{#if changeMergedLine}
									<li class="t-body flex items-start gap-2 text-gray-900 dark:text-white">
										<CalendarMonthSolid
											class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
											aria-hidden="true"
										/>
										<span>{changeMergedLine}</span>
									</li>
								{/if}
								{#if changeAuthor}
									<li class="t-body flex items-start gap-2 text-gray-900 dark:text-white">
										<UserCircleSolid
											class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
											aria-hidden="true"
										/>
										<span class="min-w-0 truncate">@{changeAuthor}</span>
									</li>
								{/if}
								{#if changeFirstDeployed}
									<li class="t-body flex items-start gap-2 text-gray-900 dark:text-white">
										<ClockOutline
											class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
											aria-hidden="true"
										/>
										<span
											>first deployed {formatTimeAgoCompact(changeFirstDeployed.since, coarse)} ago</span
										>
									</li>
								{/if}
								<!-- ⛔ NO "View on GitHub" ROW HERE. Both forms' head band
								     already carries it (`View on GitHub` / `View commit`) —
								     a second link to the identical URL on the same page is
								     the redundant tab stop `lib/CLAUDE.md`'s "one region, one
								     tap-link" rule bans, caught live by this lane's own page
								     test (`getMultipleElementsFoundError` on two `View on
								     GitHub` links). -->
							</ul>
						</Card>

						<ChangeHistoryCard
							rows={changeHistoryRows}
							retentionNote={changeHistoryRetention}
							now={coarse}
						/>

						<!--
							⭐ COORDINATOR, 2026-09-10 — RAIL CARD 3, "How it's going".
							`HowItsGoing`'s own `dl` grammar (a glyph `dt`, a `dd`
							figure) — this REPO's own typical dev→prod trip (median
							of `PrService.leadTimeMs`, each already ≥2-sample-guarded
							on ITS OWN history) and how long this change has sat in
							its CURRENT state (the frontier cell's own `since`, or —
							once nothing is left to promote — the earliest environment
							it went live).
						-->
						{#if changeTypicalToProdMs != null || changeStateSince}
							<!--
								⭐ ROUND 3, ITEM 1(b) (2026-09-10 fix pass) — OMITTED, NOT
								DRAWN WITH A BARE EM DASH. With no repo-wide dev→prod
								sample AND no "in this state since"/"live since" fact (a
								change whose frontier cell carries no `since` at all — a
								held candidate that has never started), the card's only
								row read "Typical to prod —", a title over nothing. A
								rail card that answers no question is dropped, the same
								rule the grid card's own redundant-sentence fix (item 1(c))
								already applies to a service card.
							-->
							<Card
								icon={HourglassOutline}
								title="How it's going"
								verdict={changeTypicalToProdMs != null
									? `typical ${compactSpan(changeTypicalToProdMs)}`
									: 'no data yet'}
							>
								<dl class="space-y-3">
									<div class="flex items-baseline justify-between gap-3">
										<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
											<HourglassOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
											Typical to prod
										</dt>
										<dd class="t-figure text-gray-900 tabular-nums dark:text-white">
											{changeTypicalToProdMs != null ? compactSpan(changeTypicalToProdMs) : '—'}
										</dd>
									</div>
									{#if changeTypicalToProdMs == null}
										<p class="t-micro -mt-2 text-gray-400 dark:text-gray-500">
											no measured trip yet
										</p>
									{/if}
									{#if changeStateSince}
										<div class="flex items-baseline justify-between gap-3">
											<dt
												class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400"
											>
												<ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
												{changeStateSince.label}
											</dt>
											<dd class="t-figure text-gray-900 tabular-nums dark:text-white">
												{compactSpan(coarse.getTime() - new Date(changeStateSince.since).getTime())}
											</dd>
										</div>
									{/if}
								</dl>
							</Card>
						{/if}
					</div>
				</div>
			</div>
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
					class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pr-3 pl-8 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
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
					{#each [...Array(repoSkelServices).keys()] as r (r)}
						<span class="skel-block h-[26px] w-full"></span>
					{/each}
				</div>
				<div
					class="skel-block h-[53px] w-full border-t border-gray-100 dark:border-gray-700/60"
				></div>
			</div>
			{#if repoSkelHeldBanner}
				<div
					class="skel-block mx-4 my-4 h-[122px] w-[calc(100%-2rem)] sm:h-[122px]"
					aria-hidden="true"
				></div>
			{/if}
			{#each [...Array(repoSkelHeroes).keys()] as h (h)}
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
					<CardSkeleton
						titleWidth="w-32"
						rollupWidth="w-16"
						rows={repoSkelRunning}
						rowHeight={37}
					/>
					<CardSkeleton
						titleWidth="w-36"
						rollupWidth="w-16"
						rows={repoSkelRetired}
						rowHeight={37}
					/>
				</div>
				<div class="flex min-w-0 flex-col gap-4">
					<CardSkeleton
						titleWidth="w-28"
						rollupWidth="w-16"
						rows={repoSkelPending}
						rowHeight={35}
					/>
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
			<h1 class="t-display block leading-[1.15] text-gray-900 dark:text-white">
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
				{:else if repoChangesProgress}
					<!--
						⭐ ROUND 3, ITEM 4 — THE CHANGES SUMMARY ONLY, NEVER THE OLD
						SLOT-ATTENTION SENTENCE ("N slots — 2 held · 4 behind …").
						Same leading-figure shape as every other head band on this
						product: the count that matters (`changes`) at `t-display`,
						the rest of the sentence at `t-dense` on its baseline.
					-->
					<span class="t-display text-gray-900 tabular-nums dark:text-white"
						>{repoChangesProgress.changes}</span
					>
					<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
						change{repoChangesProgress.changes === 1 ? '' : 's'}
						{#if repoChangesProgress.notEverywhere > 0}
							· <span class="font-medium text-gray-700 dark:text-gray-200"
								>{repoChangesProgress.notEverywhere} not everywhere yet</span
							>
						{/if}
						{#if repoChangesProgress.typicalToProdMs != null}
							· typical to prod {compactSpan(repoChangesProgress.typicalToProdMs)}
						{/if}
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
				{:else}
					<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
						GitHub is not connected — see what this cluster runs below.
					</p>
				{/if}
			</div>
		</div>

		<!--
			⭐ FIX PASS ITEM 1 (round 2), 2026-09-11 — ONE GRID FOR THE WHOLE
			PAGE, NOT TWO. The prior pass (comment below, unchanged) folded
			`Changes` and its rail into ONE `.rail-wrap`/`.rail-grid` — but
			left the round-11 ops content (`RepoLedgerCard`, the held banner,
			the hero cards, `BuildLists`) rendering AFTER that grid closed, as
			1201px full-bleed siblings, with `BuildLists` running its OWN
			second `.rev-cols` grid (16px seam, 320px rail) beneath it. Two
			main/rail systems on one page, at two different widths and two
			different seams, is the defect a live screenshot caught. Now
			there is exactly one: this section's `.rail-main` holds
			`Changes` (when there is GitHub data for it), the ledger, the
			held banner, every hero card and `BuildLists`' first two lists,
			in that order; `.rail-side` holds `HowChangesAreGoing` alone.
			`BuildLists`' own "No deploy on record" list — the build-list
			rail item 1's brief names — STACKS UNDER the other two lists
			inside the same main column instead of opening a second rail
			(see that component's own note, below its `<div class="rev-cols">`
			replacement) — the simpler of the two options the brief allows,
			and the one that does not require threading a second snippet
			into this page's own rail.

			`RevisionSearch` moves ABOVE this whole section, matching
			`/changes`' own placement (FIX PASS ITEM 2) — under the head
			band, at the page's full main width, never sandwiched between
			two card systems the way a bare 384px input was before.
		-->
		<div class="flex flex-wrap items-center gap-2">
			<RevisionSearch bind:value={repoSearchQuery} />
		</div>

		<!--
			⭐ FIX PASS ITEM 1, 2026-09-11 — A `Card`, INSIDE THE PAGE'S
			MAIN+RAIL GRID, NEVER A BARE 1201px LIST. Supersedes the round-3
			bare-heading-over-one-list shape a live screenshot caught: this
			section is now `/changes`' own "Your changes" grammar (a
			titled `Card`, deviations always visible, the live run and the
			no-release commits each folded behind one `.nav-link` line) —
			not a new drawing, the SAME one reused with a repo-scoped
			population. The rail beside it is `HowChangesAreGoing`, the
			SAME component `/changes`' own rail uses, retitled for one
			repository via its new `title` prop rather than forked.

			`.rail-wrap`/`.rail-grid`/`.rail-main`/`.rail-side` (`app.css`)
			— main column, 320px rail, the shared shell every rail on the
			product already runs.

			Landmark order (unchanged): `<repo>` → `Changes` →
			`What each service runs` → … — this section sits exactly where
			the superseded bare list did.
		-->
		<section class="mb-8">
			<div class="rail-wrap">
				<div class="rail-grid">
					<div class="rail-main min-w-0">
						{#if repoReleasedRows.length > 0 || repoNoReleaseRows.length > 0}
							<div class="mb-8">
								<Card
									icon={CodePullRequestOutline}
									title="Changes"
									verdict={repoChangesRollupText()}
									padded={false}
								>
									{#if repoDeviations.length > 0}
										<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
											{#each repoDeviationsShown as row (row.href)}
												<ChangeLine {row} now={coarse} />
											{/each}
										</ul>
										{#if !repoChangesExpanded && repoDeviationsHiddenCount > 0}
											<!--
												⭐ FIX PASS ITEM 5, 2026-09-11 — THE SAME LEADING
												SLOT AS THE LIVE-RUN FOLD BELOW, EMPTY. That fold's
												`CheckCircleSolid` (16px + `gap-2`'s 8px) pushed its
												own button 24px right of this one and the no-release
												fold's — three folds in one card, two different text
												x-positions. This fold has no icon to spend (nothing
												folded here is uniformly one state), so the slot is a
												same-size blank rather than inventing one — `.chip`'s
												own "never draw a mark that says nothing" rule applies
												to icons too.
											-->
											<div class="flex items-center gap-2 px-4 py-2.5">
												<span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
												<button
													type="button"
													class="nav-link"
													onclick={() => (repoChangesExpanded = true)}
													>Show {repoDeviationsHiddenCount} more ›</button
												>
											</div>
										{/if}
									{/if}
									{#if repoLiveRun.length > 0}
										<!-- ⭐ THE LIVE-RUN FOLD — same idiom as `/changes`' "Your
										     changes": every row already live everywhere is one
										     contiguous run at the tail of the stuck-first order,
										     folded behind one line rather than repeated N times. -->
										<div class="flex items-center gap-2 px-4 py-2.5">
											<CheckCircleSolid class="tone-live h-4 w-4 shrink-0" aria-hidden="true" />
											<button
												type="button"
												class="nav-link"
												onclick={() => (repoLiveExpanded = !repoLiveExpanded)}
											>
												{repoLiveRun.length} change{repoLiveRun.length === 1 ? '' : 's'} · all live everywhere
												›
											</button>
										</div>
										{#if repoLiveExpanded}
											<ul class="divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
												{#each repoLiveRun as row (row.href)}
													<ChangeLine {row} now={coarse} />
												{/each}
											</ul>
										{/if}
									{/if}
									{#if repoNoReleaseRows.length > 0}
										<!--
											⭐ ROUND 3B — THE FOLD, same idiom as the index's "Your
											changes". ⭐ FIX PASS ITEM 5, 2026-09-11 — SAME BLANK
											LEADING SLOT AS THE OTHER TWO FOLDS ABOVE (see that
											item's own note); all three fold buttons in this card
											now share ONE x.
										-->
										<div class="flex items-center gap-2 px-4 py-2.5">
											<span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
											<button
												type="button"
												class="nav-link"
												onclick={() => (repoNoReleaseExpanded = !repoNoReleaseExpanded)}
											>
												{repoNoReleaseRows.length} commit{repoNoReleaseRows.length === 1 ? '' : 's'}
												produced no release ›
											</button>
										</div>
										{#if repoNoReleaseExpanded}
											<ul class="mt-2 divide-y divide-gray-100 px-2 py-1 dark:divide-gray-700/60">
												{#each repoNoReleaseRows as row (row.href)}
													<ChangeLine {row} now={coarse} />
												{/each}
											</ul>
										{/if}
									{/if}
								</Card>
							</div>
						{/if}

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
									repoUrl={repoPageLedger.repoKey.startsWith('repo:') &&
									repoBody(repoPageLedger.repoKey).includes('/')
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
									? (leadRow.services.find((s) =>
											heldSlotsForRow.some((hs) => hs.appName === s.appName)
										)?.label ?? leadRow.short)
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
								titleHref={changeBuildPath(
									repoPageLedger.repoKey,
									leadRow.revision,
									leadRow.revision
								)}
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
					</div>
					<div class="rail-side min-w-0">
						<HowChangesAreGoing
							title="How this repository is going"
							summary={repoRailSummary}
							notEverywhereCount={repoDeviations.length}
						/>
					</div>
				</div>
			</div>
		</section>
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
					<CardSkeleton
						titleWidth="w-32"
						rollupWidth="w-40"
						rows={3}
						rowHeight={28}
						padded={false}
					/>
				{/each}
			</div>
		{:else if pullError?.reason === 'not_connected'}
			<p class="t-dense mb-1 text-gray-500 dark:text-gray-400">
				#{changeNumber} · {changeOwner}/{changeRepo}
			</p>
			<h1 class="t-display text-gray-900 dark:text-white">
				Connect GitHub to see this pull request
			</h1>
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
			<!-- ══ HEAD BAND — THE PAGE'S ONLY ORIENTATION, NO BREADCRUMB ═══════
			     ⛔ FIX PASS ITEM 16, 2026-09-11 — NAME + ONE CAPTION LINE, THE
			     ROLLOUT DETAIL'S OWN SHAPE. This used to be three stacked `<p>`s
			     — `#N · owner/repo · merged …`, a standalone `checks` line, and
			     a standalone "deployed to N of M" line — three lines answering
			     "how did this change land" above a page whose CARDS already
			     answer that in full. `checks.text` folds into the SAME caption
			     line now (`· no checks reported` / its own link when `checks.href`
			     exists); `changeRolloutsHeadBandLine` folds in beside it ONLY
			     when `showEveryRolloutCard` is false (the one-service edge case
			     where no card carries the fact) — everywhere else it is already
			     the "Every rollout" card's own `verdict` rollup two lines down,
			     and printing it twice is the defect this item exists to fix. -->
			<header class="mb-6">
				<h1 class="t-display text-gray-900 dark:text-white">{prData.title}</h1>
				<p
					class="t-dense mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
				>
					<span
						>#{prData.number} · {changeOwner}/{changeRepo} · {subtitleTail}
						{#if checks && !checks.href}
							· {checks.text}
						{/if}
						{#if !showEveryRolloutCard && changeRolloutsHeadBandLine}
							· {changeRolloutsHeadBandLine}
						{/if}</span
					>
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
					{#if checks?.href}
						<a
							href={checks.href}
							target="_blank"
							rel="noopener noreferrer"
							class="nav-link inline-flex items-center gap-1"
						>
							{checks.text}
							<span aria-hidden="true">↗</span>
						</a>
					{/if}
				</p>
			</header>

			{#if prData.state === 'open'}
				<Card icon={ClockOutline} title="Not merged yet">
					<p class="t-body text-gray-600 dark:text-gray-300">
						This pull request has not merged yet — it targets <code class="t-code-sm"
							>{prData.base}</code
						>. Once it merges, this page fills in per service.
					</p>
					<p class="t-dense mt-2 text-gray-500 dark:text-gray-400">
						{#if openAge}open {openAge} ·
						{/if}{#if openFilesLabel}{openFilesLabel} ·
						{/if}{#if openHeadShort}head
							<code class="t-code-sm">{openHeadShort}</code> ·
						{/if}not built anywhere
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
		<!--
			⭐ ROUND 3, ITEM 4 (2026-09-10 fix pass) — ECHO THE INPUT AS TYPED,
			NEVER `shortRevision`'S TRUNCATED FORM. `shortRevision` shortens a
			REAL 40-char git sha to its conventional 7-char short form — applied
			to a short, simply-wrong identifier a reader typed or pasted
			(`deadbeef`, 8 characters), it silently drops the last character and
			the page named a DIFFERENT string than the one that was actually
			looked up ("Commit deadbee" for an input of "deadbeef"). `shaForChange`
			IS the literal typed/parsed value here (`changeSlugParsed.ref.sha`,
			the fallback once `resolveRevision` finds nothing) — printed whole.
		-->
		<h1 class="t-display text-gray-900 dark:text-white">
			Commit {shaForChange ?? ''} is not in {changeOwner}/{changeRepo}
		</h1>
		{#if commitFoundInOtherRepo}
			<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
				It looks like it belongs to
				<a class="nav-link" href={withQuery(`/changes/${repoSlug(commitFoundInOtherRepo.repoKey)}`)}
					>{commitFoundInOtherRepo.label} ›</a
				>
			</p>
		{/if}
		<p class="t-body mt-2 max-w-prose text-gray-600 dark:text-gray-300">
			<a class="nav-link" href={withQuery('/changes')}>Back to changes ›</a>
		</p>
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
			<!-- ⛔ FIX PASS ITEM 16, 2026-09-11 — NAME + ONE CAPTION LINE, matching
			     the pull form above: `changeRolloutsHeadBandLine` folds into
			     THIS line, only for the one-service edge case where no
			     "Every rollout" card exists to carry it (`showEveryRolloutCard`
			     false) — everywhere else that card's own `verdict` rollup
			     already states it, and a second standalone line would repeat
			     it. -->
			<p
				class="t-dense mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
			>
				<span
					>{shaForChange ? shortRevision(shaForChange) : ''} · {changeOwner}/{changeRepo}{shaSubtitleTail
						? ` · ${shaSubtitleTail}`
						: ''}{!showEveryRolloutCard && changeRolloutsHeadBandLine
						? ` · ${changeRolloutsHeadBandLine}`
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
