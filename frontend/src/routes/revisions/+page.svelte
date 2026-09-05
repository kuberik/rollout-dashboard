<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { isEventStreamHealthy } from '$lib/api/events';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import {
		buildRevisionLedger,
		lineState,
		releaseLines,
		repoDeviation,
		rowNamesBuild,
		serviceLedger,
		sortByDeviation,
		type ReleaseLine,
		type RevisionRow,
		type RevisionSlot,
		type RepoLedger,
		type ServiceLedgerGroup
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		releaseSplit,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import { joinClauses } from '$lib/view-models/blocking-story';
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
	import BuildStateMark from '$lib/components/BuildStateMark.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';

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
	 * ⭐ THE PAGE'S ROLLUP. `null` while there is nothing to state — a `0 of
	 * 0` above a skeleton is a reading of the cluster that has not happened
	 * yet.
	 */
	const scope = $derived.by(() => {
		if (ledgers.length === 0) return null;
		let deployed = 0;
		let known = 0;
		for (const repo of ledgers) {
			deployed += repo.rows.length;
			known += repo.knownRevisions;
		}
		return known > 0 ? { deployed, known } : null;
	});

	/**
	 * ⭐ THE SKELETON REMEMBERS THREE THINGS NOW: how many repo sections to
	 * draw, WHICH of them were open, and how many service rows each one's
	 * ledger holds. (REVISIONS-2026-09-05 §1, "Loading".) All three are
	 * SHAPE — counts and a comma-joined list of indices — never fleet data;
	 * `skeleton-hints.ts` enforces that at the storage layer.
	 */
	const SHAPE_KEY = 'revisions';
	type RevisionsShape = { repos: number; open: string; services: string };
	const shapeHint = recallShape<RevisionsShape>(SHAPE_KEY);
	// Capped generously — only bounds a next-visit SKELETON's size, never the real page.
	const skelRepoCount = Math.min(Math.max(shapeHint?.repos ?? 1, 1), 6);
	const skelServiceCounts = (shapeHint?.services ?? '').split(',').map((raw) => {
		const n = parseInt(raw, 10);
		return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 3;
	});
	const skelOpenIndices = new Set(
		(shapeHint?.open ?? '0')
			.split(',')
			.map((n) => parseInt(n, 10))
			.filter((n) => Number.isInteger(n) && n >= 0)
	);

	/**
	 * ⭐ WHICH REPOSITORY SECTIONS ARE EXPANDED. (§1 "Default open state")
	 * `ledgers` is already sorted most-recently-active first, so index 0
	 * open / the rest closed is the right first-ever-visit default — and
	 * it is exactly what `skelOpenIndices` already resolves to with no
	 * remembered hint (`'0'`). Remembered by INDEX, never by repo key.
	 */
	let openMap = $state<Record<number, boolean>>(
		Object.fromEntries([...(skelOpenIndices.size ? skelOpenIndices : [0])].map((i) => [i, true]))
	);
	function isOpen(i: number): boolean {
		return !!openMap[i];
	}
	function toggleRepo(i: number) {
		openMap = { ...openMap, [i]: !isOpen(i) };
	}
	function openIndicesString(): string {
		return (
			Object.keys(openMap)
				.filter((k) => openMap[+k])
				.map(Number)
				.sort((a, b) => a - b)
				.join(',') || '0'
		);
	}

	$effect(() => {
		if (query.isLoading || query.isError) return;
		rememberShape(SHAPE_KEY, {
			repos: orderedLedgers.length,
			open: openIndicesString(),
			services: orderedLedgers.map((r) => serviceLedger(r).length).join(',')
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
	const coverageByRevision = $derived.by(() => {
		const m = new Map<string, RevisionCoverage>();
		for (const repo of ledgers) {
			for (const row of repo.rows) {
				m.set(row.revision, revisionCoverage(row, coarse));
			}
		}
		return m;
	});

	/** The two halves of the ledger, split on the page's FIRST criterion. */
	function liveRows(repo: RepoLedger): RevisionRow[] {
		return repo.rows.filter((r) => r.liveSlots > 0);
	}
	function pastRows(repo: RepoLedger, headRevisions: Set<string>): RevisionRow[] {
		return repo.rows.filter((r) => r.liveSlots === 0 && !headRevisions.has(r.revision));
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
	 * characters) clipped mid-word at 390px instead of wrapping — `Card`'s
	 * own `flex-wrap` only decides whether the ENTIRE verdict drops to its
	 * own line, not whether that line itself fits. A character budget keeps
	 * the exact two-service example the round names intact while falling
	 * back to the honest count for a line too long to state safely; the
	 * ledger's own per-line caption (§H) already names every service
	 * regardless, so nothing is lost, only guarded against clipping.
	 */
	function heroServicesLabel(row: RevisionRow): string {
		const joined = row.services.map((s) => s.appName).join(' · ');
		if (joined.length <= 40) return joined;
		return `${row.services.length} service${row.services.length === 1 ? '' : 's'}`;
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

	function commitUrlFor(repoKey: string, revision: string): string | null {
		const base = repoUrl(repoKey);
		return base ? `${base}/commit/${revision}` : null;
	}

	/** THE HERO'S OWN RELEASE-SPLIT CAPTION — unchanged from the round that shipped it. */
	function releaseSplitSentence(coverage: RevisionCoverage): string {
		return releaseSplit(coverage)
			.map((l) => {
				const envs = joinClauses(l.envLabels.map((e) => e.toLowerCase()));
				const clause = l.held
					? `${l.aheadLabel} is held in ${envs}`
					: `${l.aheadLabel} has not reached ${envs} yet`;
				return `${l.count} of them on ${l.behindLabel}; ${clause}.`;
			})
			.join(' ');
	}

	/* ── THE PAGE'S ONE BLOCKING FACT ─────────────────────────────────────── */
	const blockage = $derived.by(() => {
		for (const repo of ledgers) {
			const head = repo.rows[0];
			if (!head) continue;
			const cov = revisionCoverage(head, coarse);
			const stuckSlots = cov.buckets
				.find((b) => b.key === 'notYet')
				?.slots.filter((s) => s.blockingGates.length > 0);
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
		const where = b.envs.join(', ');
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

	/** While searching, every section that might answer it must be open. */
	function effectiveOpen(i: number): boolean {
		return isOpen(i) || searchActive;
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
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{scope.deployed}</span>
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
			{#if scope}of {scope.known} builds deployed · {ledgers.length} repositor{ledgers.length === 1
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
					<time datetime={new Date(query.dataUpdatedAt).toISOString()}
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
				class="{sectionIndex === 0
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
					<span class="skel-block h-3 w-24 shrink-0"></span>
				</div>
				<!--
					⭐ ROW HEIGHT MEASURED OFF THE REAL LEDGER, NOT THE SPEC'S
					OWN "26px" GUESS. A `.svc-line` renders name + sha + rank
					chip + env chips at `py-3` container padding — measured
					live at 1440, 74px for 2 lines and 205px for 6, i.e. ~34-
					37px per line. `py-2`/`gap-2`/`h-3` (the spec's literal
					figure) undershot that by roughly 25px per row, which is
					exactly the kind of slot-height drift `pair.mjs`'s flip
					test exists to catch.
				-->
				<div class="flex flex-col gap-3 px-4 py-3">
					{#each Array(svcCount) as _, r (r)}
						<div class="flex items-center gap-3">
							<span class="skel-block h-4 w-32"></span>
							<span class="skel-block h-4 w-16"></span>
							<span class="skel-block h-4 w-56 flex-1"></span>
						</div>
					{/each}
				</div>
				<!-- ⛔ NO CHIP-STRIP ROW HERE ANY MORE. Coordinator follow-up 2
				     folded the filter into the ledger's own name cell — the
				     ledger-row skeleton above already reserves that space. -->
				<div
					class="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60"
				>
					<span class="skel-block h-3 w-64"></span>
					<span class="skel-block h-3 w-24 shrink-0"></span>
				</div>

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
							⭐ THE HERO'S OWN `Card` HEADER, 47px — measured miss:
							this skeleton left it out entirely, undershooting the
							real nested block by ~118px. Same header shape every
							other card skeleton on this page already draws.
						-->
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
						</div>

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
									<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
										{#each Array(2) as _, i (i)}
											<li class="bld-row">
												<span class="bld-mark">
													<span class="skel-block h-4 w-4 rounded-full"></span>
												</span>
												<div class="flex min-w-0 flex-col gap-1">
													<span class="skel-block h-3.5 w-24"></span>
													<span class="skel-block h-3 w-40"></span>
													<span class="skel-block h-3 w-20"></span>
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
				⭐ ROUND 3 ADDENDUM C — LEDGER ORDER. Within each release line
				(and across the whole ledger on a single-line repo), the
				deviating service — held, pinned, stuck or failing on any build
				it is live on — leads; the rest stay alphabetical. `serviceLineIndex`
				only matters when `multiLine`; a single-line repo sorts on
				deviation alone.
			-->
			{@const serviceLineIndex = new Map(lines.flatMap((l, li) => l.services.map((s) => [s, li] as const)))}
			{@const orderedGroups = [...visibleGroups].sort((a, b) => {
				if (multiLine) {
					const la = serviceLineIndex.get(a.appName) ?? 0;
					const lb = serviceLineIndex.get(b.appName) ?? 0;
					if (la !== lb) return la - lb;
				}
				const da = a.lines.some((ln) => lineState(ln, coarse)) ? 0 : 1;
				const db = b.lines.some((ln) => lineState(ln, coarse)) ? 0 : 1;
				if (da !== db) return da - db;
				return a.appName.localeCompare(b.appName);
			})}
			{@const shownGroups = expandLedger[repo.repoKey] ? orderedGroups : orderedGroups.slice(0, FOLD)}
			{@const headCreated = repo.rows[0]?.createdMs ?? 0}
			{@const newer = headCreated > 0 ? repo.pending.filter((p) => p.createdMs > headCreated).length : 0}
			<!--
				⭐ ROUND 3 §1/§4 — A SINGLE NUMBER WOULD LIE ACROSS MORE THAN ONE
				LINE (it is only ever true of the line `repo.rows[0]` happens to
				belong to). Multi-line repos state the fact they DO know — how
				many independent lines exist — and leave "how far behind" to
				each line's own hero band below.
			-->
			{@const distanceVerdict = multiLine
				? `${lines.length} release lines`
				: newer > 0
					? `${newer} newer build${newer === 1 ? '' : 's'}`
					: 'Newest build deployed'}
			{@const distanceVerdictTitle = multiLine
				? 'This repository has more than one independent release line — each one has its own newest build, shown below.'
				: 'Builds newer than the newest one any service here is running. None of them has been deployed anywhere.'}
			{@const headCov = repoHeadCoverage.get(repo.repoKey) ?? null}
			{@const deviation = repoDeviation(repo, headCov)}
			{@const url = repoUrl(repo.repoKey)}
			{@const open = effectiveOpen(i)}
			{@const liveAll = restRows(repo, leadHeads)}
			{@const pastAll = pastRows(repo, leadHeads)}
			{@const liveVisible = liveAll.filter(passesSearch)}
			{@const pastVisible = pastAll.filter(passesSearch)}
			{@const pendingVisible = repo.pending.filter(passesSearch)}
			{@const namedLive = repoNamesBuilds(liveVisible)}
			{@const namedPast = repoNamesBuilds(pastVisible)}
			{@const noMatchText = `No build matches “${searchQuery.trim()}”.`}
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
					⭐ CRAFT REVIEW ITEM 8 — A DISCLOSURE HEADER READS AS ONE AT
					REST. `bg-gray-50`/`dark:bg-gray-800/60` is now the header's
					RESTING ground, not only its hover state — the chevron alone
					was not enough of a signal that this 47px bar is a control
					and not a static card title (every static `Card` header on
					this page stays plain white/gray-800, unchanged).
				-->
				<button
					type="button"
					class="flex min-h-[47px] w-full cursor-pointer flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:bg-gray-700/60"
					aria-expanded={open}
					aria-controls={`repo-${i}-extra`}
					onclick={() => toggleRepo(i)}
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
					-->
					<span class="flex min-w-0 items-center gap-2.5">
						<ChevronRightOutline
							class="h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 dark:text-gray-400 {open
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
						<CodeBranchOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
						<h2 class="t-card-title min-w-0 break-words text-gray-900 dark:text-white">
							{repoTitle(repo.repoLabel)}
						</h2>
					</span>
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
						{#if deviation.chip}
							<Chip
								role={deviation.chip.role}
								label={deviation.chip.label}
								title={deviation.chip.role === 'failing'
									? 'The newest build is deployed somewhere the deploy is not healthy'
									: deviation.chip.role === 'held'
										? 'Places running this build on an older release, with a newer one held by a rule'
										: 'Services with something not yet on the newest build any of them has reached'}
							/>
						{/if}
						<span
							class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400"
							title={distanceVerdictTitle}
							>{distanceVerdict}</span
						>
					</span>
				</button>

				<!-- ⭐ THE SERVICE LEDGER — §7(a). One group per service, one
				     line per build that service is actually live on. -->
				{#if repoNoMatch}
					<!-- ⭐ ROUND 3 §2/ADDENDUM J — ONE SENTENCE FOR THE WHOLE CARD. -->
					<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">{noMatchText}</p>
				{:else}
					<div class="svc-ledger py-1">
						{#each shownGroups as group, gi (group.appName)}
							{@const li = serviceLineIndex.get(group.appName) ?? 0}
							{@const prevLi = gi > 0 ? (serviceLineIndex.get(shownGroups[gi - 1].appName) ?? 0) : null}
							{#if multiLine && li !== prevLi}
								<!--
									⭐ ROUND 3 ADDENDUM H — TWO `NEWEST` SHAS IN ONE
									COLUMN READ AS A CONTRADICTION UNLESS THE LINES
									ARE LABELLED. One caption per release line, naming
									the services that share it, so `NEWEST` beside
									`9f10e49` and `NEWEST` beside `064b655` are legibly
									two different ladders, not one row disagreeing
									with itself.
								-->
								<div class="svc-line-caption t-label text-gray-500 dark:text-gray-400">
									{lines[li].services.length <= 3
										? lines[li].services.join(' · ')
										: `${lines[li].services.length} services`}
								</div>
							{/if}
							{#each group.lines.length ? group.lines : [null] as line, idx (line ? `${group.appName}/${line.revision}` : `${group.appName}/none`)}
								{@const state = line ? lineState(line, coarse) : null}
								<div class="svc-line">
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
										<span
											class="svc-name svc-name-continuation t-body text-gray-400 dark:text-gray-500"
											aria-hidden="true"
										>
											{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
												/>{/if}{/each}
										</span>
									{/if}
									{#if line}
										<a
											class="svc-sha rev-sha ident tap-link t-code text-gray-900 hover:underline dark:text-white"
											href={revisionPath(repo.repoKey, line.revision)}
											title={line.revision}>{line.short}</a
										>
										<span class="svc-rank">
											{#if line.rank !== null}
												{@const verdict = rankVerdictFor(line.rank)}
												<Chip
													role={rankRole(verdict)}
													label={rankLabel(verdict)}
													title={rankTitle(verdict, group.appName)}
												/>
											{/if}
										</span>
										<span class="svc-envs">
											{#each line.slots as slot (slot.envName)}
												{@const envDisplay = shortEnvLabel(slot.cell.theme) || slot.envName}
												<Chip
													role="env"
													theme={slot.cell.theme}
													label={envDisplay}
													wide
													title="{group.appName} in {envDisplay.toUpperCase()}"
												/>
											{/each}
											<!--
												⭐ ROUND 3 §3/ADDENDUM I — STATE IN WORDS, ONLY
												FOR THE DEVIATION. Nothing draws for the
												steady norm; `lineState` already reads the
												SAME primitives the home cards do, so this
												word cannot disagree with `/`'s for the same
												rollout.
											-->
											{#if state}
												<Chip role={state.role} label={state.label} title={state.title} wide />
											{/if}
										</span>
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
				-->
				<div
					class="repo-meta flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60"
				>
					<span
						class="repo-meta-text t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
						title="A place is one service in one environment."
					>
						{repo.knownRevisions} build{repo.knownRevisions === 1 ? '' : 's'} · {repo.rows.length} deployed
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
							{#if leadCov}
								<Card
									icon={RocketSolid}
									title="Newest build in use"
									verdict={heroServicesLabel(leadRow)}
									verdictTitle={scopeRecord(leadRow.services.length)}
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
										{#if releaseSplitSentence(leadCov)}
											<p class="t-body basis-full text-gray-500 dark:text-gray-400">
												{releaseSplitSentence(leadCov)}
											</p>
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
						{/each}

						<div class="rev-cols mt-4">
							<div class="flex min-w-0 flex-col gap-4">
								<!-- CARD 1 — THE QUIET PATH. -->
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
										{#if liveAll.length === 0 && !searchActive}
											<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">
												{visibleLeads.length > 0
													? 'Nothing older is still running — every place is on a build above.'
													: 'Nothing this repo has deployed is still running. Every place has moved on.'}
											</p>
										{:else if liveVisible.length === 0}
											<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">{noMatchText}</p>
										{:else}
											<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
												{#each liveVisible as row (row.revision)}
													{@const cov = coverageByRevision.get(row.revision)}
													{@const envSlots = liveEnvSlots(row)}
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
															{@render names(row, namedLive)}
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
																		<Chip
																			role="env"
																			theme={slot.cell.theme}
																			label={envDisplay}
																			wide
																			title="Running in {envDisplay.toUpperCase()}"
																		/>
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
															<time
																class="t-micro mt-1 block text-gray-500 dark:text-gray-400"
																datetime={ageIso(row, 'live')}
																title={ageTitle(row, 'live')}>{ageOf(row, 'live')}</time
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

									<!-- CARD 2 — HISTORY. -->
									{#if pastAll.length > 0}
										<Card
											icon={ArchiveSolid}
											title="No longer running anywhere"
											verdict={rollupLabel(pastVisible.length, pastAll.length, 'build')}
											verdictTitle="Deployed at least once; every place that ran them has since moved on"
											padded={false}
										>
											{#if pastVisible.length === 0}
												<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">{noMatchText}</p>
											{:else}
												<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
													{#each expandPast[repo.repoKey] ? pastVisible : pastVisible.slice(0, FOLD) as row (row.revision)}
														{@const pastCov = coverageByRevision.get(row.revision)}
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
																{@render names(row, namedPast)}
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
												{#if pastVisible.length > FOLD}
													{@render more(
														() => (expandPast = { ...expandPast, [repo.repoKey]: !expandPast[repo.repoKey] }),
														expandPast[repo.repoKey],
														`${pastVisible.length - FOLD} older build${pastVisible.length - FOLD === 1 ? '' : 's'}`
													)}
												{/if}
											{/if}
										</Card>
									{/if}
								</div>

								<div class="flex min-w-0 flex-col gap-4">
									<!-- THE RAIL — builds nobody has taken. Part of the
									     layout: renders even at zero (§ "States"). -->
									<Card
										icon={HourglassOutline}
										title="Never deployed"
										verdict={rollupLabel(pendingVisible.length, repo.pending.length, 'build')}
										verdictTitle={PENDING_RECORD}
										padded={false}
									>
										{#if repo.pending.length === 0}
											<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">
												Every build your services can deploy has run somewhere.
											</p>
										{:else if pendingVisible.length === 0}
											<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">{noMatchText}</p>
										{:else}
											<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
												{#each expandPending[repo.repoKey] ? pendingVisible : pendingVisible.slice(0, FOLD) as row (row.revision)}
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
															<span class="t-dense block text-gray-700 dark:text-gray-200">
																{row.services.length} service{row.services.length === 1 ? '' : 's'}
															</span>
															<time
																class="t-micro block text-gray-500 dark:text-gray-400"
																datetime={ageIso(row, 'pending')}
																title={ageTitle(row, 'pending')}>{ageOf(row, 'pending')}</time
															>
														</div>
														<span class="bld-go" aria-hidden="true">
															<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
														</span>
													</li>
												{/each}
											</ul>
											{#if pendingVisible.length > FOLD}
												{@render more(
													() =>
														(expandPending = {
															...expandPending,
															[repo.repoKey]: !expandPending[repo.repoKey]
														}),
													expandPending[repo.repoKey],
													`${pendingVisible.length - FOLD} more build${pendingVisible.length - FOLD === 1 ? '' : 's'}`
												)}
											{/if}
										{/if}
									</Card>
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

{#snippet names(row: RevisionRow, named: boolean)}
	<span class="rev-names {named ? '' : 'rev-names--unnamed'}">
		{#each row.labelGroups as g (g.label)}
			<span class="rev-name-row">
				{#if named && rowNamesBuild(row)}<span
						class="rev-name t-code-sm text-gray-900 dark:text-white"
						title={g.isOwnSha
							? `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this revision under its own sha`
							: `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this revision as ${g.label}`}
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
	 * ⭐ CRAFT REVIEW ITEM 9 — RANK IS A FIXED 90px, NOT `auto`. `auto`
	 * sized this track to the WIDEST rank chip in THIS repo's own ledger —
	 * two repos on the same page therefore computed two different
	 * pixel widths (measured live: 580px vs 593px to the env column),
	 * because each `.svc-ledger` is its own independent grid instance. A
	 * fixed width sized to the vocabulary's own widest legal member
	 * (`24 BEHIND`, comfortably under 90px at this chip's type scale)
	 * makes every repo's env column start at the SAME x regardless of
	 * which rank words happen to appear in it.
	 *
	 * ⛔ THE 16px GLYPH CELL IS GONE (round 3 addendum I). The old per-row
	 * status dot moved to a `Chip` beside the env chips, drawn only for a
	 * deviation (§3) — there is nothing to reserve a leading column FOR any
	 * more, and addendum D's own complaint (49% ink at 1440) is one column
	 * lighter for it.
	 */
	.svc-ledger {
		display: grid;
		grid-template-columns: minmax(120px, 180px) 88px 90px minmax(0, 1fr);
		column-gap: 12px;
		row-gap: 0;
		padding-inline: 16px;
	}

	.svc-line {
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
	 * ⭐ ROUND 3 ADDENDUM H — ONE CAPTION PER RELEASE LINE, spanning the
	 * whole grid so it reads as a section label over the services it names,
	 * never as a value in the name column.
	 */
	.svc-line-caption {
		grid-column: 1 / -1;
		padding: 10px 0 2px;
	}

	.svc-sha {
		grid-column: 2;
		padding-block: 6px;
	}

	.svc-rank {
		grid-column: 3;
		padding-block: 6px;
		display: flex;
		align-items: center;
	}

	.svc-envs {
		grid-column: 4;
		padding-block: 6px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	/* NO LIVE SLOT — one line: the name, then the fact, spanning the rest of
	   the row so it never pretends to be a build id. */
	.svc-empty {
		grid-column: 2 / -1;
		padding-block: 6px;
	}

	/*
	 * ⭐ ROUND 3 ADDENDUM E — THE LEDGER ACTUALLY STACKS BELOW 560px NOW.
	 * The previous four-column reflow kept the grid four columns wide
	 * (`16px 115px 64px 90px`) — names still wrapped onto two lines on most
	 * services and the env chips outdented 18px from the name because
	 * `.svc-envs`'s `grid-column: 1 / -1` measured from the WRONG column 1
	 * (the leading 16px mark track, since deleted). THREE full-width rows
	 * now, one left edge: name (its own row), sha + rank chip side by side
	 * (the one place two facts still share a row), then env chips — the
	 * exact stack the addendum asked for, and it is what makes "the
	 * continuation-line name" (item 7) sit flush under line 1's name
	 * instead of orphaned under a bare chip.
	 */
	@container (max-width: 560px) {
		.svc-ledger {
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 8px;
			row-gap: 2px;
		}

		.svc-name,
		.svc-name-continuation {
			grid-column: 1 / -1;
		}

		.svc-name-continuation {
			display: block;
		}

		.svc-sha {
			grid-column: 1;
		}

		.svc-rank {
			grid-column: 2;
		}

		.svc-envs,
		.svc-empty {
			grid-column: 1 / -1;
			padding-top: 0;
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
	 */
	.bld-row {
		position: relative;
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 200px 16px;
		gap: 12px;
		padding: 10px 16px;
		align-items: start;
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
</style>
