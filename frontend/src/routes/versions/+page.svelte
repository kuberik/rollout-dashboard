<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import {
		buildRevisionLedger,
		rowNamesBuild,
		type RevisionRow,
		type RepoLedger
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageSegments,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	// THE PRODUCT'S ONE RANK VOCABULARY. This page prints exactly one of its
	// words — `unreleased` — and it takes it from here rather than spelling it.
	import { rankLabel } from '$lib/view-models/env-rank';
	import { now } from '$lib/stores/time';
	import {
		ArchiveSolid,
		ArrowRightOutline,
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		CodeBranchOutline,
		HourglassOutline,
		PlaySolid,
		RocketSolid,
		TagOutline,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import BuildStateMark from '$lib/components/BuildStateMark.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

	/**
	 * `/versions` — THE REVISION LEDGER.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * ROUND FIVE, AND IT IS NOT A FIFTH TABLE.
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * Four rounds rearranged one five-column table and the verdict never moved:
	 * *"criminally underdesigned"*. The measured diagnosis is in
	 * `.agents-context/design/COMPOSITION-GRAMMAR.md` and it is two numbers —
	 * the page the human calls beautiful carries **115 SVG icons** and cards at
	 * **8px and 12px**; this page carried **0 icons** and one 12px radius. Not a
	 * subtle gap.
	 *
	 * THE CAUSE WAS STRUCTURAL. Every rule the previous rounds enforced was a
	 * REDUCTION rule — closed colour budget, two radii, mark-the-deviation, the
	 * ink ceiling, cut anything that mostly draws the norm. Each was earned, and
	 * run without a countervailing COMPOSITION rule they converge on exactly one
	 * thing: small gray text in undifferentiated rows. `DESIGN.md`'s "exactly
	 * two radii" rule literally forbade the 8px card the good pages are built
	 * from. **Compose first; apply the budget to what you built.**
	 *
	 * WHAT THE PAGE IS NOW — three titled cards and a rail, each with a 16px
	 * icon and a right-aligned rollup, which is the grammar of every region on
	 * rollout detail:
	 *
	 *   · `Live across the fleet` — the revisions still running somewhere. The
	 *     page's subject. Each row carries the coverage bar, a state glyph, and
	 *     its names.
	 *   · `Rolled past` — history. One quiet line each, no bar, because a
	 *     revision nothing runs has no wavefront to plot. Progressive
	 *     disclosure past six, the `Show 8 ready resources ›` habit.
	 *   · `Built, never deployed` (rail) — ⭐ THE DEFECT THIS ROUND CLOSES.
	 *     The subtitle said `16 of 34 revisions deployed` and the page listed
	 *     sixteen; the other EIGHTEEN were named in a count and reachable from
	 *     nowhere in the product. A live UX critique called them *"arguably the
	 *     most interesting"* and it is right — they are the page's own first
	 *     criterion, *"what's still out there?"*, and the answer includes builds
	 *     nobody has taken. They are now rows with links, and
	 *     `RepoLedger.pending` builds them with the same `buildRow` as the rest,
	 *     so their detail page works unchanged.
	 *   · The repo card — the scope line, as an object with a header and a
	 *     `View on GitHub` button, instead of a gray eyebrow.
	 *
	 * THE BANNER. When the newest build cannot advance, that is a page-level
	 * blocking fact and it gets `AlertPanel` — a filled field, a 40px circular
	 * icon, the concrete consequence with a clear time when the cluster
	 * publishes one. This is the object rollout detail draws its schedule gate
	 * in. It is not "drift framing": drift is normal and gets no banner, a GATE
	 * refusing every candidate is not.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * HOW THE COVERAGE BAR READS WITH NO LEGEND
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * The human has rejected legends twice, so the bar has to teach itself. It
	 * does, three ways, and none of them is a swatch key:
	 *
	 *   1. THE COUNT SITS DIRECTLY ABOVE IT, in the same fixed track and to the
	 *      same width: `6 of 9 places live` over a bar that is two-thirds mint.
	 *      One glance binds the number to the segment, on every row, forever.
	 *   2. THE BAR IS ONLY EVER DRAWN WHERE IT MEASURES SOMETHING. Rolled-past
	 *      revisions are in another card and draw none, so the reader never has
	 *      to decode an all-gray bar.
	 *   3. THE GLYPH SAYS THE SAME THING IN A THIRD CHANNEL — a mint tick for
	 *      "everywhere it can be", a gray hourglass for "still has places to
	 *      reach", a red circle for "failing somewhere". Redundancy across
	 *      channels is the reference page's own habit (`✓ 51b976a Succeeded`
	 *      beside `5/5 done`).
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * KEPT, DELIBERATELY — the parts that were right
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 *  1. REVISION KEYING. Rows are commits, never label strings. See
	 *     `view-models/revision-ledger.ts` for the defect that closes.
	 *  2. THE SCOPE STATEMENT — `16 of 34 revisions deployed` — and now both
	 *     halves are reachable rather than one being a number in a caption.
	 *  3. LABEL GROUPS and the `rowNamesBuild` suppression: a row whose only
	 *     name is its own revision does not print it twice, and the column's
	 *     emptiness is a free third reading.
	 *  4. Repo grouping is a SCOPE, not a grouping mechanism.
	 *  5. Every mutating control stays on the detail page.
	 *  6. NO `−N` CHIP ON THE ROWS. Order is newest-first within each card, so
	 *     position still carries rank; and `−N` renders RED product-wide, which
	 *     would make ordinary distance read as failure sixteen times over.
	 */

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));

	/**
	 * ⭐ THE PAGE'S ROLLUP, PROMOTED OUT OF A CAPTION AND INTO THE LEAD SLOT.
	 *
	 * It was only ever readable as two rows of a `<dl>` in the rail
	 * (`Commits your services can deploy` / `Deployed at least once`), 900px
	 * down the page. It is the scope statement `REVISION-PAGES.md` names as
	 * one of the four things to KEEP, and now that the duplicated `Revisions`
	 * heading is gone it is what the top of the page says. Summed across
	 * repos, because the heading it replaces was page-wide too.
	 *
	 * `null` while there is nothing to state — a `0 of 0` above a skeleton is
	 * a reading of the cluster that has not happened yet.
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

	function ageOf(row: RevisionRow): string {
		const ms = row.lastDeployMs || row.createdMs;
		return ms ? `${formatTimeAgoCompact(new Date(ms).toISOString(), $now)} ago` : '';
	}

	function ageTitle(row: RevisionRow): string {
		const ms = row.lastDeployMs || row.createdMs;
		return ms ? formatDate(new Date(ms).toISOString()) : '';
	}

	/**
	 * THE ROW'S ONE-GLYPH ANSWER MOVED OUT OF THIS FILE.
	 *
	 * It was `rowMark()` here, and the words it produced — `has places left to
	 * reach`, `partly rolled past`, `live everywhere it is carried` — are three
	 * of the strings the human named as assuming the domain. They are now
	 * `buildState()` in `revision-coverage.ts`, rendered by
	 * `BuildStateMark.svelte`, so the phrase is written once, carries the count
	 * it is about, and is the same sentence on the row, on the lead and on the
	 * detail page.
	 */

	/**
	 * ⭐ THE PAGE'S ENTRY POINT — the newest build anything is running.
	 *
	 * *"There should be an obvious entry point — the one revision that matters
	 * right now — and a clear, quiet path to everything else."* `rows` is sorted
	 * newest-first by BUILD CREATION time, so `rows[0]` is that build: the one
	 * furthest along the ladder that any service has actually taken. It is
	 * chosen by RANK, a stable structural property — never by health — so this
	 * is not the deleted "highlight the broken row" pattern under a new name.
	 * On a repo whose newest build IS broken, the state mark says so, and the
	 * banner above says it louder.
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

	/* ── THE PAGE'S ONE BLOCKING FACT ────────────────────────────────────────
	 *
	 * The frontier of the newest deployed build. If a gate refuses every
	 * candidate in one or more places, that is the fleet-level headline and it
	 * gets the banner. Derived ONLY from `promotionBlock`'s evidence (carried
	 * through `revision-coverage.ts`) — DESIGN.md: *"`waiting on a gate` is a
	 * lie with better grammar"* when no gate list established it.
	 */
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

	/*
	 * WHEN DOES THE WINDOW OPEN? One GET per blocked rollout, cached by key.
	 *
	 * The rollout detail page says *"Will be allowed in 1d 3h (8/31/2026,
	 * 1:00:00 PM)"*; this page knew the gate and printed a generated object
	 * name. The endpoint is the same one `ScheduleStatus` reads and the
	 * arithmetic is lifted into `api/schedules.ts` so the two cannot disagree.
	 * Read-only, and it never blocks a render: the banner states the block with
	 * or without a time, and gains the clause when the answer arrives.
	 */
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

	/**
	 * THE BANNER SAYS THE BLOCK AND ONLY THE BLOCK.
	 *
	 * It used to open with `0afab6f is live in 6 of 9 places` — the same
	 * sentence the lead panel now states directly underneath, at 24px, over the
	 * bar that draws it. Two objects eight pixels apart saying one thing is how
	 * a page ends up with no lead at all. The coverage belongs to the lead; the
	 * banner keeps the one fact only it has: WHO cannot take this build, WHERE,
	 * and WHEN that clears.
	 */
	const bannerMessage = $derived.by(() => {
		const b = blockage;
		if (!b) return '';
		const where = b.envs.join(', ');
		const who = b.apps.length === 1 ? b.apps[0] : `${b.apps.length} services`;
		return `${who} cannot deploy it in ${where} yet.`;
	});

	const bannerFootnote = $derived.by(() => {
		const b = blockage;
		if (!b) return undefined;
		const parts: string[] = [];
		if (b.window.length > 0) {
			const until = opensIn ? formatTimeUntil(opensIn, $now) : null;
			parts.push(
				until
					? `A deployment window is closed — it opens in ${until} (${new Date(opensIn!).toLocaleString()}).`
					: `${b.window.length} gate${b.window.length === 1 ? '' : 's'} not passing — ${b.window.join(', ')}.`
			);
		}
		if (b.approval.length > 0) {
			parts.push(
				`${b.approval.length} gate${b.approval.length === 1 ? '' : 's'} need an approval or an external check: ${b.approval.join(', ')}.`
			);
		}
		return parts.length > 0 ? parts.join(' ') : undefined;
	});

	/* PROGRESSIVE DISCLOSURE — `Show 8 ready resources ›`, the reference's own
	   control. The card states its rollup, prints what matters, and hides the
	   tail behind one button. It does not print all 18 rows and it does not
	   omit them, which is the trade that made the old page unreachable. */
	const FOLD = 6;
	let expandPast = $state<Record<string, boolean>>({});
	let expandPending = $state<Record<string, boolean>>({});

	function repoUrl(repoKey: string): string | null {
		if (!repoKey.startsWith('repo:')) return null;
		const body = repoKey.slice('repo:'.length);
		return body.includes('/') ? `https://${body}` : null;
	}
</script>

<svelte:head>
	<title>kuberik | Revisions</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!--
		⛔ THE VISIBLE TITLE SAID WHAT THE NAVBAR ALREADY SAYS. (2026-09-01)
		From the human: *"i think i don't like that we have a title on the page
		when it's already in the navbar."* `Navbar.svelte`'s section breadcrumb
		prints `Revisions` on every `/versions*` URL, and this `h1` printed the
		same word ~40px below it. Two objects, one fact, no second reading.

		THE HEADING IS NOT DELETED, IT IS UNVOICED. The skip link lands on
		`main` and the outline has to start at level 1, so the `h1` stays and
		goes `sr-only`. What takes its place is the ROLLUP the page was hiding
		in a caption — `14 of 36 revisions deployed` — which is the one fact a
		reader cannot get from the navigation. The 24px slot in the type range
		is not lost either: `RevisionLead` renders the build id at 24px
		directly below, so the page now leads with the OBJECT rather than with
		the name of the section it is in.
	-->
	<!-- ══ THE HEAD BAND — ONE ROW, LIKE EVERY OTHER PAGE ═══════════════════
	     THE `h1` WAS ALREADY `sr-only`; WHAT CHANGED IS THE RHYTHM. The rollup
	     ran at `t-headline` (17px) with the definition on a SECOND line at
	     `t-body`, so the head was 50px tall and the first card landed at y=92
	     while `/apps`, `/environments`, `/dependencies` and `/activity` all
	     start theirs at y=72. Two rows of chrome is the drift the human felt as
	     *"pages have slightly different content margins"*.

	     THE COUNT NOW LEADS AT 24px and the definition joins the rollup on its
	     baseline — same words, one row. Nothing was cut: the sentence that
	     defines "revision" for a first-time reader is still the first prose on
	     the page, it is just no longer a second band of chrome. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Revisions</h1>
		{#if scope}
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{scope.deployed}</span>
		{/if}
		<!--
			THE SUBTITLE IS THE PAGE'S ONLY DEFINITION, AND IT DEFINES THE NOUN IN
			THE ROLLUP BESIDE IT. A reader who has never opened kuberik does not
			know what a "revision" is; they do know what a commit is and what
			deploying is. One sentence binds the three, and every string below can
			then be plain.
		-->
		<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
			{#if scope}of {scope.known} revisions deployed.{/if}{' '}One commit, one build. Here is every
			build your services can deploy, and how far each one has got.
		</p>
	</div>

	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-6 mb-0" />
		<div class="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
			<div
				class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
			>
				<div class="h-[47px] animate-pulse bg-gray-50 dark:bg-gray-700/40"></div>
				{#each Array(6) as _}
					<div class="flex items-center gap-3 px-4 py-3">
						<div class="h-4 w-4 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-20 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					</div>
				{/each}
			</div>
			<div
				class="h-48 animate-pulse rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
			></div>
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
			THE ONE BLOCKING FACT, AS A FILLED FIELD.
			`AlertPanel` IS rollout detail's schedule-gate banner — 40px circular
			icon, bold headline, the concrete consequence underneath, a chip on the
			right. `COMPOSITION-GRAMMAR.md` §4: this is what *"attention pulled by
			design, not text"* looks like, against the neutral gray row-band the
			human said *"feels like a bug"*. ONE banner: a page with three has none.
		-->
		{#if blockage}
			<AlertPanel
				severity="warning"
				icon={blockage.window.length > 0 ? CalendarMonthSolid : UserCircleSolid}
				title="{blockage.head.short} can’t go any further yet"
				message={bannerMessage}
				footnote={bannerFootnote}
				class="mt-5"
			>
				{#snippet extra()}
					<Chip
						role="alarm"
						label="{blockage.slots.length} blocked"
						wide
						title="{blockage.slots.length} places — a place is one service in one environment — are waiting on a gate"
					/>
				{/snippet}
				{#snippet actions()}
					<!-- THE ACTION NAMES WHAT IT DOES, NOT WHAT IT OPENS. `Open 0afab6f`
					     asked the reader to already know that the build's page is where a
					     gate is explained and cleared. This says so. -->
					<a
						class="btn btn-secondary"
						href={revisionPath(blockage.repo.repoKey, blockage.head.revision)}
						aria-label={`See what’s blocking build ${blockage.head.short ?? blockage.head.revision}`}
					>
						<ArrowRightOutline class="h-4 w-4" aria-hidden="true" />
						See what’s blocking it
					</a>
				{/snippet}
			</AlertPanel>
		{/if}

		{#each ledgers as repo (repo.repoKey)}
			<!--
				⭐ ONE LEAD ON THE PAGE, NOT ONE PER REPO. *"A page with three banners
				has no banner"* is the same arithmetic for an entry point: on the mock
				cluster there are SEVEN source repos, and a lead panel per repo drew
				seven 24px identifiers down one page, which is a list of headlines and
				therefore no headline. `ledgers` is sorted by most recent deploy, so
				the first repo is the one something happened to most recently — and it
				is the same repo the banner above picks its blocking fact from, so the
				two objects at the top of the page are about one build.
			-->
			{@const lead = repo === ledgers[0] ? leadRow(repo) : null}
			{@const leadCov = lead ? revisionCoverage(lead, coarse) : null}
			{@const live = restRows(repo, lead)}
			{@const past = pastRows(repo).filter((r) => r.revision !== lead?.revision)}
			<!-- ASKED ONCE PER PANEL, NOT PER ROW AND NOT PER REPO. A card whose
			     every row ships under its own sha has no names to report, so the
			     84px name track is 84px of nothing on every one of its rows —
			     which is exactly what `Rolled past` was rendering. Per CARD, every
			     row inside one card is still drawn the same way, so there is
			     nothing for a reader to infer from a present-vs-absent track. -->
			{@const namedLive = repoNamesBuilds(live)}
			{@const namedPast = repoNamesBuilds(past)}
			{@const url = repoUrl(repo.repoKey)}

			<!--
				⭐ THE ENTRY POINT. THE ONE BUILD SOMEONE OPENED THIS PAGE ABOUT.
				*"The page currently presents eleven near-identical rows and asks the
				reader to find the interesting one … There should be an obvious entry
				point — the one revision that matters right now — and a clear, quiet
				path to everything else."*

				It is the NEWEST build any service is running, chosen by rank and never
				by health, so this is not the deleted "highlight the broken row" band
				under a new name. `RevisionLead` states it at 24px over a 26px bar with
				`FleetSpread` naming every segment in words underneath — so a reader who
				has never seen kuberik can answer "what is this, where is it, is prod on
				it" without clicking, without a legend and without a tour.
			-->
			{#if lead && leadCov}
				<!-- NO GREEN ON THIS HEADER. `DESIGN.md`: a green tick on a list
				     surface is a claim that the whole fleet is on head, and this card
				     draws the newest build whether or not that is true. The state
				     colour lives on `BuildStateMark` inside, where it is computed. -->
				<!--
					⛔ THE HEADER ROLLUP SAID `fully rolled out` AND SO DID THE PANEL
					110px BELOW IT. (2026-09-01, measured: `fully rolled out` printed
					THREE times in the first viewport at 1440, twice about the same
					build.) `buildState()` is one function, so the two objects could
					never disagree — they could only ever repeat, and a rollup that
					repeats the body is the furniture the good pages do not draw.
					The state stays where it is COMPUTED and where the bar explains
					it: on `BuildStateMark` inside the lead, with its glyph.

					⭐ WHAT THE ROLLUP SAYS INSTEAD IS THE THING THAT MAKES THE STATE
					HONEST. A live critique filed: *"/versions said `fully rolled out`
					while a build from that commit was held in three places."* The row
					is keyed on the COMMIT, and one commit ships as one release PER
					SERVICE — this repo's own harness publishes the `api` and the
					`frontend` half of a build from a single commit, each with its own
					tag, its own release list and its OWN GATES. So `fully rolled out`
					is never a sentence about a commit; it is a sentence about the N
					releases the commit became, and it is only readable once N is on
					screen. The rollup is that N, in the same count-shaped form as
					every sibling card on the page (`1 build`, `12 builds`,
					`5 services`), and the lead's note names the consequence in words.
				-->
				<Card
					icon={RocketSolid}
					title="Newest build in use"
					verdict="{lead.services.length} service{lead.services.length === 1 ? '' : 's'}"
					verdictTitle="Everything below is counted across the {lead.services
						.length} service{lead.services.length === 1
						? ''
						: 's'} that have a release for this commit. Each ships it as its own release, with its own gates."
					class="mt-5"
				>
					<RevisionLead
						short={lead.short}
						href={revisionPath(repo.repoKey, lead.revision)}
						eyebrow="Newest build"
						coverage={leadCov}
						unitNote
						scopeNote={lead.services.length > 1
							? 'Each service ships this commit as its own release, with its own gates.'
							: ''}
					>
						{#if rowNamesBuild(lead)}
							{#snippet meta()}
								<!-- CRITERION 3 AT LEAD SCALE, AND ONLY WHEN THERE IS ONE. The
								     names this commit ships under, one line each, services
								     running off them. A build whose every service ships it under
								     its own sha has no names to report — and `FleetSpread` below
								     already prints every one of those services beside the
								     environments it is in, so printing them again here would be
								     the same list twice, 40px apart. -->
								{@render names(lead, true)}
							{/snippet}
						{/if}
						<!-- BUTTONS LOOK LIKE BUTTONS — `.btn`, 14px, 8px 16px, with an
						     icon, the geometry measured off `View on GitHub` on the
						     reference page. Both are READ-ONLY: every mutating control on
						     a revision lives on its own page. -->
						<a class="btn btn-secondary" href={revisionPath(repo.repoKey, lead.revision)}>
							<ArrowRightOutline class="h-4 w-4" />
							Open {lead.short}
						</a>
						{#if commitUrlFor(repo.repoKey, lead.revision)}
							<a
								class="btn btn-secondary"
								href={commitUrlFor(repo.repoKey, lead.revision)}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`View the commit for ${lead.short} on GitHub — opens in a new tab`}
							>
								<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
								View commit
							</a>
						{/if}
					</RevisionLead>
				</Card>
			{/if}

			<div class="rev-cols mt-4">
				<div class="flex min-w-0 flex-col gap-4">
					<!--
						CARD 1 — THE QUIET PATH. Everything else still running, one line of
						answer each, ordered newest first so position still carries rank.
						The lead is not repeated here: it is the same object one card up,
						and a list that reprints its own headline has two leads and
						therefore none.
					-->
					<Card
						icon={PlaySolid}
						title={lead ? 'Also still running' : 'Still running'}
						verdict="{live.length} build{live.length === 1 ? '' : 's'}"
						verdictTitle="Older builds that some service is still running"
						padded={false}
					>
						{#if live.length === 0}
							<p class="t-body px-4 py-6 text-center text-gray-500 dark:text-gray-400">
								{lead
									? 'Nothing older is still running — every place is on the build above.'
									: 'Nothing this repo has deployed is still running. Every place has moved on.'}
							</p>
						{:else}
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each live as row (row.revision)}
									{@const cov = coverageByRevision.get(row.revision)}
									<li class="rev-row tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
										<!--
											⭐ ONE GLYPH, ONE SENTENCE, ONE OBJECT — and the row's left
											edge stops being ragged.

											It was a 20px box in its own column whose ICON landed at
											x=41 while the sha started at 64 and the service list at 64
											— three x's down one card, which is what "ragged" was
											naming. The glyph now sits in a 16px track that is exactly
											the icon, so the card has TWO x's: the glyph, and
											everything else.

											`BuildStateMark` also carries the word, so the glyph and
											the phrase can never disagree, and the phrase itself is
											`buildState()`'s — `3 places still to go`, not `has places
											left to reach`.
										-->
										<span class="rev-mark">
											{#if cov}
												<BuildStateMark coverage={cov} showWord={false} />
											{/if}
										</span>

										<div class="min-w-0">
											<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
												<a
													class="rev-sha tap-link t-code text-gray-900 hover:underline dark:text-white"
													href={revisionPath(repo.repoKey, row.revision)}
													title={row.revision}>{row.short}</a
												>
												{#if cov}
													<BuildStateMark coverage={cov} showGlyph={false} />
												{/if}
											</div>

											<!--
												CRITERION 3, AND IT IS UNCHANGED FROM THE ROUND THAT GOT
												IT RIGHT. One line per NAME, not per service: the name
												sits in a fixed track and the services that ship under it
												run out to its right, so `how many names does this commit
												have` is a count you can SEE. A row whose only name is
												its own revision prints nothing here (`rowNamesBuild`) and
												the column's emptiness becomes a third reading for free.
											-->
											{@render names(row, namedLive)}
										</div>

										<!--
											THE ROLLUP, AT ROW SCALE — a stack, not three columns.
											Count on top, bar under it at the same width, age under
											that. THE COUNT DIRECTLY ABOVE THE BAR IS WHAT MAKES THE
											BAR READ WITH NO LEGEND: `6 of 9 places live` over a bar
											two-thirds mint binds the number to the segment in one
											glance, on every row.
											The track is FIXED so the bars are comparable down the
											column, which is criterion 2 and the list's whole reason
											to exist.
										-->
										<div class="rev-roll">
											<span class="t-dense text-gray-700 dark:text-gray-200">
												Running in {row.liveSlots} of {row.totalSlots}
												<span class="text-gray-500 dark:text-gray-400">places</span>
											</span>
											{#if cov}
												<CoverageBar
													segments={coverageSegments(cov)}
													compact
													class="mt-1.5"
													label="running in {cov.liveCount} of {cov.totalCount} places · {cov.buckets
														.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`)
														.join(' · ')}"
												/>
											{/if}
											<span
												class="t-micro mt-1 block text-gray-500 dark:text-gray-400"
												title={ageTitle(row)}>{ageOf(row)}</span
											>
										</div>

										<!--
											⭐ THE CHEVRON IS THE ROW'S AFFORDANCE, SO IT SITS AT THE
											ROW'S EDGE. It used to trail the age string inside the
											rollup stack, which put it mid-row at 390 — floating beside
											nothing, pointing at nothing. It is now its own track,
											hard-right, vertically centred on the whole row, which is
											the form the reference page uses on every `Resources` row
											and on `Show 8 ready resources ›`.
										-->
										<span class="rev-go" aria-hidden="true">
											<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>

					<!--
						CARD 2 — HISTORY. No bar on any row, and that is the argument for
						the split: a revision nothing runs has no wavefront to plot, and
						nine identical flat-gray bars were furniture that looked like data.
					-->
					{#if past.length > 0}
						<Card
							icon={ArchiveSolid}
							title="No longer running anywhere"
							verdict="{past.length} build{past.length === 1 ? '' : 's'}"
							verdictTitle="Deployed at least once; every place that ran them has since moved on"
							padded={false}
						>
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each expandPast[repo.repoKey] ? past : past.slice(0, FOLD) as row (row.revision)}
									<li class="rev-row rev-row--quiet tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40">
										<!-- NO GLYPH HERE, AND THAT IS THE RULE WORKING. Every row in
										     this card has the same answer — the card header says it
										     once — so a per-row mark would be identical twelve times
										     over, which is the furniture the good pages never draw. -->
										<div class="rev-quiet-body">
											<a
												class="rev-sha tap-link t-code shrink-0 text-gray-700 hover:underline dark:text-gray-200"
												href={revisionPath(repo.repoKey, row.revision)}
												title={row.revision}>{row.short}</a
											>
											{@render names(row, namedPast)}
										</div>
										<div class="rev-roll">
											<span class="t-micro text-gray-500 dark:text-gray-400" title={ageTitle(row)}
												>{ageOf(row)}</span
											>
										</div>
										<span class="rev-go" aria-hidden="true">
											<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
										</span>
									</li>
								{/each}
							</ul>
							{#if past.length > FOLD}
								{@render more(
									() => (expandPast = { ...expandPast, [repo.repoKey]: !expandPast[repo.repoKey] }),
									expandPast[repo.repoKey],
									`${past.length - FOLD} older build${past.length - FOLD === 1 ? '' : 's'}`
								)}
							{/if}
						</Card>
					{/if}
				</div>

				<div class="flex min-w-0 flex-col gap-4">
					<!--
						⭐ THE CARD THAT CLOSES THE UNREACHABLE-REVISIONS DEFECT.
						`16 of 34 revisions deployed` used to be a caption, and the
						eighteen builds in the difference had no row, no link and no page
						anywhere in the product. They are the page's own first criterion:
						a build nobody has taken is very much *"still out there"*. Every
						one is a link now, and its detail page is the most actionable page
						in the product for it — `0 of N places live`, and the whole `Not
						yet` bucket naming the gates that are the reason.
					-->
					{#if repo.pending.length > 0}
						<Card
							icon={HourglassOutline}
							title="Never deployed"
							verdict="{repo.pending.length} build{repo.pending.length === 1 ? '' : 's'}"
							verdictTitle="Your services could deploy these; none of them has"
							padded={false}
						>
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each expandPending[repo.repoKey] ? repo.pending : repo.pending.slice(0, FOLD) as row (row.revision)}
									<!-- ⭐ THE SAME TAP ZONE AS EVERY OTHER ROW ON THE PAGE.
									     These rows had a hover fill, a chevron and 300px of dead
									     space: the row read as a door and only the seven
									     characters of the sha opened it. `src/lib/CLAUDE.md`:
									     *"A region that reads as a destination must BE one."* -->
									<li
										class="tap-zone flex items-baseline gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<a
											class="tap-link t-code min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
											href={revisionPath(repo.repoKey, row.revision)}
											title={row.revision}>{row.short}</a
										>
										<span class="t-micro ml-auto shrink-0 text-gray-500 dark:text-gray-400">
											{row.services.length} service{row.services.length === 1 ? '' : 's'}
										</span>
										<span
											class="t-micro w-14 shrink-0 text-right text-gray-500 dark:text-gray-400"
											title={ageTitle(row)}>{ageOf(row)}</span
										>
										<ChevronRightOutline
											class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
											aria-hidden="true"
										/>
									</li>
								{/each}
							</ul>
							{#if repo.pending.length > FOLD}
								{@render more(
									() =>
										(expandPending = {
											...expandPending,
											[repo.repoKey]: !expandPending[repo.repoKey]
										}),
									expandPending[repo.repoKey],
									`${repo.pending.length - FOLD} more build${repo.pending.length - FOLD === 1 ? '' : 's'}`
								)}
							{/if}
							<!-- THE CARD SAYS WHAT ITS ROWS ARE, in the reference's own
							     footer form. `Built, never deployed` was a title a reader had
							     to already understand; this is the sentence that makes it
							     mean something the first time. -->
							<p
								class="t-micro border-t border-gray-100 px-4 py-2.5 text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
							>
								Your services can deploy these commits. None of them has yet.
							</p>
						</Card>
					{/if}

					<!--
						THE SCOPE LINE, AS AN OBJECT. It was a 10px gray eyebrow floating
						above a bordered box — the exact shape `COMPOSITION-GRAMMAR.md`
						names as what keeps getting rejected. It states both halves of the
						boundary (`DESIGN.md` forbids silently dropping builds off a list)
						and both halves are now reachable.
					-->
					<Card
						icon={CodeBranchOutline}
						title={repo.repoLabel}
						verdict="{repo.serviceCount} service{repo.serviceCount === 1 ? '' : 's'}"
						padded={false}
					>
						<!--
							⛔ THIS CARD USED TO RESTATE THE WHOLE PAGE IN FOUR ROWS.
							(2026-09-02, from the human, about quantities said twice.)
							Measured at 1440 with this cluster's single repo, every one of
							its four facts was already on screen:

							  · `Commits your services can deploy 36` — the head band says
							    `14 of 36 revisions deployed`, 24px from the top.
							  · `Deployed at least once 14` — the same head band, the same
							    sentence, the leading numeral of it.
							  · `Still running somewhere 2` — the two cards in the column
							    beside it ARE that partition: the lead panel is one build
							    and `Also still running` carries `1 build` as its rollup.
							  · `A place is one service in one environment — 5 services…` —
							    `RevisionLead`'s unit note prints that sentence verbatim
							    500px above, under the number it defines.

							WHAT SURVIVES IS THE ONE NUMBER NOTHING ELSE ON THE PAGE
							STATES: the denominator every coverage bar is drawn against.
							The two ledger totals come back when there is MORE THAN ONE
							REPO, because the head band aggregates across repos and is then
							no longer this repo's own scope — the rule is duplication, not
							position.
						-->
						<dl class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#if ledgers.length > 1}
								{@render fact('Commits your services can deploy', String(repo.knownRevisions))}
								{@render fact('Deployed at least once', String(repo.rows.length))}
							{/if}
							{@render fact('Places to deploy to', String(repo.slotCount))}
						</dl>
						{#if url}
							<div class="px-4 py-3">
								<a class="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">
									<ArrowUpRightFromSquareOutline class="h-4 w-4" />
									View repository
								</a>
							</div>
						{/if}
					</Card>
				</div>
			</div>
		{/each}
	{/if}
</div>

{#snippet fact(term: string, value: string)}
	<div class="flex items-baseline justify-between gap-3 px-4 py-2.5">
		<dt class="t-dense min-w-0 truncate text-gray-500 dark:text-gray-400">{term}</dt>
		<dd class="t-dense shrink-0 text-gray-900 dark:text-white">{value}</dd>
	</div>
{/snippet}

{#snippet more(toggle: () => void, open: boolean | undefined, label: string)}
	<!-- `Show 8 ready resources ›` — the reference's progressive-disclosure
	     control, verbatim in form. The card states its rollup, prints what
	     matters, and hides the tail behind ONE button. -->
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
							<span class="rev-svc-name t-body text-gray-700 dark:text-gray-200">{svc.appName}</span>
							{#if svc.diverged}
								<!--
									⛔ THE WORD COMES FROM `rankLabel`, NOT FROM THIS FILE.
									(2026-09-01) It said `diverged` — git's word for two branches —
									while `/apps`, `/environments` and `/envs/*` all said
									`unreleased`, which is the fact: the build is on no
									environment's release list. One fact, one spelling, and it is
									now READ from the product's one formatter so this call site
									cannot drift a sixth time. Same `diverged` Chip ROLE, same
									colour value; only the string moves.
									The title says `release list` for the same reason — `release
									line` was this page's own third noun for the same object.
								-->
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

	/* TWO COLUMNS WITH A REAL RIGHT RAIL — `COMPOSITION-GRAMMAR.md` §7. The
	   rail is not a sidebar of scraps; it is a stack of small complete answers
	   (what nobody has taken, and what this repo is). It collapses under the
	   main column below `lg`, where a 340px rail beside a coverage bar would
	   leave neither enough width. */
	.rev-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}

	@media (min-width: 1024px) {
		.rev-cols {
			grid-template-columns: minmax(0, 1fr) 340px;
		}
	}

	/*
	 * THE ROW: glyph · identity+names · a right-aligned ROLLUP STACK.
	 *
	 * NOT A FIFTH FIVE-COLUMN TABLE. The rollup is one track holding three
	 * stacked lines — count, bar, age — which is the card-header rollup habit
	 * applied at row scale, and it is what lets a reader take the row's answer
	 * without reading the row.
	 *
	 * The rollup track is FIXED at 200px because a proportional bar is only
	 * comparable against the bar above it if the two are drawn to the same
	 * width and at the same x. That comparison is criterion 2.
	 */
	.rev-row {
		position: relative;
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 200px 16px;
		gap: 12px;
		padding: 12px 16px;
		align-items: start;
	}

	/* HISTORY IS ONE LINE PER REVISION. Two lines each turned twelve settled
	   facts into twenty-four, and the sha and the services it shipped under are
	   one fact. `flex-wrap` so a repo with five services still degrades to two
	   lines rather than overflowing. */
	.rev-row--quiet {
		grid-template-columns: minmax(0, 1fr) 96px 16px;
		padding-top: 8px;
		padding-bottom: 8px;
		align-items: baseline;
	}

	.rev-quiet-body {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 16px;
		min-width: 0;
	}

	.rev-quiet-body .rev-names {
		margin-top: 0;
	}

	/*
	 * ⭐ THE GLYPH TRACK IS EXACTLY THE GLYPH — 16px, no box around it.
	 *
	 * It was a 20px box holding a 16px icon, which put the icon's own left edge
	 * 2px inside the track and gave the card THREE left x's: the glyph at 41,
	 * the sha at 64, the service list at 64. The human called it ragged and it
	 * was. At 16px the track IS the icon, so the card has exactly two: the
	 * glyph, and everything else.
	 *
	 * `height: 20px` centres it on the sha's own 20px line box, so the glyph
	 * sits on the identifier's line rather than at the top of a two-line cell —
	 * the same rule the banner's 40px disc now follows.
	 */
	.rev-mark {
		display: flex;
		align-items: center;
		height: 20px;
	}

	/*
	 * THE ROW'S AFFORDANCE, AT THE ROW'S EDGE AND CENTRED ON THE WHOLE ROW.
	 * It trailed the age string before, which floated it mid-row at 390. A
	 * chevron that does not sit at the edge of the thing it opens is pointing
	 * at nothing.
	 */
	.rev-go {
		position: absolute;
		right: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
	}

	.rev-roll {
		text-align: right;
		min-width: 0;
	}

	/* ⛔ THE LOCAL `.rev-sha::after` STRETCH IS GONE — `app.css`'s
	   `.tap-zone` / `.tap-link` OWNS IT NOW. (2026-09-01) The geometry was
	   identical and the three things around it were not: the shared pattern
	   raises every other control in the row above the overlay, draws the
	   FOCUS RING on the `::after` so a keyboard user sees the whole region
	   that Enter will activate, and resolves a nested zone to the nearer
	   destination. A page-local copy of a shared affordance is how the two
	   drift. The rule that stays here is `position: relative` on `.rev-row`,
	   because `.rev-go` is positioned against it as well. */

	/* THE GLYPH INKS MOVED TO `BuildStateMark.svelte`, WITH THE GLYPH. They were
	   declared here and handed to `Card` as `iconClass`, where a Svelte-scoped
	   class cannot reach — the rule matched nothing and the icon rendered gray
	   the whole time. Scoped styles only style this component's own markup, so
	   a colour that has to travel is a colour that belongs to the component it
	   lands in. */

	/*
	 * THE NAMES CELL — a stack of lines, each line a two-track grid.
	 *
	 * 84px, AND IT IS A COLUMN, NOT A GAP. The NAME is the variable and the
	 * service is the constant, so the name gets the fixed left track and the
	 * services hang off it — which is what turns "how many names does this
	 * commit have" into something you can see rather than read.
	 * `minmax(84px, max-content)` rather than a hard 84px: a longer label
	 * pushes its own line rather than ellipsising into another label. A pushed
	 * line loses cross-row alignment on that line only; a clipped label loses
	 * the identifier.
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

	/* PINNED TO TRACK 2, NOT AUTO-PLACED INTO IT. A row whose only name is its
	   own sha prints no name, so the services would otherwise land in track 1
	   and start at a different x from the rows above — precisely the raggedness
	   the name track exists to remove. */
	.rev-name-svcs {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 8px;
		min-width: 0;
	}

	/* NO NAMES ANYWHERE IN THIS REPO, SO NO NAME TRACK AT ALL. A whole-PANEL
	   question: holding 84px open on every row of a card that can never fill it
	   is 84px of nothing. */
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

	/* A NAME NEVER BREAKS ACROSS TWO LINES. The run breaks between services
	   only; a name that cannot fit ellipsises rather than splitting, because an
	   ellipsised name still identifies and a split one does not. */
	.rev-svc-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/*
	 * PHONE WIDTH IS A DESIGN, NOT A FALLBACK.
	 *
	 * A 200px rollup track cannot sit beside a names list at 358px of content,
	 * so the row becomes TWO BANDS: identity and names on top, the rollup
	 * below, full width, with the count and the age on one line and THE BAR
	 * SPANNING THE WHOLE ROW — at 358px it is the clearest it ever gets, and it
	 * is the one object that answers "do I care about this row".
	 */
	@media (max-width: 639px) {
		.rev-row {
			grid-template-columns: 16px minmax(0, 1fr) 16px;
			gap: 8px 12px;
		}

		.rev-row--quiet {
			grid-template-columns: minmax(0, 1fr) auto 16px;
		}

		/* SECOND BAND, SECOND COLUMN — so the count, the bar and the age all
		   start at the SAME x as the sha and the service names above them. The
		   row therefore has one text edge at 390, not two. */
		.rev-roll {
			grid-column: 2;
			text-align: left;
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 4px 12px;
		}

		/* The bar takes its own full-width line under the count and the age,
		   which are now peers on one line above it. */
		.rev-roll :global(.cov) {
			width: 100%;
			margin-top: 0;
		}

		/*
		 * THE NAME TRACK BECOMES A LINE, NOT A COLUMN, AT 390.
		 *
		 * A fixed 72-84px track buys cross-row alignment, which is worth paying
		 * for at 1440 and is not at 390: it left the services 215px of a
		 * 358px content width and wrapped `hello-multi-app · hello-world-app ·
		 * hello-world-manifests` onto three lines on every row of the card,
		 * while the track itself was empty on all but one of them.
		 *
		 * Stacked, the name is the HEADING of its group and the services start
		 * at the cell's own left edge, so they still share one x down the whole
		 * card — the same alignment, bought with a line break instead of 84px.
		 */
		.rev-name-row {
			grid-template-columns: minmax(0, 1fr);
			column-gap: 0;
		}

		.rev-name,
		.rev-name-svcs {
			grid-column: 1;
		}
	}
</style>
