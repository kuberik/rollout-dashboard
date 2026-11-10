<svelte:options runes={true} />

<script lang="ts">
	/**
	 * HISTORY'S RAIL SUMMARY. (Lane H, squad-rollout, 2026-10-09; revised
	 * same day for the squad lead's presence addendum — CRAFT-STUDY P2,
	 * "numbers lead at 32-48px, labels follow".)
	 *
	 * ROLE: the rail's own "answer the card without reading a row of it" —
	 * the ledger below states each deploy; this states the SHAPE of the
	 * window (spec §1: Deploys, Failed, Rolled back, Median time to
	 * healthy, Last failure, Kept). No existing rail card plays this role —
	 * the Overview's rail is "Health checks / Resources / Recent events",
	 * all CURRENT-state cards, where this one is entirely about the past.
	 *
	 * ⛔ THE "Deploys" FIGURE ITSELF IS GONE (AD round 5, nits: "the deploy
	 * count appears 3× — keep it in the header meta, and drop it from the
	 * card rollup and the Summary title"). `deploys` is still the exact
	 * `filteredHistory.length` the page header's meta line and the ledger
	 * Card already state a few pixels away — this card's own leading 32px
	 * figure was a THIRD copy of the identical number. `Last failure` took
	 * its seat in the grid (promoted from the plain row below, which this
	 * freed up for `Kept` alone); `Failed` and `Rolled back` stay, since
	 * each is its OWN count (not a restatement of the deploy total) and
	 * `Failed` is the one figure this card still colours.
	 *
	 * WHY A NEW COMPONENT: it borrows `Card`'s own shell and the tile grid's
	 * proportions are new ONLY because no existing region leads with a bare
	 * figure at this scale — everywhere else a count rides inside a
	 * sentence (`N deploys`) or a dense row. `.t-stat` (the TL's shared
	 * role, language.css) is the figure; the label underneath is plain
	 * `t-meta`, the same pairing a stat tile anywhere else in the product
	 * would use once that role exists elsewhere.
	 */
	import Card from './Card.svelte';
	import { ChartLineUpOutline } from 'flowbite-svelte-icons';

	let {
		rangeLabel,
		failed,
		failedOpen = failed > 0,
		rolledBack,
		medianHealthyMs,
		lastFailureAgo,
		kept,
		/**
		 * ⭐ BELOW 2 DEPLOYS, A FactList — NOT A GRID OF STATS, ONE OF THEM
		 * READING "n/a" (AD round 1, item 9): "the rail's 32px figure
		 * 'n/a'." A number that LEADS is a promise the figure answers a
		 * question at a glance; "n/a" breaks that promise on the one
		 * figure (median time to healthy) that needs at least two
		 * terminal deploys to mean anything. Below that count there is
		 * nothing to compare, trend or rank — a plain field list states
		 * the one or two facts that exist (and is what the one-deploy
		 * case already gets everywhere else a record has too little to
		 * say for a stat to earn its size).
		 */
		compact = false,
		scoped = true,
		medianWord = 'to healthy',
		class: className = ''
	}: {
		rangeLabel: string;
		failed: number;
		/** ⭐ AD round 9, item 4: "danger ink only while the failure is
		 *  unresolved." `true` when the newest deploy is itself the open
		 *  failure (the Deploys Card's own `openFailed`); a failure that a
		 *  later deploy superseded reads `fg`, not danger. Defaults to
		 *  `failed > 0` (every pre-existing caller's own behaviour,
		 *  unchanged) for callers that have not been taught the distinction
		 *  yet. */
		failedOpen?: boolean;
		rolledBack: number;
		/** `null` when no terminal deploy in range has a start+end to measure. */
		medianHealthyMs: number | null;
		/** `null` when nothing in range has failed. */
		lastFailureAgo: string | null;
		/** e.g. "last 10 deploys" (from `spec.versionHistoryLimit`), or `null`
		 *  when the history is provably complete (not at the retention limit). */
		kept: string | null;
		compact?: boolean;
		/**
		 * ⭐ "none in range" IS A CLAIM ABOUT A RANGE (AD round 4, item 4):
		 * "the Summary must not say 'none in range' for All." `all` is not
		 * a range a reader picked — it is the absence of one — so the same
		 * fallback read as describing a scope that was never set. `false`
		 * (the `all` case) says the plainer, scope-free "No failures"
		 * instead.
		 */
		scoped?: boolean;
		/** what the median measures ("to healthy" on a rollout; "merge to prod" on Changes) */
		medianWord?: string;
		class?: string;
	} = $props();

	const noFailureLabel = $derived(scoped ? 'none in range' : 'No failures');

	function spanLabel(ms: number): string {
		const m = Math.round(ms / 60_000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
	}

	const medianLabel = $derived(medianHealthyMs === null ? 'n/a' : spanLabel(medianHealthyMs));
</script>

<Card icon={ChartLineUpOutline} title="Summary" class={className}>
	{#snippet rollup()}
		<!-- ⭐ `t-meta`, NOT `t-ui-sm` (round 2, item 9, squad lead): a plain
		     descriptive clause ("last 30 days"), not a count or a control. -->
		<span class="t-meta text-fg-subtle">{rangeLabel}</span>
	{/snippet}
	{#if compact}
		<!-- ⭐ A MANUAL ROW LIST, NOT `FactList` (AD round 6, nits: "sentence
		     case for labels"). `FactList`'s own `<dt>` is `t-label` — 10px
		     uppercase by its own shared contract, correct for the record
		     `dl`s it was built for, but it gave this card's "Last failure"
		     ALL CAPS in the one-deploy case while the grid branch below
		     prints the exact same label in plain sentence case a few lines
		     down — one card, two casings for one word, depending only on
		     deploy count. Same `t-meta flex items-center justify-between`
		     row the grid branch's own Last-failure/Kept rows already use,
		     so the card is internally consistent at every deploy count. -->
		<div class="flex flex-col gap-1">
			{#if failed > 0}
				<div class="t-meta flex items-center justify-between text-fg-subtle">
					<span>Failed</span>
					<span class={failedOpen ? 'text-danger' : 'text-fg-muted'}>{failed}</span>
				</div>
			{/if}
			{#if rolledBack > 0}
				<div class="t-meta flex items-center justify-between text-fg-subtle">
					<span>Rolled back</span>
					<span class="text-fg-muted">{rolledBack}</span>
				</div>
			{/if}
			<div class="t-meta flex items-center justify-between text-fg-subtle">
				<span>Last failure</span>
				<span class={lastFailureAgo ? 'text-fg-muted' : ''}>{lastFailureAgo ?? noFailureLabel}</span>
			</div>
			{#if kept}
				<div class="t-meta flex items-center justify-between text-fg-subtle">
					<span>Kept</span>
					<span class="text-fg-muted">{kept}</span>
				</div>
			{/if}
		</div>
	{:else}
		<!-- ⭐ A 3-up GRID OF STAT TILES (revised round 5 nits from the
		     presence addendum's original 2-up/4-tile layout) — the one row
		     this card must colour conditionally (`Failed`, danger ink) stays
		     a plain attribute on the figure, since `.t-stat-sm` carries no
		     tone of its own. Three tiles, not four: `Deploys`'s seat is
		     simply gone, not backfilled with a figure that was never a
		     count (`Last failure` stays prose-scale below, where a
		     relative-time string like "none in range" reads as a sentence
		     rather than a number pretending to be one).
		     ⭐ `.t-stat-sm` (24px), NOT `.t-stat` (32px) (AD round 9, item
		     4): "drop the numerals to 24px, so nothing outranks the
		     title." This rail card sits BESIDE the page's own subject
		     (the rollout name, `t-title`, also 24px) rather than leading
		     the page the way `.t-stat`'s own 32-48px ladder was measured
		     for — a new, smaller step on the same ladder (`language.css`,
		     appended), not a one-off local override.
		     ⭐ DANGER INK ONLY WHILE UNRESOLVED (AD round 9, item 4) —
		     `failedOpen`, not `failed > 0` alone: a failure a later deploy
		     already superseded reads the same `fg` ink every other settled
		     figure here does. -->
		<div class="grid grid-cols-3 gap-4">
			<div class="flex flex-col">
				<span class="t-stat-sm tabular-nums {failed > 0 && failedOpen ? 'text-danger' : 'text-fg'}"
					>{failed}</span
				>
				<span class="t-meta text-fg-subtle">Failed</span>
			</div>
			<div class="flex flex-col">
				<span class="t-stat-sm text-fg tabular-nums">{rolledBack}</span>
				<span class="t-meta text-fg-subtle">Rolled back</span>
			</div>
			<div class="flex flex-col">
				<span class="t-stat-sm text-fg tabular-nums">{medianLabel}</span>
				<!-- ⭐ "Median" ALONE BELOW `sm` (History round 14, AD round
				     10, D6 nit): "summary labels fit on one line at 390."
				     Three equal `grid-cols-3` columns at a rail card's own
				     width leave each one ~90px — enough for "Failed" and
				     "Rolled back", not for "Median to healthy" (18
				     characters), which wrapped to two lines while its
				     siblings stayed on one. The full label returns at `sm`
				     and up, where the rail is wider than this card's own
				     narrowest caller; `title` keeps the full phrase
				     reachable below it either way. -->
				<span class="t-meta text-fg-subtle" title="Median {medianWord}">
					<span class="sm:hidden">Median</span><span class="hidden sm:inline">Median {medianWord}</span>
				</span>
			</div>
		</div>
		<div class="mt-3 flex flex-col gap-1 border-t border-line-subtle pt-3">
			<div class="t-meta flex items-center justify-between text-fg-subtle">
				<span>Last failure</span>
				<span class={lastFailureAgo ? 'text-fg-muted' : ''}>{lastFailureAgo ?? noFailureLabel}</span>
			</div>
			{#if kept}
				<div class="t-meta flex items-center justify-between text-fg-subtle">
					<span>Kept</span>
					<span>{kept}</span>
				</div>
			{/if}
		</div>
	{/if}
</Card>
