<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { isEventStreamHealthy } from '$lib/api/events';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import { rolloutPath } from '$lib/source-dashboard';
	import {
		buildRevisionLedger,
		deployedRevisionCount,
		lineState,
		orderServiceGroups,
		releaseLines,
		repoDeviation,
		rowNamesBuild,
		serviceLedger,
		sortByDeviation,
		type ReleaseLine,
		type RevisionRow,
		type RevisionSlot,
		type RevisionService,
		type RepoLedger,
		type ServiceLedgerGroup,
		type ServiceLedgerLine
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		releaseSplit,
		heldBehind,
		slotBakeStatus,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import { bakeWord, bakeTitle } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import {
		joinClauses,
		buildGateContext,
		blockingStory,
		type GateContext
	} from '$lib/view-models/blocking-story';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	// THE RAIL CARD'S TITLE IS THE REPO, NOT THE URL. See `repo-title.ts`.
	import { repoTitle } from './repo-title';
	// THE PRODUCT'S ONE RANK VOCABULARY.
	import { rankLabel, rankRole, rankTitle, type RankVerdict } from '$lib/view-models/env-rank';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import {
		ArchiveSolid,
		ArrowRightOutline,
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		CheckCircleSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		CloseOutline,
		CodeBranchOutline,
		HourglassOutline,
		RocketSolid,
		SearchOutline,
		TagOutline,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList, { type Fact } from '$lib/components/FactList.svelte';
	import { blockReason, contractBlockReason } from '$lib/components/BlockReason.svelte';
	import BuildStateMark from '$lib/components/BuildStateMark.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import RulePopover from '$lib/components/RulePopover.svelte';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import BannerSkeleton from '$lib/components/skeleton/BannerSkeleton.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	import { historyAtLimit } from '$lib/history-marks';
	import { countLabel } from '$lib/disclosure';

	/**
	 * `/revisions` — REPOSITORY SECTIONS, ONE ROW GRAMMAR, A FINDABLE BUILD.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * ROUND SIX. Full spec: `.agents-context/design/REVISIONS-2026-09-05.md`.
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * Answers the seven-point critique measured against the live fleet
	 * (`kuberik-testing`, `kuberik-testing-second`). The shape:
	 *
	 *   · EACH REPOSITORY IS ONE CARD, collapsed by default (index 0 open).
	 *     Its body is the per-service LEDGER — one row per service, one line
	 *     per build that service is actually live on — so the collapsed
	 *     state already carries the page's most useful answer: *"what is
	 *     `hello-api-app` running everywhere?"* Expanding appends the
	 *     hero/still-running/retired/never-deployed cards below it.
	 *   · THE COVERAGE BAR IS SINGLE-FILL and renders ONLY when it measures a
	 *     shortfall (`live < total`). Held/failing places are said in WORDS
	 *     and CHIPS, never as a second bar colour — the human has rejected a
	 *     segmented bar on this page twice.
	 *   · ONE ROW GRAMMAR, `.bld-row`, with optional cells, used by all three
	 *     build lists (still running / retired / never deployed) so the same
	 *     four tracks line up down the whole page. Reflow is by CONTAINER
	 *     (`@container`), not viewport, because the rail is 340px at 1440 and
	 *     needs the same folded form 390 does.
	 *   · EVERY AGE NAMES ITS EVENT — `Deployed`, `Last deployed`, `Built` —
	 *     never a bare `9h ago`.
	 *   · THE REPO HEADER LEADS WITH DISTANCE: how far the deployed frontier
	 *     is behind the build frontier (`N newer builds` / `Newest build
	 *     deployed`), not the three jargon figures (demoted to a meta line).
	 *   · A SEARCH FIELD at y=72 finds a build by sha, short sha, service or
	 *     label. The per-service filter is a `.pill-btn` chip strip UNDER the
	 *     ledger — the `/rollouts` mechanism — NOT the ledger rows themselves
	 *     turning into toggles: a whole row going gray-900 reads as
	 *     SELECTION, and this is a FILTER. (Coordinator amendment to the
	 *     spec's own §7(a); the spec names this exact fallback in its own
	 *     "Risks" section.)
	 *
	 * WHAT SURVIVES FROM EARLIER ROUNDS, unchanged: revision keying
	 * (`view-models/revision-ledger.ts`), the "repo ≠ release line" rule
	 * (§6 here, `env-rank.ts` elsewhere), the one blocking-fact banner, the
	 * `RevisionLead` hero object (extended ADDITIVELY — see its own header
	 * comment — because it is shared with `/revisions/[...slug]`, a route
	 * this pass does not own).
	 */

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

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));

	/**
	 * ⭐ THE GATE JOIN TABLE — ROUND SIX §1. Built once from the same
	 * `/api/rollouts` payload every other surface reads (`environments`,
	 * `rolloutDependencies`), so a line's own "held in N places" can name
	 * the ACTUAL cause (`hello-api-app`, `^1.67.0`, `1.66.0`) through the
	 * product's one classifier instead of leaving the word unexplained. This
	 * page never loads `/schedules`, so a `check` gate is its final answer,
	 * not `pending` — same choice the revision detail page's own
	 * `gateContext` makes.
	 */
	const gateContext = $derived.by<GateContext>(() =>
		buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null,
			schedulesExpected: false
		})
	);

	/**
	 * ⭐ THE REASON BEHIND ONE LINE'S "held in N places" — ROUND SIX §1.
	 *
	 * `buildState()`'s `held` word is deliberately silent on WHY: it is read
	 * off the bare `live` bucket's `onOwnRelease`/`blockingGates` flags, not
	 * off a classified gate. This asks the SAME question `blockingStory`
	 * already answers for every other surface — picking the first held slot
	 * with gate evidence and classifying its rollout's own blocking gates —
	 * so the sentence drawn here can never disagree with `/apps`,
	 * `/environments` or the rollout's own page for the identical fact.
	 *
	 * ⛔ ONE SLOT, NOT EVERY SLOT. A line held in three places by the SAME
	 * rule needs the rule named once — `BlockReason`'s own `N rules`
	 * disclosure is what counts the rest, exactly as it does everywhere else
	 * this component is used.
	 */
	function heldGateReason(
		coverage: RevisionCoverage
	): {
		reason: NonNullable<ReturnType<typeof blockReason>>;
		appHref: string | null;
		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 2 — THE HELD SLOT'S OWN SERVICE, so the
		 * banner can name it when the sha alone cannot (see the template's
		 * own `heldSubject`).
		 */
		appName: string;
	} | null {
		// ⭐ ROUND 4a, ITEM A — `heldBehind`, NOT JUST THE `live` BUCKET. Once
		// rows split one per release, a place sharing this commit under a
		// different release lands in `notYet` (see that function's own doc
		// comment), so searching `live` alone went blind the moment the split
		// landed — the held row's own gate evidence sat in `notYet` instead.
		const slot = heldBehind(coverage).find((s) => s.blockingGates.length > 0);
		if (!slot) return null;
		const story = blockingStory(slot.slot.cell.rollout, gateContext, {
			subject: slot.appName,
			now: coarse
		});
		if (story.pinnedTo) {
			// `blockReason` only returns `null` when none of its three
			// branches fire; `pinnedTo` here is checked truthy, so the pinned
			// branch always fires.
			return {
				reason: blockReason({ pinnedTo: story.pinnedToDisplay })!,
				appHref: null,
				appName: slot.appName
			};
		}
		// THE CONTRACT, WHEN THERE IS ONE TO NAME — the shape this item exists
		// to draw: a provider, a required range, and the version it serves.
		const dep = story.gates.find((g) => g.kind === 'dependency');
		if (dep) {
			return {
				reason: contractBlockReason({
					provider: dep.subject ?? 'another service',
					contract: dep.contract ?? 'dependency',
					requiredVersion: dep.need,
					providedVersion: dep.have,
					gateName: dep.id
				}),
				appHref: dep.subject ? `/apps/${encodeURIComponent(dep.subject)}` : null,
				appName: slot.appName
			};
		}
		// No contract to draw — fall back to `blockReason`'s own two structural
		// buckets, same predicate `promotionBlock`/`BlockingStoryPanel` use:
		// `person`/`unknown`/a promotion-order gate all publish an allow-list
		// (`awaiting`); `check`/`clock` clear themselves (`notPassing`).
		const awaiting = [...story.person, ...story.unknown, ...story.upstream]
			.filter((g) => g.kind !== 'dependency')
			.map((g) => g.id);
		const notPassing = [...story.checks, ...story.clock].map((g) => g.id);
		const reason = blockReason({ awaiting, notPassing });
		return reason ? { reason, appHref: null, appName: slot.appName } : null;
	}

	/**
	 * ⭐ EACH REPO'S OWN HEAD COVERAGE, COMPUTED ONCE. Feeds both the
	 * deviation ranking below (craft review item 3) and the hero itself —
	 * the SAME object, never a second opinion recomputed a few lines apart.
	 */
	const repoHeadCoverage = $derived.by(() => {
		const m = new Map<string, RevisionCoverage | null>();
		for (const repo of ledgers) {
			const head = repo.rows[0];
			m.set(repo.repoKey, head ? revisionCoverage(head, coarse) : null);
		}
		return m;
	});

	/**
	 * ⭐ CRAFT REVIEW ITEM 3 — LEAD WITH THE DEVIATION. `ledgers` itself stays
	 * sorted by recency (`buildRevisionLedger`'s own, unowned-elsewhere
	 * contract); this is the page's OWN presentational order — the repo
	 * with something to say (failing, held, or meaningfully behind) leads,
	 * backlog breaks a tie, recency last. Index 0 of THIS array is what
	 * `openMap`'s default `{0: true}` opens.
	 */
	const orderedLedgers = $derived(
		sortByDeviation(
			ledgers.map((repo) => ({
				repo,
				deviation: repoDeviation(repo, repoHeadCoverage.get(repo.repoKey) ?? null)
			}))
		).map((item) => item.repo)
	);

	/**
	 * ⭐ ROUND 4a, ITEM E — THE DISCLOSED BLOCK'S OWN SHAPE, PER REPO. How
	 * many "Newest build" hero cards this repo's release lines draw, and
	 * WHICH of them lead with a held banner — the two facts the skeleton
	 * needs to reserve the right height for an OPEN repo instead of always
	 * guessing "one hero, never held". `heldPattern` is per-SLOT, not a bare
	 * count: a held line is not reliably the first one (`releaseLines`
	 * orders by head creation time, and an OLDER line can still be the one
	 * that is held), so a count-first guess put the banner-shaped
	 * placeholder above the WRONG hero on this exact fleet. Computed for
	 * every repo (same indexing as `services`, below), not only open ones,
	 * so a repo that gets expanded next visit already has a remembered
	 * shape waiting.
	 */
	const heroLineShape = $derived(
		orderedLedgers.map((repo) => {
			const lines = releaseLines(repo);
			const leadRows = leadRowsFor(repo, lines);
			const visible = visibleLeadRows(leadRows);
			const visibleCov = visible.map((row) => revisionCoverage(row, coarse));
			const heldPattern = visibleCov.map((cov) => !!heldGateReason(cov));
			/**
			 * ⭐ REVISIONS-2026-09-06, ITEM 1/10 — WHICH HERO LINES RENDER
			 * HEADER-ONLY. A hero at full coverage with no held banner is a
			 * 47px header, not the ~150px card the skeleton used to always
			 * guess — reserving the taller shape for every line overshot the
			 * warm flip the instant a fully-covered, unheld line resolved.
			 */
			// Round 7: the held banner lives OUTSIDE the disclosure now, so a held
			// line at full coverage has no body content either — header-only too.
			const compactPattern = visibleCov.map((cov) => cov.liveCount === cov.totalCount);
			// ⭐ REVISIONS-2026-09-06, ITEM 4 — WAS THE "ALSO STILL RUNNING"
			// CARD EMPTY? Measured live (`pair-warm.mjs`, 1440): the skeleton
			// always drew two fake rows for this card, so a repo whose "Also
			// still running" list is genuinely empty (every place is on a
			// build the hero above already names) replaced two ~144px rows
			// with a single centred sentence — real height GREW past the
			// skeleton's own reserve by +119px, not shrank, because the empty
			// state's own header + padded paragraph turned out taller than
			// this pass's first guess at it. `leadHeads` mirrors the real
			// template's own set exactly (`leadRowsFor`'s revisions).
			const leadHeads = new Set(leadRows.map((r) => r.revision));
			const stillRunningEmpty = restRows(repo, leadHeads).length === 0;
			return { total: visible.length, heldPattern, compactPattern, stillRunningEmpty };
		})
	);

	/**
	 * ⭐ THE PAGE'S ROLLUP. `null` while there is nothing to state — a `0 of
	 * 0` above a skeleton is a reading of the cluster that has not happened
	 * yet.
	 *
	 * ⭐ COORDINATOR PASS 2, ITEM C — `deployed` COUNTS DISTINCT REVISIONS
	 * (`deployedRevisionCount`, `revision-ledger.ts`), NOT `repo.rows.length`.
	 * See that function's own doc comment: a revision that splits into more
	 * than one row (a held sibling release) is still ONE commit, and this
	 * band answers "of 41 builds, how many are deployed" — a question about
	 * COMMITS, not about how many releases they happen to resolve to.
	 */
	const scope = $derived.by(() => {
		if (ledgers.length === 0) return null;
		let deployed = 0;
		let known = 0;
		for (const repo of ledgers) {
			deployed += deployedRevisionCount(repo);
			known += repo.knownRevisions;
		}
		return known > 0 ? { deployed, known } : null;
	});

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 5 — THE HEAD BAND IS THE VERDICT, NOT A
	 * LIFETIME TALLY. `N of M builds deployed` counts builds ever deployed —
	 * nobody acts on it, and it moves to the repository footers, which already
	 * print it (`repo-meta`). The figure here is the number of PLACES not on
	 * their own newest allowed build right now, across every repository's
	 * every release line: held (a gate is refusing a newer candidate on this
	 * exact commit), deploying (mid-canary), or plain behind (an older,
	 * different commit). `heldBehind`'s own `blockingGates` split is what
	 * separates "held" from ordinary lag — the same split `releaseSplitSentence`
	 * reads for the per-line banner.
	 */
	const attention = $derived.by(() => {
		let held = 0;
		let deploying = 0;
		let behind = 0;
		let places = 0;
		for (const repo of orderedLedgers) {
			const lines = releaseLines(repo);
			for (const row of leadRowsFor(repo, lines)) {
				const cov = revisionCoverage(row, coarse);
				places += cov.totalCount;
				deploying += cov.buckets.find((b) => b.key === 'deploying')?.slots.length ?? 0;
				held += heldBehind(cov).filter((s) => s.blockingGates.length > 0).length;
				const notYet = cov.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
				behind += notYet.filter((s) => !s.slot.onRevision).length;
			}
		}
		return { held, deploying, behind, places, total: held + deploying + behind };
	});

	/**
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 8 — THE CLAUSES ALONE, for a
	 * caller that wants the fleet's own verdict WITHOUT the "every other
	 * place …" filler — a zero-result search prints `0 builds match "zzzz" ·
	 * 3 held` (below), and `every other place is on its newest build` reads
	 * as a non sequitur bolted onto a sentence about a search that found
	 * nothing.
	 */
	function attentionClauses(a: { held: number; deploying: number; behind: number }): string {
		const clauses: string[] = [];
		if (a.deploying > 0) clauses.push(`${a.deploying} deploying`);
		if (a.held > 0) clauses.push(`${a.held} held`);
		if (a.behind > 0) clauses.push(`${a.behind} behind`);
		return clauses.join(' · ');
	}

	/** The sentence beside `attention`'s own figure. `0` names none of the three. */
	function attentionSentence(a: {
		held: number;
		deploying: number;
		behind: number;
		total: number;
	}): string {
		if (a.total === 0) return 'every place is on its newest build';
		return `${attentionClauses(a)} · every other place on its newest build`;
	}

	/**
	 * ⭐ ROUND SIX §2 — "NEVER DEPLOYED" IS BOUNDED BY `versionHistoryLimit`,
	 * AND THE PAGE MUST SAY SO. Every rollout keeps `spec.history` to that
	 * many entries; once a service has deployed that many times, an OLDER
	 * build it also deployed can no longer be told apart from one it never
	 * ran at all — both are simply absent from `status.history`. `pending`
	 * (`RepoLedger`'s "nobody has taken this" list) reads exactly that
	 * absence, so a repo at its cap is guaranteed to overstate its own
	 * backlog: some of those "never deployed" builds were deployed, and
	 * evicted, long before this page ever asked.
	 *
	 * `historyAtLimit` (`lib/history-marks.ts`) is the product's one test for
	 * "this rollout's history may already be truncated" — the same test the
	 * History tab uses to print `Unknown` instead of a false "first deploy".
	 * Reused here rather than re-deriving it, so the two pages cannot
	 * disagree about which rollouts are at their cap.
	 */
	function repoHistoryLimit(repo: Pick<RepoLedger, 'rows' | 'pending'>): {
		atLimit: boolean;
		limit: number;
	} {
		for (const row of [...repo.rows, ...repo.pending]) {
			for (const s of row.services) {
				for (const slot of s.slots) {
					if (historyAtLimit(slot.cell.rollout)) {
						return { atLimit: true, limit: slot.cell.rollout?.spec?.versionHistoryLimit ?? 10 };
					}
				}
			}
		}
		return { atLimit: false, limit: 10 };
	}

	const HISTORY_LIMIT_NOTE = (n: number) =>
		`History keeps the last ${n} deploys per service; a build deployed earlier is not recorded.`;

	/**
	 * ⭐ THE SKELETON REMEMBERS THREE THINGS NOW: how many repo sections to
	 * draw, WHICH of them were open, and how many ledger ROWS each one
	 * holds. (REVISIONS-2026-09-05 §1, "Loading"; ROUND SIX §4 corrects the
	 * unit.) All three are SHAPE — counts and a comma-joined list of
	 * indices — never fleet data; `skeleton-hints.ts` enforces that at the
	 * storage layer.
	 *
	 * ⛔ THE STORED COUNT IS LEDGER LINES, NOT SERVICES. `serviceLedger()`'s
	 * own contract is that a service can own TWO lines — a promotion in
	 * flight is exactly two builds live at once on one service's own
	 * ladder (`hello-multi-app`, live on the fleet). Counting groups
	 * undershot the real card's height by one row per service caught
	 * mid-rollout; the field kept its old name (`services`) so an older
	 * remembered hint still parses, only what it counts changed.
	 */
	const SHAPE_KEY = 'revisions';
	type RevisionsShape = {
		repos: number;
		open: string;
		services: string;
		/**
		 * ⭐ ROUND 4a, ITEM E — THE DISCLOSED BLOCK'S OWN SHAPE, REMEMBERED.
		 * `heroLines` is comma-joined, one entry per repo (same indexing as
		 * `services`): how many "Newest build" hero cards an OPEN repo draws
		 * (one per release line). `heldLines` is comma-joined too, but each
		 * entry is a per-repo BIT STRING (`"01"` = line 0 steady, line 1
		 * held) rather than a bare count — a held line is not reliably the
		 * FIRST one (see `heroLineShape`'s own doc comment), so the skeleton
		 * needs to know WHICH slot to draw a banner above, not just how many.
		 * `hadBanner` is the page-level "one blocking fact" banner that sits
		 * ABOVE every repo card. All three are SHAPE — counts, bits and a
		 * boolean — never fleet data.
		 */
		hadBanner: boolean;
		heroLines: string;
		heldLines: string;
		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 1/10 — WHICH HERO LINES RENDER
		 * HEADER-ONLY (no body). Same bit-string shape as `heldLines`.
		 */
		heroCompact: string;
		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 4 — WAS THE "ALSO STILL RUNNING" CARD
		 * EMPTY. Comma-joined `'1'`/`'0'` per repo, same indexing as
		 * `heroLines`. A boolean, not a count: the skeleton only needs to
		 * pick between the two-row placeholder and the empty-state one.
		 */
		stillRunningEmpty: string;
	};
	const shapeHint = recallShape<RevisionsShape>(SHAPE_KEY);
	// Capped generously — only bounds a next-visit SKELETON's size, never the real page.
	const skelRepoCount = Math.min(Math.max(shapeHint?.repos ?? 1, 1), 6);
	const skelServiceCounts = (shapeHint?.services ?? '').split(',').map((raw) => {
		const n = parseInt(raw, 10);
		return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 3;
	});
	const skelOpenIndices = new Set(
		(shapeHint?.open ?? '0')
			.split(',')
			.map((n) => parseInt(n, 10))
			.filter((n) => Number.isInteger(n) && n >= 0)
	);
	const skelHadBanner = shapeHint?.hadBanner ?? false;
	const skelHeroLineCounts = (shapeHint?.heroLines ?? '').split(',').map((raw) => {
		const n = parseInt(raw, 10);
		return Number.isFinite(n) && n > 0 ? Math.min(n, 4) : 1;
	});
	// One bit string per repo, e.g. `["01", "0"]` — `skelHasHeldBanner(sectionIndex)`
	// below reads it (ITEM 2/10: the held banner is no longer per-slot inside
	// the disclosed block — it is always visible, so the skeleton only needs
	// to know WHETHER this repo has one, not which line).
	const skelHeldPatterns = (shapeHint?.heldLines ?? '').split(',');
	function skelHasHeldBanner(sectionIndex: number): boolean {
		return skelHeldPatterns[sectionIndex]?.includes('1') ?? false;
	}
	// Same shape, for the hero's own header-only-vs-card branch (ITEM 1/10).
	const skelCompactPatterns = (shapeHint?.heroCompact ?? '').split(',');
	function skelCompactAt(sectionIndex: number, li: number): boolean {
		return skelCompactPatterns[sectionIndex]?.[li] === '1';
	}
	// ⭐ ITEM 4 — one bit per repo; no hint defaults to `false` (assume
	// non-empty, the two-row placeholder), matching this page's existing
	// convention of guessing the LARGER shape until a real visit corrects it.
	const skelStillRunningEmptyBits = (shapeHint?.stillRunningEmpty ?? '').split(',');
	function skelStillRunningEmptyAt(sectionIndex: number): boolean {
		return skelStillRunningEmptyBits[sectionIndex] === '1';
	}

	/**
	 * ⭐ WHICH REPOSITORY SECTIONS ARE EXPANDED. (§1 "Default open state")
	 * `ledgers` is already sorted most-recently-active first, so index 0
	 * open / the rest closed is the right first-ever-visit default.
	 *
	 * ⛔ REVISIONS-2026-09-06, ITEM 2 — KEYED BY REPOSITORY NOW, NOT INDEX.
	 * `orderedLedgers` is `sortByDeviation`'d — it re-sorts LIVE the moment a
	 * deviation changes (a held gate clears, a deploy starts failing), which
	 * the SSE stream patches into `rollouts` mid-session. An index-keyed
	 * `openMap` therefore did not track "the repository the operator opened",
	 * it tracked "whatever repository next lands at that position" — opening
	 * `kuberik-testing-second` at position 1 and having a deviation elsewhere
	 * promote it to position 0 would silently open `kuberik-testing` instead
	 * and close the one the operator actually expanded.
	 *
	 * The SKELETON still needs indices — before data arrives there are no
	 * repo keys to key by, only a remembered COUNT and POSITION SET
	 * (`skelOpenIndices`, `skeleton-hints.ts`'s own contract: shape only,
	 * never fleet data). So the index form survives as the on-disk shape and
	 * the runtime map translates it to keys exactly ONCE, the first time real
	 * data resolves (`openMapInitialized` below) — index `i` becomes
	 * "the repoKey at position `i` in `orderedLedgers` on that first render",
	 * which for a first-ever visit (no remembered hint, default `{0}`) is
	 * simply "whichever repository sorts first". After that one translation
	 * the map is entirely keyed by `repoKey` and reordering cannot move it.
	 */
	let openMap = $state<Record<string, boolean>>({});
	let openMapInitialized = false;
	$effect(() => {
		if (openMapInitialized || orderedLedgers.length === 0) return;
		openMapInitialized = true;
		const indices = skelOpenIndices.size ? skelOpenIndices : new Set([0]);
		const next: Record<string, boolean> = {};
		for (const i of indices) {
			const repo = orderedLedgers[i];
			if (repo) next[repo.repoKey] = true;
		}
		openMap = next;
	});
	function isOpen(repoKey: string): boolean {
		return !!openMap[repoKey];
	}
	function toggleRepo(repoKey: string) {
		openMap = { ...openMap, [repoKey]: !isOpen(repoKey) };
	}
	/**
	 * The skeleton hint's own shape is still POSITIONAL (see the doc comment
	 * above), so this translates the current, repo-keyed `openMap` back to
	 * index form against `orderedLedgers`' CURRENT order — a faithful
	 * "what a first-ever visit would see right now" snapshot, not a claim
	 * about which repository key was open.
	 */
	function openIndicesString(): string {
		const idx: number[] = [];
		orderedLedgers.forEach((repo, i) => {
			if (openMap[repo.repoKey]) idx.push(i);
		});
		return idx.length ? idx.sort((a, b) => a - b).join(',') : '0';
	}

	$effect(() => {
		if (query.isLoading || query.isError) return;
		rememberShape(SHAPE_KEY, {
			repos: orderedLedgers.length,
			open: openIndicesString(),
			services: orderedLedgers
				.map((r) => serviceLedger(r).reduce((n, g) => n + Math.max(g.lines.length, 1), 0))
				.join(','),
			hadBanner: !!blockage,
			heroLines: heroLineShape.map((h) => h.total).join(','),
			heldLines: heroLineShape
				.map((h) => h.heldPattern.map((b) => (b ? '1' : '0')).join(''))
				.join(','),
			heroCompact: heroLineShape
				.map((h) => h.compactPattern.map((b) => (b ? '1' : '0')).join(''))
				.join(','),
			stillRunningEmpty: heroLineShape.map((h) => (h.stillRunningEmpty ? '1' : '0')).join(',')
		});
	});

	/**
	 * A COARSE CLOCK, DELIBERATELY — not `$now`, which ticks every 100ms.
	 * Bucketing calls `detectStuck`, whose thresholds are 1h and 24h, so a 30s
	 * clock is three orders of magnitude inside the shortest one and saves
	 * rebuilding every slot of every row ten times a second.
	 */
	let coarse = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (coarse = new Date()), 30_000);
		return () => clearInterval(id);
	});

	/**
	 * ⭐ ROUND 3 §10 — STALENESS. `isEventStreamHealthy()` has no reactive
	 * signal of its own (it reflects module-level state `$lib/api/events`
	 * mutates from an SSE callback), so this re-reads it every time the data
	 * ACTUALLY changes (`query.dataUpdatedAt` — a fetch or an SSE-patched
	 * cache write both bump it) and on the coarse clock's own tick, so a
	 * stream drop with no new data is still noticed within 30s.
	 */
	const streamHealthy = $derived.by(() => {
		void query.dataUpdatedAt;
		void coarse;
		return isEventStreamHealthy();
	});

	/**
	 * revision → coverage, for EVERY deployed row — not only the live ones.
	 * (Craft review item 6: a retired row's `.bld-mark` needs its own last
	 * build-state glyph, which reads off this same coverage.)
	 */
	/**
	 * ⭐ ROUND 4a, ITEM A RESIDUE — KEYED BY THE ROW OBJECT, NOT ITS
	 * REVISION STRING. Since a revision can now resolve to more than one
	 * row (one per release — see `buildRowsForRevision` in
	 * `revision-ledger.ts`), two rows sharing a `.revision` would collide on
	 * a string key, and whichever was inserted last would silently answer
	 * for BOTH — the exact cross-release mixing item A exists to end,
	 * reintroduced one map over. Row OBJECTS are unique per render pass
	 * (`buildRevisionLedger` builds them fresh each time), so object
	 * identity is a safe key and the lookup below never has to guess which
	 * release a bare sha string meant.
	 */
	const coverageByRevision = $derived.by(() => {
		const m = new Map<RevisionRow, RevisionCoverage>();
		for (const repo of ledgers) {
			for (const row of repo.rows) {
				m.set(row, revisionCoverage(row, coarse));
			}
		}
		return m;
	});

	/** The two halves of the ledger, split on the page's FIRST criterion. */
	function liveRows(repo: RepoLedger): RevisionRow[] {
		return repo.rows.filter((r) => r.liveSlots > 0);
	}
	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 8 — SORTED BY THE DATE IT DISPLAYS.
	 * `repo.rows` is ordered by BUILD CREATION time (`buildRevisionLedger`'s
	 * own contract, unowned here and correct for the ledger's own use of it)
	 * — filtering it for "No longer running anywhere" without re-sorting
	 * left the row order following creation time while every row's own
	 * printed fact is `Last deployed N ago`. Measured live: `6d, 1d, 1d, 7d,
	 * 1d, 7d` down the list — not monotonic in either direction, so the
	 * order carried no information the reader could use. Newest
	 * `lastDeployMs` first, matching the age this list actually prints.
	 */
	function pastRows(repo: RepoLedger, headRevisions: Set<string>): RevisionRow[] {
		return repo.rows
			.filter((r) => r.liveSlots === 0 && !headRevisions.has(r.revision))
			.sort((a, b) => b.lastDeployMs - a.lastDeployMs);
	}

	/**
	 * ⭐ ROUND 4a, ITEM F — A SERVICE LIST THAT REPEATS THE LINE'S WHOLE SET
	 * IS NOISE, NOT A FACT. A repo that has always deployed as one unit
	 * prints the SAME `hello-multi-app · hello-world-app ·
	 * hello-world-manifests` on every retired build's row — five rows, one
	 * name set, read five times. `heroServicesLabel` already names the line
	 * once, at the top of the section; a row that carries no OTHER services
	 * has nothing left to distinguish by naming them again. Folds to `N
	 * services` (the row's own `title` carries the full join, same idiom as
	 * `.svc-line-caption`'s fold) — but ONLY when the row's own service set
	 * IS the line's full set, never when it is a proper subset (a service
	 * missing from a row IS the fact a subset states).
	 */
	function lineForRow(row: RevisionRow, lines: ReleaseLine[]): ReleaseLine | null {
		const rowServices = new Set(row.services.map((s) => s.appName));
		for (const line of lines) {
			if (line.services.some((s) => rowServices.has(s))) return line;
		}
		return null;
	}

	function namesFoldToCount(row: RevisionRow, lines: ReleaseLine[]): boolean {
		const line = lineForRow(row, lines);
		if (!line || line.services.length <= 1) return false;
		// ⛔ NEVER FOLD AWAY A DEVIATION. `svc.diverged` is a per-service chip
		// this row's own list draws; a fold that hid it would be trading a
		// real fact for the same tidiness this item asks for elsewhere.
		if (row.services.some((s) => s.diverged)) return false;
		const rowServices = new Set(row.services.map((s) => s.appName));
		return (
			line.services.length === rowServices.size && line.services.every((s) => rowServices.has(s))
		);
	}

	/**
	 * DOES THIS REPO RENAME ANYTHING? A PANEL-LEVEL QUESTION, ASKED ONCE.
	 *
	 * In a repo where no service has ever called a build anything but its own
	 * sha there ARE no labels, and the name track degenerates into a second copy
	 * of the revision. Asked per PANEL and not per row, so inside any one card
	 * every row renders the same way and there is nothing to infer.
	 */
	function repoNamesBuilds(rows: RevisionRow[]): boolean {
		return rows.some(rowNamesBuild);
	}

	/**
	 * ⭐ WRAP AT A TOKEN, NEVER THROUGH ONE. `.rev-svc-name` / `.svc-name`
	 * truncated a service name mid-word; `identParts` breaks only after a
	 * hyphen — the only break points a kebab-case app name actually has.
	 */
	function identParts(name: string): string[] {
		return name.split(/(?<=-)/);
	}

	/**
	 * ⭐ EVERY AGE NAMES ITS EVENT. (§5) The same row prints a different verb
	 * depending on which list it is in, stable inside a card so nothing is
	 * inferred from a present/absent word. Falls back to `Built …` when a row
	 * has never actually been deployed (a `pending` row with no
	 * `lastDeployMs`, reached defensively — `pending` rows always pass
	 * `kind: 'pending'` below, but a row moved between lists must never print
	 * a deploy verb it cannot back up).
	 */
	function ageOf(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		if (!ms) return '';
		const t = `${formatTimeAgoCompact(new Date(ms).toISOString(), $now)} ago`;
		if (kind === 'pending' || !row.lastDeployMs) return `Built ${t}`;
		return kind === 'past' ? `Last deployed ${t}` : `Deployed ${t}`;
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 8(c) — AMBIGUOUS RELATIVE TIME, NAMED.
	 * `Built 7d ago` is the same string for every build created within one
	 * rounding bucket, so a CI sweep that cuts twenty-two builds within an
	 * hour prints the identical age twenty-two times — true of each of them,
	 * and useless for telling any two of them apart. When two or more rows
	 * in the "Never deployed" list share one relative label, the whole
	 * colliding set switches to the fact that actually distinguishes them: a
	 * compact absolute time (`Built Aug 29, 11:16`). Computed over the FULL
	 * visible set (`pendingVisible`), not just the folded-to-`compactFold`
	 * slice — a collision the fold is currently hiding is still a collision
	 * the reader hits the moment they press "Show more".
	 */
	function collidingPendingRevisions(rows: RevisionRow[]): Set<string> {
		const byLabel = new Map<string, RevisionRow[]>();
		for (const row of rows) {
			const label = ageOf(row, 'pending');
			const list = byLabel.get(label);
			if (list) list.push(row);
			else byLabel.set(label, [row]);
		}
		const colliding = new Set<string>();
		for (const list of byLabel.values()) {
			if (list.length < 2) continue;
			for (const row of list) colliding.add(row.revision);
		}
		return colliding;
	}

	/** `month day, HH:MM`, 24-hour — the year is never needed (a build old
	 *  enough to need one is not "never deployed" for long). */
	function compactAbsoluteTime(ms: number): string {
		return new Date(ms).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 11 — THE BATCH RANGE, SAID ONCE, IN THE
	 * SUBTITLE. A CI sweep that never-deploys six builds within an hour used
	 * to print `Built Aug 29, 11:1x` six near-identical times down the list —
	 * true of every row, and only the per-row minute actually distinguishes
	 * them. The card's own rollup now states the batch as a range
	 * (`built Aug 29, 10:20–11:17`) once; each row keeps its own compact time
	 * (`pendingAgeText`, unchanged) so the minute that DOES distinguish two
	 * rows is still there to read. `null` when there is no real collision to
	 * summarise, or the batch spans more than one calendar day (a range
	 * across days is not the same compact fact).
	 */
	function pendingBatchRange(rows: RevisionRow[]): string | null {
		const times = rows.map((r) => r.createdMs).filter((t): t is number => !!t);
		if (times.length < 2) return null;
		const min = Math.min(...times);
		const max = Math.max(...times);
		const a = new Date(min);
		const b = new Date(max);
		if (a.toDateString() !== b.toDateString()) return null;
		const dateStr = a.toLocaleString('en-US', { month: 'short', day: 'numeric' });
		const t = (ms: number) =>
			new Date(ms).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
		return `built ${dateStr}, ${t(min)}–${t(max)}`;
	}

	function pendingAgeText(row: RevisionRow, colliding: Set<string>): string {
		if (!colliding.has(row.revision) || !row.createdMs) return ageOf(row, 'pending');
		return `Built ${compactAbsoluteTime(row.createdMs)}`;
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 11 — "N SERVICES" IS THE FILTERED COUNT
	 * UNDER A QUERY, not the row's raw total. Falls back to every service on
	 * the row when the query matched none of THEM by name — a search that hit
	 * the sha or a label still describes the whole row, and narrowing to zero
	 * names would be a worse answer than the honest full set.
	 *
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 7 — RENAMED FROM `pendingServiceNames`
	 * AND SHARED. It answered the identical question for every `.bld-row`
	 * services cell, not only the "Never deployed" rail; the fold branch of
	 * the `names` snippet (below) used to print `row.services.length` raw and
	 * unfiltered instead of calling this, which is exactly why `?q=hello-multi`
	 * showed the unfiltered `3 services` on "No longer running anywhere" while
	 * "Never deployed" correctly showed `1 service hello-multi-app`.
	 */
	function matchedServiceNames(row: RevisionRow): string[] {
		const all = row.services.map((s) => s.appName);
		if (!searchActive) return all;
		const matched = all.filter((n) => n.toLowerCase().includes(searchNeedle));
		return matched.length > 0 ? matched : all;
	}

	function ageTitle(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		return ms ? formatDate(new Date(ms).toISOString()) : '';
	}

	/**
	 * ⭐ ROUND 3 — A RELATIVE AGE NEEDS ITS ABSOLUTE VALUE REACHABLE. `<time
	 * datetime>` is what lets a phone's own long-press/"copy" surface the
	 * real timestamp behind `Deployed 1d ago`, the same fact `ageTitle`
	 * already gives a mouse via `title` — a `<span>` has no such mechanism.
	 */
	function ageIso(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string | undefined {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		return ms ? new Date(ms).toISOString() : undefined;
	}

	/**
	 * ⭐ ROUND SIX §3 — THE LEDGER'S OWN DEAD SPACE. Measured at 1440: the
	 * env-chip column is `minmax(0, 1fr)` and a two- or three-chip line fills
	 * maybe half of it, so ink stopped at x≈788 of a 1199px card with nothing
	 * printed in the remaining 400px. `RevisionRow.lastDeployMs` is the wrong
	 * fact to fill it with — it is the MAX across every service and
	 * environment that ships the revision, not THIS service's own. A line's
	 * own latest deploy is the newest `history[0].timestamp` among the
	 * environments where it is actually onIt right now — the same slots the
	 * env chips beside it are drawn from, so the two facts can never name
	 * different places.
	 */
	/**
	 * ⛔ REVISIONS-2026-09-06, ITEM 3 — SUPERSEDES ROUND-4 RULING 7 (the
	 * laggard-first age this comment used to describe). After a pin clear,
	 * the row read `Deployed 6d ago · STAGING` while DEV had deployed 2
	 * minutes earlier — the title showed it, but the visible row led with the
	 * environment that needed the LEAST attention. The row age is now the
	 * MOST RECENT deploy, named with its own environment — `Deployed 2m ago ·
	 * DEV` — because a reader scanning the row wants to know "what just
	 * happened here", not the deploy that has been sitting steady the longest.
	 *
	 * `slotAgeInfo` returns the NEWEST deploy among the given live slots, with
	 * the environment it belongs to; `envsAgreeWithinMinute` decides whether
	 * naming that environment is a fact or noise — `hello-world-manifests`
	 * printed `· PROD` with all three environments identical to the minute,
	 * which names nothing a reader could not already assume. `slotAgeTitle`
	 * still lists every distinct environment's own date, unconditionally, for
	 * the hover/long-press case. Shared by the ledger's own per-line age
	 * (`lineAge`) and the "Also still running" list's per-row age below — one
	 * derivation, so the two cannot disagree about which environment led for
	 * the same slots.
	 */
	function slotAgeInfo(slots: Pick<RevisionSlot, 'cell' | 'envName'>[]): {
		ms: number;
		envLabel: string;
		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 1 — THE WINNING SLOT'S OWN BAKE STATUS.
		 * Carried alongside the timestamp so a caller can tell "just deployed"
		 * (settled) from "still deploying" (the event that produced this
		 * timestamp has not finished) without a second walk over `slots`.
		 */
		bakeStatus?: string;
	} | null {
		let newest: { ms: number; envLabel: string; bakeStatus?: string } | null = null;
		for (const slot of slots) {
			const latest = slot.cell?.rollout?.status?.history?.[0];
			const ts = latest?.timestamp;
			if (!ts) continue;
			const t = new Date(ts).getTime();
			if (!Number.isFinite(t)) continue;
			const envLabel = shortEnvLabel(slot.cell.theme) || slot.envName;
			if (!newest || t > newest.ms) newest = { ms: t, envLabel, bakeStatus: latest?.bakeStatus };
		}
		return newest;
	}

	/**
	 * ⭐ ITEM 3 — NAME THE ENVIRONMENT ONLY WHEN THE DATES ACTUALLY DISAGREE.
	 * `hello-world-manifests`' three environments deploy together (a single
	 * kustomization apply lands on all three within the same reconcile), so
	 * every timestamp is identical to the minute and printing `· PROD` claims
	 * a distinction that is not there. A minute of slack absorbs clock/queue
	 * jitter between environments that are, for a human's purposes, "the
	 * same deploy".
	 */
	function envsAgreeWithinMinute(slots: Pick<RevisionSlot, 'cell' | 'envName'>[]): boolean {
		let min = Infinity;
		let max = -Infinity;
		for (const slot of slots) {
			const ts = slot.cell?.rollout?.status?.history?.[0]?.timestamp;
			if (!ts) continue;
			const t = new Date(ts).getTime();
			if (!Number.isFinite(t)) continue;
			if (t < min) min = t;
			if (t > max) max = t;
		}
		if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
		return max - min <= 60_000;
	}

	/** Every distinct environment's own deploy date, for the tooltip. */
	function slotAgeTitle(slots: Pick<RevisionSlot, 'cell' | 'envName'>[]): string {
		const seen = new Set<string>();
		const parts: string[] = [];
		for (const slot of slots) {
			const ts = slot.cell?.rollout?.status?.history?.[0]?.timestamp;
			if (!ts) continue;
			const envLabel = (shortEnvLabel(slot.cell.theme) || slot.envName).toUpperCase();
			if (seen.has(envLabel)) continue;
			seen.add(envLabel);
			parts.push(`${envLabel} ${formatDate(ts)}`);
		}
		return parts.join(' · ');
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 9(b) — THE SAME DATES AS `slotAgeTitle`,
	 * AS A RECORD RATHER THAN A JOINED STRING. Feeds the age's own
	 * `RulePopover` (below); a hover `title` states the identical dates for a
	 * mouse, this is the tap/keyboard-reachable form of the same fact.
	 */
	function envDateFacts(slots: Pick<RevisionSlot, 'cell' | 'envName'>[]): Fact[] {
		const seen = new Set<string>();
		const facts: Fact[] = [];
		for (const slot of slots) {
			const ts = slot.cell?.rollout?.status?.history?.[0]?.timestamp;
			if (!ts) continue;
			const envLabel = (shortEnvLabel(slot.cell.theme) || slot.envName).toUpperCase();
			if (seen.has(envLabel)) continue;
			seen.add(envLabel);
			facts.push({ label: envLabel, value: formatDate(ts) });
		}
		return facts;
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 1 — "DEPLOYED" IS NOT YET TRUE MID-CANARY.
	 * The row's own age used to print `Deployed 2s ago` off the newest
	 * timestamp regardless of whether that deploy had actually finished — on
	 * the live cluster, the environment DRIVING that timestamp was still
	 * `Deploying` when the row was captured, so the word claimed a settled
	 * fact the bake had not reached yet. `slotAgeInfo`'s own `bakeStatus`
	 * (the WINNING slot's, i.e. the one this timestamp is about) decides the
	 * verb; the environment/age arithmetic is unchanged either way.
	 */
	function lineAge(line: Pick<ServiceLedgerLine, 'slots'>): string {
		const info = slotAgeInfo(line.slots);
		if (!info) return '';
		const envPart = envsAgreeWithinMinute(line.slots) ? '' : ` · ${info.envLabel.toUpperCase()}`;
		const rel = formatTimeAgoCompact(new Date(info.ms).toISOString(), $now);
		const inFlight = info.bakeStatus === 'Deploying' || info.bakeStatus === 'InProgress';
		return inFlight
			? `Deploying · started ${rel} ago${envPart}`
			: `Deployed ${rel} ago${envPart}`;
	}

	function lineAgeTitle(line: Pick<ServiceLedgerLine, 'slots'>): string {
		if (line.slots.length > 0) return slotAgeTitle(line.slots);
		const info = slotAgeInfo(line.slots);
		return info ? formatDate(new Date(info.ms).toISOString()) : '';
	}

	function lineAgeIso(line: Pick<ServiceLedgerLine, 'slots'>): string | undefined {
		const info = slotAgeInfo(line.slots);
		return info ? new Date(info.ms).toISOString() : undefined;
	}

	/**
	 * ⭐ ROUND 3 §1 — A REPOSITORY IS NOT ONE RELEASE LINE. Replaces the old
	 * single `leadRow`/`restRows`/`filteredLeadRow` trio, which picked ONE
	 * repo-wide "newest" row and filed every OTHER line's own current build
	 * under "Also still running" as if it were merely older — measured on
	 * the live cluster, `hello-multi-app`/`hello-world-app`'s own current
	 * build (`064b655`) is not older than anything on ITS OWN line; it just
	 * is not the newest build in a DIFFERENT line (`hello-api-app`/
	 * `hello-frontend-app`'s `9f10e49`) that happens to sort first.
	 *
	 * One hero PER LINE whose own head has actually been deployed — a line
	 * whose newest known build has never been deployed anywhere has nothing
	 * to lead with (it belongs to the "Never deployed" list instead, per
	 * `releaseLines`' own `headRevision` doc comment).
	 */
	function leadRowsFor(repo: RepoLedger, lines: ReleaseLine[]): RevisionRow[] {
		const out: RevisionRow[] = [];
		for (const line of lines) {
			// ⚠️ NOT `line.headRevision` — that is the ladder's rank-0 build,
			// which (exactly like the old single-line page) can itself be
			// undeployed while an OLDER build from the same line is the one
			// actually in use (`newerPendingFixture`'s own shape: a newer
			// build exists but nobody has run it yet). The hero states what
			// is DEPLOYED, so it is this line's own newest row within
			// `repo.rows` — already sorted newest-first by
			// `buildRevisionLedger`'s own contract — not the line's absolute
			// ladder head.
			const deployed = repo.rows.find((r) => r.services.some((s) => line.services.includes(s.appName)));
			if (deployed) out.push(deployed);
		}
		return out;
	}

	/**
	 * §2 of round 3 — "each line's lead … is hidden when none of its
	 * services match" a live search. Search is the ONE filter now (the
	 * per-service chip strip is retired — see the ledger's own name cell,
	 * now a plain link to `/apps/<name>`), so this is just `passesSearch`
	 * applied to each line's own head row.
	 */
	function visibleLeadRows(rows: RevisionRow[]): RevisionRow[] {
		return rows.filter((r) => !searchActive || passesSearch(r));
	}

	/**
	 * ⭐ THE HERO NAMES ITS OWN LINE'S SERVICES — round 3 §1, "each naming
	 * its services (hello-api-app · hello-frontend-app)" — but `Card`'s
	 * `verdict` slot is `whitespace-nowrap` and the card itself is
	 * `overflow-hidden` (it has no ellipsis of its own; it is sized for
	 * short counts like `6/6 done`). Measured live: three long names
	 * ("hello-multi-app · hello-world-app · hello-world-manifests", 58
	 * characters) clipped mid-word at 390px instead of wrapping.
	 *
	 * ⛔ ROUND SIX §8 — THE CHARACTER-BUDGET FALLBACK MADE TWO HERO CARDS ON
	 * ONE REPO DISAGREE ABOUT WHAT THEY ARE. A multi-line repo renders one
	 * of these cards per line, and the OLD rule picked its spelling from
	 * STRING LENGTH alone: the first line's two short names fit under 40
	 * characters and printed `hello-api-app · hello-frontend-app`; the
	 * second line's three names did not and fell back to the bare count
	 * `3 services` — the exact defect this item names, one card naming
	 * itself and the other refusing to. The budget is now a COUNT (three
	 * names, the same cap the ledger's own line caption already applies),
	 * never a character length, so both cards use the same rule regardless
	 * of how long any one name happens to be — clipping is `Card`'s own
	 * `overflow-hidden` to guard against, not a reason to stop naming
	 * things. `Card`'s `whitespace-nowrap` verdict still cannot wrap, so a
	 * name past the third is folded into `+N more` rather than joined in
	 * full, which is what keeps the line short at any name length.
	 */
	function heroServicesLabel(names: string[]): string {
		if (names.length <= 3) return names.join(' · ');
		return `${names.slice(0, 3).join(' · ')} +${names.length - 3} more`;
	}

	/**
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 2 — THE HERO IS FILTER-AWARE.
	 * `?q=hello-frontend` kept naming `hello-api-app` in the title and
	 * counting its 3 places into the rollup even though the query excludes
	 * it — a service the filter has already hidden from the ledger above
	 * was still the majority of what the hero claimed to be about. Same
	 * fallback idiom as `pendingServiceNames`: a query that matches none of
	 * this row's services BY NAME (a sha or a label search) still describes
	 * the whole line, so the full set survives rather than narrowing to
	 * nothing.
	 */
	function heroMatchedServices(row: RevisionRow): RevisionService[] {
		if (!searchActive) return row.services;
		const matched = row.services.filter((s) => s.appName.toLowerCase().includes(searchNeedle));
		return matched.length > 0 ? matched : row.services;
	}

	/** Everything still running that is NOT one of the lines' own heads. */
	function restRows(repo: RepoLedger, headRevisions: Set<string>): RevisionRow[] {
		return liveRows(repo).filter((r) => !headRevisions.has(r.revision));
	}

	/** §2 — the bar's exact width, `1 of 9` → 11%, never a cell-flex guess. */
	function livePercent(live: number, total: number): number {
		return total > 0 ? Math.round((live / total) * 100) : 0;
	}

	/**
	 * ⭐ CRAFT REVIEW ITEM 7 — WHERE A STILL-RUNNING BUILD ACTUALLY RUNS.
	 * One slot per distinct environment (first service to claim it wins the
	 * theme lookup — identical envs across services in one repo share a
	 * theme anyway), so a five-service row does not print the same five
	 * env chips.
	 */
	function liveEnvSlots(row: RevisionRow): RevisionSlot[] {
		const seen = new Set<string>();
		const out: RevisionSlot[] = [];
		for (const service of row.services) {
			for (const slot of service.slots) {
				if (!slot.onIt) continue;
				// ⛔ DEDUPE BY THE DISPLAYED LABEL, NOT THE RAW `envName`.
				// Measured live: two services' cells can carry different
				// internal `envName`s (per-namespace) for the SAME tier, so
				// keying on `envName` alone printed `STAGING` twice, `PROD`
				// twice, `DEV` twice on one row — a visual duplicate of a
				// chip that reads identically to the one beside it.
				const key = shortEnvLabel(slot.cell.theme) || slot.envName;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(slot);
			}
		}
		return out;
	}

	/*
	 * ⛔ THE LEDGER'S OWN STATE DISC IS GONE (round 3 addendum I). It read
	 * `dotClass`'s borrowed `gray-500` for "deploy succeeded" — a value
	 * `revision-coverage.ts` itself records as wrong — and a coloured dot
	 * with no word needed a `title` to mean anything. `lineState`
	 * (`revision-ledger.ts`) replaces it: nothing drawn for the steady norm,
	 * a `Chip` in words for the one case that needs a look (§3).
	 */

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 4 — EVERY ENVIRONMENT CHIP LINKS. Today the
	 * ledger's `DEV`/`STAGING`/`PROD` chips are inert `<span>`s while the
	 * identical chips on the build (detail) page navigate. `rolloutPath` is
	 * the product's ONE rollout-URL builder (`source-dashboard.ts`, also what
	 * `/dependencies` and rollout detail's own tabs use) — reused rather than
	 * re-derived, so this page cannot construct a URL shape the destination
	 * route does not recognise.
	 */
	function placeHref(slot: Pick<RevisionSlot, 'cell'>): string {
		return rolloutPath(
			slot.cell.sourceCluster,
			slot.cell.rollout.metadata?.namespace ?? '',
			slot.cell.rollout.metadata?.name ?? ''
		);
	}

	function commitUrlFor(repoKey: string, revision: string): string | null {
		const base = repoUrl(repoKey);
		return base ? `${base}/commit/${revision}` : null;
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 3 — DOES THIS SHA RESOLVE TO MORE THAN ONE
	 * RELEASE? `buildRowsForRevision` (`revision-ledger.ts`) already splits a
	 * revision into several rows the moment some service carries several
	 * releases of it (a rollback re-tags a commit already released once
	 * before) — counting rows sharing this revision across BOTH `rows` and
	 * `pending` is the cheapest faithful read of that same split, with no
	 * second derivation of the ambiguity.
	 */
	function revisionReleaseCount(repo: Pick<RepoLedger, 'rows' | 'pending'>, revision: string): number {
		let n = 0;
		for (const row of repo.rows) if (row.revision === revision) n++;
		for (const row of repo.pending) if (row.revision === revision) n++;
		return n;
	}

	/**
	 * This service's own display label for this exact revision, or `null`.
	 *
	 * ⛔ RANK DISAMBIGUATES WHICH ROW, WHEN THE REVISION IS AMBIGUOUS. Two
	 * releases sharing one revision (`hello-frontend-app` rel-66/rel-67)
	 * both carry the SAME app name at the SAME revision string, so "the
	 * first row whose revision matches" silently answered for the WRONG
	 * release — a `1 BEHIND` ledger line for the OLDER release printed the
	 * NEWER release's own label, because `buildRowsForRevision`'s primary
	 * row (rank 0, the held one) sorts first. `rank`, when given, is the
	 * SAME service's own rank on this exact row — `null` only when the
	 * caller already holds the precise row object and has nothing to
	 * disambiguate (the held banner's own call site, which reads
	 * `leadRow.services` directly instead of going through this at all).
	 */
	function serviceLabelFor(
		repo: Pick<RepoLedger, 'rows' | 'pending'>,
		appName: string,
		revision: string,
		rank?: number | null
	): string | null {
		for (const row of [...repo.rows, ...repo.pending]) {
			if (row.revision !== revision) continue;
			const svc = row.services.find(
				(s) => s.appName === appName && (rank == null || s.rank === rank)
			);
			if (svc) return svc.label;
		}
		return null;
	}

	/**
	 * ⭐ ROUND 4a, ITEM C — THE SENTENCE NAMES ITS OWN SUBJECTS.
	 *
	 * `${l.count} of them on ${l.behindLabel}` had no antecedent: "them" named
	 * nothing printed anywhere on screen, and the reader had already been
	 * handed the release names, not a headcount, everywhere else on this
	 * card. The subject is the ENVIRONMENTS actually running the older
	 * release — `dev, staging and prod run 2.66.0-66` — so the sentence reads
	 * as a fact about places, not as an unlabelled count.
	 *
	 * "in all N" only when this group's environments ARE the entire held set
	 * (the common case, one gate holding everything back); a genuinely mixed
	 * repo — one gate holding two of three environments, say — lists them
	 * instead of overclaiming "all".
	 */
	const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	function numberWord(n: number): string {
		return NUMBER_WORDS[n] ?? String(n);
	}

	function releaseSplitSentence(coverage: RevisionCoverage): string {
		const lines = releaseSplit(coverage);
		if (lines.length === 0) return '';
		const heldEnvs = new Set(lines.flatMap((l) => l.envLabels));
		const sentences = lines.map((l) => {
			const envs = joinClauses(l.envLabels.map((e) => e.toLowerCase()));
			const sameSet = l.envLabels.length === heldEnvs.size;
			let clause: string;
			if (l.held) {
				const where = sameSet ? `all ${numberWord(heldEnvs.size)}` : envs;
				clause = `${l.aheadLabel} is held in ${where}`;
			} else {
				const where = sameSet ? 'them' : envs;
				clause = `${l.aheadLabel} has not reached ${where} yet`;
			}
			return `${envs} run ${l.behindLabel}; ${clause}.`;
		});
		return sentences.join(' ');
	}

	/**
	 * ⭐ COORDINATOR PASS 2, ITEM A — ONE FACT ONCE. This used to fire the
	 * moment ANY `notYet` slot on the repo's head row had gate evidence,
	 * which is also exactly the condition that now makes a repository's own
	 * hero draw ITS "is held" banner (`heldGateReason`/`heldBehind`, once a
	 * revision splits one row per release — see `revision-coverage.ts`'s own
	 * doc comment on `heldBehind`). Both fired for `hello-frontend-app`'s
	 * held `9f10e49` at once: this page-level banner said `3 HELD` / `3
	 * rules`, the repository's own said `1 rule` for the identical hold —
	 * two spellings of one fact, 800px apart.
	 *
	 * `s.slot.onRevision` is the exact predicate `heldBehind` uses to decide
	 * a `notYet` slot is a SIBLING-RELEASE hold rather than ordinary
	 * pipeline lag. Excluding it here is not a narrower guess at the same
	 * cause — it is the complement: whatever the repository banner already
	 * draws (a hold on the SAME commit under a different release) is
	 * excluded from this one, and this one is left to say the thing the
	 * repository banner structurally cannot — a place genuinely blocked
	 * on a DIFFERENT, older commit it has not been promoted past at all
	 * (`onRevision: false`), which no per-line hero speaks for. On the
	 * live fleet's current shape that leaves nothing for this banner to
	 * say, and it renders nothing — which is correct, not a bug to chase:
	 * see `skelHadBanner` for why the skeleton stays honest about that.
	 */
	const blockage = $derived.by(() => {
		for (const repo of ledgers) {
			const head = repo.rows[0];
			if (!head) continue;
			const cov = revisionCoverage(head, coarse);
			const stuckSlots = cov.buckets
				.find((b) => b.key === 'notYet')
				?.slots.filter((s) => s.blockingGates.length > 0 && !s.slot.onRevision);
			if (!stuckSlots || stuckSlots.length === 0) continue;
			return {
				repo,
				head,
				cov,
				slots: stuckSlots,
				apps: [...new Set(stuckSlots.map((s) => s.appName))],
				envs: [...new Set(stuckSlots.map((s) => s.envLabel))],
				approval: [...new Set(stuckSlots.flatMap((s) => s.awaitingApprovalGates))],
				window: [...new Set(stuckSlots.flatMap((s) => s.notPassingGates))]
			};
		}
		return null;
	});

	let windows = $state<Record<string, ScheduleWindow>>({});
	$effect(() => {
		const b = blockage;
		if (!b) return;
		for (const s of b.slots) {
			if (s.notPassingGates.length === 0 || !s.rolloutRef) continue;
			const key = `${s.rolloutRef.cluster}/${s.rolloutRef.namespace}/${s.rolloutRef.name}`;
			if (windows[key]) continue;
			fetchScheduleWindow(s.rolloutRef.namespace, s.rolloutRef.name, s.rolloutRef.cluster)
				.then((w) => {
					windows = { ...windows, [key]: w };
				})
				.catch(() => {});
		}
	});

	/** The earliest moment any blocking window on the page opens. */
	const opensIn = $derived.by(() => {
		let best: string | null = null;
		for (const w of Object.values(windows)) {
			if (!w.blocked || !w.nextTransition) continue;
			if (!best || new Date(w.nextTransition) < new Date(best)) best = w.nextTransition;
		}
		return best;
	});

	const bannerMessage = $derived.by(() => {
		const b = blockage;
		if (!b) return '';
		// ⛔ REVISIONS-2026-09-06, ITEM 12 — `joinClauses`, NOT A BARE `.join(',
		// ')`. This banner printed "dev, staging, prod" while the repo banner's
		// own `releaseSplitSentence` (below) said "dev, staging and prod" for
		// the identical shape of fact — one punctuation rule product-wide.
		const where = joinClauses(b.envs.map((e) => e.toLowerCase()));
		const who = b.apps.length === 1 ? b.apps[0] : `${b.apps.length} services`;
		return `${who} ${b.apps.length === 1 ? 'is' : 'are'} held in ${where}.`;
	});

	const bannerFacts = $derived.by<Fact[]>(() => {
		const b = blockage;
		if (!b) return [];
		const facts: Fact[] = [];
		if (b.window.length > 0 && opensIn) {
			facts.push({
				label: 'Opens',
				value: `in ${formatTimeUntil(opensIn, $now)} · ${new Date(opensIn).toLocaleString()}`
			});
		}
		for (const name of b.window) facts.push({ label: 'Not passing', value: name, handle: true });
		for (const name of b.approval) facts.push({ label: 'Approval', value: name, handle: true });
		return facts;
	});

	const bannerRuleCount = $derived(
		(blockage?.window.length ?? 0) + (blockage?.approval.length ?? 0)
	);

	/* PROGRESSIVE DISCLOSURE — `Show N more …`, the reference's own control. */
	const FOLD = 6;
	let expandPast = $state<Record<string, boolean>>({});
	let expandPending = $state<Record<string, boolean>>({});
	/** The ledger's own fold — §1: "prints at most 6 service rows". */
	let expandLedger = $state<Record<string, boolean>>({});

	/**
	 * ⛔ REVISIONS-2026-09-06, ITEM 11 — A VIEWPORT QUERY WAS THE WRONG SIGNAL,
	 * AND IT MADE 640 TALLER THAN 390. `narrowFold` used to read
	 * `max-width: 559px` against the VIEWPORT, but every width on this page
	 * that matters — the rail split, a row's own two-line form — is decided
	 * against the CARD's rendered width, which is the viewport MINUS the
	 * sidebar (~200px open). Measured live: at a 640px viewport the sidebar
	 * is still open and `.rev-shell`'s own container resolves to **367px** —
	 * narrower than the 559 threshold this query was gating on, so the fold
	 * fired at 390 and silently did NOT fire at 640, and the page came out
	 * TALLER at the wider width (3399px vs 3030px) because six collapsed rows
	 * rendered instead of three. `railNarrow` reads the ACTUAL container width
	 * `.rev-shell` reports (the same element `.rev-cols`'s own `@container
	 * (min-width: 860px)` rail split is measured against — see that rule
	 * below), via `ResizeObserver` rather than `MediaQuery`, because a
	 * container's width is not a fact `window.matchMedia` can see. One signal,
	 * both the CSS rail split and this JS fold now agree with — an
	 * `{#each}` slice cannot be sliced by `@container` directly, which is
	 * still the reason this stays JS rather than becoming pure CSS.
	 */
	let shellWidth = $state(Number.POSITIVE_INFINITY);
	function trackRailWidth(node: HTMLElement) {
		const ro = new ResizeObserver((entries) => {
			shellWidth = entries[0]?.contentRect.width ?? node.clientWidth;
		});
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	}
	const railNarrow = $derived(shellWidth < 860);
	const compactFold = $derived(railNarrow ? 3 : FOLD);
	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 1 — THE HERO'S OWN NAME FOLD IS A NARROWER
	 * QUESTION THAN THE RAIL SPLIT. `heroFolds` used to read `railNarrow`
	 * (<860) — the SAME signal the 3-row list fold and the `.rev-cols` rail
	 * split are keyed to — which fires at ~860 regardless of whether the
	 * hero's own title actually has room for its names: measured live, a
	 * 1024–1200px viewport already trips `railNarrow` (the sidebar eats
	 * ~200px) and folds `hello-api-app · hello-frontend-app` to `2 services`
	 * even though the header has hundreds of spare pixels. `heroNarrow` reads
	 * the SAME `.rev-shell` measurement at 560 instead — the width below
	 * which the ledger's own `.svc-line-caption` already folds — so 1024–1200
	 * shows the names and only a genuinely narrow header folds.
	 */
	const heroNarrow = $derived(shellWidth < 560);

	function scopeRecord(n: number): string {
		const services = `${n} service${n === 1 ? '' : 's'}`;
		return `Everything below is counted across the ${services} that have a release for this commit. Each service ships this commit as its own release, with its own rules.`;
	}

	const PENDING_RECORD = 'Your services can deploy these commits. None of them has yet.';

	function repoUrl(repoKey: string): string | null {
		if (!repoKey.startsWith('repo:')) return null;
		const body = repoKey.slice('repo:'.length);
		return body.includes('/') ? `https://${body}` : null;
	}

	/* ── §7 — FIND A BUILD; FILTER TO ONE SERVICE ───────────────────────────
	 *
	 * ⭐ ROUND 3 §2 — ONE FILTER. The per-repo `.pill-btn` chip strip
	 * (`selectedApps`/`toggleAppFilter`) is RETIRED: search is now the only
	 * mechanism that narrows a build list, and the ledger's own service name
	 * is a plain link to `/apps/<name>` instead of a second, competing
	 * filter control — the two-hop path (find the row here, then go look up
	 * the app) becomes one hop straight to the app page.
	 *
	 * THE QUERY LIVES IN THE URL, so a filtered view is deep-linkable and
	 * survives Back/refresh — the same `?x=` pattern `/activity` already
	 * uses for its own chips. Read once on load; every further keystroke
	 * replaces the current history entry (never pushes one per character).
	 */

	let searchQuery = $state(page.url.searchParams.get('q') ?? '');
	const searchActive = $derived(searchQuery.trim().length > 0);
	const searchNeedle = $derived(searchQuery.trim().toLowerCase());

	$effect(() => {
		const trimmed = searchQuery.trim();
		if ((page.url.searchParams.get('q') ?? '') === trimmed) return;
		const params = new URLSearchParams(page.url.searchParams);
		if (trimmed) params.set('q', trimmed);
		else params.delete('q');
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: true, noScroll: true, keepFocus: true });
	});

	function passesSearch(row: RevisionRow): boolean {
		if (!searchActive) return true;
		const q = searchNeedle;
		return (
			row.revision.toLowerCase().startsWith(q) ||
			row.short.toLowerCase().includes(q) ||
			row.services.some((s) => s.appName.toLowerCase().includes(q)) ||
			row.labelGroups.some((g) => g.label.toLowerCase().includes(q))
		);
	}

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 5 — THIS REPO'S OWN "N of M builds", for the
	 * disclose control. Counts DISTINCT revisions (a revision that split into
	 * several rows — a held sibling release — still counts once, the same
	 * rule `deployedRevisionCount` uses), across both the deployed rows and
	 * the never-deployed backlog, so the denominator matches `repo.knownRevisions`
	 * exactly.
	 */
	function repoKnownMatchCount(repo: Pick<RepoLedger, 'rows' | 'pending'>): number {
		const matched = new Set<string>();
		for (const row of [...repo.rows, ...repo.pending]) {
			if (passesSearch(row)) matched.add(row.revision);
		}
		return matched.size;
	}

	/**
	 * ⭐ OPERATOR-WALK ITEM B — UNDER A FILTER, EVERY COUNT FOLLOWS IT.
	 *
	 * The head band used to print the fleet's TOTAL counts
	 * (`19 of 41 builds deployed · 2 repositories`) unchanged while a search
	 * was narrowing every card below it to a handful of rows — a claim about
	 * the cluster sitting above a page that was, at that moment, about
	 * something much smaller. While searching, the band states what the
	 * search itself found: how many builds matched, across how many
	 * repositories. `null` while there is no active search, so the caller
	 * falls back to the fleet-wide sentence unchanged.
	 */
	/**
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 8 — ONE UNIT FOR THE SEARCH COUNT:
	 * BUILDS (COMMITS), EVERYWHERE. This used to count matching ROWS —
	 * `?q=9f10e49` said `2 builds match` (one row per release of that held
	 * commit) while the repo's own disclose pill, two rows down, correctly
	 * deduped to `1 of 36 builds` (`repoKnownMatchCount`'s own `Set` of
	 * revisions). Two objects on one page, two different denominators for
	 * the identical search. `matches` is now the SAME dedupe; `releases` is
	 * the raw row count, printed as a second clause ONLY when it says
	 * something `matches` does not (a build that split into more than one
	 * row) — an ordinary, unambiguous match never grows a `· 1 releases`
	 * tail nobody asked for.
	 */
	const searchSummary = $derived.by(() => {
		if (!searchActive) return null;
		let matches = 0;
		let releases = 0;
		let repos = 0;
		for (const repo of ledgers) {
			const matchedRows = [...repo.rows, ...repo.pending].filter(passesSearch);
			if (matchedRows.length === 0) continue;
			repos++;
			releases += matchedRows.length;
			matches += new Set(matchedRows.map((r) => r.revision)).size;
		}
		return { matches, releases, repos };
	});

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 12 — SEARCH → BUILD, DIRECTLY. When the
	 * query matches exactly one build across the whole fleet, the reader
	 * almost always typed the sha (or the label) to go straight there — the
	 * ledger row already links the same build, but this is the direct route
	 * that does not depend on which repository happens to be open.
	 *
	 * ⭐ ROUND 8, ITEM 8 — DEDUPED BY BUILD (repo + revision), NOT BY ROW. A
	 * held commit that splits into two release-rows (`9f10e49`) used to trip
	 * the "more than one match" bail here even though it is ONE build — the
	 * `Open build →` shortcut fired for `064b655` (one row) and silently did
	 * not for `9f10e49` (two rows, same commit), for no reason a reader could
	 * see. The repo key is part of the dedupe key so the same sha coinciding
	 * across two independent repositories still counts as two builds.
	 */
	const singleSearchMatch = $derived.by<{ repoKey: string; row: RevisionRow } | null>(() => {
		if (!searchActive) return null;
		let found: { repoKey: string; row: RevisionRow } | null = null;
		let foundKey: string | null = null;
		for (const repo of ledgers) {
			for (const row of [...repo.rows, ...repo.pending]) {
				if (!passesSearch(row)) continue;
				const key = `${repo.repoKey}::${row.revision}`;
				if (foundKey && foundKey !== key) return null; // more than one distinct build — no direct route
				if (!found) {
					found = { repoKey: repo.repoKey, row };
					foundKey = key;
				}
			}
		}
		return found;
	});

	/** While searching, every section that might answer it must be open. */
	function effectiveOpen(repoKey: string): boolean {
		return isOpen(repoKey) || searchActive;
	}

	function lineMatchesSearch(line: { revision: string; short: string }): boolean {
		if (!searchActive) return true;
		const q = searchNeedle;
		return line.revision.toLowerCase().startsWith(q) || line.short.toLowerCase().includes(q);
	}

	/**
	 * §7(b): "the ledger filters to matching services." A service whose OWN
	 * name matches keeps every line (the whole service matched); otherwise
	 * only the lines whose build matches survive, and a service with none
	 * left drops out of the ledger entirely for the duration of the search.
	 */
	function visibleLedgerGroups(groups: ServiceLedgerGroup[]): ServiceLedgerGroup[] {
		if (!searchActive) return groups;
		const q = searchNeedle;
		const out: ServiceLedgerGroup[] = [];
		for (const g of groups) {
			if (g.appName.toLowerCase().includes(q)) {
				out.push(g);
				continue;
			}
			const lines = g.lines.filter(lineMatchesSearch);
			if (lines.length > 0) out.push({ appName: g.appName, lines });
		}
		return out;
	}

	/** `{n} of {m} builds` while a filter narrows the list; `{m} builds` when it does not. */
	function rollupLabel(shown: number, total: number, noun: string): string {
		const word = `${noun}${total === 1 ? '' : 's'}`;
		return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
	}

	/**
	 * ⭐ ROUND 4a, ITEM B — SUBJECT-VERB AGREEMENT, THE VERB HALF. `1 build
	 * matches`/`5 builds match`: the verb takes `-es` exactly when the noun
	 * did NOT take `-s` — the two suffixes move in opposite directions, which
	 * is why they are two separate words rather than one shared ternary.
	 */
	function matchVerb(n: number): string {
		return n === 1 ? 'matches' : 'match';
	}

	function rankVerdictFor(rank: number): RankVerdict {
		return rank === 0 ? { kind: 'newest' } : { kind: 'behind', by: rank };
	}
</script>

<svelte:head>
	<title>kuberik | Revisions</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!--
		⛔ THE VISIBLE TITLE SAID WHAT THE NAVBAR ALREADY SAYS. (2026-09-01)
		The `h1` stays for the skip link and the heading outline, and goes
		`sr-only`; the rollup takes its place — see the head-band note below.
	-->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Revisions</h1>
		{#if query.isLoading}
			<span class="skel-block h-7 w-8" aria-hidden="true"></span>
			<span class="skel-block h-3.5 w-56" aria-hidden="true"></span>
		{:else if scope}
			<!--
				⭐ ROUND 4a, ITEM B — THE FIGURE FOLLOWS THE SEARCH TOO. This used
				to print `scope.deployed` (the fleet's unfiltered total)
				unconditionally, so a search for one build's sha sat a big `19`
				directly beside a sentence saying `1 build matches "…"` — the
				same defect §B fixed for the sentence, one node up, still
				unfixed. Under an active search the figure IS the match count.
			-->
			<span class="t-display text-gray-900 tabular-nums dark:text-white"
				>{searchActive && searchSummary ? searchSummary.matches : attention.total}</span
			>
		{/if}
		<!--
			⭐ THE OBJECT IS A BUILD. (§4) `revisions` never appears on the
			printed page again — the route, `<title>`, the nav breadcrumb and
			`SHAPE_KEY` name the SECTION and are unchanged by that rule.
		-->
		<p
			class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400"
			title="One commit, one build. Here is every build your services can deploy, and how far each one has got."
		>
			<!--
				⭐ ROUND 4, ITEM 6 — THE RECORDED-HISTORY CAVEAT IS SAID ONCE NOW,
				NOT THREE TIMES. It used to sit here as a `· recorded history`
				tooltip fragment, again as the "Never deployed" rail's own
				rollup title, and a third time drawn as the rail's own `t-micro`
				line — one fact, three renderings, 90px apart. The rail's drawn
				line (below, `HISTORY_LIMIT_NOTE`) is the one that survives: it
				is the only one that is actually READ without a hover, so it is
				the honest single source. This head band goes back to one
				sentence.

				⭐ ROUND 4, ITEM B — UNDER AN ACTIVE SEARCH THIS STATES WHAT THE
				SEARCH FOUND, not the fleet's unfiltered totals — a search for
				one repo's builds must not sit under a headline still quoting
				the OTHER repo's numbers.
			-->
			{#if searchActive && searchSummary}
				<!--
					⭐ ROUND 4a, ITEM B — SUBJECT-VERB AGREEMENT. `match` never
					inflected: `1 build match "…"` is wrong the same way `1 build
					matches` reads right and `5 builds matches` does not. The noun
					takes `-s` when plural; the verb takes `-es` when the subject is
					SINGULAR — the two suffixes move in opposite directions.
				-->
				{searchSummary.matches} build{searchSummary.matches === 1 ? '' : 's'} {matchVerb(
					searchSummary.matches
				)} “{searchQuery.trim()}”
				<!--
					⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 8 — THE RELEASE COUNT, ONLY
					WHEN IT SAYS SOMETHING `matches` DOES NOT. A held commit
					(`9f10e49`) resolves to more rows than builds; naming that here
					is new information. An ordinary, unambiguous match never grows
					this clause — `releases === matches` for every one of them.
				-->
				{#if searchSummary.releases > searchSummary.matches}
					· {searchSummary.releases} release{searchSummary.releases === 1 ? '' : 's'}
				{/if}
				{#if searchSummary.repos > 0}
					in {searchSummary.repos} repositor{searchSummary.repos === 1 ? 'y' : 'ies'}
				{/if}
				<!--
					⭐ ITEM 8 — A ZERO-RESULT QUERY KEEPS THE FLEET'S OWN VERDICT.
					`0 builds match "zzzz"` on its own leaves a reader with no
					reading of the fleet at all — the same information the
					unfiltered head band already carries (`attentionClauses`,
					the clause half of `attentionSentence` with no "every other
					place …" filler, which reads as a non sequitur bolted onto a
					sentence about a search that matched nothing).
				-->
				{#if searchSummary.matches === 0 && attention.total > 0}
					· {attentionClauses(attention)}
				{/if}
			{:else if scope}
				<!-- ⭐ ROUND 4, ITEM 6 — a non-breaking space between the figure
				     and its noun: `&nbsp;` so "2 repositories" cannot orphan the
				     bare "2" onto its own line at 390.

				     ⭐ REVISIONS-2026-09-06, ITEM 5 — THE SENTENCE NAMES THE
				     VERDICT, NOT A LIFETIME TALLY. `N of M builds deployed` moved
				     to the repository footers (`repo-meta`, unchanged); this
				     names what the figure above counts. -->
				{attentionSentence(attention)} · {ledgers.length}&nbsp;repositor{ledgers.length === 1
					? 'y'
					: 'ies'}
				<!--
					⭐ ROUND 3 §10 — STALENESS. `· live` when the push channel is
					healthy (the poll interval is the safety net, not the truth);
					otherwise the exact time of the last successful read, so a
					reader can judge for themselves whether the page might be
					behind — never a silent, ageless "of N builds deployed" that
					looks current whether or not it still is.
				-->
				{#if streamHealthy}
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
			{/if}
		</p>
	</div>

	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-0 mb-0" />

		<!-- ⭐ THE SEARCH FIELD, RESERVED FIRST — real geometry, disabled. -->
		<div class="relative mt-1 w-full sm:max-w-sm" aria-hidden="true">
			<SearchOutline
				class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
			/>
			<input
				type="text"
				disabled
				placeholder="Find a build or service"
				class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-500"
			/>
		</div>

		<!--
			⭐ ROUND 4a, ITEM E — THE PAGE'S ONE BLOCKING FACT GETS ITS OWN
			PLACEHOLDER. Nothing reserved this slot at all before: the real
			`AlertPanel` (when `blockage` is truthy) sits between the search
			field and the first repo card, and a skeleton with no node there
			shifted every repo-card slot down by one position once the fetch
			resolved — the same DOM-index misalignment `pair.mjs`'s flip test
			exists to catch, just one level up from the ledger row it was
			written for. `skelHadBanner` is the remembered answer to "did last
			visit have one"; `BannerSkeleton` is the product's own placeholder
			for this exact `AlertPanel` shape (already used on `/environments`,
			`/apps`), sized to this page's own measured mobile height.
		-->
		{#if skelHadBanner}
			<BannerSkeleton minHeightMobile={190} class="mt-5" />
		{/if}

		<!--
			⭐ ONE SECTION PER REMEMBERED REPO, AND A CARD PER REMEMBERED
			OPEN INDEX. `skelRepoCount` is 1 on a first-ever visit, and every
			later visit draws the fleet's own last-known repo count with the
			same open/closed sections it last had. Flip test: nothing moves.
		-->
		{#each Array(skelRepoCount) as _, sectionIndex (sectionIndex)}
			{@const svcCount = skelServiceCounts[sectionIndex] ?? 3}
			{@const open = skelOpenIndices.has(sectionIndex)}
			<!--
				⭐ THE REPOSITORY CARD SKELETON — ITEM 2's NESTING, MATCHED.
				`pair.mjs`'s warm-visit flip test caught a real drift here:
				this used to be a SIBLING of the hero+cols block, and craft
				review item 2 nested the real one INSIDE the repository card
				(a `.repo-card` now contains its own disclosed content on a
				tinted ground). A skeleton with the old sibling shape put the
				hero+cols placeholder at the wrong DOM depth and the wrong Y
				entirely once the real card's height — now ledger PLUS
				nested content — came in hundreds of pixels taller than a
				bare ledger guess.
			-->
			<div
				class="repo-card {sectionIndex === 0
					? 'mt-5'
					: 'mt-6'} flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
				aria-hidden="true"
			>
				<div
					class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<span class="skel-block h-4 w-4 shrink-0"></span>
						<span class="skel-block h-4 w-4 shrink-0"></span>
						<span class="skel-block h-3.5 w-40"></span>
					</div>
					<!--
						⛔ REVISIONS-2026-09-06, ITEM 13 — 12→28, +64 WIDE. This
						reserved a bare 12px-tall, 96px-wide placeholder for what a
						loaded header actually draws: a `deviation.chip` (22px) plus
						the 28px-tall `.repo-disclose` button, ~156px wide together.
						Measured live (1440, `kuberik-testing`): the real group is
						28px tall — the skeleton now matches it exactly instead of
						growing the header by 16px the instant real data lands.
					-->
					<span class="skel-block h-7 w-40 shrink-0"></span>
				</div>
				<!--
					⭐ ROUND SIX §4 — THE SKELETON DRAWS `.svc-ledger`'S OWN GRID,
					NOT A BESPOKE FLEX ROW. It used to be a plain `flex flex-col`
					stack at every width, so the warm-visit flip — the moment
					this placeholder is replaced by the real, container-queried
					ledger — reflowed the second repo card by ~1500px the
					instant the real DOM below 560px container width folded
					four columns into a three-row stack. Reusing `.svc-ledger` /
					`.svc-line` / `.svc-name` / `.svc-sha` / `.svc-envs` means the
					SAME `@container` rule (`revisions/+page.svelte`'s own style
					block) folds this placeholder exactly like the real content,
					at every width, so nothing moves when the fetch resolves.
					`svcCount` is now a count of LEDGER LINES, not services —
					`serviceLedger()`'s own contract says a service can own two
					(a promotion in flight), and underestimating that undershot
					the real card's height by one row per service currently
					mid-rollout.

					⭐ ROUND 4, ITEM 4 — ONE `.svc-sha` PLACEHOLDER, NOT TWO. The
					real row's rank chip and sha joined into one cell; the
					skeleton follows so its own grid has the same four columns
					the real content resolves to, not five.
				-->
				<div class="svc-ledger py-1">
					<!--
						⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 9 — THE CAPTION IS GONE,
						SO THE SKELETON HAS ONLY ONE SHAPE TO RESERVE PER LINE BREAK
						NOW: the 8px `.svc-line-gap`. `skelHeroLineCounts` is still the
						per-repo line count the hero cards below already read —
						reserved as one gap per line boundary, matching the real
						template's own unconditional `.svc-line-gap` below exactly, so
						nothing moves on the warm flip.
					-->
					{#if (skelHeroLineCounts[sectionIndex] ?? 1) > 1}
						{#each Array(skelHeroLineCounts[sectionIndex]) as _, li (li)}
							<div class="svc-line-gap" aria-hidden="true"></div>
						{/each}
					{/if}
					{#each Array(svcCount) as _, r (r)}
						<!--
							⭐ ROUND 4a, ITEM E — THE AGE HAS TWO SKELETON PLACEHOLDERS
							NOW, MATCHING THE REAL ROW'S TWO NODES. `.svc-header`'s
							`.svc-age-header` reserves the <560 form (name's own line);
							`.svc-age` reserves the desktop trailing column. The SAME
							`@container` rule hides whichever one the real content
							would hide, so the skeleton folds exactly like the row it
							is standing in for — the flip test this item asks for.
						-->
						<div class="svc-line">
							<span class="svc-header">
								<span class="svc-name"><span class="skel-block h-4 w-28"></span></span>
								<span class="svc-age-header"><span class="skel-block h-3 w-14"></span></span>
							</span>
							<span class="svc-sha"><span class="skel-block h-4 w-24"></span></span>
							<span class="svc-envs">
								<span class="skel-block h-[22px] w-14"></span>
								<span class="skel-block h-[22px] w-14"></span>
							</span>
							<span class="svc-age"><span class="skel-block h-3 w-14"></span></span>
						</div>
					{/each}
				</div>
				<!-- ⛔ NO CHIP-STRIP ROW HERE ANY MORE. Coordinator follow-up 2
				     folded the filter into the ledger's own name cell — the
				     ledger-row skeleton above already reserves that space. -->
				<!--
					⛔ REVISIONS-2026-09-06, ITEM 13 — 29→53. The meta line wraps
					to two lines at most widths once its own repo carries more
					than one release line (`… · across 2 release lines` is the
					fourth clause on an already-long sentence); measured live at
					1440 the loaded `.repo-meta` is 52.6px tall against this
					block's own ~29px. `min-h` reserves the real number directly
					rather than tuning a single `skel-block`'s own height to a
					line count that depends on data this skeleton cannot see yet.
				-->
				<div
					class="flex min-h-[53px] items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60"
				>
					<span class="skel-block h-3 w-64"></span>
					<span class="skel-block h-3 w-24 shrink-0"></span>
				</div>

				<!--
					⭐ REVISIONS-2026-09-06, ITEM 2/10 — THE HELD BANNER RESERVES
					OUTSIDE `{#if open}` NOW, matching where the real one moved
					(always visible while the hold exists, not only when the
					section is expanded). `skelHasHeldBanner` is true whenever ANY
					remembered hero line was held, regardless of position.
				-->
				{#if skelHasHeldBanner(sectionIndex)}
					<BannerSkeleton minHeight={122} minHeightMobile={162} class="mt-4" />
				{/if}

				{#if open}
					<!--
						⭐ THE HERO + `.rev-cols` BLOCK, NESTED — item 2's own
						ground (`bg-gray-50`/`dark:bg-black/20`, 16px inset)
						repeated here so the skeleton's own tint matches.
						The hero itself is COMPACT now (item 7): one row for
						id+state+figure, an optional thin bar, a caption
						line, `View commit` — not the old two-line, 218px
						card.
					-->
					<div class="border-t border-gray-100 bg-gray-50 p-4 dark:border-gray-700/60 dark:bg-black/20">
						<!--
							⭐ ROUND 4a, ITEM E — ONE HERO CARD PER RELEASE LINE, AND A
							HELD BANNER ABOVE THE ONES THAT HAD ONE. This used to
							always draw exactly ONE hero with no banner — a repo with
							two release lines (or a held head) had its disclosed
							block undersized by a full "Newest build" card (and its
							banner) per line the remembered shape didn't know about.
							`skelHeroLineCounts`/`skelHeldAt` are `heroLineShape`'s own
							remembered counts and per-slot bit pattern (see that
							derived's doc comment) — a held line is not reliably the
							first one, so which slot gets the banner is remembered
							per position, not guessed from a count.
						-->
						{#each Array(skelHeroLineCounts[sectionIndex] ?? 1) as _, li (li)}
							{@const last = li === (skelHeroLineCounts[sectionIndex] ?? 1) - 1}
							<!--
								⭐ REVISIONS-2026-09-06, ITEM 1/10 — HEADER-ONLY WHEN THE
								REAL CARD WILL BE. `skelCompactAt` (`heroCompact`,
								`heroLineShape`'s own remembered bit string) picks the
								47px header-only reserve for a line that is at full
								coverage with no held banner, or the fuller header+body
								block otherwise — matching the real branch exactly (see
								the live template's `compactHeroOnly`). The held banner
								itself no longer reserves HERE — it moved outside `{#if
								open}` (see `skelHasHeldBanner`, above), always visible.
							-->
							<div
								class="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white {last
									? ''
									: 'mb-4'} dark:border-gray-700 dark:bg-gray-800"
								aria-hidden="true"
							>
								<div
									class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
								>
									<div class="flex min-w-0 items-center gap-2.5">
										<span class="skel-block h-4 w-4 shrink-0"></span>
										<span class="skel-block h-3.5 w-32"></span>
									</div>
									<span class="skel-block h-3 w-16 shrink-0"></span>
								</div>
								{#if !skelCompactAt(sectionIndex, li)}
									<div class="flex flex-col gap-2 p-4">
										<span class="skel-block h-3 w-32"></span>
										<div class="flex items-baseline justify-between gap-3">
											<span class="skel-block h-6 w-28"></span>
											<span class="skel-block h-4 w-16"></span>
										</div>
										<span class="skel-block h-1.5 w-full"></span>
										<span class="skel-block mt-1 h-3.5 w-full"></span>
										<span class="skel-block h-3.5 w-24"></span>
									</div>
								{/if}
							</div>
						{/each}

						<div class="rev-cols mt-4">
							<div class="flex min-w-0 flex-col gap-4">
								<div
									class="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
									aria-hidden="true"
								>
									<div
										class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
									>
										<div class="flex min-w-0 items-center gap-2.5">
											<span class="skel-block h-4 w-4 shrink-0"></span>
											<span class="skel-block h-3.5 w-32"></span>
										</div>
										<span class="skel-block h-3 w-16 shrink-0"></span>
									</div>
									<!--
										⭐ REVISIONS-2026-09-06, ITEM 4 — THE EMPTY STATE IS ITS
										OWN RESERVE, NOT THE TWO-ROW LIST'S. Measured live
										(`pair-warm.mjs`, 1440): this card's real height when
										"Also still running" has nothing to say (`Nothing older
										is still running — every place is on a build above.`)
										GREW past the always-two-rows skeleton by +119px, because
										a single centred sentence over `px-4 py-6` measures more
										than this pass first assumed. `skelStillRunningEmptyAt`
										(ITEM 4's own remembered boolean) picks the branch that
										actually matches what the real card is about to draw.
									-->
									{#if skelStillRunningEmptyAt(sectionIndex)}
										<div class="flex flex-col items-center gap-1.5 px-4 py-6">
											<span class="skel-block h-3.5 w-full max-w-sm"></span>
											<span class="skel-block h-3.5 w-56 max-w-full"></span>
										</div>
									{:else}
										<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
											{#each Array(2) as _, i (i)}
												<!--
													⭐ ROUND 4a, ITEM E — A FOURTH LEFT-COLUMN LINE. Measured
													live: this row (with its live-percentage bar) renders
													144px against this skeleton's 112px — the env-chip line
													`liveEnvSlots` draws under the service names had no
													placeholder here at all.
												-->
												<li class="bld-row">
													<span class="bld-mark">
														<span class="skel-block h-4 w-4 rounded-full"></span>
													</span>
													<div class="flex min-w-0 flex-col gap-1">
														<span class="skel-block h-3.5 w-24"></span>
														<span class="skel-block h-3 w-40"></span>
														<span class="skel-block h-3 w-20"></span>
														<span class="skel-block h-[18px] w-12"></span>
													</div>
													<div class="bld-roll flex flex-col gap-1.5">
														<span class="skel-block ml-auto h-3.5 w-32"></span>
														<span class="skel-block h-1.5 w-full"></span>
														<span class="skel-block ml-auto h-2.5 w-16"></span>
													</div>
													<span class="bld-go"><span class="skel-block h-4 w-4"></span></span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
								<div
									class="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
									aria-hidden="true"
								>
									<div
										class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
									>
										<div class="flex min-w-0 items-center gap-2.5">
											<span class="skel-block h-4 w-4 shrink-0"></span>
											<span class="skel-block h-3.5 w-44"></span>
										</div>
										<span class="skel-block h-3 w-16 shrink-0"></span>
									</div>
									<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each Array(4) as _, i (i)}
											<li class="bld-row">
												<span class="bld-mark"><span class="skel-block h-4 w-4"></span></span>
												<div class="flex min-w-0 flex-col gap-1">
													<span class="skel-block h-3.5 w-24"></span>
													<span class="skel-block h-3 w-40"></span>
												</div>
												<div class="bld-roll flex flex-col gap-1.5">
													<span class="skel-block ml-auto h-3 w-16"></span>
												</div>
												<span class="bld-go"><span class="skel-block h-4 w-4"></span></span>
											</li>
										{/each}
									</ul>
								</div>
							</div>
							<div class="min-w-0">
								<CardSkeleton titleWidth="w-28" rollupWidth="w-16" rows={4} rowHeight={28} />
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{:else if query.isError}
		<ErrorState
			error={query.error}
			subject="the revision list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-6"
		/>
	{:else if ledgers.length === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-semibold text-gray-900 dark:text-white">Nothing built yet</p>
			<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				A commit shows up here as soon as one of your services can deploy it.
			</p>
		</div>
	{:else}
		<!--
			⭐ THE SEARCH FIELD — §7(b). ONE ROW, the first content element.
			`w-full` at 390, `max-w-sm` from `sm`. The unlayered iOS
			input-zoom fix (`app.css`) already covers this input untouched.
		-->
		<div class="relative mt-1 w-full sm:max-w-sm">
			<SearchOutline
				class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
			/>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Find a build or service"
				aria-label="Find a build by sha or a service by name"
				class="t-body block h-9 w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-gray-900 placeholder-gray-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
				onkeydown={(e) => {
					if (e.key === 'Escape') searchQuery = '';
				}}
			/>
			{#if searchQuery}
				<button
					type="button"
					aria-label="Clear the search"
					onclick={() => (searchQuery = '')}
					class="hit-32 absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
				>
					<CloseOutline class="h-4 w-4" aria-hidden="true" />
				</button>
			{/if}
		</div>

		<!--
			⭐ REVISIONS-2026-09-06, ITEM 12 — SEARCH → BUILD. The ledger row
			already links the matching build; this is the direct route that
			does not depend on which repository is open, printed under the
			field only when the query resolves to exactly one build.
		-->
		{#if singleSearchMatch}
			<a
				class="nav-link mt-1 inline-flex"
				href={revisionPath(singleSearchMatch.repoKey, singleSearchMatch.row.revision)}
			>
				Open build {singleSearchMatch.row.short}
				<ArrowRightOutline class="h-4 w-4" aria-hidden="true" />
			</a>
		{/if}

		<!--
			THE ONE BLOCKING FACT, AS A FILLED FIELD. Unchanged from the round
			that shipped it — see the doc comments on `blockage`/`bannerFacts`
			above.
		-->
		{#snippet gateFacts()}
			<FactList facts={bannerFacts} tone="banner" />
		{/snippet}

		{#if blockage}
			<AlertPanel
				severity="warning"
				icon={blockage.window.length > 0 ? CalendarMonthSolid : UserCircleSolid}
				title="{blockage.head.short} is held"
				message={bannerMessage}
				footnoteBody={bannerRuleCount > 0 ? gateFacts : undefined}
				footnoteCount={bannerRuleCount > 0 ? bannerRuleCount : undefined}
				class="mt-5"
			>
				{#snippet extra()}
					<Chip
						role="alarm"
						label="{blockage.slots.length} held"
						wide
						title="{blockage.slots
							.length} places — a place is one service in one environment — are held by a rule"
					/>
				{/snippet}
				{#snippet actions()}
					<a
						class="nav-link"
						href={revisionPath(blockage.repo.repoKey, blockage.head.revision)}
						aria-label={`See what’s blocking build ${blockage.head.short ?? blockage.head.revision}`}
					>
						See what’s blocking it
						<ArrowRightOutline class="h-4 w-4" aria-hidden="true" />
					</a>
				{/snippet}
			</AlertPanel>
		{/if}

		{#each orderedLedgers as repo, i (repo.repoKey)}
			{@const serviceGroups = serviceLedger(repo)}
			{@const visibleGroups = visibleLedgerGroups(serviceGroups)}
			<!--
				⭐ ROUND 3 §1 — A REPOSITORY IS NOT ONE RELEASE LINE. `lines` groups
				this repo's services by the build their OWN ladder currently
				heads with. `leadHeads` is the set of revisions that are SOME
				line's own head — excluded from "Also still running"/"No longer
				running" so a line's own current build is never filed as if it
				were merely older than a DIFFERENT line's more recent one.
			-->
			{@const lines = releaseLines(repo)}
			{@const multiLine = lines.length > 1}
			{@const leadRows = leadRowsFor(repo, lines)}
			{@const visibleLeads = visibleLeadRows(leadRows)}
			{@const leadHeads = new Set(leadRows.map((r) => r.revision))}
			<!--
				⭐ REVISIONS-2026-09-06, ITEM 2 — THE HELD BANNER, COMPUTED FOR
				EVERY REPO REGARDLESS OF `open`. It used to live inside the
				`{#if open}` disclosed block, so collapsing `36 builds ⌄` took the
				banner (and its rule disclosure, and its `Open <service>` action)
				down with it — leaving a bare `HELD` chip in the collapsed header
				with no way to reach the reason. The hold is a standing fact about
				the repository, not about whether an operator happens to have this
				card expanded, so it is computed here — outside the disclosure —
				and rendered right under the ledger footer, always.
			-->
			{@const heldBanners = visibleLeads
				.map((leadRow) => {
					const leadCov =
						leadRow.revision === (repo.rows[0]?.revision ?? '')
							? repoHeadCoverage.get(repo.repoKey) ?? null
							: revisionCoverage(leadRow, coarse);
					const heldGate = leadCov ? heldGateReason(leadCov) : null;
					return heldGate ? { leadRow, leadCov: leadCov!, heldGate } : null;
				})
				.filter((x): x is { leadRow: RevisionRow; leadCov: RevisionCoverage; heldGate: NonNullable<ReturnType<typeof heldGateReason>> } => x !== null)}
			<!--
				⭐ ROUND 3 ADDENDUM C — LEDGER ORDER. Within each release line
				(and across the whole ledger on a single-line repo), the
				deviating service — held, pinned, stuck or failing on any build
				it is live on — leads; the rest stay alphabetical.
				`serviceLineIndex` only matters when `multiLine`; a single-line
				repo sorts on deviation alone.

				⭐ ROUND SIX §6 — EXTRACTED TO `orderServiceGroups`
				(`revision-ledger.ts`), so the comparator has a unit test with a
				fixture where alphabetical and deviation order actually
				disagree — a `.sort()` inline in a template has none.
			-->
			{@const serviceLineIndex = new Map(lines.flatMap((l, li) => l.services.map((s) => [s, li] as const)))}
			{@const orderedGroups = orderServiceGroups(visibleGroups, {
				lineIndexOf: multiLine ? (appName) => serviceLineIndex.get(appName) ?? 0 : undefined,
				now: coarse
			})}
			{@const shownGroups = expandLedger[repo.repoKey] ? orderedGroups : orderedGroups.slice(0, FOLD)}
			<!--
				⭐ ROUND 4, ITEM 11 — ONE GRAMMAR, NOT TWO. This used to print
				`N release lines` on a multi-line repo and a distance verdict
				(`N newer builds` / `Newest build deployed`) on a single-line
				one — the same header slot answering two different QUESTIONS
				depending on which repo it sat on, so `[3 HELD] 2 release
				lines 36 builds ⌄` and `Newest build deployed 5 builds ›` read
				as two grammars in one column. The distance question — how
				many known builds are newer than anything deployed here — is
				answerable for BOTH shapes: `repo.rows[0]` is the most
				recently CREATED deployed build across every line (`rows` is
				sorted newest-first by creation, repo-wide), so `newer` is
				exactly the old single-line calculation, just no longer
				gated on `multiLine`. `N release lines` moves to the meta
				line below (it already lived there too, doubly stated).
			-->
			<!--
				⭐ COORDINATOR PASS 2, ITEM B — `repo.rows[0]` STAYS THE
				FRONTIER; "DEPLOYED" IS NO LONGER ASSUMED OF IT. The first
				draft tried to route around a held head by hunting for the
				newest row with ANY live slot (`liveSlots > 0`) — but once a
				non-ambiguous service attaches to the split's primary row
				(`buildRowsForRevision`'s own fix, item C), that row's
				`liveSlots` MIXES a genuinely-running service
				(`hello-api-app`, 3 live slots) with the held one
				(`hello-frontend-app`, 0) — the row read `liveSlots: 3` and
				the hunt found it "deployed" anyway, missing the hold
				entirely. `headCov`/`deviation` are computed here instead
				(moved up, unchanged from what they were two lines down) and
				reused — `repoDeviation` already resolved the SAME row's
				coverage down to a per-service `held` count (item B's own
				fix), so this asks that answer directly rather than
				re-deriving a second, buggier one from row-level aggregates.
			-->
			{@const headCov = repoHeadCoverage.get(repo.repoKey) ?? null}
			{@const deviation = repoDeviation(repo, headCov)}
			{@const headCreated = repo.rows[0]?.createdMs ?? 0}
			{@const newer = headCreated > 0 ? repo.pending.filter((p) => p.createdMs > headCreated).length : 0}
			{@const distanceVerdict =
				deviation.chip?.role === 'held'
					? 'Newest build held'
					: newer > 0
						? `${newer} newer build${newer === 1 ? '' : 's'}`
						: 'Newest build deployed'}
			{@const distanceVerdictTitle =
				deviation.chip?.role === 'held'
					? 'The newest known build is held by a rule and has not been deployed anywhere.'
					: newer > 0
						? 'Builds newer than the newest one any service here is running. None of them has been deployed anywhere.'
						: 'Every known build newer than what is running here has already been deployed somewhere.'}
			{@const historyLimit = repoHistoryLimit(repo)}
			{@const url = repoUrl(repo.repoKey)}
			{@const open = effectiveOpen(repo.repoKey)}
			{@const liveAll = restRows(repo, leadHeads)}
			{@const pastAll = pastRows(repo, leadHeads)}
			{@const liveVisible = liveAll.filter(passesSearch)}
			{@const pastVisible = pastAll.filter(passesSearch)}
			{@const pendingVisible = repo.pending.filter(passesSearch)}
			{@const pendingColliding = collidingPendingRevisions(pendingVisible)}
			{@const namedLive = repoNamesBuilds(liveVisible)}
			{@const namedPast = repoNamesBuilds(pastVisible)}
			<!--
				⭐ ROUND 3 §2/ADDENDUM J — A REPOSITORY WITH NO MATCH COLLAPSES TO
				ONE SENTENCE, not four (the ledger's own miss text, plus one per
				build-list card). `repoNoMatch` covers EVERY section this card can
				show; when true, the card prints its header and exactly one line
				underneath and nothing else.
			-->
			{@const repoNoMatch =
				searchActive &&
				visibleGroups.length === 0 &&
				liveVisible.length === 0 &&
				pastVisible.length === 0 &&
				pendingVisible.length === 0}
			<!--
				⭐ REVISIONS-2026-09-06, ITEM 5 — THE FILTER FOLLOWS INTO THE
				HEADER. `deviation`/`distanceVerdict` are computed from
				`repo.rows[0]` — the repo-wide head row — regardless of the
				search box, so `?q=hello-multi` still drew `3 HELD · Newest
				build held · 36 builds` on `kuberik-testing`'s header even
				though the held build (`hello-frontend-app`'s `9f10e49`) is not
				among the matches at all. `headRowMatches` is what the chip
				gates on now: a deviation chip names a fact about a SPECIFIC
				build, and a search that hides that build should hide the
				claim with it (the ledger below and `repoNoMatch` already
				prove some OTHER part of this repo matched, or this whole card
				would not be open). `repoKnownMatchCount` is the same "N of M"
				shape the head band already uses, scoped to this one repo's
				own known-build count for the disclose control.
			-->
			{@const headRowMatches = !searchActive || (repo.rows[0] ? passesSearch(repo.rows[0]) : false)}
			{@const repoKnownMatch = searchActive ? repoKnownMatchCount(repo) : repo.knownRevisions}

			<!--
				⭐ THE REPOSITORY CARD — §1. Always drawn, and its own
				disclosure: the header toggles the hero/list cards BELOW it,
				never the ledger, which stays visible collapsed or not — the
				collapsed state IS the page's most useful answer.

				⛔ CRAFT REVIEW ITEM 2 — CONTAINS ITS OWN DISCLOSURE NOW. With
				the hero/list block as a SIBLING, two open repos printed two
				"Newest build in use" titles at the same x, same width, same
				radius, with nothing saying which repo owned which — the
				repository card and its own disclosed content read as
				unrelated objects. The `{#if open}` block is nested INSIDE
				this card's own body now, on a tinted ground with a 16px
				inset, so it reads as CONTENTS of a container, not a peer of
				it. Radius steps up to 12 (`rounded-xl`) so the outer
				boundary is visibly one size larger than the 8px cards it
				contains.
			-->
			<div
				class="repo-card {i === 0
					? 'mt-5'
					: 'mt-6'} flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
			>
				<!--
					⭐ ROUND SIX §5 — THE TITLE IS NOT A BUTTON; THE DISCLOSURE
					SAYS WHAT IT COLLAPSES. (Supersedes CRAFT REVIEW ITEM 8.)
					The whole 47px bar used to be one `<button>` — a repo's own
					NAME, at `t-card-title`, rendered as a control with no word
					on it saying what pressing it does. `lib/CLAUDE.md`'s own
					rule (*"a control that only changes what you are looking at
					… must look like navigation [or disclosure]"*) and its
					trigger grammar (`lib/disclosure.ts`: *"a SET you can count
					→ N noun"*) both apply here and neither was followed: the
					header read as a static heading OR a mystery button
					depending on which half a reader looked at. The title is a
					plain `<h2>` now; the ONE control is the pill on the
					right, and it names its own count (`36 builds`) — the same
					figure the meta line already prints, so the label is never
					a fact invented for the control alone.
				-->
				<div
					class="flex min-h-[47px] w-full flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60 {repoNoMatch
						? ''
						: 'tap-zone transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50'}"
				>
					<!--
						⭐ COORDINATOR FOLLOW-UP 4 — THE NAME NEVER TRUNCATES, THE
						ROLLUP WRAPS INSTEAD. `truncate` at 390 cut the repo's own
						name (`kuberik-tes…`) while the rollup kept its full width
						— the one identifier this header exists to state, clipped
						so a distance sentence could sit on the same line. `Card`'s
						own header solved this exact fight (see its own comment on
						`flex-wrap` + unconstrained `flex-basis`): unprefixed
						`flex-wrap` on the header lets the rollup drop to its own
						line the moment it and the full title stop both fitting,
						and — the flexbox single-item rule — a lone item under
						`justify-between` sits flush LEFT, not floating right.

						⭐ REVISIONS-2026-09-06, ITEM 6 — THE WHOLE HEADER IS THE
						TOGGLE NOW, NOT THE 93px PILL ALONE. `lib/CLAUDE.md`'s own
						`.tap-zone`/`.tap-link` pattern: the region gets `tap-zone`
						and a hover fill, the `.repo-disclose` pill below keeps its
						own `aria-expanded` (the REAL control) and becomes the
						`.tap-link` whose `::after` covers the region, so a click
						anywhere in this 1199×47 bar toggles the disclosed block —
						not only the 93px `36 builds` pill it used to take.
					-->
					<span class="flex min-w-0 items-center gap-2.5">
						<!--
							⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 5 — THE CHEVRON'S OWN
							TRACK IS RESERVED EVEN WHEN THIS REPO HAS NOTHING TO
							DISCLOSE. Under `?q=064b655` a zero-match repo drew no
							chevron at all, so its title started 26px (16px icon + 10px
							gap) to the LEFT of a matching repo's title two rows down —
							two repository names on one page, two different left
							edges. An invisible spacer the chevron's own size keeps
							every repo card's title flush at the identical x whether or
							not it has anything behind the disclosure.
						-->
						{#if !repoNoMatch}
							<!-- The disclosure's own indicator, left of the identity
							     icon — decorative; the accessible state lives on the
							     REAL control's `aria-expanded`, below. -->
							<ChevronRightOutline
								class="h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-gray-400 {open
									? 'rotate-90'
									: ''}"
								aria-hidden="true"
							/>
						{:else}
							<span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
						{/if}
						<CodeBranchOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
						<h2 class="t-card-title min-w-0 break-words text-gray-900 dark:text-white">
							{repoTitle(repo.repoLabel)}
						</h2>
					</span>
					<!--
						⭐ ROUND 4, ITEM B — A REPOSITORY WITH ZERO MATCHES COLLAPSES
						ITS WHOLE HEADER TO ONE WORD, NOT JUST ITS BODY. This used to
						keep printing its full, UNFILTERED stats — `[3 HELD] 2 release
						lines 36 builds ⌄` — directly above a body that said "No build
						matches", so the loudest object on the card contradicted the
						sentence under it. When nothing here matched the search there
						is nothing left to roll up: no deviation chip (it describes
						builds this view isn't showing), no distance verdict, no
						disclosure — there is nothing behind it to disclose.
					-->
					{#if repoNoMatch}
						<span class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400"
							>no match</span
						>
					{:else}
						<!--
							⭐ §6 — THE HEADER LEADS WITH DISTANCE: how far the deployed
							frontier is behind the build frontier, never a per-service
							claim (`repo ≠ release line`).

							⭐ CRAFT REVIEW ITEM 3 — THE DEVIATION RIDES BESIDE IT. The
							fleet's only adverse fact used to sit two screens down,
							10px tall, on a card the collapsed header gives no hint
							exists. `deviation.chip` is null on a repo with nothing to
							say, so this adds no ink to the common case.
						-->
						<span class="flex shrink-0 items-center gap-2">
							{#if deviation.chip && headRowMatches}
								<Chip
									role={deviation.chip.role}
									label={deviation.chip.label}
									title={deviation.chip.role === 'failing'
										? 'The newest build is deployed somewhere the deploy is not healthy'
										: deviation.chip.role === 'held'
											? `${countLabel(deviation.chip.count, 'place')} ${deviation.chip.count === 1 ? 'is' : 'are'} held by a rule`
											: 'Services with something not yet on the newest build any of them has reached'}
								/>
							{/if}
							<!--
								⛔ REVISIONS-2026-09-06, ITEM 6 — NO DISTANCE VERDICT AT
								REPO SCOPE WHEN THE REPO IS MORE THAN ONE RELEASE LINE.
								`distanceVerdict` reads `repo.rows[0]` — the single
								most-recently-CREATED row across every line — so
								`kuberik-testing` printed `Newest build held` for the
								whole repository because ITS newest-created row
								(`hello-frontend-app`'s `9f10e49`) is held, while a
								DIFFERENT, unrelated line in the same repo
								(`hello-multi-app`/`hello-world-app`, headed by
								`064b655`) was fully covered, `9 of 9`. A verdict is a
								claim about ONE frontier; a multi-line repo has as many
								frontiers as it has lines, and the hero cards below
								already speak for each of them individually. The chip
								stays (it names a real, evidenced fact) and so does the
								disclosure; only the single-sentence verdict goes.
							-->
							{#if !multiLine}
								<span
									class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400"
									title={distanceVerdictTitle}
									>{distanceVerdict}</span
								>
							{/if}
							<!--
								⭐ ROUND SIX §5 — THE ONE CONTROL, AND ITS LABEL NAMES
								WHAT IT COLLAPSES. `countLabel` is the same "N noun"
								form every other disclosure on the product uses; the
								ledger below stays visible either way (§1's own rule,
								unchanged) — this toggles the hero + build-list block
								alone.
							-->
							<!--
								⛔ NOT `.nav-link`. This changes LOCAL VIEW STATE (what
								is expanded), not what page or object is on screen —
								`lib/CLAUDE.md`'s own rule files that under "legitimately
								keeps button chrome", the same family the `more` snippet
								below already uses.

								⭐ ROUND 4, ITEM 12 — RADIUS 8 AND A REST AFFORDANCE
								THAT DOES NOT DEPEND ON HOVER. `rounded-md` (6px) was
								off the product's 4/8/12/pill budget, and with no
								fill or ring at rest it read as plain text until a
								mouse found it — no affordance at all on a touch
								device. The filled `gray-100` ground is the rest
								state.

								⛔ THE BESPOKE 44px `::before` SLOP IS GONE
								(REVISIONS-2026-09-06, ITEM 6) — see the `<style>`
								block's own note beside `.repo-disclose`. This
								button no longer carries `position: relative` of its
								own: it is now `.tap-link` inside the HEADER's
								`.tap-zone` (below), whose `::after` needs to reach
								the whole 47px bar, not just this pill — a
								self-positioned tap-link collapses that overlay down
								to its own box, which is exactly what shipped here
								until measured. The whole header is now the touch
								target, which is bigger than the 44px circle it
								replaces at every width.

								⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 10 — A VISIBLE
								FOCUS RING, THE SAME ONE `RulePopover`'s age summary
								USES. `.tap-zone .tap-link:focus-visible` sets
								`outline: none` and substitutes a ring drawn on the
								ZONE's own `::after` (right, so a ring on a `truncate`
								box is never clipped) — measured on THIS control,
								`outline: 0` / `boxShadow: none` computed on the
								button itself, and pressing Tab past the search field
								landed here with no visible indicator at all: the
								disclosure did not need the zone's whole-header ring,
								it needed its own. `focus-visible:ring-2
								focus-visible:ring-current/40 focus-visible:outline-none`
								is `box-shadow`, not `outline` — it draws on this
								element directly and does not need `position:
								relative` (the property this button deliberately does
								not carry, see the note above), so it cannot re-open
								the collapsed-overlay regression that note exists to
								prevent.
							-->
							<button
								type="button"
								class="repo-disclose tap-link flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-700/80"
								aria-expanded={open}
								aria-controls={`repo-${i}-extra`}
								aria-label={open ? 'Hide build analysis' : 'Show build analysis'}
								onclick={() => toggleRepo(repo.repoKey)}
							>
								{searchActive
									? `${repoKnownMatch} of ${repo.knownRevisions} builds`
									: countLabel(repo.knownRevisions, 'build')}
								{#if open}
									<ChevronDownOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
								{:else}
									<ChevronRightOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
								{/if}
							</button>
						</span>
					{/if}
				</div>

				<!-- ⭐ THE SERVICE LEDGER — §7(a). One group per service, one
				     line per build that service is actually live on. -->
				{#if repoNoMatch}
					<!--
						⭐ ROUND 4a, ITEM D — ONE LINE, NOT TWO. This used to ALSO
						print a body paragraph (`noMatchText`, "No build matches
						'…'.") under a header that already said `no match` — the
						same fact stated twice, 47px apart, at two different
						grammars ("no match" vs "No build matches…"). The header
						carries it now; there is nothing left to disclose here.
					-->
				{:else}
					<div class="svc-ledger py-1">
						{#each shownGroups as group, gi (group.appName)}
							{@const li = serviceLineIndex.get(group.appName) ?? 0}
							{@const prevLi = gi > 0 ? (serviceLineIndex.get(shownGroups[gi - 1].appName) ?? 0) : null}
							{#if multiLine && li !== prevLi}
								<!--
									⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 9 — THE CAPTION IS
									GONE. `1.66.0-66 · 2.67.0-67` restated a fact that now
									lives everywhere else it is needed: the hero's own title
									names the release line, an ambiguous row's joined chip
									prints the release label instead of the bare sha (item
									3, `chipValue`/`serviceLabelFor` above), and the held
									banner names the release it is about. A caption that
									repeated all of that 8px above the rows it was already
									true of was a fourth spelling, not a new fact. Only the
									group's own 8px gap survives to tell two release lines
									apart — alignment alone, the same idiom
									`lineHeadLabels`'s own empty case already used.
								-->
								<div class="svc-line-gap" aria-hidden="true"></div>
							{/if}
							{#each group.lines.length ? group.lines : [null] as line, idx (line ? `${group.appName}/${line.revision}` : `${group.appName}/none`)}
								{@const state = line ? lineState(line, coarse) : null}
								<div class="svc-line">
									<!--
										⭐ ROUND 4a, ITEM E — THE NAME AND THE AGE SHARE ONE
										LINE AT <560. `.svc-header` is `display: contents`
										above that width (so `.svc-name`/`.svc-age` place
										into the desktop grid's columns 1 and 4 exactly as
										before) and a real flex row below it, so a phone
										gets "name … age" as line 1 instead of the age
										getting crammed onto the env-chip line, which is
										what pushed this row to four lines. `.svc-age-header`
										is a THIRD copy of the same fact — the same
										mutually-exclusive-by-`display` idiom
										`.svc-age`/`.svc-age-inline` already used for two
										widths, now one width wider.
									-->
									<span class="svc-header">
										{#if idx === 0}
											<!--
												⭐ ROUND 3 §2 — ONE FILTER. The name is a plain
												link to the app page now, never a second
												filter control competing with the search field
												above — `.tap-link` outside any `.tap-zone`
												picks up `app.css`'s own 32px hit-slop
												automatically.
											-->
											<a
												href={`/apps/${encodeURIComponent(group.appName)}`}
												aria-label={group.appName}
												class="svc-name tap-link t-body text-gray-700 hover:underline dark:text-gray-200"
											>
												<!--
													⭐ `aria-label` NAMES THE WHOLE WORD. `<wbr>` between
													`identParts`' pieces is a visual break point only,
													but the accessible-name algorithm treats sibling
													text nodes split by an element as needing a joining
													space — "a-web" was announced (and matched by role
													queries) as "a- web". The label states the fact the
													markup's own soft-wrap would otherwise mis-state.
												-->
												{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
													/>{/if}{/each}
											</a>
										{:else}
											<!--
												⭐ ROUND 3 ITEM 7/ADDENDUM E — THE CONTINUATION
												LINE KEEPS ITS NAME AT 390. Always rendered
												(muted); the `@container` rule below hides it
												again above 560px, where the sha's own column
												already lines every line up under line 1's name.
											-->
											<!--
												⭐ ROUND 4, ITEM 8 — SAME INK AS LINE 1, NOT A GHOST
												COPY. `text-gray-400` measured 2.60:1 against the
												page ground — a continuation line is still this
												service's own name, not a lesser fact, so it prints
												at the identical ink `.svc-name`'s link uses two
												lines up.
											-->
											<span
												class="svc-name svc-name-continuation t-body text-gray-700 dark:text-gray-200"
												aria-hidden="true"
											>
												{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
													/>{/if}{/each}
											</span>
										{/if}
										{#if line && lineAge(line)}
											<!--
												⭐ REVISIONS-2026-09-06, ITEM 9(b) — HOVER IS NOT
												REACHABLE ON A PHONE. Per-environment deploy dates
												lived only in this `<time>`'s `title`. The age is
												now a button that opens the product's existing
												popover primitive (`RulePopover`, `disclosure.ts`'s
												"a SET → count" shape doesn't quite fit an age, so
												it takes a custom `trigger` — see that component's
												own additive note), listing every distinct
												environment's own date, reachable by tap and by
												keyboard (a `<summary>` is focusable; Enter/Space
												open it).
											-->
											<span class="svc-age-header">
												{#snippet ageTrigger()}
													<time
														class="t-micro"
														datetime={lineAgeIso(line)}
														title={lineAgeTitle(line)}>{lineAge(line)}</time
													>
												{/snippet}
												<RulePopover
													count={line.slots.length}
													noun="place"
													trigger={ageTrigger}
													class="text-gray-500 dark:text-gray-400"
												>
													<FactList facts={envDateFacts(line.slots)} />
												</RulePopover>
											</span>
										{/if}
									</span>
									{#if line}
										{#if line.rank !== null}
											{@const verdict = rankVerdictFor(line.rank)}
											<!--
												⭐ ROUND 4, ITEM 4 — THE RANK CHIP CARRIES THE
												SAME GLYPH `/rollouts` DRAWS. `Chip.svelte`'s tag
												(`◇`) only renders in the JOINED form
												(`hasGlyph = joined && …`) — `/rollouts` earns it
												by pairing the rank chip with the build's own sha
												as `value`. This ledger drew them as TWO separate
												cells (a rank chip, then the sha 90px away), so
												the chip never joined and never drew the glyph —
												exactly the "prop the list page forgot" this item
												named. Joining them here also removes a column: the
												sha's own link becomes the chip's value half
												(still a real link, via `valueHref`), so the fact
												is drawn once instead of a rank chip sitting beside
												an unrelated-looking identifier.
											-->
											<!--
												⭐ REVISIONS-2026-09-06, ITEM 3 — THE VALUE IS THE
												RELEASE WHEN THE SHA CANNOT SAY WHICH ONE. `NEWEST
												9f10e49` on one row and `1 BEHIND 9f10e49 · HELD` on
												another cannot be told apart by the sha alone once a
												commit resolves to more than one release — the joined
												chip's value becomes this service's own release label
												(`2.66.0-66`) then, with the full revision staying in
												the title and the href unchanged (still the commit
												page). Ordinary, non-ambiguous shas are unaffected.
											-->
											{@const ambiguousRevision =
												revisionReleaseCount(repo, line.revision) > 1}
											{@const chipValue = ambiguousRevision
												? (serviceLabelFor(repo, group.appName, line.revision, line.rank) ?? line.short)
												: line.short}
											<!--
												⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 6 — HELD OUT OF
												THE ENVIRONMENT RUN. `DEV STAGING PROD HELD` used to
												read as a fourth environment — the state chip sat
												inside `.svc-envs`, amber beside amber `PROD`. It
												moves beside the rank chip now (`1 BEHIND · 2.66.0-66
												· HELD`), in `.svc-build-id`'s own flex run, never
												inside the env-chip list. Chip spelling is unchanged
												(the same `lineState()` this page always read).
											-->
											<span class="svc-build">
												<span class="svc-build-id">
													<Chip
														role={rankRole(verdict)}
														label={rankLabel(verdict)}
														title="{rankTitle(verdict, group.appName)} — {line.slots
															.map((s) => (shortEnvLabel(s.cell.theme) || s.envName).toUpperCase())
															.join(', ')}"
														value={chipValue}
														valueHref={revisionPath(repo.repoKey, line.revision)}
														valueTitle={line.revision}
													/>
												</span>
												{#if state && state.role !== 'deploying' && state.role !== 'checking'}
													<Chip role={state.role} label={state.label} title={state.title} wide />
												{/if}
											</span>
										{:else}
											<span class="svc-build">
												<a
													class="svc-sha rev-sha ident tap-link t-code text-gray-900 hover:underline dark:text-white"
													href={revisionPath(repo.repoKey, line.revision)}
													title={line.revision}>{line.short}</a
												>
												{#if state && state.role !== 'deploying' && state.role !== 'checking'}
													<Chip role={state.role} label={state.label} title={state.title} wide />
												{/if}
											</span>
										{/if}
										<span class="svc-envs">
											{#each line.slots as slot (slot.envName)}
												{@const envDisplay = shortEnvLabel(slot.cell.theme) || slot.envName}
												{@const inFlightBake = slotBakeStatus(slot)}
												{@const inFlight =
													inFlightBake === 'Deploying' || inFlightBake === 'InProgress'}
												<!--
													⭐ REVISIONS-2026-09-06, ITEM 4 — ONE MARK PER
													FACT, AND THE CHIP RUN NEVER CHANGES WIDTH. The
													old spelling said "this place is deploying" THREE
													times — a bare `spinner + "deploying"` span
													inserted into this chip run (measured on a real
													canary: it moved STAGING +77px and PROD +79px), a
													`DEPLOYING` state chip sitting where
													HELD/PINNED/STUCK normally sit, and the age text.
													The age stays (`lineAge`, below); the inline word
													and the state chip are gone. The env chip itself
													now carries the fact, inside its own box: the
													spinner replaces the chip's glyph slot at the SAME
													width the tag glyph already reserves, in the
													bake's own hue — never the chip's identity colour,
													which stays a function of the environment's name
													alone (`Chip.svelte`'s own invariant).
												-->
												<a
													class="hit-32 shrink-0"
													href={placeHref(slot)}
													aria-label={`Open the ${envDisplay.toUpperCase()} rollout for ${group.appName}${inFlight ? ` — ${bakeWord(inFlightBake)}` : ''}`}
												>
													{#if inFlight}
														{#snippet inFlightGlyph()}
															<span class="mr-[3px] inline-flex shrink-0 items-center">
																<BakeStatusIcon bakeStatus={inFlightBake} size="small" decorative />
															</span>
														{/snippet}
														<Chip
															role="env"
															theme={slot.cell.theme}
															label={envDisplay}
															wide
															icon={inFlightGlyph}
															title="{group.appName} in {envDisplay.toUpperCase()} — {bakeTitle(
																inFlightBake
															)}"
														/>
													{:else}
														<Chip
															role="env"
															theme={slot.cell.theme}
															label={envDisplay}
															wide
															title="{group.appName} in {envDisplay.toUpperCase()}"
														/>
													{/if}
												</a>
											{/each}
										</span>
										<!--
											⭐ ROUND SIX §3 — THE LEDGER'S DEAD SPACE, NAMED.
											A right-aligned fifth column, verb-led
											(`Deployed 1d ago`) — the same verb and the same
											`<time datetime>` mechanism the three build lists
											already use (`ageOf`/`ageIso`), scoped to just
											this line's own live slots rather than the row's
											repo-wide `lastDeployMs`.
										-->
										{#if lineAge(line)}
											<span class="svc-age">
												{#snippet ageTriggerDesktop()}
													<time
														class="t-micro"
														datetime={lineAgeIso(line)}
														title={lineAgeTitle(line)}>{lineAge(line)}</time
													>
												{/snippet}
												<RulePopover
													count={line.slots.length}
													noun="place"
													trigger={ageTriggerDesktop}
													class="text-gray-500 dark:text-gray-400"
												>
													<FactList facts={envDateFacts(line.slots)} />
												</RulePopover>
											</span>
										{/if}
									{:else}
										<span class="svc-empty t-micro text-gray-500 dark:text-gray-400">Not deployed</span>
									{/if}
								</div>
							{/each}
						{/each}
				</div>
			{/if}
				{#if visibleGroups.length > FOLD}
					{@render more(
						() => (expandLedger = { ...expandLedger, [repo.repoKey]: !expandLedger[repo.repoKey] }),
						expandLedger[repo.repoKey],
						`${visibleGroups.length - FOLD} more service${visibleGroups.length - FOLD === 1 ? '' : 's'}`
					)}
				{/if}

				<!--
					⭐ THE META LINE — §4/§1: the three jargon figures, demoted
					here. Coordinator follow-up 5: at <560 the text wraps
					(never truncates against the link) and `View repository`
					drops to its own line below, flush left.

					⭐ ROUND 4, ITEM B — SUPPRESSED ON A ZERO-MATCH REPO. Its own
					counts (`36 builds · 14 deployed at least once · 15 places`)
					are unfiltered fleet stats, exactly the ones the header just
					stopped stating for the same reason — a repo with nothing
					matching the search has no footer to roll up either.

					⛔ REVISIONS-2026-09-06, ITEM 5 — HIDDEN UNDER ANY ACTIVE
					QUERY, NOT ONLY A ZERO-MATCH ONE. `?q=hello-multi` still
					printed the full, unfiltered `36 builds · 14 deployed at
					least once · 15 places` under a header the same query had
					already narrowed — the meta line's own three counts are
					fleet-wide stats with no "of the matches" reading, so there
					is no honest filtered form to fall back to; the disclose
					control above already carries the filtered "N of M builds"
					figure this line would otherwise contradict.
				-->
				{#if !repoNoMatch && !searchActive}
					{@const deployedRevisions = deployedRevisionCount(repo)}
					<div
						class="repo-meta flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60"
					>
						<span
							class="repo-meta-text t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
							title="A place is one service in one environment. 'Deployed at least once' counts distinct commits that have run somewhere, ever — a commit resolving to more than one release (a rollback re-tag) still counts once."
						>
							{repo.knownRevisions} build{repo.knownRevisions === 1 ? '' : 's'} · {deployedRevisions} deployed
							at least once · {repo.slotCount} place{repo.slotCount === 1 ? '' : 's'} to deploy to{multiLine
								? ` · across ${lines.length} release lines`
								: ''}
						</span>
						{#if url}
							<a class="nav-link shrink-0" href={url} target="_blank" rel="noopener noreferrer" title={repo.repoLabel}>
								View repository
								<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
							</a>
						{/if}
					</div>
				{/if}

				<!--
					⭐ REVISIONS-2026-09-06, ITEM 2 — THE HELD BANNER, ALWAYS
					VISIBLE WHILE THE HOLD EXISTS. Moved out of `{#if open}` (see
					`heldBanners`'s own doc comment, above): a hold does not stop
					being true because the card is collapsed, and hiding the ONE
					action that explains it (`Open <service>`) behind a disclosure
					control is what left a bare `HELD` chip with nowhere to go.
				-->
				{#if !repoNoMatch}
					{#each heldBanners as { leadRow, leadCov, heldGate } (leadRow.revision)}
						{@const HeldIcon = heldGate.reason.icon}
						<!--
							⭐ REVISIONS-2026-09-06, ITEM 2(a) — SUBJECT AND PLACE.
							`9f10e49 is held` cannot be told apart from a row reading
							`9f10e49 · 6 of 6 places` for a DIFFERENT release of the
							same commit. When the sha resolves to more than one
							release (`revisionReleaseCount`), the subject is the
							release AND the service it belongs to —
							`hello-frontend-app 2.67.0-67 is held`; an unambiguous sha
							keeps the bare sha, as before.
						-->
						{@const heldAmbiguous = revisionReleaseCount(repo, leadRow.revision) > 1}
						<!--
							⭐ ITEM 2(a) — READ THE LABEL OFF `leadRow` DIRECTLY, NOT
							VIA A SECOND REVISION LOOKUP. `leadRow` already IS the
							precise row object this banner is about (the split's own
							primary row), so its own `services` array names exactly
							the release it is the primary row FOR — no ambiguity to
							resolve, unlike the ledger's ITEM 3 (which only has a bare
							revision string to work from and needs `serviceLabelFor`'s
							own rank disambiguation).
						-->
						{@const heldSubject = heldAmbiguous
							? `${heldGate.appName} ${leadRow.services.find((s) => s.appName === heldGate.appName)?.label ?? leadRow.short}`
							: leadRow.short}
						{#snippet heldFootnote()}
							<p class="min-w-0">{heldGate.reason.line}</p>
							{#if heldGate.appHref}
								<a class="nav-link mt-1 inline-flex" href={heldGate.appHref}>
									Open {heldGate.reason.subject ?? 'the service'}
									<ArrowRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
								</a>
							{/if}
						{/snippet}
						<!--
							⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 11 — THE BANNER SEAM.
							`AlertPanel`'s own root is `rounded-xl` (12px, the same
							radius `.repo-card` itself uses) and this call site inset
							it by nothing horizontally and 16px on top only — measured
							live, the banner's own 12px corner sat almost flush against
							the card's identical 12px corner, a hairline hard-to-read
							wedge where the two rounded edges nearly (but not exactly)
							coincide, with 16px above the banner and 0 below it. Inset
							by the card's own 16px padding on all four sides — the same
							gutter `.svc-ledger`/`.repo-meta` already use — so the
							banner reads as CONTENT of the card, at the card's OWN inner
							cards' radius (8px, `rounded-lg` — every other object nested
							inside `.repo-card` is 8px, only the outer container is 12).
							`overflow-hidden` on this wrapper is what makes the 8px
							radius the one that is actually seen: `AlertPanel.svelte`
							is a shared component this lane does not own, so its
							internal `rounded-xl` cannot be edited directly, but a
							same-size clipping box one radius step tighter crops its
							corners to the smaller curve from outside.
						-->
						<div class="mx-4 my-4 overflow-hidden rounded-lg">
							<AlertPanel
								severity="warning"
								icon={HeldIcon}
								title="{heldSubject} is held"
								message={releaseSplitSentence(leadCov)}
								footnoteBody={heldFootnote}
								footnoteCount={1}
								footnoteNoun="rule"
								class=""
							/>
						</div>
					{/each}
				{/if}

				<!--
					⭐ CRAFT REVIEW ITEM 2, CONTINUED — THE DISCLOSED BLOCK NESTS
					HERE NOW, on a tinted ground (`bg-gray-50/60` /
					`dark:bg-gray-800/40`) with a 16px inset, so its own 8px
					cards read as CONTENTS of the 12px repository card rather
					than siblings of it.
				-->
				{#if open && !repoNoMatch}
					<!--
						⛔ DARK GROUND DEVIATES FROM THE COORDINATOR'S LITERAL
						`dark:bg-gray-800/40`: this element's PARENT (`.repo-card`)
						is already `dark:bg-gray-800` SOLID, and alpha-blending
						`gray-800` at 40% over an opaque `gray-800` base composites
						to exactly `gray-800` again — zero visible difference,
						measured live. `bg-black/20` is a real translucent
						darkening over that same base, which is what "a visibly
						different surface" requires; light mode's `bg-gray-50` is
						unchanged (its parent is `bg-white`, where the tint IS
						visible as specified).
					-->
					<div
						id={`repo-${i}-extra`}
						class="rev-shell border-t border-gray-100 bg-gray-50 p-4 dark:border-gray-700/60 dark:bg-black/20"
						use:trackRailWidth
					>
						<!--
							⭐ ROUND 3 §1 — ONE HERO PER RELEASE LINE. `barPercent`/
							`hideBar`/`compact` are the additive props `RevisionLead.svelte`
							gained for the previous pass; `showHeldChip` is deliberately
							NOT passed any more (addendum B) — the collapsed header's own
							`N held` chip already states it, in the shared `held` spelling,
							and the hero's own `BuildStateMark` already says "held in N
							places" in words, so a second chip here was the same fact
							twice, 399px apart. The detail page's own call site is
							untouched.
						-->
						{#each visibleLeads as leadRow (leadRow.revision)}
							{@const leadCov =
								leadRow.revision === (repo.rows[0]?.revision ?? '')
									? headCov
									: revisionCoverage(leadRow, coarse)}
							{@const heldGate = leadCov ? heldGateReason(leadCov) : null}
							<!--
								⭐ ROUND 4, ITEM 2 — THE TITLE NAMES THE OBJECT, THE
								ROLLUP CARRIES THE VERDICT. This card used to title
								itself "Newest build in use" (a caption true of every
								hero on the page) and put the actual object — the
								services this line covers — in the `verdict` slot,
								which is `whitespace-nowrap`: measured live at 390 a
								three-name line clipped mid-word (`scrollWidth 353 /
								clientWidth 307`). The title WRAPS (`Card`'s own
								`break-words`), so the long, informative half belongs
								there; the rollup keeps the short, count-shaped half
								it was built for.

								⛔ REVISIONS-2026-09-06, ITEM 1 — THE ROLLUP IS ALWAYS
								COVERAGE, NEVER `held in N`. This used to branch to
								`held in ${heldPlaces}` the moment a release split had a
								held sibling, which is exactly the shape that produced
								`held in 3 places · 3 of 6` — two different denominators
								for the same six places, both on screen at once. The
								page's identifier is the sha: the rollup counts places
								running THIS REVISION, full stop, and now agrees with
								`revisionCoverage`'s own fixed count (see
								`revision-coverage.ts`'s `classify()`). The held fact is
								still said — once — by the `AlertPanel` below and by the
								repo header's own `N held` chip; it does not need a third
								spelling here.
							-->
							<!--
								⛔ REVISIONS-2026-09-06, ITEM 10 — THE FOLD BELOW 560
								SHIPPED FOR THE LEDGER'S OWN CAPTION (`.svc-line-caption`)
								BUT NOT FOR THIS HEADER. Measured live: at 390 AND at 640
								`Newest build · hello-multi-app · hello-world-app ·
								hello-world-manifests` wrapped to three lines, an 85px
								header for one card. `railNarrow` is the SAME container
								signal item 11 fixed the row-count fold onto (see that
								item's own comment above `railNarrow`'s declaration) —
								one container-width fact feeding both the CSS rail split
								and every JS fold on this page, rather than a THIRD
								breakpoint decided a fourth way. Folds to `N services`
								regardless of count (`> 1`, never `1 service` — a
								single-service line already reads fine unfolded and this
								predicate never fires for it, `heroServicesLabel` returns
								the bare name at length 1), with the full set moved to
								`Card`'s new `titleTooltip` so it is never actually lost,
								the same "fold in text, keep it in a title" idiom as the
								caption's own fold.
							-->
							<!--
								⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 2 — THE HERO IS
								FILTER-AWARE. `?q=hello-frontend` used to keep naming
								`hello-api-app` (a service the query excludes) and
								counting all 6 places into the rollup though only 3 of
								them belong to the matched service. `heroMatchedServices`
								is the same fallback idiom as `pendingServiceNames`: a
								query that names none of this row's services by NAME (a
								sha or a label search) still describes the whole line, so
								the full set survives rather than narrowing to nothing.
							-->
							{@const heroServices = heroMatchedServices(leadRow)}
							{@const heroNames = heroServices.map((s) => s.appName)}
							{@const heroFolds = heroNarrow && heroServices.length > 1}
							{@const heroTitleTail = heroFolds
								? `${heroServices.length} services`
								: heroServicesLabel(heroNames)}
							{@const heroTitle = `Newest build · ${heroTitleTail}`}
							{@const heroTitleTooltip = heroFolds
								? `Newest build · ${heroNames.join(' · ')}`
								: undefined}
							<!--
								⭐ ITEM 2, RESIDUE — READ THE MATCHED COUNT OFF `leadCov`'s OWN
								BUCKETS, NOT `RevisionService.liveSlots`. `liveSlots` counts only
								`onIt` (this row's EXACT release) — for `hello-frontend-app` on
								the held row that is 0, even though round 5's own ruling ("coverage
								counts the revision") counts those same 3 places as `live` because
								they run a SIBLING release of this commit. Summing `liveSlots`
								under-read `hello-frontend-app`'s own places as `0 of 3` where the
								page's one true coverage says `3 of 3` — the exact fixture that
								motivated this item. Filtering `leadCov`'s `live`/`failing` buckets
								by the matched service names agrees with `revisionCoverage` BY
								CONSTRUCTION on the unfiltered set (summing over every service is
								the bucket's own `liveCount`), and now also on a narrowed one.
							-->
							{@const heroMatchedNames = new Set(heroNames)}
							{@const heroMatchedLive = leadCov
								? leadCov.buckets
										.filter((b) => b.key === 'live' || b.key === 'failing')
										.reduce((n, b) => n + b.slots.filter((s) => heroMatchedNames.has(s.appName)).length, 0)
								: 0}
							{@const heroMatchedTotal = heroServices.reduce((n, s) => n + s.slots.length, 0)}
							{@const heroVerdict = leadCov
								? `${heroMatchedLive} of ${heroMatchedTotal} place${heroMatchedTotal === 1 ? '' : 's'}`
								: ''}
							<!--
								⭐ REVISIONS-2026-09-06, ITEM 1 — THE HERO IS A ROW, NOT A
								CARD, WHEN THE BAR IS OMITTED. Measured: a fully-covered
								hero (bar omitted) rendered as a 1167×152 card with
								111×61 of ink (9.5% fill) — the 24px sha the largest ink
								on the page, repeating the ledger 300px above. When
								coverage is 100% AND there is no held banner to explain
								(the banner is now drawn above the ledger footer — see
								`heldBanners` — so `heldGate` here is only ever the
								RARE case where a banner belongs beside THIS card, not
								the common one), the hero is its 47px header only:
								title, coverage rollup, `View commit ↗` in the header's
								right slot. No body — `padded={false}` and an empty
								child. Only the bar-drawn (shortfall) case keeps the
								full body; the held banner sits outside the disclosure
								(round 7), so a held line at full coverage is a row too.
							-->
							{@const compactHeroOnly = leadCov ? leadCov.liveCount === leadCov.totalCount : false}
							{#if leadCov}
								{#if compactHeroOnly}
									{@const heroHref = revisionPath(repo.repoKey, leadRow.revision)}
									<!--
										⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 1 — THE HERO NAMES
										ITS BUILD AND LINKS TO IT. Round 7 made this branch
										header-only (see the comment above) but its title read
										`Newest build · svc · svc` with no sha anywhere the
										reader could see — it survived only inside `View
										commit`'s `aria-label`, and the row did not navigate
										while every `.bld-row` on the page does. A reader could
										not tell this card and the ledger row two chips above it
										(`1 BEHIND 2.66.0-66`) were about the SAME commit.

										Hand-rolled rather than `<Card titleHref>`: the title
										needs its own `t-code` run around the sha, which `Card`'s
										plain-string `title` prop cannot carry. The geometry
										(47px, radius 8, `.tap-zone`/`.tap-link`) is copied from
										`Card`'s own header rather than a new invention.

										When this commit's sha carries more than one release and
										a SIBLING release is held (`heldGate`, computed above —
										the same predicate `heldBanners` uses, evaluated against
										this exact `leadRow`), the rollup names it:
										`6 of 6 places · 2.67.0-67 held` — `heldGate.appName`'s
										own label on THIS row, the same expression `heldBanners`'
										own `heldSubject` uses, so the two can never name a
										different release for the same fact.
									-->
									{@const heroAmbiguous = revisionReleaseCount(repo, leadRow.revision) > 1}
									{@const heroHeldLabel = heldGate
										? (leadRow.services.find((s) => s.appName === heldGate.appName)?.label ??
											leadRow.short)
										: null}
									{@const heroVerdictFull =
										heldGate && heroAmbiguous ? `${heroVerdict} · ${heroHeldLabel} held` : heroVerdict}
									<!--
										⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 3 — FOLD ON FIT,
										NOT ON 560. `heroNarrow`'s own `N services` fold is a
										coarse, JS-computed give-up below 560px container
										width; between 560 and ~1088 a repo whose line names
										three services (`hello-multi-app · hello-world-app ·
										hello-world-manifests`) still printed the full roster
										UNFOLDED there, and `Card`'s own `break-words` +
										`flex-wrap` let the rollup drop to its own line the
										moment title+rollup stopped both fitting — 65px against
										a two-name sibling header's 47px, same width, same
										card. `flex-nowrap` on the row plus `min-w-0 flex-1
										truncate` on the title (ellipsis, the full names still
										in the `title` attribute) means the title always yields
										first and the row never grows past one line; the rollup
										stays `shrink-0` and is never the thing that wraps.
									-->
									<!--
										⛔ ONLY ABOVE 560. Measured live at 390 with a single-
										service line (nothing left for `heroFolds` to fold, its
										own guard is `> 1`): `flex-nowrap` unconditionally
										ellipsised `Newest build 064b655 · hello-multi-app` down
										to two visible characters ("Ne…") to make room for the
										rollup and `View commit` on the SAME line — losing the
										sha item 1 exists to show, in the one width band that
										has genuine room to spare a whole second line for it.
										`heroNarrow` (the SAME 560px signal the JS fold already
										reads) switches the row back to `flex-wrap` there, so
										the rollup drops to its own line exactly as `Card`'s
										own header already does at 390 elsewhere in the
										product, and the title keeps the full width of that
										line to itself.
									-->
									<div
										class="tap-zone flex min-h-[47px] w-full items-center justify-between gap-x-2.5 gap-y-1 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/30 {heroNarrow
											? 'flex-wrap'
											: 'flex-nowrap'} {multiLine ? 'mb-4' : ''}"
									>
										<!--
											⭐ ITEM 3, RESIDUE — `flex-1`/`flex-basis:0%` ON THIS
											SPAN IS WHAT MAKES `flex-nowrap` WORK ABOVE 560 (it is
											what lets the title SHRINK to give the rollup room) —
											and it is exactly what defeats `flex-wrap` below 560.
											A `flex-basis:0%` item's HYPOTHETICAL size (what the
											wrap algorithm tests against the container) is 0
											regardless of its real content, so the row never
											wrapped even when the title's real text plainly did
											not fit — measured live, "Ne…" alongside the rollup
											rather than the rollup dropping to its own line the
											way plain `flex:0 1 auto` sizing (this span's shape
											below 560) lets it. Only applied `!heroNarrow`, to
											match the container's own `flex-nowrap`/`flex-wrap`
											switch one node up.
										-->
										<span
											class="flex min-w-0 items-center gap-2.5 {heroNarrow ? '' : 'flex-1'}"
										>
											<RocketSolid
												class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
												aria-hidden="true"
											/>
											<h2
												class="t-card-title min-w-0 flex-1 text-gray-900 dark:text-white"
												title={heroTitleTooltip ?? `Newest build · ${heroNames.join(' · ')}`}
											>
												<a class="tap-link hover:underline block truncate" href={heroHref}>
													Newest build <span class="t-code">{leadRow.short}</span> · {heroTitleTail}
												</a>
											</h2>
										</span>
										<!--
											⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 3 RESIDUE — THIS
											MUST CARRY `card-header-rollup`. `app.css`'s own rule
											(`.card-header-rollup .nav-link { padding: 0; line-height:
											16px; }`) is what keeps a `Card` header at 47px when its
											rollup slot holds a `.nav-link` — measured live, this
											hand-rolled row was 61.6px without it (`View commit`'s
											own `padding: 8px 0` block height, un-shrunk). Not a
											`Card` call site, but the identical rollup shape, so it
											gets the identical class.
										-->
										<span class="card-header-rollup flex shrink-0 items-center gap-2">
											<span
												class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400"
												title={scopeRecord(heroServices.length)}>{heroVerdictFull}</span
											>
											{#if commitUrlFor(repo.repoKey, leadRow.revision)}
												<a
													class="nav-link"
													href={commitUrlFor(repo.repoKey, leadRow.revision)}
													target="_blank"
													rel="noopener noreferrer"
													aria-label={`View the commit for ${leadRow.short} on GitHub — opens in a new tab`}
												>
													View commit
													<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
												</a>
											{/if}
										</span>
									</div>
								{:else}
									<Card
										icon={RocketSolid}
										title={heroTitle}
										titleTooltip={heroTitleTooltip}
										verdict={heroVerdict}
										verdictTitle={scopeRecord(heroServices.length)}
										class={multiLine ? 'mb-4' : ''}
									>
										<RevisionLead
											short={leadRow.short}
											href={revisionPath(repo.repoKey, leadRow.revision)}
											eyebrow="Newest build"
											coverage={leadCov}
											barPercent={livePercent(leadCov.liveCount, leadCov.totalCount)}
											hideBar={leadCov.liveCount === leadCov.totalCount}
											spread={false}
											compact
										>
											{#if rowNamesBuild(leadRow)}
												{#snippet meta()}
													{@render names(leadRow, true)}
												{/snippet}
											{/if}
											{#if commitUrlFor(repo.repoKey, leadRow.revision)}
												<a
													class="nav-link"
													href={commitUrlFor(repo.repoKey, leadRow.revision)}
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
								{/if}
							{/if}
						{/each}

						<div class="rev-cols mt-4">
							<div class="flex min-w-0 flex-col gap-4">
								<!--
									⭐ REVISIONS-2026-09-06, ITEM 5 (RULING 6) — A CARD WITH
									ZERO MATCHES UNDER A QUERY DOES NOT RENDER AT ALL, NOT
									EVEN ITS HEADER. Round 4's own item 1 already stopped the
									BODY printing anything ("liveVisible.length === 0" below),
									but the outer `<Card>` — header, rollup, `0 of N builds` —
									still drew, so a search left three empty boxes standing
									(one of them, `Never deployed`, with its retention caveat
									floating over zero rows). `repoNoMatch` already covers the
									whole-repo case; this is the same rule one card at a time:
									a search-active, zero-match, non-empty list draws nothing.
								-->
								<!--
									⭐ REVISIONS-2026-09-06, ITEM 7 — GATED ON MATCHED > 0,
									LIKE ITS SIBLINGS. This used to suppress only the
									"a search hid every row" shape (`liveAll.length > 0`),
									so a repo whose "Also still running" list is genuinely
									EMPTY (`liveAll.length === 0`) still drew a header-only
									card — `0 builds`, nothing below — the instant a search
									was active, while "No longer running anywhere" and
									"Never deployed" both vanish under the identical
									condition. `liveVisible.length === 0` alone covers both
									shapes; a search that matched nothing here draws nothing
									here, full stop.
								-->
								<!-- CARD 1 — THE QUIET PATH. -->
								{#if !(searchActive && liveVisible.length === 0)}
								<Card
										icon={CheckCircleSolid}
										title={visibleLeads.length > 0 ? 'Also still running' : 'Still running'}
										verdict={rollupLabel(liveVisible.length, liveAll.length, 'build')}
										verdictTitle="Older builds that some service is still running"
										padded={false}
									>
										<!--
											⭐ ROUND 3 §2 — NO FLEET SENTENCE WHILE A QUERY IS
											ACTIVE. `liveAll.length === 0` is true of the whole
											repo regardless of the search box; stating it while
											a search is narrowing the page reads as "there is
											nothing here" when the honest fact is "nothing here
											matches your search" — the branch below already says
											that.
										-->
										{#if liveAll.length === 0}
											<!--
												⭐ ROUND 4, ITEM B — A GENUINELY EMPTY LIST IS NEVER "EXPLAINED"
												BY THE SEARCH. This used to fall through to `noMatchText` while a
												search was active, telling the reader their query found nothing
												when the honest fact is there was never anything here to find at
												all. Say the real reason when not searching; say nothing while
												searching — the rollup already reads `0 builds`.
											-->
											{#if !searchActive}
												<!--
													⭐ REVISIONS-2026-09-06, ITEM 7 — ONE EMPTY-STATE
													TREATMENT, SHARED WITH "NEVER DEPLOYED"'S OWN
													(below). Unfiltered, this sentence used to be the
													only CENTRED text on the page — ink starting 166px
													right of every other left edge, on a page whose
													every other block (the ledger, the row lists, the
													head band) is flush left at the body edge. `px-4`
													matches `Card`'s own `p-4` body padding and every
													`.bld-row`'s own left inset, so this reads as the
													same column, not a different one. `emptyListText`
													is byte-identical at both call sites — literal text
													here, not passed through a snippet argument, so the
													message census (`lib/messages/scan.ts` walks
													template TEXT NODES, not function-call arguments)
													keeps pinning it.
												-->
												{#if visibleLeads.length > 0}
													<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
														Nothing older is still running — every place is on a build above.
													</p>
												{:else}
													<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
														Nothing this repo has deployed is still running. Every place has moved on.
													</p>
												{/if}
											{/if}
										{:else if liveVisible.length === 0}
											<!--
												⭐ ROUND 4, ITEM 1 — A CARD WITH ZERO MATCHES INSIDE A REPO THAT
												HAS A MATCH ELSEWHERE COLLAPSES TO ITS ROLLUP AND PRINTS NOTHING
												ELSE. `repoNoMatch` is guaranteed false here (it gates the whole
												disclosed block above), so some other section of this repo DID
												match — the repo-wide "no build matches" sentence belongs to the
												repository, once, not to every empty card inside it.
											-->
										{:else}
											<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
												{#each liveVisible as row (row.revision)}
													{@const cov = coverageByRevision.get(row)}
													{@const envSlots = liveEnvSlots(row)}
													<!-- ⭐ OPERATOR-WALK ITEM C — the laggard slot for this
													     row, computed once per row alongside its siblings
													     above; `{@const}` must sit directly under the
													     `{#each}`, not inside a plain element further down. -->
													{@const liveAge = slotAgeInfo(envSlots)}
													<li class="bld-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
														<span class="bld-mark">
															{#if cov}
																<BuildStateMark coverage={cov} showWord={false} />
															{/if}
														</span>

														<div class="min-w-0">
															<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
																<a
																	class="ident rev-sha tap-link t-code text-gray-900 hover:underline dark:text-white"
																	href={revisionPath(repo.repoKey, row.revision)}
																	title={row.revision}>{row.short}</a
																>
															</div>
															{@render names(row, namedLive, namesFoldToCount(row, lines))}
															<!--
																⭐ CRAFT REVIEW ITEM 7 — CELL 2 CARRIES WHERE
																TOO, not only who. The env chips this row runs
																on used to appear nowhere outside the ledger;
																cell 3 stays the count/bar/age rollup.
															-->
															{#if envSlots.length > 0}
																<div class="bld-envs">
																	{#each envSlots as slot (slot.envName)}
																		{@const envDisplay = shortEnvLabel(slot.cell.theme) || slot.envName}
																		<a
																			class="hit-32 shrink-0"
																			href={placeHref(slot)}
																			aria-label={`Open the ${envDisplay.toUpperCase()} rollout for ${slot.appName}`}
																		>
																			<Chip
																				role="env"
																				theme={slot.cell.theme}
																				label={envDisplay}
																				wide
																				title="Running in {envDisplay.toUpperCase()}"
																			/>
																		</a>
																	{/each}
																</div>
															{/if}
														</div>

														<div class="bld-roll">
															<span class="t-dense text-gray-700 dark:text-gray-200">
																Running in {row.liveSlots} of {row.totalSlots}
																<span class="text-gray-500 dark:text-gray-400">places</span>
															</span>
															{#if cov && cov.liveCount < cov.totalCount}
																<div
																	class="bld-fill-track"
																	role="img"
																	aria-label="running in {cov.liveCount} of {cov.totalCount} places"
																	title="running in {cov.liveCount} of {cov.totalCount} places"
																>
																	<div
																		class="bld-fill"
																		style="width: {livePercent(cov.liveCount, cov.totalCount)}%"
																	></div>
																</div>
															{/if}
															<!--
																⛔ REVISIONS-2026-09-06, ITEM 3 — THE MOST RECENT
																DEPLOY, NAMED. Supersedes the laggard-first age
																this comment used to describe: after a pin clear
																the row read `Deployed 6d ago · STAGING` while DEV
																had deployed 2 minutes earlier. `slotAgeInfo`
																(computed above, alongside `envSlots`) now picks
																the NEWEST deploy; the environment is only named
																when `envsAgreeWithinMinute` says the dates
																actually disagree (`hello-world-manifests`'
																three environments land within the same minute
																and naming one of them would claim a distinction
																that is not there). `slotAgeTitle` lists every
																environment's own date for the hover/long-press,
																unconditionally.
															-->
															<time
																class="t-micro mt-1 block text-gray-500 dark:text-gray-400"
																datetime={liveAge ? new Date(liveAge.ms).toISOString() : ageIso(row, 'live')}
																title={envSlots.length > 0
																	? slotAgeTitle(envSlots)
																	: ageTitle(row, 'live')}
																>{#if liveAge}Deployed {formatTimeAgoCompact(
																		new Date(liveAge.ms).toISOString(),
																		$now
																	)} ago{envsAgreeWithinMinute(envSlots) ? '' : ` · ${liveAge.envLabel.toUpperCase()}`}{:else}{ageOf(
																		row,
																		'live'
																	)}{/if}</time
															>
														</div>

														<span class="bld-go" aria-hidden="true">
															<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
														</span>
													</li>
												{/each}
											</ul>
										{/if}
									</Card>
								{/if}

									<!-- CARD 2 — HISTORY. -->
									{#if pastAll.length > 0 && !(searchActive && pastVisible.length === 0)}
										<Card
											icon={ArchiveSolid}
											title="No longer running anywhere"
											verdict={rollupLabel(pastVisible.length, pastAll.length, 'build')}
											verdictTitle="Deployed at least once; every place that ran them has since moved on"
											padded={false}
										>
											{#if pastVisible.length === 0}
												<!-- ⭐ ROUND 4, ITEM 1 — see the "Still running" card above: this
												     branch only fires when a search hid every row, and the repo
												     has a match elsewhere. Nothing prints; the rollup already
												     reads `0 of N`. -->
											{:else}
												<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
													{#each expandPast[repo.repoKey] ? pastVisible : pastVisible.slice(0, compactFold) as row (row.revision)}
														{@const pastCov = coverageByRevision.get(row)}
														<li class="bld-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
															<!--
																⭐ CRAFT REVIEW ITEM 6 — A RETIRED ROW GETS ITS
																LAST BUILD-STATE MARK, not an empty 16px cell.
																Reads off the SAME coverage the live list uses
																— `coverageByRevision` now covers every
																deployed row, not only the live ones.
															-->
															<span class="bld-mark">
																{#if pastCov}
																	<BuildStateMark coverage={pastCov} showWord={false} />
																{/if}
															</span>
															<div class="min-w-0">
																<a
																	class="ident rev-sha tap-link t-code text-gray-700 hover:underline dark:text-gray-200"
																	href={revisionPath(repo.repoKey, row.revision)}
																	title={row.revision}>{row.short}</a
																>
																{@render names(row, namedPast, namesFoldToCount(row, lines))}
															</div>
															<div class="bld-roll">
																<time
																	class="t-micro block text-gray-500 dark:text-gray-400"
																	datetime={ageIso(row, 'past')}
																	title={ageTitle(row, 'past')}>{ageOf(row, 'past')}</time
																>
															</div>
															<span class="bld-go" aria-hidden="true">
																<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
															</span>
														</li>
													{/each}
												</ul>
												{#if pastVisible.length > compactFold}
													{@render more(
														() => (expandPast = { ...expandPast, [repo.repoKey]: !expandPast[repo.repoKey] }),
														expandPast[repo.repoKey],
														`${pastVisible.length - compactFold} older build${pastVisible.length - compactFold === 1 ? '' : 's'}`
													)}
												{/if}
											{/if}
										</Card>
									{/if}
								</div>

								<div class="flex min-w-0 flex-col gap-4">
									<!-- THE RAIL — builds nobody has taken. Part of the
									     layout: renders even at zero (§ "States") — UNLESS a
									     search has narrowed it to zero matches (item 5, ruling
									     6), which is a different fact ("nothing here matches",
									     not "this repo has never left anyone behind"). -->
									{#if !(searchActive && pendingVisible.length === 0 && repo.pending.length > 0)}
									{@const pendingRange = pendingBatchRange(
										pendingVisible.filter((r) => pendingColliding.has(r.revision))
									)}
									<!--
										⭐ REVISIONS-2026-09-06, ITEM 11 — ONE FACT ONCE. The
										subtitle used to say "beyond the last N deploys" AND
										the body caveat below said "History keeps the last N
										deploys per service …" — the same retention fact, 40px
										apart. The caveat stays (it is the only one that is
										actually READ without a hover); the subtitle goes back
										to a plain count, with the batch range (when there is
										one worth naming) taking its place instead.
									-->
									<!--
										⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 13 — THE SUBTITLE
										STATES ITS OWN ORDER. `repo.pending` is newest-first by
										the SAME comparator `repo.rows` uses (`RepoLedger`'s own
										contract) — a fact a reader has to take on faith today,
										since nothing on the card says so. Named once, between
										the count and the batch range: `24 builds · newest first
										· built Aug 29, 10:20–11:17`.
									-->
									<Card
										icon={HourglassOutline}
										title="Never deployed"
										verdict={rollupLabel(pendingVisible.length, repo.pending.length, 'build') +
											' · newest first' +
											(pendingRange ? ` · ${pendingRange}` : '')}
										verdictTitle={PENDING_RECORD}
										padded={false}
									>
										<!--
											⭐ ROUND SIX §2 — "NEVER DEPLOYED" IS BOUNDED BY
											RETENTION. At least one service here has already
											evicted an older deploy from its own history, so
											this list's count is a floor, not a fact: some of
											these builds may have run once, before this page
											could see it.
										-->
										{#if historyLimit.atLimit}
											<p
												class="t-micro border-b border-gray-100 px-4 py-2 text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
											>
												{HISTORY_LIMIT_NOTE(historyLimit.limit)}
											</p>
										{/if}
										{#if repo.pending.length === 0}
											<!-- ⭐ ITEM 7 — the same treatment as "Also still
											     running"'s own empty state, above: literal text,
											     left-aligned, `emptyListText`'s own class list. -->
											<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
												Every build your services can deploy has run somewhere.
											</p>
										{:else if pendingVisible.length === 0}
											<!-- ⭐ ROUND 4, ITEM 1 — see the "Still running" card: a search hid
											     every row here while the repo matched elsewhere. Nothing
											     prints; the rollup already reads `0 of N`. -->
										{:else}
											<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
												{#each expandPending[repo.repoKey] ? pendingVisible : pendingVisible.slice(0, compactFold) as row (row.revision)}
													<!--
														⭐ REVISIONS-2026-09-06, ITEM 9(a)/11 — MUST SIT
														DIRECTLY UNDER THE `{#each}` (Svelte's own
														`{@const}` placement rule), not nested inside the
														row further down where it is actually used.
													-->
													{@const svcNames = matchedServiceNames(row)}
													<li class="bld-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
														<!--
															⭐ CRAFT REVIEW ITEM 6 — NEVER DEPLOYED GETS THE
															HOURGLASS, the card's own icon: "built, still
															waiting" is true of every row in this list, not a
															per-row guess.
														-->
														<span class="bld-mark">
															<HourglassOutline
																class="h-4 w-4 text-gray-400 dark:text-gray-500"
																aria-hidden="true"
															/>
														</span>
														<a
															class="ident rev-sha tap-link t-code min-w-0 text-gray-700 hover:underline dark:text-gray-200"
															href={revisionPath(repo.repoKey, row.revision)}
															title={row.revision}>{row.short}</a
														>
														<div class="bld-roll">
															{@render bldSvcNames(svcNames)}
															<time
																class="t-micro block text-gray-500 dark:text-gray-400"
																datetime={ageIso(row, 'pending')}
																title={ageTitle(row, 'pending')}
																>{pendingAgeText(row, pendingColliding)}</time
															>
														</div>
														<span class="bld-go" aria-hidden="true">
															<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
														</span>
													</li>
												{/each}
											</ul>
											{#if pendingVisible.length > compactFold}
												{@render more(
													() =>
														(expandPending = {
															...expandPending,
															[repo.repoKey]: !expandPending[repo.repoKey]
														}),
													expandPending[repo.repoKey],
													`${pendingVisible.length - compactFold} more build${pendingVisible.length - compactFold === 1 ? '' : 's'}`
												)}
											{/if}
										{/if}
									</Card>
									{/if}
								</div>
							</div>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

{#snippet more(toggle: () => void, open: boolean | undefined, label: string)}
	<!-- `Show 8 ready resources ›` — the reference's progressive-disclosure
	     control, verbatim in form. -->
	<button
		type="button"
		class="flex w-full items-center gap-1.5 border-t border-gray-100 px-4 py-2.5 text-left text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700/60 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-gray-200"
		onclick={toggle}
	>
		{#if open}
			<ChevronDownOutline class="h-3.5 w-3.5 shrink-0" />
			Hide {label}
		{:else}
			<ChevronRightOutline class="h-3.5 w-3.5 shrink-0" />
			Show {label}
		{/if}
	</button>
{/snippet}

{#snippet names(row: RevisionRow, named: boolean, foldServices: boolean = false)}
	{#if foldServices}
		<!--
			⭐ ROUND 4a, ITEM F — `namesFoldToCount`'s own doc comment: this row's
			services ARE the release line's full set, so naming them again is
			the same three names the section header (or the hero above it)
			already printed.

			⛔ REVISIONS-2026-09-06 ROUND 8, ITEM 7 — ONE RULE FOR THE `.bld-row`
			SERVICES CELL. This branch used to print a bare, UNFILTERED
			`row.services.length` with no names anywhere but a `title` — under
			`?q=hello-multi` it kept saying `3 services` while "Never deployed"
			(the rail's own count-or-names cell) correctly narrowed to `1
			service hello-multi-app`. `bldSvcNames` is the one shared rule now:
			the filtered count (`matchedServiceNames`), full names when the
			container is wide enough to hold them, and — below that — the count
			is `RulePopover`'s own tap/keyboard disclosure rather than a label
			only a mouse could ever read.
		-->
		{@render bldSvcNames(matchedServiceNames(row))}
	{:else}
		<span class="rev-names {named ? '' : 'rev-names--unnamed'}">
			{#each row.labelGroups as g (g.label)}
				<span class="rev-name-row">
					{#if named && rowNamesBuild(row)}<span
							class="rev-name t-code-sm text-gray-900 dark:text-white"
							title={g.isOwnSha
								? `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this build under its own sha`
								: `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this build as ${g.label}`}
							>{g.label}</span
						>{/if}
					<span class="rev-name-svcs">
						{#each g.services as svc, i (svc.appName)}
							<span class="rev-svc">
								<span class="rev-svc-name t-body text-gray-700 dark:text-gray-200"
									>{#each identParts(svc.appName) as part, pi (pi)}{part}{#if pi < identParts(svc.appName).length - 1}<wbr
											/>{/if}{/each}</span
								>
								{#if svc.diverged}
									<Chip
										role="diverged"
										label={rankLabel({ kind: 'diverged' })}
										class="shrink-0"
										title="{svc.appName} lists this build on no environment’s release list"
									/>
								{/if}
								{#if i < g.services.length - 1}<span
										class="rev-sep t-body text-gray-500 dark:text-gray-400"
										aria-hidden="true">·</span
									>{/if}
							</span>
						{/each}
					</span>
				</span>
			{/each}
		</span>
	{/if}
{/snippet}

{#snippet bldSvcNames(svcNames: string[])}
	<!--
		⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 7 — THE ONE `.bld-row` SERVICES-CELL
		RULE, shared by "No longer running anywhere", "Still running" and
		"Never deployed": full names print when the row's own container can
		hold them (≥768, `.bld-svc-full`'s own container query below); under
		that width the count is no longer a `title`-only dead label — it is
		`RulePopover`'s own disclosure (the same primitive the ledger's age
		popover uses), reachable by tap and by keyboard, listing every
		MATCHED name (the caller already filtered `svcNames` by the active
		search — see `matchedServiceNames`).
	-->
	<span class="bld-svc-names t-dense block text-gray-700 dark:text-gray-200">
		<span class="bld-svc-full">{svcNames.join(' · ')}</span>
		<span class="bld-svc-count">
			{#snippet svcCountTrigger()}
				{svcNames.length} service{svcNames.length === 1 ? '' : 's'}
			{/snippet}
			<RulePopover count={svcNames.length} noun="service" trigger={svcCountTrigger}>
				<ul class="flex flex-col gap-1">
					{#each svcNames as n (n)}
						<li class="t-body text-gray-700 dark:text-gray-200">{n}</li>
					{/each}
				</ul>
			</RulePopover>
		</span>
	</span>
{/snippet}

<style>
	/*
	 * GEOMETRY AND THE TWO GLYPH INKS ONLY. Everything else stays in utilities,
	 * per the `app.css` layering note: a Svelte-scoped rule outranks a Tailwind
	 * utility, so anything declared here is un-overridable from the markup.
	 */

	/* THE REPOSITORY CARD IS ITS OWN QUERY SUBJECT — the ledger's own
	   breakpoint (`.svc-line`, below) queries THIS box, not the viewport. */
	.repo-card {
		container-type: inline-size;
	}

	/*
	 * ⭐ THE SERVICE LEDGER — §7(a). ONE SHARED GRID for every line in every
	 * group in this repo, so `minmax(120px,180px)` resolves to the SAME
	 * pixel width down the whole ledger — the same problem, and the same
	 * fix, `FleetSpread.svelte`'s own `.fs-runs`/`display:contents` already
	 * solved: CSS Grid tracks are scoped to one grid CONTAINER, so a grid
	 * per LINE would size its name column from that line's own content
	 * alone and land at a different x than its neighbours.
	 *
	 * ⭐ ROUND 4, ITEM 4 — RANK AND SHA ARE ONE COLUMN NOW, NOT TWO. The
	 * fixed-90px rank track this comment used to defend is gone along with
	 * `.svc-rank`: joining the rank chip to the build's own sha as `Chip`'s
	 * `value` (so the product's rank glyph actually draws — see the
	 * markup) also means the two facts are ONE cell, `minmax(150px,
	 * max-content)` — wide enough for the joined chip's own widest legal
	 * member plus a seven-character sha, sized ONCE per grid the same way
	 * the old fixed 90px was, for the same reason: two repos on the same
	 * page must not compute two different pixel widths for the same kind
	 * of cell.
	 *
	 * ⭐ ROUND 4, ITEMS 7/9 — THE ENV TRACK IS `max-content`, NOT `1fr`.
	 * Measured live: `1fr` let this track stretch to whatever the page's
	 * own width happened to be — 655px with 182px of actual chip ink (28%)
	 * — leaving a hole in the MIDDLE of the row, before the age cell ever
	 * got a chance to use the space. Sized to its own content, any slack
	 * moves to the LAST column instead (`.svc-age`, below), which is a
	 * right-aligned, already-blank margin rather than a gap between two
	 * facts.
	 *
	 * ⛔ THE 16px GLYPH CELL IS GONE (round 3 addendum I). The old per-row
	 * status dot moved to a `Chip` beside the env chips, drawn only for a
	 * deviation (§3) — there is nothing to reserve a leading column FOR any
	 * more, and addendum D's own complaint (49% ink at 1440) is one column
	 * lighter for it.
	 *
	 * ⛔ REVISIONS-2026-09-06 ROUND 8, ITEM 5 — `max-content`/`minmax(…,
	 * max-content)` TRACKS DO NOT ALIGN ACROSS REPOSITORIES. Each `.svc-ledger`
	 * is its OWN grid container (one per `.repo-card`), so a content-sized
	 * track is sized from THAT repo's own rows alone — measured live,
	 * `kuberik-testing`'s env track started at x=581 and `kuberik-testing-
	 * second`'s at x=571, ages at 790 vs 732: two repositories on one page,
	 * two different pixel grids, so shas and chips never lined up down the
	 * whole page the way a shared column vocabulary implies they should.
	 * Fixed lengths (not `max-content`) for the build and env tracks make
	 * every `.svc-ledger` on the page compute the SAME three column widths
	 * regardless of which repo's content happens to be longest; a name or a
	 * chip run that does not fit its own track wraps (`.svc-name`'s existing
	 * `<wbr>`, `.svc-build`/`.svc-envs`'s existing `flex-wrap`) rather than
	 * silently resizing the shared grid.
	 */
	.svc-ledger {
		display: grid;
		grid-template-columns: 180px 190px 220px minmax(0, 1fr);
		column-gap: 12px;
		row-gap: 0;
		padding-inline: 16px;
	}

	/*
	 * ⭐ ROUND SIX §3 — CAP THE LEDGER'S OWN MEASURE, DELIBERATELY, PAST 1800.
	 * ⭐ ROUND 4, ITEMS 7/9 — the env column no longer stretches (see the
	 * grid definition above), so THIS cap now bounds only the trailing age
	 * column's own slack on an ultrawide monitor — the same reason it
	 * existed originally, one column over.
	 */
	@media (min-width: 1800px) {
		.svc-ledger {
			max-width: 1200px;
		}
	}

	.svc-line {
		display: contents;
	}

	/*
	 * ⭐ ROUND 4a, ITEM E — THE WRAPPER IS TRANSPARENT TO THE DESKTOP GRID.
	 * `display: contents` here means `.svc-name` and `.svc-age-header`
	 * (below) place into the top-level `.svc-ledger` grid exactly as if this
	 * span were not there — columns 1 and (nothing, it stays hidden) at
	 * this width. Only the <560 query turns it into a real flex row.
	 */
	.svc-header {
		display: contents;
	}

	.svc-name {
		grid-column: 1;
		padding-block: 6px;
		min-width: 0;
	}

	/*
	 * ⭐ ROUND 3 §2 — THE NAME IS A LINK NOW, NOT A FILTER. The per-repo chip
	 * strip this cell used to double as is retired (search is the one
	 * filter); `.tap-link` alone (outside any `.tap-zone`) is what gives it
	 * `app.css`'s standalone 32px hit-slop, so no bespoke button geometry is
	 * needed here any more.
	 */
	.svc-name-continuation {
		display: none;
	}

	/*
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 9 — THE CAPTION (`.svc-line-caption`,
	 * "1.66.0-66 · 2.67.0-67") IS DELETED. Its meaning now lives elsewhere:
	 * the hero's own title names the release line, an ambiguous row's joined
	 * chip prints the release label in place of the bare sha, and the held
	 * banner names the release it is about — a fourth restatement 8px above
	 * rows that already carried the same fact. The group boundary between two
	 * release lines is an 8px gap now and only that — the product's own
	 * spacing-scale step (`lib/CLAUDE.md`'s `2/4/6/8/10/12/16/24`), no text,
	 * no border: alignment alone (the next group's own name/sha/env columns)
	 * is what says "new line" here.
	 */
	.svc-line-gap {
		grid-column: 1 / -1;
		height: 8px;
	}

	/*
	 * ⭐ ROUND 4, ITEM 4 — `.svc-build` IS THE JOINED-CHIP CELL, `.svc-sha`
	 * SURVIVES ONLY FOR THE PLAIN-LINK FALLBACK (`line.rank === null`).
	 * `.svc-sha` carries a `position: relative` + `::before` hit-slop below,
	 * generated on the ANCHOR itself, which is the one shape that technique
	 * works on.
	 *
	 * ⛔ REVISIONS-2026-09-06 ROUND 8, ITEM 6 — `.svc-build` IS NOW THE ONE
	 * GRID ITEM FOR THIS COLUMN, ALWAYS. Both branches (the joined rank chip
	 * and the plain-sha fallback) render inside it now, followed by an
	 * optional state chip (HELD/PINNED/STUCK/failing) moved out of
	 * `.svc-envs` — see the markup's own note. `.svc-sha` no longer carries
	 * its own `grid-column`/`padding-block`: it is a flex CHILD of
	 * `.svc-build` now, not a grid item in its own right, and doubling the
	 * vertical padding on both boxes would have made the plain-sha row
	 * taller than its joined-chip sibling.
	 */
	.svc-build {
		grid-column: 2;
		padding-block: 6px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.svc-build-id {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	/*
	 * ⭐ REVISIONS-2026-09-06, ITEM 9 — THE SHA COLUMN RAGS BECAUSE THE RANK
	 * HALF IS AUTO-WIDTH. Measured live: `NEWEST` renders 67.8px, `1 BEHIND`
	 * 81.4px — the joined chip's label half sizes to its own text, so every
	 * row's sha starts wherever ITS OWN rank word happened to end, 13.6px
	 * off its neighbours. A `min-width` sized to the longest ordinary rank
	 * word in this family (`N BEHIND` up to two digits) fixes the common
	 * case without touching `Chip.svelte` (a shared component this pass does
	 * not own) — a three-digit behind count is rare enough, and short
	 * enough of a re-rag, to accept rather than solve with a `ch`-based
	 * formula that would also have to special-case `NEWEST`. Scoped to
	 * `.svc-build-id` (ITEM 6) so the min-width applies to the rank+sha chip
	 * only, never to the optional state chip appended beside it.
	 */
	.svc-build-id :global(.chip) {
		min-width: 84px;
	}

	.svc-envs {
		grid-column: 3;
		padding-block: 6px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	/*
	 * ⭐ ROUND SIX §3 — THE FOURTH COLUMN. Right-aligned, `nowrap` (`Deployed
	 * 1d ago` is short and this is the one cell in the row that should never
	 * wrap onto a second line and disturb every sibling line's own height).
	 * `.svc-age-header` is the SAME fact, rendered a second time for the
	 * <560 container query below, hidden here so nothing prints twice.
	 *
	 * ⭐ ROUND 4, ITEMS 7/9 — THIS COLUMN NOW TAKES THE SLACK the env track
	 * used to (`minmax(0, 1fr)` moved here from `.svc-envs`), so a row with
	 * few env chips gets extra BLANK MARGIN after its own timestamp instead
	 * of a hole in the middle of the row before the timestamp is ever
	 * reached.
	 *
	 * ⭐ REVISIONS-2026-09-06 ROUND 8, ITEM 4 — RIGHT-ALIGNED AGAIN, AND THIS
	 * TIME IT DOES NOT REOPEN ROUND-6 ITEM 9's OWN DEFECT. Item 9's complaint
	 * was a 471px gap BETWEEN the env chips and the timestamp, produced by an
	 * env track that was itself `max-content` and therefore never in the same
	 * place twice; item 5 (above, `.svc-ledger`'s own comment) fixes that
	 * track to a constant width instead, so right-aligning the age no longer
	 * separates it from the chips it describes — it aligns it with the
	 * card's own content edge, the same edge the header rollup and the
	 * footer's `View repository` already sit flush against, at 439px (38% at
	 * 1440) of otherwise-dead trailing space that a left-aligned age spent
	 * doing nothing. The popover trigger (`RulePopover`, unchanged below)
	 * still opens from the same `<time>`.
	 */
	.svc-age {
		grid-column: 4;
		padding-block: 6px;
		padding-left: 12px;
		text-align: right;
		white-space: nowrap;
	}

	/*
	 * ⭐ ROUND 4a, ITEM E — TWO NODES, ONE FACT, DELIBERATELY NOT MERGED INTO
	 * ONE (the same idiom `.svc-name`/`.svc-name-continuation` and
	 * `.svc-age`/its <560 twin already used). A width-based duplicate-text
	 * report reads both `.svc-age` and `.svc-age-header`'s `textContent`
	 * regardless of `display`, but a real screen reader (and `innerText`)
	 * already sees only the one CSS shows — `display: none` removes an
	 * element from the accessibility tree, so there is no ACTUAL duplicate
	 * announcement at any one width. Hidden here (desktop); shown at <560
	 * beside the name instead of crammed onto the env-chip line, which is
	 * what made that row wrap to a fourth line.
	 */
	.svc-age-header {
		display: none;
	}

	/* NO LIVE SLOT — one line: the name, then the fact, spanning the rest of
	   the row so it never pretends to be a build id. */
	.svc-empty {
		grid-column: 2 / -1;
		padding-block: 6px;
	}

	/*
	 * ⭐ ROUND 4a, ITEM E — THREE FULL-WIDTH ROWS, THE AGE ON THE FIRST ONE.
	 * (Supersedes round 3 addendum E's three-row stack, which put the age on
	 * the THIRD row beside the env chips — measured live, that crowded row
	 * wrapped to a fourth line the moment a service carried more than one or
	 * two env chips, which is the common case: `NEWEST 064b655 [DEV]
	 * [STAGING] [PROD] 1d ago` does not fit 358px of content box.) The stack
	 * is now: (1) `.svc-header` — name, age right-aligned; (2) rank chip +
	 * sha; (3) env chips + state chip, nothing else competing for the line.
	 */
	@container (max-width: 560px) {
		.svc-ledger {
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 8px;
			row-gap: 2px;
		}

		/*
		 * ⭐ ITEM E — THE WRAPPER BECOMES A REAL FLEX ROW, spanning both
		 * tracks, with the name growing and the age pinned to the right
		 * edge. `align-items: baseline` keeps the link's text and the
		 * `<time>`'s smaller `t-micro` sitting on one text baseline rather
		 * than one looking vertically centred against the other.
		 */
		.svc-header {
			display: flex;
			grid-column: 1 / -1;
			align-items: baseline;
			justify-content: space-between;
			gap: 8px;
		}

		.svc-name-continuation {
			display: block;
		}

		.svc-age-header {
			display: inline;
			flex-shrink: 0;
			white-space: nowrap;
		}

		/* ⭐ ROUND 4, ITEM 4 — `.svc-build` folds beside `.svc-sha` here: the
		   joined-chip cell and the plain-link fallback are mutually exclusive
		   per line and share the same fold position. */
		.svc-build {
			grid-column: 1;
		}

		.svc-envs,
		.svc-empty {
			grid-column: 1 / -1;
			padding-top: 0;
		}

		/*
		 * ⭐ ROUND 4a, ITEM E — THE STANDALONE FIFTH COLUMN HAS NOWHERE TO
		 * SIT once the grid folds to two tracks; `.svc-header`'s own
		 * `.svc-age-header` carries the fact instead now (line 1, not line
		 * 3 — see this query's own header comment).
		 */
		.svc-age {
			display: none;
		}

		/*
		 * ⭐ COORDINATOR FOLLOW-UP 5 — THE META LINE WRAPS, THE LINK DROPS.
		 * `truncate`'s three properties are Tailwind utilities; this scoped
		 * rule outranks them (`app.css`'s layering note), so overriding all
		 * three here — not just adding `flex-wrap` — is what actually lets
		 * the text wrap instead of clipping against `View repository`.
		 */
		.repo-meta {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}

		.repo-meta-text {
			white-space: normal;
			overflow: visible;
			text-overflow: clip;
		}
	}

	/* THE 860px RAIL, AS A CONTAINER QUERY — §"Breakpoints": the product's
	   ONE rail number (`.apps-split`/`.env-split`/`.ab-grid`), moved off a
	   1024px MEDIA query because the rail (340px) needs the same folded
	   `.bld-row` form the phone gets, regardless of the viewport around it. */
	.rev-shell {
		container-type: inline-size;
	}

	.rev-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}

	@container (min-width: 860px) {
		.rev-cols {
			grid-template-columns: minmax(0, 1fr) 340px;
		}
	}

	/*
	 * ⭐ `.bld-row` — §3. ONE ROW GRAMMAR for all three build lists, the
	 * TRACKS identical everywhere so ids line up down the whole page; cards
	 * differ only in which cells they fill in. Replaces `.rev-row` /
	 * `.rev-row--quiet` / the pending rail's bespoke flex row.
	 *
	 * ⭐ REVISIONS-2026-09-06, ITEM 8 — THE MEASURE IS CAPPED, DELIBERATELY.
	 * Measured live on the wide (non-rail) column: `0afab6f` ended at x=317
	 * and `Last deployed 20m ago` started at x=854 — 537px of nothing, 66% of
	 * the row, because column 2 is `minmax(0, 1fr)` and stretches to whatever
	 * width the card happens to have. `max-width: 46rem` caps the row's own
	 * content measure so the age sits within one reading distance of the id
	 * at every container width; the rail column (340px) is already narrower
	 * than this and is unaffected.
	 */
	.bld-row {
		position: relative;
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 200px 16px;
		gap: 12px;
		padding: 10px 16px;
		align-items: start;
		max-width: 46rem;
	}

	.bld-mark {
		display: flex;
		align-items: center;
		height: 20px;
	}

	.bld-roll {
		text-align: right;
		min-width: 0;
	}

	/*
	 * ⭐ REVISIONS-2026-09-06, ITEM 9(a) — "N SERVICES" PRINTS THE NAMES WHEN
	 * THE ROW'S OWN CONTAINER CAN HOLD THEM. The nearest `container-type`
	 * ancestor here is `Card`'s own `.card-cq` (`Card.svelte`), so this reads
	 * the CARD's rendered width — 340px on the desktop rail, its own repo
	 * card's full width once the layout has folded to one column — never the
	 * viewport, which is what makes 390 and a stacked 1024 agree.
	 */
	.bld-svc-full {
		display: none;
	}

	@container (min-width: 768px) {
		.bld-svc-count {
			display: none;
		}

		.bld-svc-full {
			display: inline;
		}
	}

	/*
	 * ⭐ ROUND 3 ADDENDUM A / ITEM 8 — THE CHEVRON WAS DEAD. Both this glyph
	 * and `.tap-zone .tap-link::after` (`app.css`) are `position: absolute`
	 * with `z-index: auto`, so CSS's own painting order falls back to DOM
	 * order among them — and `.bld-go` is the LAST child of the row, after
	 * the `.tap-link` it is meant to sit visually beside, so it painted (and
	 * hit-tested) ON TOP of the overlay that is supposed to make the whole
	 * row clickable. `elementFromPoint` at the glyph returned the bare `path`
	 * with no anchor ancestor — a click there hit a decorative, aria-hidden
	 * `<span>` with no handler and went nowhere. It is purely decorative
	 * (`aria-hidden="true"`, no click handler of its own), so it must never
	 * intercept a pointer event; `.tap-link`'s overlay underneath is what
	 * actually owns the click.
	 */
	.bld-go {
		position: absolute;
		right: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		pointer-events: none;
	}

	/*
	 * ⭐ CRAFT REVIEW ITEM 7 — CELL 2 CARRIES WHERE, NOT ONLY WHO. Measured
	 * live: `.bld-row`'s cell 2 was 543px wide with ~130px of actual ink
	 * (the sha + names) — the rest was empty because the one other fact a
	 * reader wants here, WHICH PLACES this build runs, was nowhere on the
	 * row at all. `flex-wrap` so a build running in many places wraps
	 * inside this cell rather than pushing the row wider.
	 */
	.bld-envs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}

	/*
	 * ⭐ CRAFT REVIEW ITEM 1 — THE SAME PAINTED-TRACK FILL AS THE HERO'S
	 * `.single-bar` (`RevisionLead.svelte`), sized to THIS row's own
	 * geometry (it sits in a 200px `.bld-roll` column at rest, full width
	 * once the container query below folds it under the count). One
	 * spelling for "one fill, exact width" product-wide on this page —
	 * never `<CoverageBar>`'s `flex:1` cells again, which drew "1 of 9"
	 * and "8 of 9" as the identical fully-filled bar.
	 */
	.bld-fill-track {
		height: 6px;
		border-radius: 4px;
		overflow: hidden;
		background-color: var(--color-gray-200);
		margin-top: 6px;
	}

	:global(.dark) .bld-fill-track {
		background-color: var(--color-gray-700);
	}

	.bld-fill {
		height: 100%;
		border-radius: inherit;
		background-color: var(--color-green-700);
	}

	:global(.dark) .bld-fill {
		background-color: var(--color-green-600);
	}

	/*
	 * ⭐ REFLOW IS BY CONTAINER, NOT VIEWPORT — §3. The rail Card is 340px at
	 * every viewport (it sits in `.rev-cols`' fixed second track), so it
	 * needs this same two-band form AT 1440, not only below 640: a media
	 * query keyed to the viewport would never fire for it.
	 */
	@container (max-width: 560px) {
		.bld-row {
			grid-template-columns: 16px minmax(0, 1fr) 16px;
			gap: 8px 12px;
		}

		.bld-roll {
			grid-column: 2;
			text-align: left;
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 4px 12px;
		}

		.bld-fill-track {
			width: 100%;
			margin-top: 0;
		}

		.rev-name-row {
			grid-template-columns: minmax(0, 1fr);
			column-gap: 0;
		}

		.rev-name,
		.rev-name-svcs {
			grid-column: 1;
		}
	}

	/*
	 * THE NAMES CELL — a stack of lines, each line a two-track grid. 84px,
	 * and it is a COLUMN, not a gap — unchanged from the round that shipped
	 * it (`minmax(84px, max-content)` rather than a hard 84px, so a longer
	 * label pushes its own line rather than ellipsising into another).
	 */
	.rev-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin-top: 2px;
	}

	.rev-name-row {
		display: grid;
		grid-template-columns: minmax(84px, max-content) minmax(0, 1fr);
		column-gap: 12px;
		align-items: baseline;
		min-width: 0;
	}

	.rev-name {
		grid-column: 1;
		white-space: nowrap;
	}

	.rev-name-svcs {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 8px;
		min-width: 0;
	}

	.rev-names--unnamed .rev-name-row {
		grid-template-columns: minmax(0, 1fr);
		column-gap: 0;
	}

	.rev-names--unnamed .rev-name-svcs {
		grid-column: 1;
	}

	.rev-svc {
		display: flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
	}

	.rev-svc-name {
		min-width: 0;
		white-space: normal;
		overflow-wrap: normal;
	}

	/*
	 * ⭐ CRAFT REVIEW ITEM 13 — THE LEDGER'S SHA GETS AN UNCONDITIONAL 32px
	 * HIT BOX. `app.css`'s own `.rev-sha` slop only fires under `(pointer:
	 * coarse), (max-width: 639px)` — correct as the GENERAL rule (a mouse
	 * on a wide desktop window is deliberately excluded there) — but
	 * measured live `.svc-sha` renders 15px tall, one grid cell from a rank
	 * chip and env chips, with no `.tap-zone` around the row to fall back
	 * on (`.svc-line` is a plain grid row, not a tap zone — the row itself
	 * is not a single destination, since the ledger's OWN destination is
	 * the sha, the rank chip's title, and the pressable name, three
	 * different things).
	 *
	 * ⛔ SCOPED TO `.svc-sha`, NOT THE SHARED `.rev-sha` CLASS. `app.css`'s
	 * own `.tap-zone .tap-link::after` mechanism deliberately keeps
	 * `.tap-link` itself UNPOSITIONED ("giving it a z-index would make it
	 * a stacking context and drag its own `::after` up with it, at which
	 * point the overlay covers its siblings again" — that file's own
	 * comment). Every OTHER `.rev-sha` on this page (the three `.bld-row`
	 * lists) also carries `.tap-link` INSIDE an actual `.tap-zone`
	 * ancestor (`.bld-row.tap-zone`), where the whole row is already the
	 * click target; giving THOSE elements `position: relative` here would
	 * make each one its own containing block and collapse `.tap-link`'s
	 * `::after` down to the sha's own 15px box — the exact regression the
	 * shared rule's comment warns against. `.svc-sha` has no enclosing
	 * `.tap-zone` at all (`.tap-link` is inert there — the governing
	 * selector never matches), so this is the one sha on the page where a
	 * dedicated hit-slop is both needed and safe.
	 */
	.svc-sha {
		position: relative;
	}

	.svc-sha::before {
		content: '';
		position: absolute;
		inset: 50%;
		width: max(100% + 12px, 32px);
		height: max(100% + 12px, 32px);
		transform: translate(-50%, -50%);
	}

	/*
	 * ⛔ REVISIONS-2026-09-06, ITEM 6 — THE 44px `::before` SLOP IS GONE, AND
	 * NOT AS A LOSS. This button's own `position: relative` (round 4, item
	 * 12) made it the nearest positioned ancestor for its OWN pseudo-element
	 * — which was fine while the slop was this element's private `::before`,
	 * but item 6 also makes it the page's `.tap-link` (its `::after` is
	 * supposed to cover the WHOLE 47px header, per `.tap-zone .tap-link::after`
	 * in `app.css`). A `::after` generated INSIDE a positioned element resolves
	 * its `inset: 0` against THAT element, not against `.tap-zone` further up
	 * — exactly the regression `.svc-sha`'s own comment two rules above this
	 * one already warns against, on this page, in this exact file. Measured
	 * live: the overlay collapsed to the 93×28px pill instead of the full
	 * 1199×47px header. Deleting `position: relative` here lets `::after`'s
	 * containing-block search continue up to `.tap-zone` where it belongs.
	 *
	 * The 44px mobile slop is not lost, it is SUPERSEDED: the tap-zone's own
	 * overlay now gives this control the ENTIRE header — 1199×47 desktop,
	 * full card width × 47px at 390 — which is strictly bigger than the 44px
	 * circle it replaces at every width.
	 */
</style>
