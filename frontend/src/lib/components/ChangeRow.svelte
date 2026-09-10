<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE COMPACT FORM'S TWO-LINE ROW. CHANGES-2026-09-10.md §2b. Shared by
	 * `YourChangesCard` (Home) and `routes/changes/+page.svelte` (the index)
	 * — one row shape, two call sites, so the two surfaces cannot drift.
	 *
	 * Line 1: the verdict word (`PrPipelineVM.verdict`, folded to ≤3 words by
	 * `changes.ts`'s own `changeVerdict`) in the state's own ink, then the
	 * title — `#n title` for a PR, the commit's first line for a bare commit
	 * — as the row's `.tap-link`, then the meta (`#n · repo`, merge age).
	 *
	 * Line 2 is the landing grid — `allSameLabel` collapses to one line of
	 * text ("today's PR page renders this case as 12 rows"); otherwise
	 * `LandingGrid` renders every service itself, worst-first, folding
	 * beyond 4 below 1024px behind its own "+N services" button (fix pass
	 * item 4/5, 2026-09-10 — no more caller-side 3-cap + dead span).
	 *
	 * ⛔ NOT `justify-between`. `ActivityRail.svelte` and the old
	 * `MyPullListRow.svelte` both record two flush ends fighting a wrap as
	 * the defect that produced 390 overlaps twice already — this row simply
	 * wraps whatever does not fit, on both lines.
	 */
	import LandingGrid from './LandingGrid.svelte';
	import type { ChangeRowVM, ChangeVerdictTone } from '$lib/view-models/changes';
	import { formatTimeAgoCompact } from '$lib/utils';

	let {
		row,
		dense = false,
		now = new Date()
	}: {
		row: ChangeRowVM;
		/** Tighter grid rows for a narrow rail card — `LandingGrid`'s own prop,
		 *  threaded straight through. */
		dense?: boolean;
		now?: Date;
	} = $props();

	const STATIC_TONE_CLASS: Record<Exclude<ChangeVerdictTone, 'active'>, string> = {
		live: 'tone-live',
		failed: 'tone-bad',
		'not-built': 'text-gray-500 dark:text-gray-400',
		held: 'text-orange-950 dark:text-orange-300'
	};

	// `active` covers deploying/baking/retrying/promoting/cancelled/rolled
	// back (`landing-grid.ts`'s own fold) — baking/retrying get the same
	// yellow `BakeStatusIcon` uses for those states; everything else in the
	// bucket reads `tone-active` (blue), matching `LandingMark`'s own
	// per-state ink for the deploying case the design doc names. A function
	// (not a plain object closing over `row` at mount) so re-reading it per
	// render never warns about capturing only the initial prop value.
	function toneClassFor(vm: { verdictTone: ChangeVerdictTone; verdictWord: string }): string {
		if (vm.verdictTone !== 'active') return STATIC_TONE_CLASS[vm.verdictTone];
		return vm.verdictWord === 'baking' || vm.verdictWord === 'retrying'
			? 'text-yellow-700 dark:text-yellow-400'
			: 'tone-active';
	}

	const toneClass = $derived(toneClassFor(row));
	const changeTitle = $derived(row.kind === 'pr' && row.number != null ? `#${row.number} ${row.title}` : row.title);
	const mergedAgo = $derived(formatTimeAgoCompact(row.mergedAt, now));
</script>

<li class="environment-theme-scope">
	<div class="tap-zone cr-row -mx-2 block rounded px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
			<span class="cr-verdict shrink-0 font-semibold {toneClass}">{row.verdictWord}</span>
			<a href={row.href} class="tap-link min-w-0 truncate text-sm text-gray-900 dark:text-white"
				>{changeTitle}</a
			>
			<span class="ml-auto shrink-0 text-[11px] whitespace-nowrap text-gray-500 dark:text-gray-400">
				{#if row.kind === 'pr' && row.number != null}#{row.number} ·{' '}{/if}{row.repo} · {mergedAgo} ago
				{#if row.author}by @{row.author}{/if}
			</span>
		</div>
		<div class="mt-1">
			{#if row.grid.allSameLabel}
				<span class="text-[11px] text-gray-500 dark:text-gray-400">{row.grid.allSameLabel}</span>
			{:else}
				<!-- ⛔ FIX PASS ITEM 4/5, 2026-09-10 — `row.grid.visible` is now
				     `landing-grid.ts`'s FULL adverse-first list (ruling 6, no
				     longer 3-capped); `LandingGrid` owns its own fold (a real
				     "+N services" button), so the index preview is always a
				     strict prefix of what the change page shows for the same
				     change — same list, same order, both places.

				     ⛔ FIX PASS ITEM 6, 2026-09-10 — `dense` FOLDS AT 2, NOT 4.
				     `LandingGrid`'s one row per service (needed for column
				     alignment) costs real height even in dense mode — measured,
				     a 5-row Home card with a 5-service change hit 992px at 390.
				     A dense caller (Home, the repo page's own preview list) is
				     a SUMMARY; 2 services plus a "+N services" button keeps
				     every row's own height bounded regardless of how many
				     services a change touches. -->
				<LandingGrid services={row.grid.visible} {dense} fold={dense ? 2 : undefined} />
			{/if}
		</div>
	</div>
</li>

<style>
	.cr-verdict {
		font-size: 13px;
	}
</style>
