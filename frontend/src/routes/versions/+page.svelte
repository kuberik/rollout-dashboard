<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { revisionPath } from '$lib/version-utils';
	import { buildRevisionLedger, rowNamesBuild, type RevisionRow } from '$lib/view-models/revision-ledger';
	import { revisionCoverage, coverageSegments, type RevisionCoverage } from '$lib/view-models/revision-coverage';
	import { now } from '$lib/stores/time';
	import { TagOutline } from 'flowbite-svelte-icons';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import type { Rollout, Environment } from '../../types';

	/**
	 * `/versions` — THE REVISION LEDGER, RANKED BY COVERAGE.
	 *
	 * The row is the COMMIT, not the label. See `view-models/revision-ledger.ts`
	 * for why (one commit was rendering as three rows with three different
	 * ranks, and claiming three services when five carried it).
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * ROUND FOUR. THREE ROUNDS FAILED ON ONE WORD — "RAW" — AND THE FOURTH
	 * STOPPED ITERATING THE CELL.
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * Round 1 put the services in a wrapped paragraph. Round 2 put one service
	 * per line, which measured better (7.9x proximity) and was called raw
	 * anyway. Round 3 hung an `[AS][label]` badge on the deviating lines. Still
	 * raw. Three attempts at the SERVICES CELL, and the verdict never moved,
	 * which is the signal that the cell was not the defect.
	 *
	 * So this round did what the human asked for instead: loaded the three
	 * pages they call the best ones — `/`, `/rollouts` and a rollout detail —
	 * and took the row apart against them. TWO THINGS ARE TRUE OF ALL THREE
	 * AND WERE TRUE OF NONE OF THIS PAGE:
	 *
	 *   1. THE GRAPHIC IS THE DEVIATION, NOT THE FURNITURE. On `/`, one
	 *      rollout is `Trailing` and it sits alone above fourteen `Steady`
	 *      ones; the eye lands on it before you read a word. On `/rollouts`
	 *      the status mark is the same green tick on every card *because every
	 *      card is healthy* — the moment one is not, one mark differs. Nothing
	 *      on those pages draws a graphic that is identical on nine rows out of
	 *      eleven. THIS PAGE DID: nine of eleven revisions are rolled past, and
	 *      each drew a full-width flat gray coverage bar. Eleven bars, two of
	 *      which carried information. The rest were furniture that looked like
	 *      data, and they diluted the two that were data by a factor of five.
	 *
	 *   2. THE QUIET HALF OF A PAIR IS A COLUMN, NOT A SENTENCE. Every object
	 *      on those pages puts its identifier in a FIXED SLOT — `[NEWEST]
	 *      [1.66.0-66]` is always bottom-left of a `/rollouts` card, always
	 *      right-aligned in a `/` pill. This page's second cell was a run of
	 *      service names whose left edge was the same five strings, repeated
	 *      forty times down the page, carrying nothing. The VARIABLE was the
	 *      label, and the label was the thing being hidden.
	 *
	 * WHAT THE ROW IS NOW.
	 *
	 *   · `Ships as` is ONE LINE PER NAME, not one line per service, with the
	 *     name in a fixed 84px track so the names form a COLUMN down the whole
	 *     page. `9f10e49` has three lines because it has three names; `3cc206c`
	 *     has one because it has one. Criterion 3 — *"which services ship it,
	 *     and under what labels"* — stops being a paragraph you read and
	 *     becomes a count you can see. Nothing is dropped: every service is
	 *     still named, on the line of the name it ships under.
	 *   · A ROW WHOSE ONLY NAME IS THE REVISION DOES NOT PRINT IT TWICE. Six
	 *     of the eleven rows read `3cc206c │ 3cc206c │ hello-multi-app · …`,
	 *     the identical string 60px apart, which is the purest form of *"text
	 *     doesn't cut it and just pollutes"*. Suppressing it costs the reader
	 *     nothing: there is exactly ONE group, so no absence sits beside a
	 *     presence to be decoded, and the fact it stated is already stated by
	 *     the sha at the head of the row. See `rowNamesBuild` for why this is
	 *     not the `labelDiffers` rule returning.
	 *     THE SERVICES DO NOT MOVE. The 84px track stays open and empty and
	 *     they stay pinned to track 2, so their left edge is x=513 on all
	 *     eleven rows. What the reader gains is a THIRD reading of the column
	 *     for free: five rows carry names and six are blank, so *which commits
	 *     were renamed by somebody* is now legible from across the room, with
	 *     no mark, no colour and no word spent on it.
	 *   · AND THE NAME TRACK ITSELF DISAPPEARS IN A REPO THAT NEVER RENAMES
	 *     ANYTHING. Asked once per PANEL, not per row — see `repoNamesBuilds`.
	 *     A repo whose services all ship every build under its own sha has no
	 *     names to report, and the track degenerates into a second copy of the
	 *     `Revision` column; measured on the mock fleet, `checkout-edge`
	 *     printed `4d0b7e8  4d0b7e8  checkout-edge` twenty-five rows running.
	 *     The header then reads `Services`, and every row of that table is
	 *     rendered the same way, so there is still nothing to infer.
	 *   · THE BAR IS DRAWN ONLY WHERE THERE IS COVERAGE. A revision nothing
	 *     runs has no wavefront to plot, and its old all-gray bar was a
	 *     statement of that dressed as a measurement. Two bars on the page now,
	 *     and they are the only chromatic marks on it, so the page's first
	 *     criterion — *"what's still out there?"* — is answered before you read.
	 *     The `Live` column still prints `rolled past` in words on those rows,
	 *     so the empty track is explained on its own row and is not a mystery.
	 *
	 * MEASURED, live cluster, 1440: the service cell went from 40 lines to 19,
	 * of which 13 carry a name. Bars 11 → 2. Chromatic elements 7 → 3.
	 * Badges 8 → 0. Headers unmoved at 337 / 417 / 975 / 1147 / 1223, and the
	 * services hold one x — 513 — on every row.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * THE LEGEND IS GONE, AND SO IS THE RULE IT WAS EXPLAINING.
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * The footer key and its caption (*"a service with no AS badge ships this
	 * revision under its own sha"*) are deleted. The human has rejected legends
	 * twice and a caption in prose is a legend.
	 *
	 * BUT DELETING THE CAPTION ALONE WOULD HAVE LEFT THE OBJECT UNEXPLAINED,
	 * which is the trade the `/apps` ruler made three times before it was cut.
	 * The caption existed because the page had an EXCEPTION RULE — print a
	 * label only where it differs from the row's own sha — and an exception
	 * rule cannot be read off a row: a line with no label is indistinguishable
	 * from missing data.
	 *
	 * SO THE RULE WAS DELETED, NOT THE EXPLANATION. Grouping by name means
	 * every group prints its own name, including the group whose name IS the
	 * revision. A reader never sees a present label beside an absent one, so
	 * there is nothing to infer and nothing to state. `9f10e49` reading
	 * `1.66.0-66 · 2.66.0-66 · 9f10e49` says "three names, one of them the
	 * commit's own" without a word of prose. The detail page's `valueDim` and
	 * its matching caption went the same way, so the two pages now express one
	 * rule — *a name shown is always shown in full* — instead of two.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * COLOUR
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * Measured before: 2 distinct chromatic values over 7 elements (light and
	 * dark alike). After: the same 2 values over 3 elements. What went:
	 *
	 *   · THE LEGEND'S THREE SWATCHES. Two chromatic, one gray.
	 *   · THE MINT ON THE `14/15` COUNT — the newest arrival on this page and
	 *     the one that answers *"there are some new colors there too"*. It came
	 *     in on 2026-08-27 to mark the page's first question, and DESIGN.md's
	 *     own rule kills it: **colour goes on MARKS, never on PROSE.** A count
	 *     in a column is prose. The mint 12px to its left, in the bar, is the
	 *     mark, and it says the same thing at higher precision.
	 *   · THIRTEEN GRAY `ahead` SEGMENTS, with the bars that carried them.
	 *
	 * The two survivors are the coverage bar's `live` mint and its `notYet`
	 * amber, both governed by DESIGN.md's FIELD CEILING, both argued there at
	 * length, and both left alone: §1 requires the adverse segment to
	 * out-chroma the rest (0.188 vs 0.0503, 3.7x) and the corollary forbids a
	 * gray `live`. Two is the floor that section sets for this object, and the
	 * page is now at it.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * KEPT, DELIBERATELY
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 *  1. REVISION KEYING — 11 rows for 11 revisions, never keyed on labels.
	 *  2. NO `−N` CHIP ON THE ROWS — row position is the rank, and the order is
	 *     untouched: one list, newest first, no sectioning. Splitting live from
	 *     rolled-past into two panels was tried on paper and rejected for
	 *     exactly this: it would have put ranks 0 and 4 in one panel and 1,2,3
	 *     in another, and position would have stopped meaning anything. The bar
	 *     separates them without moving them.
	 *  3. THE SCOPE IS IN THE EYEBROW: `11 of 37 revisions deployed`.
	 *  4. Repo grouping is a SCOPE LABEL, not a grouping mechanism.
	 *  5. Every mutating control stays on the detail page.
	 */

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));

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
	 * revision → coverage, and ONLY for the rows that have any.
	 *
	 * A revision nothing runs has no wavefront: every one of its places is in
	 * the `ahead` bucket by construction, so the bar it produced was a single
	 * flat gray fill on nine of eleven rows. The map is now built only where
	 * the object has something to draw, which is also what stops the page
	 * spending eleven bucketing passes to render two bars.
	 */
	const coverageByRevision = $derived.by(() => {
		const m = new Map<string, RevisionCoverage>();
		for (const repo of ledgers) {
			for (const row of repo.rows) {
				if (row.liveSlots > 0) m.set(row.revision, revisionCoverage(row, coarse));
			}
		}
		return m;
	});

	/**
	 * DOES THIS REPO RENAME ANYTHING? A PANEL-LEVEL QUESTION, ASKED ONCE.
	 *
	 * Criterion 3 is *"which services ship it, and under what labels"*. In a
	 * repo where no service has ever called a build anything but its own sha,
	 * there ARE no labels — and the name track degenerates into a second copy
	 * of the `Revision` column, printed once per row. Measured on the mock
	 * fleet, which is five single-service repos: `checkout-edge` rendered
	 * `4d0b7e8   4d0b7e8   checkout-edge` twenty-five times running.
	 *
	 * THIS IS NOT THE EXCEPTION RULE COMING BACK, AND THE DIFFERENCE IS WHERE
	 * THE QUESTION IS ASKED. The rule that was deleted was per-CELL — print a
	 * label only where it differs — so one row could show a name and the row
	 * under it show a blank, and a reader had to be told which meant what.
	 * This is per-PANEL: inside any one table every row is rendered the same
	 * way, and the column header names what the column holds. A column that is
	 * identical to the row key on every row of a table is that table not having
	 * the column, which is the same finding DESIGN.md records for
	 * `/environments`' rollup — *"18 identical green ticks directly above the
	 * words 18 healthy"* — one fact, drawn twice.
	 *
	 * The predicate is deliberately about the REPO and not the row: one row
	 * with a rename anywhere in the panel keeps the track on every row of it,
	 * so the names stay a column and the alignment that makes them countable
	 * survives.
	 */
	function repoNamesBuilds(rows: RevisionRow[]): boolean {
		return rows.some(rowNamesBuild);
	}

	/*
	 * COMPACT, because `/apps` and `/rollouts` are compact. This page printed
	 * `27 days ago` where every other list prints `27d ago` — the same fact in
	 * two vocabularies.
	 */
	function ageOf(row: RevisionRow): string {
		const ms = row.lastDeployMs || row.createdMs;
		return ms ? `${formatTimeAgoCompact(new Date(ms).toISOString(), $now)} ago` : '';
	}

	function ageTitle(row: RevisionRow): string {
		const ms = row.lastDeployMs || row.createdMs;
		return ms ? formatDate(new Date(ms).toISOString()) : '';
	}
</script>

<svelte:head>
	<title>kuberik | Revisions</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<h1 class="t-display min-w-0 truncate text-gray-900 dark:text-white">Revisions</h1>
	<p class="t-body mt-1 text-gray-500 dark:text-gray-400">
		Every commit that has been deployed, and how far across the fleet each one got.
	</p>

	{#if query.isLoading}
		<div
			class="mt-6 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
		>
			{#each Array(8) as _}
				<div class="flex items-center gap-3 px-4 py-3">
					<div class="h-2 w-2 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					<div class="h-3 w-20 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					<div class="h-3 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<div
			class="t-body mt-6 rounded-xl border border-gray-200 p-4 text-red-700 dark:border-gray-700 dark:text-red-400"
		>
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if ledgers.length === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-semibold text-gray-900 dark:text-white">No revisions yet</p>
			<p class="t-body mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				A commit appears here once a rollout has deployed it.
			</p>
		</div>
	{:else}
		{#each ledgers as repo (repo.repoKey)}
			{@const named = repoNamesBuilds(repo.rows)}
			<section class="mt-6">
				<!-- REPO GROUPING, DEMOTED. An eyebrow, not a panel. The SCOPE line is
				     here and it names both numbers: DESIGN.md forbids silently
				     dropping 26 of 37 builds off a list. -->
				<div class="mb-2 flex flex-wrap items-baseline gap-2">
					<span class="t-label min-w-0 truncate text-gray-500 dark:text-gray-400"
						>{repo.repoLabel}</span
					>
					<span class="t-micro text-gray-500 dark:text-gray-400">
						{repo.rows.length} of {repo.knownRevisions} revisions deployed · {repo.serviceCount} service{repo.serviceCount ===
						1
							? ''
							: 's'} · newest first
					</span>
				</div>

				<div
					class="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
				>
					<!-- COLUMN HEADERS, the `/rollouts` habit. They are what turn five
					     aligned cells into five columns, and they are what lets the
					     coverage column be read as one comparison rather than as a
					     scatter of unrelated graphics. Hidden at phone width, where the
					     row is three bands rather than five tracks. -->
					<div class="rev-row rev-head">
						<span class="t-label text-gray-500 dark:text-gray-400">Revision</span>
						<!-- THE HEADER NAMES WHAT THE COLUMN HOLDS, and the column holds
						     two different things in the two cases. `Ships as` when there are
						     names to report; `Services` when the repo has never renamed a
						     build and the cell is a service list and nothing else. A header
						     reading `Ships as` over a column of bare service names would be
						     the caption problem again, one word long. -->
						<span class="t-label text-gray-500 dark:text-gray-400"
							>{named ? 'Ships as' : 'Services'}</span
						>
						<span class="t-label text-gray-500 dark:text-gray-400">Coverage</span>
						<span class="t-label text-gray-500 dark:text-gray-400">Live</span>
						<span class="t-label text-right text-gray-500 dark:text-gray-400">Last</span>
					</div>

					{#each repo.rows as row (row.revision)}
						{@const cov = coverageByRevision.get(row.revision)}
						<div class="rev-row hover:bg-gray-50 dark:hover:bg-gray-700/40">
							<!-- THE SHA, IN ITS OWN BOX. NO MARK BESIDE IT.

							     This cell used to be a joined `[wordless status dot][sha]`, and
							     the human rejected that sub-badge on 2026-08-27 — then rejected
							     the dot outside the badge too. So it is not moved, it is DELETED,
							     and here that costs nothing at all: the predicate it encoded
							     ("still live somewhere" / "rolled past everywhere") is now
							     carried TWICE over — by whether this row draws a bar at all, and
							     by the words in the `Live` column three tracks right.
							     `Chip` with a `value` and no `label` renders the value half alone,
							     all four corners at the chip's 4px — same 20px box, same 6px
							     padding, same hairline, no empty half. -->
							<!-- THE CLASS IS ON A WRAPPER, NOT ON `Chip`. Svelte 5 prunes a
							     scoped selector it cannot see matched in this component's own
							     markup, and a `class` handed to a child component is opaque to
							     it — `.rev-sha` and its stretched-link rule were both being
							     dropped as dead CSS, which is a silent loss of the row's click
							     target, not just a warning. The wrapper is the grid item; the
							     chip sits inside it. -->
							<span class="rev-sha">
								<Chip
									value={row.short}
									valueHref={revisionPath(repo.repoKey, row.revision)}
									valueTitle="{row.revision} · {row.liveSlots > 0
										? 'still live somewhere'
										: 'rolled past everywhere'}"
								/>
							</span>

							<!--
								ONE LINE PER NAME. NOT ONE LINE PER SERVICE.

								THE AXIS TURNED, AND THAT IS THE WHOLE CHANGE. Three rounds put
								the SERVICE on the left of this cell and hung the label off it;
								the human called all three raw. The service is the constant —
								the same five strings, forty times down eleven rows, and the
								left edge of the cell carried none of the page's variation. The
								NAME is the variable, and the name is what criterion 3 is about:
								*"versions can be labeled different for different versions on
								the same revision"*.

								So the name goes in a FIXED 84px TRACK on the left and the
								services that use it run out to its right. Two consequences,
								both of them the point:

								  · THE NAMES FORM A COLUMN DOWN THE PAGE. Count the lines in
								    this cell and you have counted the names the commit ships
								    under — three for `9f10e49`, one for `3cc206c`. That is
								    criterion 3 as a SHAPE, at a glance, with no reading. It is
								    the `/rollouts` habit: `[NEWEST][1.66.0-66]` is in the same
								    slot of every card, so a scan down the column compares
								    like with like.
								  · IT COMPRESSES BY HALF. Six of eleven revisions have exactly
								    one name, so their whole cell is one line where it used to
								    be three. Measured on the live cluster: 40 lines → 19.

								AND IT DELETED THE EXCEPTION RULE. Every group prints its name,
								including the group whose name is the revision's own sha. There
								is no "only when it differs", so there is nothing to explain,
								so the caption and the footer key that used to explain it are
								gone rather than merely hidden. See `RevisionLabelGroup`.

								NO BADGES. Round 3's `[AS][label]` chip existed to bind a label
								to the one service it belonged to across a 12px gap. A group
								does not need binding: the services on a line share the name at
								the head of that line by construction, and alignment in a fixed
								track is a stronger grouping cue than any box. Eight chips went
								to zero and the cell got quieter, not louder.
							-->
							<span class="rev-names {named ? '' : 'rev-names--unnamed'}">
								{#each row.labelGroups as g (g.label)}
									<span class="rev-name-row">
										<!-- THE NAME. Mono, primary ink, in the track. Mono because
										     every identifier in this product is mono; primary ink
										     because it is the one thing in this cell the reader came
										     for. It carries NO colour: DESIGN.md puts colour on
										     marks, and this is a word. -->
										{#if named && rowNamesBuild(row)}<span
											class="rev-name t-code-sm text-gray-900 dark:text-white"
											title={g.isOwnSha
												? `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this revision under its own sha`
												: `${g.services.length} service${g.services.length === 1 ? '' : 's'} ship this revision as ${g.label}`}>{g.label}</span
										>{/if}
										<!-- THE SERVICES THAT USE IT. Secondary ink, because a
										     service is never the subject of this page — the
										     revision is — and that is the same ink the bucket cards
										     and the detail table print it in.

										     THE MIDDOT IS LOAD-BEARING. Round 1's run failed
										     because labels and names alternated inside it and one
										     gap had to mean both "next field" and "next service".
										     Everything after the name here IS a service, so the run
										     has one possible reading; the separator makes that true
										     at any wrap point rather than only at this width.

										     IT TRAILS ITS OWN NAME RATHER THAN LEADING THE NEXT
										     ONE, and that is a 390px decision. Each service is one
										     flex item — `name ·` — so the run breaks BETWEEN
										     services and a wrapped line can never open with an
										     orphaned separator. A leading middot on line two reads
										     as a bullet, which is a different object. -->
										<span class="rev-name-svcs">
											{#each g.services as svc, i (svc.appName)}
												<span class="rev-svc">
													<span class="rev-svc-name t-dense text-gray-700 dark:text-gray-200"
														>{svc.appName}</span
													>
													{#if svc.diverged}
														<!-- A build on no environment's release line. Its rank
														     is not a distance — promoting N times never arrives
														     at it — so it is marked here, on the service it is
														     true of. -->
														<Chip
															role="diverged"
															label="diverged"
															class="shrink-0"
															title="{svc.appName} lists this build on no environment’s release line"
														/>
													{/if}
													{#if i < g.services.length - 1}<span
															class="rev-sep t-dense text-gray-500 dark:text-gray-400"
															aria-hidden="true">·</span
														>{/if}
												</span>
											{/each}
										</span>
									</span>
								{/each}
							</span>

							<!-- THE BAR, AND ONLY WHERE THERE IS ONE TO DRAW.

							     Nine of eleven revisions are rolled past. Each of them used to
							     draw a full-width flat gray bar — one bucket, `ahead`, at 100% —
							     which is a graphic that is identical on nine rows and therefore
							     carries nothing, while diluting the two rows where the bar IS
							     the answer. Not one of the three pages the human calls the best
							     draws furniture that looks like data.
							     The track stays, because a proportional bar is only comparable
							     against the bar above it if the two are drawn to the same width
							     and at the same x. What is left is two marks on the page, and
							     they are the page's first criterion answered before you read. -->
							<!-- THE SPAN IS ALWAYS RENDERED, and that is not laziness. Every
							     row is its own grid and its five children auto-place in source
							     order, so dropping the element entirely would slide `Live` into
							     the coverage track on nine rows and the columns would stop being
							     columns. It holds the track open on desktop and takes itself out
							     of flow at phone width, where the tracks are explicit. -->
							<span class="rev-cov {cov ? '' : 'rev-cov--empty'}">
								{#if cov}
									<CoverageBar
										segments={coverageSegments(cov)}
										compact
										label="{cov.liveCount} of {cov.totalCount} places live · {cov.buckets
											.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`)
											.join(' · ')}"
									/>
								{/if}
							</span>

							<!-- THE ABSOLUTE, beside the proportional. `rolled past` rather
							     than `0 of 9`, because a zero numerator is the one value in
							     this column that is a different KIND of fact — and because it
							     is what explains the empty coverage track on its own row,
							     rather than leaving an absence to be inferred.

							     NEUTRAL, AND THAT IS A REMOVAL (2026-08-27, round four). The
							     numerator was mint — added in the colour-placement pass to
							     mark the page's first question, and the value the human meant
							     by *"there are some new colors there too"*. DESIGN.md: colour
							     goes on MARKS, never on PROSE. A count in a column is prose;
							     the bar 12px to its left is the mark, and it says the same
							     thing with more precision. Two chromatic elements removed, no
							     information lost. -->
							{#if row.liveSlots === 0}
								<span class="rev-where t-dense text-gray-500 dark:text-gray-400">rolled past</span>
							{:else}
								<span class="rev-where t-dense text-gray-700 dark:text-gray-200"
									>{row.liveSlots}<span class="text-gray-500 dark:text-gray-400"
										>/{row.totalSlots}</span
									></span
								>
							{/if}

							<span class="rev-age t-micro text-gray-500 dark:text-gray-400" title={ageTitle(row)}
								>{ageOf(row)}</span
							>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

<style>
	/*
	 * GEOMETRY ONLY. Colour and visibility stay in utilities, per the `app.css`
	 * layering note: a Svelte-scoped rule outranks a Tailwind utility, so
	 * anything declared here is un-overridable from the markup.
	 *
	 * FIVE FIXED TRACKS AND ONE FLEXIBLE ONE. `Coverage`, `Live` and `Last` are
	 * fixed because a column whose left edge moves with its content is not a
	 * column. The coverage track is fixed for the stronger reason: a
	 * proportional bar is only comparable against the bar above it if the two
	 * are drawn to the same width.
	 *
	 * THE REVISION TRACK IS FIXED TOO, AND THAT IS A BUG FIX. It was `auto`,
	 * and every row in this panel is its OWN grid — the header is not a grid
	 * row of the data, it is a sibling — so `auto` resolved separately per row:
	 * 61.8px over the word `REVISION` and 80.5px over the sha chip. Column
	 * headers that do not sit over their column are worse than no headers, and
	 * this page's whole claim is that its cells are columns. 68px is the value
	 * half's measured 62.5px for a 7-character `shortRevision` plus a hair.
	 */
	.rev-row {
		position: relative;
		display: grid;
		grid-template-columns: 68px minmax(0, 1fr) 160px 64px 56px;
		gap: 12px;
		padding: 12px 16px;
		align-items: baseline;
	}

	/* The bar has no baseline of its own, so it is centred against the row's
	   text rather than sitting on an imaginary one. */
	.rev-cov {
		align-self: center;
		min-width: 0;
	}

	/* The stretched link: ONE anchor with real text (the sha), whose ::after
	   covers the row. The row has no button in it any more, but the trick stays
	   because it is what keeps the whole row clickable without wrapping
	   interactive content in an anchor. */
	.rev-sha {
		justify-self: start;
		min-width: 0;
	}

	.rev-sha :global(.chip-value)::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	/*
	 * THE NAMES CELL — a stack of lines, each line a two-track grid.
	 *
	 * Row gap zero: the lines are held apart by their own leading, which is
	 * what makes a stack read as a list rather than as N separate objects. No
	 * `line-height` is declared here on purpose — the leading is `.t-dense`'s
	 * own 1.45, and a second value would be a tenth type role that only this
	 * cell has.
	 */
	.rev-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/*
	 * 84px, AND IT IS A COLUMN, NOT A GAP.
	 *
	 * The whole move this round is that the NAME is the variable and the
	 * service is the constant, so the name gets the fixed left track and the
	 * services hang off it. A fixed track means the names line up across every
	 * line of every row on the page — which is what turns "how many names does
	 * this commit have" into something you can see rather than read.
	 *
	 * 84px is the widest live label (`1.66.0-66`, 9 characters of
	 * `t-code-sm`) at ~72px plus the same hair the revision track takes.
	 * `minmax(84px, max-content)` rather than a hard `84px`: a longer label
	 * pushes its own line rather than ellipsising into another label, which is
	 * the defect that killed the badge attempt one round ago at the 12ch cap.
	 * A pushed line loses the cross-row alignment on that line only; a clipped
	 * label loses the identifier.
	 */
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

	/*
	 * THE SERVICES ARE PINNED TO TRACK 2, NOT AUTO-PLACED INTO IT.
	 *
	 * A row whose only name is the revision's own sha does not print a name
	 * (`rowNamesBuild`), so the services are that grid's only child — and an
	 * auto-placed only child lands in track 1. That would start the services
	 * at 417 on six rows and 513 on five, which is precisely the raggedness
	 * the name track was introduced to remove. Pinned, the empty 84px track
	 * still holds, `Ships as` still sits over the column it names, and the
	 * services keep ONE left edge down the whole table whether or not the row
	 * above them printed a name.
	 */
	.rev-name-svcs {
		grid-column: 2;
	}

	/* NO NAMES ANYWHERE IN THIS REPO, SO NO NAME TRACK AT ALL. Different
	   case, and it is a whole-PANEL one: holding 84px open on every row of a
	   table that can never fill it is 84px of nothing. The cell collapses to
	   the run of services, the header reads `Services`, and the services take
	   the x the names would have had — so both forms of the panel still share
	   one left edge with their own header. */
	.rev-names--unnamed .rev-name-row {
		grid-template-columns: minmax(0, 1fr);
		column-gap: 0;
	}

	.rev-names--unnamed .rev-name-svcs {
		grid-column: 1;
	}

	/*
	 * THE SERVICES THAT SHARE ONE NAME — A WRAPPING RUN, NOT A PARAGRAPH.
	 *
	 * `flex-wrap` rather than inline flow, and that is a 390px bug fix, not a
	 * preference. Inline flow breaks at WHITESPACE, and this run is emitted
	 * with none between the separator and the name it belongs to — so with
	 * `nowrap` on the names the whole run became one unbreakable box and ran
	 * 120px off the right edge of a phone. Flex items give the run explicit
	 * break points at the only places a break is legal: between services.
	 *
	 * THE TWO GAPS ARE 4 AND 8, IN THAT ORDER, AND THE ORDER IS THE POINT. A
	 * name sits 4px from its own trailing dot and 8px from the next name, so
	 * proximity says the dot belongs to the name BEFORE it — which is what
	 * makes a wrapped line legible when the dot ends up last on the line.
	 * Both values are on the declared 4/8/12/16/24 scale; an earlier pass had
	 * them at 6px and 10px, which was both off-scale and backwards.
	 * Row gap 0: wrapped lines are held apart by `.t-dense`'s own leading, the
	 * same way the name lines above them are.
	 */
	.rev-name-svcs {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 8px;
		min-width: 0;
	}

	.rev-svc {
		display: flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
	}

	/* A NAME NEVER BREAKS ACROSS TWO LINES. At 390 the run wrapped inside
	   `hello-world-app`, printing `hello-world-` above `app` — a service
	   rendered as two strings, which is the same defect as ellipsising two
	   services to one string, in the other direction. The run breaks between
	   services only, and a name that cannot fit ellipsises rather than
	   splitting: an ellipsised name still identifies, a split one does not. */
	.rev-svc-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rev-where,
	.rev-age {
		white-space: nowrap;
	}

	.rev-age {
		text-align: right;
	}

	/*
	 * PHONE WIDTH IS A DESIGN, NOT A FALLBACK.
	 *
	 * A five-track row cannot narrow to 390px — the sha alone is 96px and the
	 * names cell is a list. So the row becomes THREE BANDS and the column
	 * headers are dropped, because a header over a stacked band is a label for
	 * nothing.
	 *
	 * The ORDER is the argument. Band 1 is identity and the count (sha · live ·
	 * age) on one line. Band 2 is THE BAR, full width — at 358px it is the
	 * clearest it ever gets, and it is the one object that answers "do I care
	 * about this row". On a rolled-past row the band collapses to nothing,
	 * because there is no bar, and the row is two bands instead of three: the
	 * rows that matter are physically taller than the ones that do not, which
	 * is the same allocation the desktop layout makes with ink.
	 * Band 3 is the names list, which is the detail and reads last.
	 */
	@media (max-width: 639px) {
		.rev-row {
			grid-template-columns: minmax(0, auto) 1fr auto;
			gap: 8px;
		}

		.rev-head {
			display: none;
		}

		.rev-sha {
			grid-column: 1;
		}

		.rev-where {
			grid-column: 2;
			justify-self: end;
		}

		.rev-age {
			grid-column: 3;
		}

		/* AND THE BAND DISAPPEARS WHEN THERE IS NO BAR. An empty grid item is
		   not free at phone width — it still takes a grid row and the 8px row
		   gap on either side of it, so nine rolled-past rows were paying 16px
		   each for a band with nothing in it. Removed from flow, a rolled-past
		   row is two bands and a live row is three: the rows that matter are
		   physically taller than the ones that do not, which is the same
		   allocation the desktop layout makes with ink. */
		.rev-cov {
			grid-column: 1 / -1;
			order: 1;
			margin-top: 4px;
		}

		.rev-cov--empty {
			display: none;
		}

		.rev-names {
			grid-column: 1 / -1;
			order: 2;
			margin-top: 4px;
		}

		/* The name track shrinks but never goes away — the alignment it buys is
		   worth more at 390 than at 1440, because the services wrap under
		   themselves and the indent is what says which name they belong to. */
		.rev-name-row {
			grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
			column-gap: 8px;
		}
	}
</style>
