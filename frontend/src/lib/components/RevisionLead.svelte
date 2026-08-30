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
	import {
		coverageSegments,
		buildState,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';

	let {
		short,
		href = null,
		eyebrow,
		coverage,
		spread = true,
		unitNote = false,
		meta,
		children
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
		/** `false` on the detail page: there the bucket CARDS are the spread, at
		    full size and carrying the actions. Drawing both would print the same
		    environments twice on one screen. */
		spread?: boolean;
		/**
		 * ⭐ THE ONE SENTENCE THAT MAKES `places` SELF-TEACHING.
		 *
		 * `6 of 9 places live` was on the human's list of strings that assume the
		 * domain, and the word cannot simply be deleted: `/api/rollouts` carries
		 * no pod counts (confirmed three times), so a (service, environment) slot
		 * is the honest unit and inventing a pod ratio would be worse than a
		 * plain word. So the page defines it, ONCE, where it is first used, in
		 * seven words. That is not a legend — it is the caption of the number
		 * directly above it.
		 */
		unitNote?: boolean;
		/** A second line under the identifier — repo, commit summary, scope. */
		meta?: Snippet;
		/** Buttons and any page-specific note, under the spread. */
		children?: Snippet;
	} = $props();

	const segments = $derived(coverageSegments(coverage));
	const state = $derived(buildState(coverage));

	const barLabel = $derived(
		`${coverage.liveCount} of ${coverage.totalCount} places running ${short} · ` +
			coverage.buckets.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`).join(' · ')
	);
</script>

<div class="lead">
	<div class="lead-top">
		<div class="lead-id">
			<div class="t-label text-gray-500 dark:text-gray-400">{eyebrow}</div>
			<div class="lead-name">
				{#if href}
					<a class="t-display-id text-gray-900 hover:underline dark:text-white" {href}>{short}</a>
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
			<div class="t-label text-gray-500 dark:text-gray-400">places running it</div>
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

	<CoverageBar {segments} label={barLabel} class="mt-3" />

	{#if spread}
		<FleetSpread {coverage} class="mt-4" />
	{/if}

	{#if unitNote}
		<p class="t-micro mt-3 text-gray-500 dark:text-gray-400">
			A place is one service in one environment.
		</p>
	{/if}

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
	.lead-name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 4px;
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

	.lead-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
</style>
