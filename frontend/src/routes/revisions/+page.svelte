<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import {
		buildRevisionLedger,
		repoDeviation,
		rowNamesBuild,
		serviceLedger,
		sortByDeviation,
		type RevisionRow,
		type RevisionSlot,
		type RepoLedger,
		type ServiceLedgerGroup,
		type ServiceLedgerLine
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		releaseSplit,
		type CoverageSlotVM,
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
	function pastRows(repo: RepoLedger): RevisionRow[] {
		return repo.rows.filter((r) => r.liveSlots === 0);
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
	 * ⭐ THE REPO'S ENTRY POINT — the newest build anything is running.
	 * Chosen by RANK, a stable structural property — never by health.
	 */
	function leadRow(repo: RepoLedger): RevisionRow | null {
		return repo.rows[0] ?? null;
	}

	/** Everything still running that is NOT the lead — the quiet path. */
	function restRows(repo: RepoLedger, lead: RevisionRow | null): RevisionRow[] {
		return liveRows(repo).filter((r) => r.revision !== lead?.revision);
	}

	/**
	 * ⭐ CRAFT REVIEW ITEM 5 — THE HERO MUST OBEY THE SERVICE FILTER TOO.
	 * `lead` is the repo's own overall newest build; a filtered reader asking
	 * "what is `hello-api-app` running" does not care that a DIFFERENT
	 * service reached a newer commit. If any selected service is actually
	 * live on `lead`, nothing changes — it is still the honest answer. If
	 * none is, and exactly ONE service is selected, its own current build
	 * (the ledger's own `lines[0]`, already rank-sorted) is the unambiguous
	 * substitute. Two-plus selected services with no build in common have no
	 * single "newest" left to state, so the hero hides rather than guess —
	 * `filteredLeadRow` returns `null` and the caller renders nothing.
	 */
	function filteredLeadRow(
		repo: RepoLedger,
		lead: RevisionRow | null,
		serviceGroups: ServiceLedgerGroup[]
	): RevisionRow | null {
		const selected = selectedApps[repo.repoKey];
		if (!selected || selected.length === 0) return lead;
		if (lead && lead.services.some((s) => selected.includes(s.appName) && s.liveSlots > 0)) {
			return lead;
		}
		if (selected.length !== 1) return null;
		const line: ServiceLedgerLine | undefined = serviceGroups.find(
			(g) => g.appName === selected[0]
		)?.lines[0];
		if (!line) return null;
		return repo.rows.find((r) => r.revision === line.revision) ?? null;
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

	/**
	 * ⭐ CRAFT REVIEW ITEM 6 — THE LEDGER'S OWN STATE DISC. "The deploy state
	 * of that service's live build" — read off the SAME `revisionCoverage`
	 * bucketing the rest of the page already trusts (never a second
	 * classifier), for the specific (service, env) slots this ledger LINE
	 * is actually about. A line's slots can disagree across environments
	 * (DEV healthy, PROD failing); the worst one wins, because a disc that
	 * hid a failure to show a healthy sibling would be a mark untrue of its
	 * own kind. Returns `null` when the line's revision cannot be resolved
	 * to a deployed row at all (should not happen — `serviceLedger` builds
	 * lines only from `repo.rows` — but a glyph with nothing to point at is
	 * refused rather than guessed).
	 */
	const DOT_SEVERITY: [needle: string, weight: number][] = [
		['bg-red-', 4],
		['bg-amber-', 3],
		['bg-blue-', 2],
		['bg-yellow-', 2],
		['bg-gray-5', 1],
		['bg-gray-4', 1]
	];
	function dotSeverity(cls: string): number {
		for (const [needle, weight] of DOT_SEVERITY) if (cls.includes(needle)) return weight;
		return 0;
	}
	function lineDot(appName: string, line: ServiceLedgerLine): CoverageSlotVM | null {
		const row = coverageByRevision.get(line.revision);
		if (!row) return null;
		let best: CoverageSlotVM | null = null;
		for (const bucket of row.buckets) {
			for (const slot of bucket.slots) {
				if (slot.appName !== appName) continue;
				if (!line.slots.some((ls) => ls.envName === slot.envName)) continue;
				if (!best || dotSeverity(slot.dotClass) > dotSeverity(best.dotClass)) best = slot;
			}
		}
		return best;
	}

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
	 * TWO SEPARATE MECHANISMS, DELIBERATELY NOT SHARED. Search is global
	 * (one field, every repo) and matches a BUILD (sha / short sha / service
	 * / label). The per-service filter is PER REPO — pressing a chip asks
	 * "what does this one service run" and only ever narrows THAT repo's own
	 * three build lists, never its ledger (the ledger already answers the
	 * per-service question directly; filtering it by its own chips would be
	 * circular).
	 */

	let searchQuery = $state('');
	const searchActive = $derived(searchQuery.trim().length > 0);
	const searchNeedle = $derived(searchQuery.trim().toLowerCase());

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
	 * ⭐ THE PER-SERVICE FILTER IS A CHIP STRIP, NOT A ROW TOGGLE.
	 * (Coordinator amendment to REVISIONS-2026-09-05 §7(a): the spec's own
	 * ledger-row-as-`aria-pressed`-toggle draft is NOT implemented — a whole
	 * list row turning gray-900 reads as SELECTION, not FILTERING. This is
	 * the spec's own named fallback: a multi-select `.pill-btn` strip under
	 * the ledger, the exact mechanism `RolloutGrid.svelte`'s cluster filter
	 * already uses — `aria-pressed`, gray-900 pressed treatment on the CHIP.)
	 */
	let selectedApps = $state<Record<string, string[]>>({});
	function isAppSelected(repoKey: string, appName: string): boolean {
		return (selectedApps[repoKey] ?? []).includes(appName);
	}
	function toggleAppFilter(repoKey: string, appName: string) {
		const cur = selectedApps[repoKey] ?? [];
		selectedApps = {
			...selectedApps,
			[repoKey]: cur.includes(appName) ? cur.filter((a) => a !== appName) : [...cur, appName]
		};
	}
	function passesAppFilter(row: RevisionRow, repoKey: string): boolean {
		const apps = selectedApps[repoKey];
		return !apps || apps.length === 0 || row.services.some((s) => apps.includes(s.appName));
	}
	/** Search AND the chip filter both narrow the three build lists. */
	function visibleInList(row: RevisionRow, repoKey: string): boolean {
		return passesSearch(row) && passesAppFilter(row, repoKey);
	}

	/** While searching OR filtering, the section that answers it must be open. */
	function effectiveOpen(i: number, repoKey: string): boolean {
		return isOpen(i) || searchActive || (selectedApps[repoKey]?.length ?? 0) > 0;
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
	 * Never affected by the chip filter — see the note above `selectedApps`.
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
					: 'ies'}{/if}
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
		<div class="relative mt-1 w-full md:max-w-sm" aria-hidden="true">
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
		<div class="relative mt-1 w-full md:max-w-sm">
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
					class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
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
			{@const shownGroups = expandLedger[repo.repoKey] ? visibleGroups : visibleGroups.slice(0, FOLD)}
			{@const headCreated = repo.rows[0]?.createdMs ?? 0}
			{@const newer = headCreated > 0 ? repo.pending.filter((p) => p.createdMs > headCreated).length : 0}
			{@const distanceVerdict = newer > 0 ? `${newer} newer build${newer === 1 ? '' : 's'}` : 'Newest build deployed'}
			{@const headCov = repoHeadCoverage.get(repo.repoKey) ?? null}
			{@const deviation = repoDeviation(repo, headCov)}
			{@const url = repoUrl(repo.repoKey)}
			{@const open = effectiveOpen(i, repo.repoKey)}
			{@const rawLead = leadRow(repo)}
			{@const lead = filteredLeadRow(repo, rawLead, serviceGroups)}
			{@const leadCov = lead ? (lead === rawLead ? headCov : revisionCoverage(lead, coarse)) : null}
			{@const liveAll = restRows(repo, lead)}
			{@const pastAll = pastRows(repo).filter((r) => r.revision !== lead?.revision)}
			{@const liveVisible = liveAll.filter((r) => visibleInList(r, repo.repoKey))}
			{@const pastVisible = pastAll.filter((r) => visibleInList(r, repo.repoKey))}
			{@const pendingVisible = repo.pending.filter((r) => visibleInList(r, repo.repoKey))}
			{@const namedLive = repoNamesBuilds(liveVisible)}
			{@const namedPast = repoNamesBuilds(pastVisible)}
			{@const noMatchText = searchActive
				? `No build matches “${searchQuery.trim()}”.`
				: 'No build matches this filter.'}
			<!--
				⭐ CRAFT REVIEW ITEM 5 — A REPO-WIDE SEARCH MISS COLLAPSES TO ONE
				SENTENCE. Three cards each independently printing `No build
				matches "x".` (or worse, three headers each reading `0 of N
				builds`) is the same fact stated three times. Scoped to SEARCH
				only (`searchActive`) — the service-chip filter keeps its
				per-card `noMatchText` branches, since a chip miss on one list
				while another still has rows is a real, useful distinction.
			-->
			{@const repoSearchMiss =
				searchActive && liveVisible.length === 0 && pastVisible.length === 0 && pendingVisible.length === 0}

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
									: deviation.chip.role === 'alarm'
										? 'Places running this build on an older release, with a newer one held by a rule'
										: 'Services with something not yet on the newest build any of them has reached'}
							/>
						{/if}
						<span
							class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400"
							title="Builds newer than the newest one any service here is running. None of them has been deployed anywhere."
							>{distanceVerdict}</span
						>
					</span>
				</button>

				<!-- ⭐ THE SERVICE LEDGER — §7(a). One group per service, one
				     line per build that service is actually live on. -->
				{#if searchActive && visibleGroups.length === 0}
					<!-- Every service's own name AND every build it ships were
					     ruled out by the search — an empty grid here would read
					     as a rendering gap, not as an answer. -->
					<p class="t-body px-4 py-3 text-gray-500 dark:text-gray-400">{noMatchText}</p>
				{:else}
					<div class="svc-ledger py-1">
						{#each shownGroups as group (group.appName)}
						{#each group.lines.length ? group.lines : [null] as line, idx (line ? `${group.appName}/${line.revision}` : `${group.appName}/none`)}
							{@const dot = line ? lineDot(group.appName, line) : null}
							<div class="svc-line">
								<!--
									⭐ CRAFT REVIEW ITEM 6 — THE LEDGER'S OWN STATE
									DISC. Every OTHER row on this page reserves a
									16px glyph cell; the ledger alone had none, so
									a service's own deploy health was invisible
									until the reader opened the whole section. Only
									on the first line — a continuation line shares
									the same service and, per `lineDot`'s own
									worst-wins rule, a second disc would either
									repeat the first or silently contradict it.
								-->
								<span class="svc-mark" aria-hidden="true">
									{#if idx === 0 && dot}
										<span
											class="inline-block h-2 w-2 shrink-0 rounded-full {dot.dotClass}"
											title="{group.appName}: {dot.statusWord}"
										></span>
									{/if}
								</span>
								{#if idx === 0}
									{@const selected = isAppSelected(repo.repoKey, group.appName)}
									<!--
										⭐ THE FILTER IS THE NAME CELL NOW — coordinator
										follow-up 2, typography fixed per craft-review
										items 10 and 11. `t-body` sans (not `t-code`
										mono — mono stays reserved for the sha beside
										it, §7a), and the pressed fill is INSET within
										the row's own padding rather than reaching past
										it with a negative margin (which pushed the
										fill 5px outside the card's own edge and had it
										clipped by `overflow-hidden`).
									-->
									<button
										type="button"
										onclick={() => toggleAppFilter(repo.repoKey, group.appName)}
										aria-pressed={selected}
										aria-label={`Show only ${group.appName}`}
										class="svc-name svc-name-btn hit-32 t-body rounded text-left transition-colors
											{selected
											? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
											: 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60'}"
									>
										{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
											/>{/if}{/each}
									</button>
								{:else}
									<span class="svc-name" aria-hidden="true"></span>
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
						at least once · {repo.slotCount} place{repo.slotCount === 1 ? '' : 's'} to deploy to
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
				{#if open}
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
							⭐ THE HERO, COMPACT NOW (craft review item 7). `barPercent`/
							`hideBar`/`showHeldChip`/`compact` are the additive props
							`RevisionLead.svelte` gained for this pass — see that
							component's own header comment. The detail page's call
							site is untouched and keeps its old two-line layout and
							bucketed bar.
						-->
						{#if lead && leadCov}
							<Card
								icon={RocketSolid}
								title="Newest build in use"
								verdict="{lead.services.length} service{lead.services.length === 1 ? '' : 's'}"
								verdictTitle={scopeRecord(lead.services.length)}
							>
								<RevisionLead
									short={lead.short}
									href={revisionPath(repo.repoKey, lead.revision)}
									eyebrow="Newest build"
									coverage={leadCov}
									barPercent={livePercent(leadCov.liveCount, leadCov.totalCount)}
									hideBar={leadCov.liveCount === leadCov.totalCount}
									showHeldChip
									spread={false}
									compact
								>
									{#if rowNamesBuild(lead)}
										{#snippet meta()}
											{@render names(lead, true)}
										{/snippet}
									{/if}
									{#if releaseSplitSentence(leadCov)}
										<p class="t-body basis-full text-gray-500 dark:text-gray-400">
											{releaseSplitSentence(leadCov)}
										</p>
									{/if}
									{#if commitUrlFor(repo.repoKey, lead.revision)}
										<a
											class="nav-link"
											href={commitUrlFor(repo.repoKey, lead.revision)}
											target="_blank"
											rel="noopener noreferrer"
											aria-label={`View the commit for ${lead.short} on GitHub — opens in a new tab`}
										>
											View commit
											<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
										</a>
									{/if}
								</RevisionLead>
							</Card>
						{/if}

						{#if repoSearchMiss}
							<p class="t-body mt-4 px-4 py-10 text-center text-gray-500 dark:text-gray-400">{noMatchText}</p>
						{:else}
							<div class="rev-cols mt-4">
								<div class="flex min-w-0 flex-col gap-4">
									<!-- CARD 1 — THE QUIET PATH. -->
									<Card
										icon={CheckCircleSolid}
										title={lead ? 'Also still running' : 'Still running'}
										verdict={rollupLabel(liveVisible.length, liveAll.length, 'build')}
										verdictTitle="Older builds that some service is still running"
										padded={false}
									>
										{#if liveAll.length === 0}
											<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">
												{lead
													? 'Nothing older is still running — every place is on the build above.'
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
															<span class="t-micro mt-1 block text-gray-500 dark:text-gray-400" title={ageTitle(row, 'live')}
																>{ageOf(row, 'live')}</span
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
																<span
																	class="t-micro block text-gray-500 dark:text-gray-400"
																	title={ageTitle(row, 'past')}>{ageOf(row, 'past')}</span
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
															<span
																class="t-micro block text-gray-500 dark:text-gray-400"
																title={ageTitle(row, 'pending')}>{ageOf(row, 'pending')}</span
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
						{/if}
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
	 * ⭐ CRAFT REVIEW ITEM 6 — A 16px GLYPH CELL LEADS THE ROW, matching
	 * `.bld-row`'s own grammar: every row-shaped list on this page reserves
	 * one, and the ledger was the one exception.
	 */
	.svc-ledger {
		display: grid;
		grid-template-columns: 16px minmax(120px, 180px) 88px 90px minmax(0, 1fr);
		column-gap: 12px;
		row-gap: 0;
		/*
		 * ⭐ THE 16px INSET LIVES ON THE GRID CONTAINER, NOT ON A TRACK.
		 * `.svc-mark`'s own track is a fixed, exact 16px — the glyph's own
		 * width — so giving that SAME element 16px of padding-left would
		 * need 32px total, which either overflows the fixed track or (via a
		 * grid item's implicit `min-width: auto`) silently grows it past
		 * 16px, throwing off every column after it. Padding the CONTAINER
		 * insets the whole grid uniformly without touching any track's own
		 * width — the same reasoning `.bld-row`'s 16px side padding already
		 * uses one level up.
		 */
		padding-inline: 16px;
	}

	.svc-line {
		display: contents;
	}

	.svc-mark {
		grid-column: 1;
		padding-block: 6px;
		display: flex;
		align-items: center;
		height: 20px;
	}

	.svc-name {
		grid-column: 2;
		padding-block: 6px;
		min-width: 0;
	}

	/*
	 * ⭐ THE NAME CELL IS THE FILTER — coordinator follow-up 2. Button resets
	 * only; the pressed/unpressed COLOUR is inline (it is state, not
	 * geometry). `display: block` because `.svc-name` is a `display:
	 * contents` grid child's sibling cell and a `<button>`'s UA default
	 * (`inline-block`) would let it shrink to its own text instead of
	 * filling the grid cell the way the plain `<span>` on every other line
	 * does — which is what kept the column's left edge lining up before
	 * this control existed.
	 */
	/*
	 * ⛔ `:where()`, NOT A BARE SELECTOR — same fight, twice. Svelte's own
	 * scoping hash gets appended INSIDE the `:where()` too, but `:where()`
	 * always contributes ZERO specificity, so this UA-reset rule can no
	 * longer outrank the CONDITIONAL utility classes the markup adds for
	 * pressed/unpressed (`bg-gray-900`, `text-white`, …) or `.t-code`'s own
	 * font declarations. Measured live: written as plain `.svc-name-btn {
	 * background: transparent }`, the scoping hash made it MORE specific
	 * than `.bg-gray-900` and the pressed fill silently never painted —
	 * `aria-pressed="true"` with a fully transparent background. Same root
	 * cause as the `font: inherit` note this replaced.
	 */
	/*
	 * ⛔ NO `background` HERE, EVEN AT ZERO SPECIFICITY. (Second round of the
	 * same bug — see the `font: inherit` note this rule used to carry.)
	 * `app.css`'s own layering note is the one to reread: a Svelte-scoped
	 * rule is UNLAYERED, and an unlayered rule beats a LAYERED one — e.g.
	 * Tailwind's own utilities layer — regardless of specificity. `:where()`
	 * only wins specificity fights; it cannot lose a layer fight on
	 * purpose. Declaring `background: transparent` here pinned the button
	 * transparent through `aria-pressed="true"` no matter what utility
	 * class the markup added. Tailwind's own preflight (`@layer base`)
	 * already resets a bare `<button>` to a transparent background, which
	 * is exactly the UNSELECTED state this control wants — so the fix is to
	 * declare nothing at all and let the conditional `bg-gray-900` /
	 * `dark:bg-white` utility classes be the only thing that ever sets it.
	 */
	/*
	 * ⭐ CRAFT REVIEW ITEM 11 — INSET, NOT FULL-BLEED. This used to be
	 * `display: block; width: 100%` (fill the whole grid cell) PLUS a
	 * `-mx-1.5`/`-my-0.5` Tailwind negative margin meant to cancel padding
	 * back to the bare text's position — and the margin reached far enough
	 * left that the pressed fill's own edge measured outside the card's
	 * border, clipped by `overflow-hidden`. There is no other element
	 * sharing this cell (a continuation line's `.svc-name` is an empty
	 * span, not a second copy of this button), so nothing needs the button
	 * to fill the full column width. Sized to its own content instead, with
	 * a small CSS-only inset — never a Tailwind utility here, so this
	 * cannot re-fight `bg-gray-900` the way the geometry properties did.
	 */
	.svc-name-btn {
		display: inline-block;
		max-width: 100%;
		padding: 2px 6px;
		margin-left: -6px;
		border: none;
		cursor: pointer;
	}

	.svc-sha {
		grid-column: 3;
		padding-block: 6px;
	}

	.svc-rank {
		grid-column: 4;
		padding-block: 6px;
		display: flex;
		align-items: center;
	}

	.svc-envs {
		grid-column: 5;
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
		grid-column: 3 / -1;
		padding-block: 6px;
	}

	/*
	 * ⭐ THE LEDGER ROW'S OWN REFLOW — coordinator follow-up 3. TWO LINES,
	 * not three or four: line 1 is `name …… sha  RANK` (name left, sha +
	 * rank chip right-aligned), line 2 is the env chips. This STAYS the one
	 * shared grid (`.svc-line` stays `display: contents` — never reverts to
	 * its own per-line grid the way it did in the first mobile draft) with
	 * fewer, narrower columns: `minmax(0,1fr)` for the name, fixed widths
	 * for the mark/sha/rank. That is what makes "sub-lines of a multi-build
	 * service start at line 1's sha column" true for free — every line's
	 * sha lands in the SAME shared column regardless of whether that line
	 * has a name.
	 */
	@container (max-width: 560px) {
		.svc-ledger {
			grid-template-columns: 16px minmax(0, 1fr) 64px 90px;
			column-gap: 8px;
			row-gap: 2px;
		}

		/* Its own full-width line under name/sha/rank. Container padding
		   already gives it a right inset; no per-cell override needed. */
		.svc-envs {
			grid-column: 1 / -1;
			padding-top: 0;
		}

		/* ⛔ NO OVERRIDE NEEDED — the base rule's `grid-column: 3 / -1` spans
		   "everything after the name" at any track count: sha+rank+envs on
		   the 5-column desktop grid, sha+rank on this 4-column one. An
		   earlier `2 / -1` here overlapped the FIRST line's own name cell
		   (column 2) with this message in the exact case both render at
		   once (a "Not deployed" line's own idx-0 name). */

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

	.bld-go {
		position: absolute;
		right: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
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
