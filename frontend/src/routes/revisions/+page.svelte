<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import {
		buildRevisionLedger,
		rowNamesBuild,
		serviceLedger,
		type RevisionRow,
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
			repos: ledgers.length,
			open: openIndicesString(),
			services: ledgers.map((r) => serviceLedger(r).length).join(',')
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

	/** revision → coverage, for every row that has a live place. */
	const coverageByRevision = $derived.by(() => {
		const m = new Map<string, RevisionCoverage>();
		for (const repo of ledgers) {
			for (const row of repo.rows) {
				if (row.liveSlots > 0) m.set(row.revision, revisionCoverage(row, coarse));
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
			<!-- THE REPOSITORY CARD SKELETON. -->
			<div
				class="{sectionIndex === 0
					? 'mt-5'
					: 'mt-10'} flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
				aria-hidden="true"
			>
				<div
					class="flex min-h-[47px] shrink-0 items-center justify-between gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
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
			</div>

			{#if open}
				<!-- THE HERO + `.rev-cols` BLOCK — unchanged shape from the
				     round that reserved it, reused per open section. -->
				<div
					class="mt-3 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
					aria-hidden="true"
				>
					<span class="skel-block h-3 w-32"></span>
					<span class="skel-block h-6 w-44"></span>
					<span class="skel-block h-[26px] w-full"></span>
					<span class="skel-block h-3.5 w-full"></span>
					<span class="skel-block h-3.5 w-3/4"></span>
					<span class="skel-block mt-2 h-3.5 w-56"></span>
					<span class="skel-block h-3.5 w-64"></span>
					<span class="skel-block h-3.5 w-48"></span>
					<span class="skel-block mt-2 h-3.5 w-28"></span>
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
										</div>
										<div class="bld-roll flex flex-col gap-1.5">
											<span class="skel-block ml-auto h-3.5 w-32"></span>
											<span class="skel-block h-2 w-full"></span>
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
										<span class="bld-mark"></span>
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
			{/if}
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

		{#each ledgers as repo, i (repo.repoKey)}
			{@const serviceGroups = serviceLedger(repo)}
			{@const visibleGroups = visibleLedgerGroups(serviceGroups)}
			{@const shownGroups = expandLedger[repo.repoKey] ? visibleGroups : visibleGroups.slice(0, FOLD)}
			{@const headCreated = repo.rows[0]?.createdMs ?? 0}
			{@const newer = headCreated > 0 ? repo.pending.filter((p) => p.createdMs > headCreated).length : 0}
			{@const distanceVerdict = newer > 0 ? `${newer} newer build${newer === 1 ? '' : 's'}` : 'Newest build deployed'}
			{@const url = repoUrl(repo.repoKey)}
			{@const open = effectiveOpen(i, repo.repoKey)}
			{@const lead = leadRow(repo)}
			{@const leadCov = lead ? revisionCoverage(lead, coarse) : null}
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
				⭐ THE REPOSITORY CARD — §1. Always drawn, and its own
				disclosure: the header toggles the hero/list cards BELOW it,
				never the ledger, which stays visible collapsed or not — the
				collapsed state IS the page's most useful answer.
			-->
			<div
				class="repo-card {i === 0
					? 'mt-5'
					: 'mt-10'} flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
			>
				<button
					type="button"
					class="flex min-h-[47px] w-full flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
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
					-->
					<span
						class="t-card-rollup shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400"
						title="Builds newer than the newest one any service here is running. None of them has been deployed anywhere."
						>{distanceVerdict}</span
					>
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
							<div class="svc-line">
								{#if idx === 0}
									{@const selected = isAppSelected(repo.repoKey, group.appName)}
									<!--
										⭐ THE FILTER IS THE NAME CELL NOW — coordinator
										follow-up 2. The separate `.pill-btn` strip
										repeated every service the ledger already names,
										12px below, in a tracked-uppercase treatment the
										human has rejected before. One control, one
										place: the name IS the toggle, `t-code` (lowercase,
										no tracking) so it reads as an identifier, not a
										shouted label, and the pressed fill is the
										product's one selected-toggle treatment.
									-->
									<button
										type="button"
										onclick={() => toggleAppFilter(repo.repoKey, group.appName)}
										aria-pressed={selected}
										aria-label={`Show only ${group.appName}`}
										class="svc-name svc-name-btn hit-32 t-code min-w-0 -mx-1.5 -my-0.5 rounded px-1.5 py-0.5 text-left transition-colors
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
			</div>

			{#if open}
				<div id={`repo-${i}-extra`} class="rev-shell">
					<!--
						⭐ THE HERO. `barSegments`/`hideBar`/`showHeldChip` are the
						additive props `RevisionLead.svelte` gained for this pass —
						see that component's own header comment. The detail page's
						call site is untouched and keeps its old bucketed bar.
					-->
					{#if lead && leadCov}
						<Card
							icon={RocketSolid}
							title="Newest build in use"
							verdict="{lead.services.length} service{lead.services.length === 1 ? '' : 's'}"
							verdictTitle={scopeRecord(lead.services.length)}
							class="mt-3"
						>
							<RevisionLead
								short={lead.short}
								href={revisionPath(repo.repoKey, lead.revision)}
								eyebrow="Newest build"
								coverage={leadCov}
								barSegments={[{ key: 'live', count: leadCov.liveCount, title: 'Running it now', reachable: true }]}
								hideBar={leadCov.liveCount === leadCov.totalCount}
								showHeldChip
								spread={false}
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
												</div>

												<div class="bld-roll">
													<span class="t-dense text-gray-700 dark:text-gray-200">
														Running in {row.liveSlots} of {row.totalSlots}
														<span class="text-gray-500 dark:text-gray-400">places</span>
													</span>
													{#if cov && cov.liveCount < cov.totalCount}
														<CoverageBar
															segments={[{ key: 'live', count: cov.liveCount, title: 'Running it now', reachable: true }]}
															compact
															class="mt-1.5"
															label="running in {cov.liveCount} of {cov.totalCount} places"
														/>
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
												<li class="bld-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
													<span class="bld-mark" aria-hidden="true"></span>
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
												<span class="bld-mark" aria-hidden="true"></span>
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
				</div>
			{/if}
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
	 * group in this repo, so `minmax(140px,200px)` resolves to the SAME
	 * pixel width down the whole ledger — the same problem, and the same
	 * fix, `FleetSpread.svelte`'s own `.fs-runs`/`display:contents` already
	 * solved: CSS Grid tracks are scoped to one grid CONTAINER, so a grid
	 * per LINE would size its name column from that line's own content
	 * alone and land at a different x than its neighbours.
	 */
	.svc-ledger {
		display: grid;
		grid-template-columns: minmax(140px, 200px) 88px auto minmax(0, 1fr);
		column-gap: 12px;
		row-gap: 0;
	}

	.svc-line {
		display: contents;
	}

	.svc-name {
		grid-column: 1;
		padding-block: 6px;
		padding-left: 16px;
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
	.svc-name-btn {
		display: block;
		width: 100%;
		border: none;
		cursor: pointer;
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
		padding-right: 16px;
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
		padding-right: 16px;
	}

	/*
	 * ⭐ THE LEDGER ROW'S OWN REFLOW — coordinator follow-up 3. TWO LINES,
	 * not three or four: line 1 is `name …… sha  RANK` (name left, sha +
	 * rank chip right-aligned), line 2 is the env chips. This STAYS the one
	 * shared grid (`.svc-line` stays `display: contents` — never reverts to
	 * its own per-line grid the way it did in the first mobile draft) with
	 * fewer, narrower columns: `minmax(0,1fr)` for the name, `auto` for sha
	 * and rank. That is what makes "sub-lines of a multi-build service start
	 * at line 1's sha column" true for free — every line's sha lands in the
	 * SAME shared column regardless of whether that line has a name.
	 */
	@container (max-width: 560px) {
		.svc-ledger {
			grid-template-columns: minmax(0, 1fr) auto auto;
			column-gap: 8px;
			row-gap: 2px;
		}

		.svc-name {
			padding-right: 0;
		}

		.svc-rank {
			padding-right: 16px;
		}

		/* Its own full-width line under name/sha/rank. */
		.svc-envs {
			grid-column: 1 / -1;
			padding-top: 0;
		}

		.svc-empty {
			grid-column: 2 / -1;
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

	.bld-go {
		position: absolute;
		right: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
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

		.bld-roll :global(.cov) {
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
</style>
