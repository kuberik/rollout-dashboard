<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/changes`' RAIL CARD 1 — CHANGES-2026-09-10.md ROUND 2, §R2.2.
	 *
	 * Cannot reuse `HowItsGoing` — that component's five rows
	 * (`Deploys`/`Typical deploy`/`Failed`/`Furthest behind`) are
	 * ROLLOUT-shaped; this card's four rows are CHANGE-shaped (`Merged`,
	 * `Typical to prod`, `Held`, `No release`). It reuses that component's
	 * GRAMMAR exactly, not its markup: `Card icon={ChartMixedOutline}`,
	 * header `verdict` naming the section-1 count, body `dl.space-y-3`, each
	 * row `div.flex.items-baseline.justify-between.gap-3` with
	 * `dt.t-dense.text-gray-500` carrying a `h-3.5 w-3.5` glyph and
	 * `dd.t-figure.tabular-nums.text-gray-900`.
	 */
	import Card from './Card.svelte';
	import { compactSpan } from '$lib/view-models/lead-time';
	import type { ChangesRailSummary } from '$lib/view-models/changes';
	import {
		ChartMixedOutline,
		CodePullRequestOutline,
		HourglassOutline,
		PauseSolid,
		MinusOutline
	} from 'flowbite-svelte-icons';

	let {
		summary,
		/** The SAME count section 1's own dot-header prints (`notEverywhere`
		 *  over the FILTERED feed) — one population, read twice, so this
		 *  card's header can never disagree with the section under it. */
		notEverywhereCount,
		/**
		 * ⛔ FIX PASS ITEM 1, 2026-09-11 — an optional title, so the
		 * `/changes/<repo>` page can scope this card to ONE repository
		 * ("How this repository is going") rather than repeat "your
		 * changes" over a feed that page never filters to the viewer.
		 * Same grammar, same `dl` rows, same four facts — a caller-supplied
		 * caption, not a new component.
		 */
		title = 'How your changes are going'
	}: {
		summary: ChangesRailSummary;
		notEverywhereCount: number;
		title?: string;
	} = $props();

	const verdict = $derived(
		notEverywhereCount > 0 ? `${notEverywhereCount} not everywhere yet` : 'all landed'
	);
</script>

<Card icon={ChartMixedOutline} {title} {verdict}>
	<dl class="space-y-3">
		<div class="flex items-baseline justify-between gap-3">
			<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
				<CodePullRequestOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Merged · 30d
			</dt>
			<dd class="t-figure text-gray-900 tabular-nums dark:text-white">{summary.mergedCount}</dd>
		</div>

		<div class="flex items-baseline justify-between gap-3">
			<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
				<HourglassOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical to prod
			</dt>
			<dd class="flex items-baseline justify-end gap-1.5 text-gray-900 tabular-nums dark:text-white">
				{#if summary.typicalToProdMs === null}
					<!-- `—` ALONE READS AS A RENDERING BUG, NOT AN ANSWER —
					     `HowItsGoing`'s own spelling for "never a median of one". -->
					<span class="t-figure text-gray-500 dark:text-gray-400">—</span>
					<span class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
						>no measured trip yet</span
					>
				{:else}
					<span class="t-figure">{compactSpan(summary.typicalToProdMs)}</span>
				{/if}
			</dd>
		</div>

		<div class="flex items-baseline justify-between gap-3">
			<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
				<PauseSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Held
			</dt>
			<dd
				class="t-figure tabular-nums {summary.heldCount > 0
					? 'text-orange-700 dark:text-orange-300'
					: 'text-gray-900 dark:text-white'}"
			>
				{summary.heldCount}
			</dd>
		</div>

		<div class="flex items-baseline justify-between gap-3">
			<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
				<MinusOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />No release
			</dt>
			<dd class="t-figure text-gray-900 tabular-nums dark:text-white">{summary.neverBuiltCount}</dd>
		</div>
	</dl>
</Card>
