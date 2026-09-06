<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE PAGE'S ENTRY POINT — one build, stated large.
	 *
	 * ── THE PROBLEM IT SOLVES ───────────────────────────────────────────────
	 *
	 * From the human: *"The page currently presents eleven near-identical rows
	 * and asks the reader to find the interesting one. The banner is the only
	 * thing that leads. There should be an obvious entry point — the one
	 * revision that matters right now — and a clear, quiet path to everything
	 * else."*
	 *
	 * This is that entry point. On `/versions` it is the newest build anything
	 * is running: the one an operator is almost always here about. On
	 * `/versions/<rev>` it is the hero, for the build the URL names. The two
	 * pages are therefore ONE OBJECT AT TWO SCALES rather than two designs that
	 * rhyme — which is the standing requirement in
	 * `.agents-context/design/REVISION-PAGES.md` for the bar, applied to the
	 * thing the bar sits inside.
	 *
	 * ── WHY IT IS NOT JUST A `Card` ─────────────────────────────────────────
	 *
	 * It IS inside a `Card` on the list — the frame is not the argument. What
	 * earns a component is the ARRANGEMENT: an identifier at 24px against a
	 * measurement at 24px on one baseline, a 26px proportional bar directly
	 * under the count that names it, and `FleetSpread` directly under the bar
	 * naming every segment in words. Those four things have to stay in that
	 * order and at those sizes or the bar stops reading without a legend — and
	 * the human has rejected a legend twice. Written twice, they would drift.
	 *
	 * ── THE COUNT IS DIRECTLY ABOVE THE BAR, ALWAYS ─────────────────────────
	 *
	 * `6 of 9` over a bar that is two-thirds mint binds the number to the
	 * segment in one glance, every time, with no key. That adjacency is the
	 * whole reason the object is composed rather than assembled per page.
	 */
	import type { Snippet } from 'svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import BuildStateMark from '$lib/components/BuildStateMark.svelte';
	import FleetSpread from '$lib/components/FleetSpread.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import {
		coverageSegments,
		buildState,
		releaseSplit,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';

	let {
		short,
		href = null,
		eyebrow,
		coverage,
		spread = true,
		meta,
		children,
		// ⭐ ADDITIVE, REVISIONS-2026-09-05 §2, revised per craft-review item 1
		// — `/revisions` (the list) is the only caller that passes these;
		// every existing call site (the detail page's own hero) keeps
		// computing `segments` and rendering `<CoverageBar>` exactly as
		// before. Kept as opt-in props rather than a rewrite of this
		// component's default behaviour because this object is shared with
		// `/revisions/[...slug]`, a route this pass does not own.
		barPercent = undefined,
		hideBar = false,
		showHeldChip = false,
		compact = false
	}: {
		/** The build's short sha — the object's name, at 24px mono. */
		short: string;
		/** Set on the list, where the lead is a doorway. Null on the detail page,
		    where it would link to itself. */
		href?: string | null;
		/** `NEWEST BUILD IN USE` / `TRACKING BUILD`. Supplies the noun so the
		    heading can be nothing but the identifier. */
		eyebrow: string;
		coverage: RevisionCoverage;
		/** `false` on the detail page (the bucket CARDS are the spread there,
		    at full size and carrying the actions) and on `/revisions`' own
		    hero (REVISIONS-2026-09-05, Removed §6: the per-service LEDGER
		    above the hero is now the one statement of "who runs it and
		    where" — repeating it as a service→env spread inside the hero
		    would print the same fact twice on one screen). */
		spread?: boolean;
		/** A second line under the identifier — repo, commit summary, scope. */
		meta?: Snippet;
		/** Buttons and any page-specific note, under the spread. */
		children?: Snippet;
		/**
		 * ⛔ CRAFT REVIEW ITEM 1 — THE BAR LIED. `CoverageBar`'s cells are
		 * `flex: 1`, sized to fill its track whatever the count — one cell
		 * (`1 of 9`) drew exactly as wide as nine (`9 of 9`, or `8 of 9`).
		 * That component is right for its OWN job (comparing revisions by
		 * shape, `/revisions`' bucketed bars), but wrong for a bar whose
		 * whole point is a literal WIDTH = live/total. `barPercent`
		 * (0-100, pre-rounded by the caller) switches this component off
		 * `<CoverageBar>` entirely and onto a plain painted-track fill —
		 * see the markup below.
		 */
		barPercent?: number;
		/** §2: "the bar draws only when it measures a shortfall". */
		hideBar?: boolean;
		/**
		 * §2: a held build states its count as a chip under the figure instead
		 * of the inline `· N held on …` clause in the count's caption line.
		 */
		showHeldChip?: boolean;
		/**
		 * ⭐ CRAFT REVIEW ITEM 7 — `/revisions`' own hero. With the
		 * service→env spread gone (`spread={false}`), the old two-column
		 * `.lead-top` (eyebrow+id stacked left, a 24px count stacked right)
		 * cost 218px for two lines of actual information. `compact`
		 * collapses id + state + figure onto ONE row (id left, state
		 * word beside it, figure right) and drops the eyebrow label — the
		 * card's own header ("Newest build in use") already supplies the
		 * noun `eyebrow` existed to restate. The detail page's own hero
		 * (this prop's default, `false`) is untouched.
		 */
		compact?: boolean;
	} = $props();

	const segments = $derived(coverageSegments(coverage));
	const state = $derived(buildState(coverage));

	const barLabel = $derived(
		`${coverage.liveCount} of ${coverage.totalCount} places running ${short} · ` +
			coverage.buckets.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`).join(' · ')
	);

	/**
	 * ⭐ THE ROLLUP MAY NOT DISAGREE WITH THE BAR IT SITS ON. (2026-09-03,
	 * operator-walk B4, re-check of F3.) `6 of 6 places running it` said
	 * nothing about the bar's own orange segment two lines below it, so an
	 * operator read the two together as "fully out" — the exact `fully
	 * rolled out` claim `buildState`'s own `held` branch exists to refuse.
	 * `releaseSplit` is the same grouping `releaseSplitSentence` (the page's
	 * own caption) already reads, so the rollup's count and the caption's
	 * sentence cannot drift: both are read off one function.
	 */
	const splits = $derived(releaseSplit(coverage));
	const heldTotal = $derived(splits.reduce((sum, s) => sum + s.count, 0));
	/**
	 * NAMED ONLY WHEN EVERY HELD GROUP AGREES ON THE VERSION. A build that
	 * ships as two services can have two different releases held — `2.67.0-67`
	 * for one, a different tag for the other — and printing either alone
	 * would be a claim about the wrong service. `null` falls back to the
	 * honest, ungraded `a newer release`.
	 */
	const heldLabel = $derived.by(() => {
		if (splits.length === 0) return null;
		const labels = new Set(splits.map((s) => s.aheadLabel));
		return labels.size === 1 ? [...labels][0] : null;
	});
</script>

<div class="lead">
	{#if compact}
		<!--
			⭐ CRAFT REVIEW ITEM 7 — THE COMPACT LEAD BAND. `/revisions`' own
			hero: id, state and figure on ONE row (the eyebrow label is gone —
			the host `Card`'s own header, "Newest build in use", already
			supplies that noun), the bar directly under it only when it has
			something to say. Same header, same card; the two-line, 218px
			`.lead-top` this branch replaces is still what the detail page
			renders (`compact` defaults `false`).

			⛔ REVISIONS-2026-09-06, ITEM 1 — NO FIGURE HERE ANY MORE, AND THE
			STATE MARK IS CONDITIONAL. The host `Card`'s own header already
			prints the identical `N of M places` rollup (`+page.svelte`'s
			`heroVerdict`) — this component's own `lead-compact-figure` was the
			SAME number a second time, 60px below it, sharing the exact same
			`state.title`. And a hero whose bar is omitted — `hideBar`, true the
			moment `liveCount === totalCount` — has nothing left to explain: the
			header already said "N of N places", so the body is the identifier
			and (via `children`) `View commit`, nothing else. `BuildStateMark`
			only draws when there IS a shortfall left to name.
		-->
		<div class="lead-compact">
			<div class="lead-compact-id min-w-0">
				{#if href}
					<a class="t-display-id hit-32 text-gray-900 hover:underline dark:text-white" {href}
						>{short}</a
					>
				{:else}
					<h1 class="t-display-id text-gray-900 dark:text-white">{short}</h1>
				{/if}
				{#if !hideBar}
					<BuildStateMark {coverage} size="row" />
				{/if}
			</div>
		</div>
	{:else}
		<div class="lead-top">
			<div class="lead-id">
				<div class="t-label text-gray-500 dark:text-gray-400">{eyebrow}</div>
				<div class="lead-name">
					{#if href}
						<!-- ⭐ `.hit-32` — THE LINK'S OWN 27.6px BOX IS UNDER THE 32px TOUCH
						     FLOOR. (2026-09-03, touch lane hand-off) Same general-purpose
						     slop `app.css` already gives `.rev-sha`/other raised controls;
						     `.lead-name`'s `margin-top: 10px` (see the style block below)
						     is what keeps its expanded reach clear of the eyebrow above. -->
						<a class="t-display-id hit-32 text-gray-900 hover:underline dark:text-white" {href}
							>{short}</a
						>
					{:else}
						<h1 class="t-display-id text-gray-900 dark:text-white">{short}</h1>
					{/if}
				</div>
			</div>

			<!--
				THE MEASUREMENT, AT THE SAME SIZE AS THE IDENTIFIER AND ON ITS
				BASELINE. Concept 07's hero anatomy, and the reason the page has a type
				range of 24 -> 10 rather than the 10-13px cluster every rejected page
				ran at.
			-->
			<div class="lead-count" title={state.title}>
				<span class="t-display text-gray-900 dark:text-white">{coverage.liveCount}</span>
				<span class="t-body text-gray-500 dark:text-gray-400">of {coverage.totalCount}</span>
				<!--
					⭐ THE DEFINITION IS ON THE TERM, NOT UNDER IT. (2026-09-02, from the
					human: three lines of caption prose on this card, of which this was
					one — *"A place is one service in one environment."* printed at
					`t-micro` 120px below the number it defines.) The word `places` still
					cannot be deleted: `/api/rollouts` carries no pod counts (confirmed
					three times), so a (service, environment) slot is the honest unit and
					inventing a pod ratio would be worse. So the sentence stays, ON the
					noun, where a reader who does not know the word can ask and a reader
					who does is not made to read it on every visit.

					⛔ IT IS A `title`, WHICH THE MESSAGE CENSUS READS. `scan.ts` scans
					`title` / `aria-label` / `alt` / `placeholder` as operator-visible
					literals, so the fact stays pinned by `drift.test.ts` — moving prose
					into an attribute hides it from the page, never from the suite.
				-->
				<div
					class="t-label text-gray-500 dark:text-gray-400"
					title="A place is one service in one environment."
				>
					<!--
						⭐ THE SPACE BEFORE THE DOT IS EXPLICIT, NOT WHITESPACE-COLLAPSED.
						(coordinator sweep, finding 7) `running it{#if …}` sat directly
						against the `{#if}` block with nothing between them, so the join
						relied on the span's own leading newline/tabs collapsing to a
						single space — and it rendered `RUNNING IT·2 HELD…` with none.
						A literal space here is unambiguous at any indentation.
					-->
					running it{#if heldTotal > 0 && !showHeldChip}<span
							class="text-orange-950 dark:text-orange-300"
						>
							&nbsp;· {heldTotal} held on {heldLabel ?? 'a newer release'}</span
						>{/if}
				</div>
			</div>
		</div>

		<!--
			THE STATE SENTENCE IS THE IDENTIFIER'S SUBTITLE AND TAKES THE FULL WIDTH.
			Inline beside the sha it shared a column with the 24px count, which at 390
			left it ~180px and broke `3 places still to go` across two lines under an
			orphaned glyph. Full width it is one line at every width tested, and the
			reading order — what this is, then what is happening to it, then how far it
			got — is the same at 390 and at 1440.
		-->
		<div class="lead-sub">
			<BuildStateMark {coverage} size="lead" />
			{#if meta}
				<div class="lead-meta">{@render meta()}</div>
			{/if}
		</div>
	{/if}

	<!--
		⭐ §2's "3 HELD" CHIP, UNDER THE FIGURE — SHARED BY BOTH LAYOUTS NOW.
		(REVISIONS-2026-09-05, craft review) The list page hides the bar
		entirely at full coverage, so the held fact can no longer ride the
		caption line above a segment that visibly proves it — a bare
		"running it" with no bar and no mark reads as "done". `alarm` is the
		product's held-and-needs-a-look chip; the release-split sentence
		below still names WHICH release and WHERE.
	-->
	{#if showHeldChip && heldTotal > 0}
		<div class="mt-1 flex w-full justify-end">
			<Chip
				role="alarm"
				label="{heldTotal} held"
				wide
				title="{heldTotal} place{heldTotal === 1
					? ''
					: 's'} run this on an older release, and a newer one is held by a rule"
			/>
		</div>
	{/if}

	{#if !hideBar}
		{#if barPercent !== undefined}
			<!--
				⛔ CRAFT REVIEW ITEM 1 — NO MORE `<CoverageBar>` HERE, ONLY WHEN A
				CALLER PASSES `barPercent`. Its cells are `flex: 1`, so `n`
				cells always fill the track regardless of count: measured
				live, "1 of 9" and "8 of 9" both drew a fully-filled 200px
				bar. This is a plain painted track with a WIDTH, which is
				what "one fill, width = live/total" (§2) actually requires —
				the exact geometry `/revisions`' own list rows share (see
				that file's CSS for the one spelling). The detail page's own
				call site never passes `barPercent`, so it is untouched below.
			-->
			<div class="single-bar mt-3" role="img" aria-label={barLabel} title={barLabel}>
				<div class="single-bar-fill" style="width: {barPercent}%"></div>
			</div>
		{:else}
			<CoverageBar {segments} label={barLabel} class="mt-3" />
		{/if}
	{/if}

	<!-- ⛔ THE TWO-SWATCH LEGEND IS GONE. (2026-09-03, direct from the human,
	     overriding the note this comment used to carry.) It explained a bar
	     segment that no longer exists — `coverageSegments()` paints one green
	     `live` fill now, whatever release a place is on — and the held fact
	     it named is not lost: the rollup two lines up already says
	     `N held on <release>`, and `releaseSplitSentence` (the page's own
	     caption, unowned by this component) says it again in a full
	     sentence. Two objects were enough; a third, graphical one was the
	     segmented-bar shape the human has now rejected twice on this page. -->

	{#if spread}
		<FleetSpread {coverage} class="mt-4" />
	{/if}

	<!-- ⛔ TWO `<p>` CAPTIONS STOOD HERE AND BOTH WERE DEFINITIONS.
	     (2026-09-02, from the human: *"three lines of caption prose"* on one
	     card; *"descriptive text pollutes and attention is pulled by design"*.)
	     Neither fact was deleted, only unprinted:
	       · `A place is one service in one environment.` → the `title` on the
	         term `places running it`, twelve pixels from the number it
	         qualifies. See the block above it.
	       · `Each service ships this commit as its own release, with its own
	         gates.` → already the second sentence of the host `Card`'s
	         `verdictTitle`, on the `N services` rollup that counts them. It was
	         printed AND in the record; only the printing goes.
	     Both remain in `catalogue.txt`, because `scan.ts` reads `title`. -->

	{#if children}
		<div class="lead-actions">{@render children()}</div>
	{/if}
</div>

<style>
	/* GEOMETRY ONLY — a Svelte-scoped rule outranks a Tailwind utility, so
	   colour and type roles stay in the markup where they can be overridden. */
	.lead {
		min-width: 0;
	}

	/* Identity left, measurement right, baselines aligned. It KEEPS ITS TWO
	   COLUMNS AT 390 and that is a fold decision, not a taste one: stacked, the
	   count costs ~44px above the bar, and the bar is the object that answers
	   "do I care about this build". */
	.lead-top {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px 16px;
		align-items: baseline;
	}

	.lead-id {
		min-width: 0;
	}

	/* The identifier's own row. The state word is NOT in here — see `.lead-sub`
	   and the comment above it in the markup. */
	/* ⛔ `margin-top: 4px` WAS TOO TIGHT FOR THE LINK'S OWN TOUCH FLOOR.
	   (2026-09-03, touch lane hand-off) The identifier link's rendered box
	   is 27.6px tall (24px `t-display-id` at line-height 1.15) — under the
	   32px floor `app.css`'s slop mechanism (`.rev-sha`/`.hit-32`) enlarges
	   a control to, which reaches `(32 - 27.6) / 2 + 6px ≈ 8.2px` above the
	   link's own top edge (the `+12px` term in that formula's `max()`). A
	   4px gap to the eyebrow above it is short of that reach, so a point
	   just inside the link's expanded hit box can resolve to the eyebrow
	   instead. 10px clears it with margin to spare. */
	.lead-name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 10px;
		min-width: 0;
	}

	.lead-sub {
		margin-top: 4px;
		min-width: 0;
	}

	.lead-meta {
		margin-top: 6px;
		min-width: 0;
	}

	.lead-count {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-end;
		gap: 6px;
		text-align: right;
	}

	.lead-count :global(.t-label) {
		width: 100%;
	}

	/* 8px, NOT 16 — the row holds `.nav-link`s now, and `.nav-link` carries
	   `.btn`'s own 8px of vertical padding inside its box. Against a `.btn`
	   the ink sat 16px below the object; against a link at 16px it sat 24. */
	.lead-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 8px;
	}

	/*
	 * ⭐ CRAFT REVIEW ITEM 7 — THE COMPACT LEAD BAND. id + state on the left,
	 * baseline-aligned so the 20px glyph+word sits on the 24px sha's own
	 * line rather than floating above or below it; the figure right,
	 * `flex-wrap` so a narrow container (the rail width `/revisions` never
	 * actually puts this in, but cheap insurance) stacks rather than clips.
	 */
	.lead-compact {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px 16px;
	}

	.lead-compact-id {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		min-width: 0;
	}

	/* ⛔ `.lead-compact-figure` REMOVED, ITEM 1 — it duplicated the host
	   `Card`'s own header rollup one row down; see the markup comment above. */

	/*
	 * ⭐ CRAFT REVIEW ITEM 1 — THE PAINTED TRACK, ONE FILL, EXACT WIDTH.
	 * Height 6 / radius 4 per spec §2 — half `.cov`'s 8px-compact height,
	 * because a bar in a 96px compact band has no room for the bucketed
	 * bar's own scale. `overflow: hidden` is what lets the fill's own
	 * square end clip to the track's rounded one.
	 */
	.single-bar {
		height: 6px;
		border-radius: 4px;
		overflow: hidden;
		background-color: var(--color-gray-200);
	}

	:global(.dark) .single-bar {
		background-color: var(--color-gray-700);
	}

	.single-bar-fill {
		height: 100%;
		border-radius: inherit;
		background-color: var(--color-green-700);
	}

	:global(.dark) .single-bar-fill {
		background-color: var(--color-green-600);
	}
</style>
