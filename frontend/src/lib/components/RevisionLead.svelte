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
		coverageBarSegments,
		coverageBarLabel,
		buildState,
		releaseSplit,
		releaseHeldClause,
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
		 * @deprecated ROUND 11, A.2/A.6.2 — "THE BAR COMES BACK, AND IT ALWAYS
		 * DRAWS." The human's own ruling this round overturns the premise
		 * this prop existed to serve: the bar is no longer hidden at full
		 * coverage, and it no longer needs a caller-computed percentage —
		 * `CoverageBar` itself now draws a literal, comparable shape at every
		 * count via `coverageBarSegments`. This component ignores the prop
		 * entirely now; it is kept, unused, so `routes/revisions/+page.svelte`
		 * (Lane 2, this pass does not own that file) keeps COMPILING until it
		 * migrates off the prop and deletes this line — see this file's
		 * report for the exact call site.
		 */
		barPercent?: number;
		/**
		 * @deprecated ROUND 11, A.2 — see `barPercent`'s own note immediately
		 * above: "the bar draws on every build, always, including 0% and
		 * 100%" is the ruling that deletes this prop's whole reason to exist.
		 * Ignored; kept only so the same still-live call site keeps compiling.
		 */
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

	/**
	 * ⭐ ROUND 11, A.5 — `coverageBarSegments`, NOT THE DELETED
	 * `coverageSegments`. Four entries, `WEIGHT_ORDER`, zero counts
	 * included — `CoverageBar` renders these at its new `weightFill`
	 * palette. See that function's own doc comment.
	 */
	const segments = $derived(coverageBarSegments(coverage));
	const state = $derived(buildState(coverage));

	/**
	 * ⭐ ROUND 11, A.7 — `coverageBarLabel`, NOT A HAND-ROLLED SENTENCE. Also
	 * names the DENOMINATOR (the operator-walk addition this round folds
	 * in): a bare `6 of 9` stacked down a column of different builds reads
	 * as inconsistent unless the sentence says what each number counts, so
	 * `coverageBarLabel` names the services that own the places, off the
	 * same slots the bar itself is drawn from.
	 */
	const barLabel = $derived(coverageBarLabel(coverage, short));

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
	 * ⭐ OPERATOR-WALK ADDITION, ROUND 11 — REPLACES `heldLabel`. The old
	 * aggregate named ONLY the held release (`heldLabel`, falling back to
	 * the vague `a newer release`) and, on the held release's own hero,
	 * that label IS the row's own name — "held on {its own name}" reads as
	 * a build held from itself. `releaseHeldClause` states the true,
	 * narrower fact per split line instead: this build is the SAME COMMIT
	 * under two release labels, and names where the older one is still the
	 * one deployed. Joined with `; ` on the rare multi-service case where
	 * two lines disagree on the label or the places.
	 */
	const heldClause = $derived(splits.length > 0 ? splits.map(releaseHeldClause).join('; ') : null);
</script>

<div class="lead">
	{#if compact}
		<!--
			⭐ ROUND 11, A.6.2 — THE COMPACT LEAD BODY, REWRITTEN FOR "THE BAR
			COMES BACK, AND IT ALWAYS DRAWS". The host `Card`'s own header
			keeps the verdict rollup (`+page.svelte`'s `heroVerdict`) hard-right
			and this body never restates it — that half of craft review item 7
			survives unchanged. What changes: the bar is no longer conditional
			(`hideBar` is deleted from this branch's logic; A.2 draws it at 0%
			and at 100% too) and the identifier is GONE from this body —
			"the hero body does not reprint the sha" (A.6.2) — because the host
			`Card`'s own title is where it belongs now (a Lane 2 call-site
			change; see this file's report). At full coverage the body is
			nothing but the bar, which is the point: a `BuildStateMark` only
			when there is a shortfall left to name (`state.key !== 'done'`),
			then the bar, full width, always.
		-->
		<div class="lead-compact">
			{#if state.key !== 'done'}
				<BuildStateMark {coverage} size="row" />
			{/if}
			<CoverageBar {segments} label={barLabel} />
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
					running it{#if heldClause && !showHeldChip}<span
							class="text-orange-950 dark:text-orange-300"
						>
							&nbsp;· {heldClause}</span
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

	<!--
		⭐ ROUND 11, A.2/A.6.2 — THE BAR ALWAYS DRAWS NOW, NON-COMPACT TOO.
		`hideBar`/`barPercent` are deprecated no-ops (see their prop doc
		comments) — this is the ONE bar render for the NON-compact branch, at
		every coverage from 0% to 100%, via `CoverageBar` and its new
		weight-keyed segments. Gated on `!compact`: the compact branch draws
		its OWN copy inline, above (inside `.lead-compact`, at `mt-2` instead
		of `mt-3`, per A.6.2's body geometry) — without this guard a compact
		render drew the bar TWICE, caught mounting the component directly.
	-->
	{#if !compact}
		<CoverageBar {segments} label={barLabel} class="mt-3" />
	{/if}

	<!-- ⛔ THE TWO-SWATCH LEGEND IS GONE. (2026-09-03, direct from the human,
	     overriding the note this comment used to carry.) It explained a bar
	     segment that no longer exists — `coverageBarSegments()` paints one
	     green `here` fill now, whatever release a place is on — and the held
	     fact it named is not lost: the rollup two lines up already says the
	     held clause, and `releaseSplitSentence` (the page's own caption,
	     unowned by this component) says it again in a full sentence. Two
	     objects were enough; a third, graphical one was the segmented-bar
	     shape the human has now rejected twice on this page. -->

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
	 * ⭐ ROUND 11, A.6.2 — THE COMPACT LEAD BODY. No id row any more (see the
	 * markup comment above); a column of at most two things — the state
	 * mark, only when there is a shortfall, then the bar. `gap` rather than
	 * a margin on the bar itself so a body with no mark (`state.key ===
	 * 'done'`) costs nothing extra above it.
	 */
	.lead-compact {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* ⛔ `.lead-compact-id`/`.lead-compact-figure` REMOVED, ROUND 11/ITEM 1 —
	   the identifier moved out of this body (A.6.2, "the hero body does not
	   reprint the sha") and the figure duplicated the host `Card`'s own
	   header rollup one row down; see the markup comments above. */

	/* ⛔ `.single-bar`/`.single-bar-fill` REMOVED, ROUND 11, A.2 — the
	   painted-track fallback they drew only when a caller passed the now-
	   deprecated `barPercent`. Every render is `<CoverageBar>` now, both
	   branches, so this component owns no second bar geometry any more. */
</style>
