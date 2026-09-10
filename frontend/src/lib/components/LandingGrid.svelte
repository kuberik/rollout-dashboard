<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE COMPACT FORM'S "LINE 2" — per service, its app name and its
	 * family-collapsed marks. CHANGES-2026-09-10.md §2b.
	 *
	 * ── SCOPE: THIS IS LINE 2 ONLY ────────────────────────────────────────
	 *
	 * §2b's compact row is TWO lines — a verdict word + title + meta line,
	 * then this grid. The first line names ONE change (a PR title, a merge
	 * age) that this module has no opinion on, so it is the CALLER's markup
	 * (`YourChangesCard`, the `/changes` index row, L2's own lane) — this
	 * component renders only the per-service marks row, which is the part
	 * `landing-grid.ts`'s fold algorithm actually computes.
	 *
	 * ── WHAT `services` HOLDS, AND WHO FOLDS IT ───────────────────────────
	 *
	 * `buildLandingGrid` computes THREE things: every service (unfolded),
	 * an `allSameLabel` for the case where they all agree, and a worst-first
	 * `visible`/`overflow` split when they do not. Deciding WHICH of those to
	 * hand this component — the full list, or the capped `visible` slice —
	 * is the caller's call (a one-line change with an `allSameLabel` set
	 * renders that string directly and never mounts this component at all;
	 * one with an overflow renders `visible` here plus its own `+N services`
	 * `Chip role="count"` beside it). This component is deliberately dumb
	 * about that decision: it draws exactly the services it is given, so
	 * the fold logic stays in one testable place (`landing-grid.test.ts`)
	 * rather than being re-decided in every card that embeds this.
	 *
	 * ── WRAPPING, §2b's OWN RULE ───────────────────────────────────────────
	 *
	 * "line 2 wraps at the group boundary; a group never splits across
	 * lines" — the outer row is `flex-wrap`, each service is one
	 * `flex-nowrap` group, `gap-1` (4px) inside a group (name → marks, and
	 * mark → mark), `gap-3` (12px) between groups — a 3:1 ratio so grouping
	 * reads without a separator.
	 */
	import LandingMark from './LandingMark.svelte';
	import type { LandingServiceVM } from '$lib/view-models/landing-grid';

	let {
		services,
		dense = false,
		class: className = ''
	}: {
		services: LandingServiceVM[];
		/** Tighter row height for embedding inside an already-dense card
		 *  (e.g. a 5-row Home card). `false` keeps each row tall enough
		 *  (44px) to itself be a comfortable tap target when this grid is
		 *  the outermost interactive surface — CHANGES-2026-09-10.md §2a's
		 *  "the mark is not a control; the GROUP is" applied to the ROW,
		 *  never by growing the 18px mark. */
		dense?: boolean;
		class?: string;
	} = $props();
</script>

<div class="lg-row {dense ? 'lg-row--dense' : ''} {className}">
	{#each services as service (service.appName)}
		<span class="lg-group">
			<span class="lg-name" title={service.appName}>{service.appName}</span>
			{#each service.marks as mark (mark.family)}
				<LandingMark
					family={mark.family}
					count={mark.count}
					state={mark.state}
					sentence={mark.sentence}
					href={mark.href}
					theme={mark.theme}
				/>
			{/each}
		</span>
	{/each}
</div>

<style>
	.lg-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 12px;
		row-gap: 6px;
		min-height: 44px;
	}

	.lg-row--dense {
		min-height: 0;
		row-gap: 4px;
	}

	.lg-group {
		display: inline-flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.lg-name {
		flex-shrink: 0;
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--color-gray-500);
	}

	:global(.dark) .lg-name {
		color: var(--color-gray-400);
	}
</style>
