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
		releaseSplit,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';
	import { joinClauses } from '$lib/view-models/blocking-story';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	// THE RAIL CARD'S TITLE IS THE REPO, NOT THE URL. See `repo-title.ts`.
	import { repoTitle } from './repo-title';
	// THE PRODUCT'S ONE RANK VOCABULARY. This page prints exactly one of its
	// words — `unreleased` — and it takes it from here rather than spelling it.
	import { rankLabel } from '$lib/view-models/env-rank';
	import { now } from '$lib/stores/time';
	import {
		ArchiveSolid,
		ArrowRightOutline,
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		// ⛔ `PlaySolid` WAS THIS CARD'S ICON AND IT WAS A LIE. (2026-09-02, from
		// the human: *"`Also still running` uses a ▶ play triangle as its card
		// icon. Play means START; this card means STILL LIVE."*) `src/lib/CLAUDE.md`:
		// *"a mark that is not true of its kind is worse than no mark"* — an icon
		// names an OBJECT, and nothing on this page starts anything.
		// The true mark already exists: `live` is `CheckCircleSolid` in
		// `BuildStateMark`'s GLYPH map and in the detail page's `BUCKET_ICON`,
		// and every row in this card carries that same glyph. One vocabulary.
		CheckCircleSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		CodeBranchOutline,
		HourglassOutline,
		RocketSolid,
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
		rolloutsListQueryOptions({
			options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) }
		})
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

	/**
	 * ⭐ WRAP AT A TOKEN, NEVER THROUGH ONE. (2026-09-03, design pass 9
	 * re-check, F6) `.rev-svc-name` truncated `hello-world-manifests` to
	 * 127px of 151 at 1024 and 99 of 151 at 640 — an ellipsis on a SERVICE
	 * NAME, the one string the row exists to identify. The same defect and
	 * the same fix as `DependencyNode`'s stacked box: a bare `overflow-wrap`
	 * would break mid-word (`hello-fronte` / `nd-app`, the live bug that fix
	 * closed), so this inserts a `<wbr>` after every hyphen instead — the
	 * only break points a kebab-case app name actually has.
	 */
	function identParts(name: string): string[] {
		return name.split(/(?<=-)/);
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

	/**
	 * ⭐ THE HERO'S OWN RELEASE-SPLIT CAPTION. (2026-09-03, operator-walk
	 * finding B4 — *"`6 of 6 PLACES RUNNING IT` over a bar that reads 3 green
	 * + 3 [held]; the operator reads the bar as 3 of 6."*) `6 of 6` and the
	 * bar both answer "does this place run the revision", correctly — the
	 * held segment's fill is what stopped implying "empty" (see
	 * `HELD_SEGMENT_FILL`'s own note). What was still missing on THIS page's
	 * hero is the sentence `/versions/<rev>`'s own head band already prints
	 * for the identical fact — same `releaseSplit()`, same wording, so the
	 * list's hero and the detail page's hero cannot describe one build two
	 * ways two clicks apart.
	 */
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

	/**
	 * ⭐ THE DISCLOSED TIER IS A RECORD, AND THE TRIGGER COUNTS. (2026-09-02)
	 *
	 * It was one run-on string — *"A deployment window is closed — it opens in
	 * 1d 4h (8/31/2026, 1:00:00 PM). 2 gates need an approval or an external
	 * check: ghd-xm669, hello-world-manual-approval."* — behind a control
	 * labelled `Details`. That is a SET of gate handles with a count already in
	 * the prose, plus a clock, narrated at 12px inside an amber field. Every
	 * fact in it survives; each one now has its own row and its own label, and
	 * the count moves out of the sentence and into the control, which is where
	 * a reader uses it (`lib/disclosure.ts`).
	 *
	 * ⛔ THE TWO BUCKETS STAY APART. `window` (a gate reporting `passing:
	 * false`) and `approval` (a gate that published an allow-list) clear
	 * differently and the old sentence said so; collapsing them into one `Rule`
	 * label would drop that. They are the `<dt>`s.
	 */
	const bannerFacts = $derived.by<Fact[]>(() => {
		const b = blockage;
		if (!b) return [];
		const facts: Fact[] = [];
		// THE CLOCK LEADS, because it is the only row that answers "when".
		// ⛔ AND ONLY WHERE THERE IS ONE. A window with no `nextTransition` has
		// no reopening to state, and `opens` with nothing after it is a broken
		// row — the same fence `BlockingStoryLines` puts on `clearsAt`.
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

	/** The SET the trigger counts: gate handles, both buckets, never the clock. */
	const bannerRuleCount = $derived(
		(blockage?.window.length ?? 0) + (blockage?.approval.length ?? 0)
	);

	/* PROGRESSIVE DISCLOSURE — `Show 8 ready resources ›`, the reference's own
	   control. The card states its rollup, prints what matters, and hides the
	   tail behind one button. It does not print all 18 rows and it does not
	   omit them, which is the trade that made the old page unreachable. */
	const FOLD = 6;
	let expandPast = $state<Record<string, boolean>>({});
	let expandPending = $state<Record<string, boolean>>({});

	/**
	 * ⭐ THE TWO RECORDS THE PRINTED CAPTIONS BECAME, AS SCRIPT LITERALS.
	 *
	 * (2026-09-02.) Both sentences used to be drawn under their cards and are
	 * now the `verdictTitle` behind the rollup that counts the thing they
	 * define — which is what the human asked for: *"definitions belong in a
	 * `title` on the term they define, or behind the existing `2 services`
	 * trigger as a record — not printed."*
	 *
	 * ⛔ AND THEY LIVE HERE, NOT INLINE ON THE `<Card>`, BECAUSE OF THE CENSUS.
	 * `scan.ts` reads `title` / `aria-label` / `alt` / `placeholder` — it does
	 * NOT read a component prop called `verdictTitle`, so a sentence written
	 * inline there leaves `catalogue.txt` silently and `drift.test.ts` stays
	 * green while an operator-visible claim goes untracked. A string literal in
	 * a `<script>` block IS scanned (kind `code`), so hoisting them keeps both
	 * facts pinned. Unprinting a sentence must never unpin it.
	 */
	function scopeRecord(n: number): string {
		const services = `${n} service${n === 1 ? '' : 's'}`;
		return `Everything below is counted across the ${services} that have a release for this commit. Each service ships this commit as its own release, with its own gates.`;
	}

	const PENDING_RECORD = 'Your services can deploy these commits. None of them has yet.';

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
		<!--
			⛔ THE DEFINITION CAME OFF THE PRINTED TIER. (2026-09-02, from the
			human: *"descriptive text pollutes and attention is pulled by
			design"*; this was one of four definitions this page printed.)
			`One commit, one build. Here is every build your services can deploy,
			and how far each one has got.` is what a `revision` IS — a definition
			of the noun in the rollup beside it, not a fact about this cluster.
			It is the `title` on the rollup now: a reader who does not know the
			word can ask for it on the exact sentence that uses it, and a reader
			who does is not made to read it on every visit.

			⛔ NOTHING WAS DELETED. `scan.ts` reads `title` as an
			operator-visible literal, so the sentence stays in `catalogue.txt`
			and `drift.test.ts` still pins it.
		-->
		<p
			class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400"
			title="One commit, one build. Here is every build your services can deploy, and how far each one has got."
		>
			{#if scope}of {scope.known} revisions deployed{/if}
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
		<!-- ⭐ THE RECORD. `FactList` is the product's one aligned `<dl>`;
		     `tone="banner"` makes it read `currentColor` off `AlertPanel`'s
		     footnote ink, so it speaks in the severity's voice. -->
		{#snippet gateFacts()}
			<FactList facts={bannerFacts} tone="banner" />
		{/snippet}

		{#if blockage}
			<AlertPanel
				severity="warning"
				icon={blockage.window.length > 0 ? CalendarMonthSolid : UserCircleSolid}
				title="{blockage.head.short} can’t go any further yet"
				message={bannerMessage}
				footnoteBody={bannerRuleCount > 0 ? gateFacts : undefined}
				footnoteCount={bannerRuleCount > 0 ? bannerRuleCount : undefined}
				class="mt-5"
			>
				{#snippet extra()}
					<Chip
						role="alarm"
						label="{blockage.slots.length} blocked"
						wide
						title="{blockage.slots
							.length} places — a place is one service in one environment — are waiting on a gate"
					/>
				{/snippet}
				{#snippet actions()}
					<!-- THE ACTION NAMES WHAT IT DOES, NOT WHAT IT OPENS. `Open 0afab6f`
					     asked the reader to already know that the build's page is where a
					     gate is explained and cleared. This says so.

					     ⛔ AND IT IS `.nav-link`, NOT `.btn`. (2026-09-02.) It opens a
					     page; it clears no gate and changes no cluster state. Every other
					     banner action in the product was moved off `.btn` in the
					     2026-09-02 sweep — `/environments`, `/envs/<name>`, `NextStep`,
					     which carries `/activity` and the dependencies tab — and this
					     route was owned elsewhere that day, so it was the one left.
					     `AlertPanel` sets `--nav-link-ink: currentColor` on this row, so
					     the link speaks in the severity's ink like the `1 rule`
					     disclosure above it. -->
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
					`5 services`), and its `verdictTitle` names the consequence in
					words — which is where the printed caption `Each service ships this
					commit as its own release, with its own gates.` went (2026-09-02):
					it was drawn AND held in this record, and a definition belongs in
					the record, not on the card.
				-->
				<Card
					icon={RocketSolid}
					title="Newest build in use"
					verdict="{lead.services.length} service{lead.services.length === 1 ? '' : 's'}"
					verdictTitle={scopeRecord(lead.services.length)}
					class="mt-5"
				>
					<RevisionLead
						short={lead.short}
						href={revisionPath(repo.repoKey, lead.revision)}
						eyebrow="Newest build"
						coverage={leadCov}
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
						<!--
							⭐ THE RELEASE-SPLIT CAPTION — see `releaseSplitSentence`'s own
							note (2026-09-03, operator-walk B4). Rendered as a full-width
							`children` row (`RevisionLead`'s own prop doc: "a second line …
							Buttons and any page-specific note, under the spread" — this IS
							that note), `basis-full` so it takes its own line above
							`View commit` rather than sitting inline beside it. Empty on the
							ordinary build (every live place on its own release), which is
							most of them — `releaseSplit` returns `[]` and nothing renders.
						-->
						{#if releaseSplitSentence(leadCov)}
							<p class="t-body basis-full text-gray-500 dark:text-gray-400">
								{releaseSplitSentence(leadCov)}
							</p>
						{/if}
						<!--
							⛔ `Open <sha>` IS GONE, NOT RESTYLED. (2026-09-02, from the
							human: *"two navigation controls wearing button chrome … `Open
							9f10e49` may be redundant with the lead card being a tap zone —
							check, and delete rather than restyle if so."*) Checked: its
							`href` was `revisionPath(repo.repoKey, lead.revision)`,
							byte-identical to the 24px sha `RevisionLead` already renders as
							an `<a>` 260px above it. `src/lib/CLAUDE.md`: *"a second control
							inside one, pointing at the SAME destination, is a redundant tab
							stop — delete it rather than restyle it."* The card is TWO tab
							stops now, one per destination: the build, and the commit.

							⛔ AND `titleHref` ON THIS CARD WAS TRIED AND TAKEN BACK OUT IN
							THE SAME PASS. It made the 47px header a `.tap-zone` to the same
							build — which does not REMOVE the duplicate tab stop, it MOVES
							it off `Open <sha>` and onto the header. The rule that makes a
							header a door is *"a card header carrying an OBJECT'S NAME"*,
							and this one carries `Newest build in use`, which is the name of
							a SECTION. The object's name is `9f10e49`, it is 24px, it is
							already the link, and one door is the whole point.

							⭐ `View commit` IS NAVIGATION AND NOW LOOKS LIKE IT. It only
							changes what you are looking at (someone else's page, at that),
							so it is `.nav-link` with the external glyph — the rule's stated
							answer for an outbound link. It changes no cluster state, so it
							never earned `.btn`.
						-->
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
					<!--
						CARD 1 — THE QUIET PATH. Everything else still running, one line of
						answer each, ordered newest first so position still carries rank.
						The lead is not repeated here: it is the same object one card up,
						and a list that reprints its own headline has two leads and
						therefore none.
					-->
					<Card
						icon={CheckCircleSolid}
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
											⭐ ONE GLYPH, NOT ONE GLYPH PLUS A SENTENCE — and the row's
											left edge stops being ragged.

											It was a 20px box in its own column whose ICON landed at
											x=41 while the sha started at 64 and the service list at 64
											— three x's down one card, which is what "ragged" was
											naming. The glyph now sits in a 16px track that is exactly
											the icon, so the card has TWO x's: the glyph, and
											everything else.

											⛔ `BuildStateMark`'S WORD USED TO SIT BESIDE THE SHA TOO,
											AND IT RESTATED THE SAME COUNT `Running in N of M places`
											PRINTS 90px BELOW IT. (2026-09-02, residue — the detail
											page's head band had the identical duplication, `3 of 6
											places running it` beside `⧗ 3 places still to go`, and
											both are fixed the same way.) The GLYPH stays — it is a
											CATEGORY mark (still arriving / moved past / failing / done),
											not a restated number, and `buildState()`'s `title` on the
											span still carries the full sentence for anyone who hovers
											or reads it with a screen reader. The count is stated once,
											in `.rev-roll`, where the bar that draws it already sits.
										-->
										<span class="rev-mark">
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
									<li
										class="rev-row rev-row--quiet tap-zone hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<!-- NO GLYPH HERE, AND THAT IS THE RULE WORKING. Every row in
										     this card has the same answer — the card header says it
										     once — so a per-row mark would be identical twelve times
										     over, which is the furniture the good pages never draw. -->
										<div class="rev-quiet-body">
											<a
												class="ident rev-sha tap-link t-code shrink-0 text-gray-700 hover:underline dark:text-gray-200"
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
							verdictTitle={PENDING_RECORD}
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
						<!-- ⛔ A FOOTER `<p>` PRINTED THE CARD'S OWN `verdictTitle`.
						     (2026-09-02, from the human: this was the third of three
						     definitions this page drew.) It read `Your services can
						     deploy these commits. None of them has yet.` — the same
						     fact as the `N builds` rollup's record 200px above it,
						     twice on one card. The record keeps it; the page stops
						     printing it. -->
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
						title={repoTitle(repo.repoLabel)}
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
						<!--
							⛔ THE THIRD NAVIGATION CONTROL WEARING BUTTON CHROME ON THIS
							ROUTE. (2026-09-02, same sweep as the lead card's two.) It
							changes no cluster state — it opens someone else's website —
							so it is `.nav-link` with the external glyph, the rule's stated
							answer for an outbound link.

							⭐ IT ALSO CARRIES THE HOST THE CARD TITLE STOPPED PRINTING.
							The title is `littlechimera/kuberik-testing` now (see
							`repo-title.ts`); `title={repo.repoLabel}` on this link is where
							`github.com/…` remains readable, on the one control that resolves
							to it.
						-->
						{#if url}
							<div class="px-4 py-1.5">
								<a
									class="nav-link"
									href={url}
									target="_blank"
									rel="noopener noreferrer"
									title={repo.repoLabel}
								>
									View repository
									<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
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
							<span class="rev-svc-name t-body text-gray-700 dark:text-gray-200"
								>{#each identParts(svc.appName) as part, pi (pi)}{part}{#if pi < identParts(svc.appName).length - 1}<wbr
										/>{/if}{/each}</span
							>
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

	/* ⛔ SUPERSEDED (2026-09-03, design pass 9 re-check, F6): ellipsis is not
	   the safer choice here — it CLIPPED the name, which is a worse defect
	   than a wrap. `identParts` in the markup breaks only after a `-`, so
	   "the run breaks between services only" survives as "the run breaks
	   between services, or at a hyphen inside a name that has run out of
	   room" — never mid-token. `white-space: normal` (the default, stated
	   for clarity against the sibling rules around it) plus `overflow-wrap:
	   normal` refuses the browser's own last-resort mid-word break. */
	.rev-svc-name {
		min-width: 0;
		white-space: normal;
		overflow-wrap: normal;
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
