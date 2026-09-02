<svelte:options runes={true} />

<script lang="ts" module>
	/** Who the card is answering for. Informs nothing about rendering by
	 *  itself — every row is driven by its own prop — but a caller states it
	 *  so the shape of the call site says what population it is reading, and
	 *  the component test can walk all four without four fixtures. */
	export type HowItsGoingScope = 'fleet' | 'apps' | 'app' | 'env';

	export type FurthestBehind = { appName: string; by: number };
</script>

<script lang="ts">
	/**
	 * `How it's going` — ONE card, not four.
	 *
	 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
	 *
	 * `/`, `/apps`, `/apps/[name]` and `/envs/[name]` each hand-rolled this
	 * card. Two independent critics measured the same defect from opposite
	 * ends: the `dd` figure was `text-base font-semibold` (16px/600, not a
	 * declared type role) on three of them and `t-headline` (17px/600, an
	 * actual role, but the WRONG one — see `app.css`'s `.t-figure` note) on
	 * the fourth; `dt` was `text-xs` (12px) on three and `t-dense` (12.5px)
	 * on the fourth; the sparkline lived in a `dl` ROW on three pages and in
	 * the CARD HEADER on the fourth; `/envs/[name]` silently swapped its
	 * window from 7 days to 24 hours with no mark anywhere reading it said
	 * so; and `Deploys · 7d` printed **49** on `/` and **34** on `/apps` —
	 * both correct, for two different populations (all 15 rollouts vs. the
	 * 4 apps that carry an `Environment` CR), with nothing on either card
	 * saying which.
	 *
	 * ── THE FIVE ROWS, IN ONE FIXED ORDER ────────────────────────────────
	 *
	 * `Deploys` (count + sparkline) → `Typical deploy` → `Typical to prod` →
	 * `Failed` → `Furthest behind`. Every row is optional — a page renders
	 * the ones that are TRUE for its population, never a synthesised zero —
	 * but the ORDER never changes, so a reader who has learned the card on
	 * one page does not have to re-learn it on the next:
	 *
	 *   `/`             Deploys · Typical to prod · Failed
	 *   `/apps`         Deploys · Typical to prod · Furthest behind
	 *   `/apps/[name]`  Deploys · Typical deploy · Typical to prod
	 *   `/envs/[name]`  Deploys · Typical deploy · Furthest behind
	 *
	 * ── THE WINDOW IS STATED ONCE, ON THE ROW THAT HAS ONE ─────────────────
	 *
	 * `windowLabel` prints on the `Deploys` row's `dt` (`Deploys · 7d`,
	 * `Deploys · 24h`) — never in the header, so it is drawn exactly once
	 * and a 24-hour page cannot be mistaken for a 7-day one at a glance.
	 *
	 * ── THE POPULATION IS NAMED WHEN IT WOULD OTHERWISE COLLIDE ────────────
	 *
	 * `population` appends to the SAME row (`Deploys · 7d · 15 rollouts` vs.
	 * `Deploys · 7d · 4 apps`) — only where two pages share both a window
	 * AND a count that could be read as the same measurement. `/apps/[name]`
	 * and `/envs/[name]` don't pass one: the page's own `h1` already names
	 * the one app or environment the card is about, which is what
	 * `COMPOSITION-GRAMMAR.md`'s "or titles do at minimum" clause allows.
	 *
	 * ── ONE FIGURE ROLE ─────────────────────────────────────────────────────
	 *
	 * Every `dd` is `.t-figure` (16px/600, `app.css`) and every `dt` is
	 * `.t-dense` (12.5px/400, already declared — this card is the fourth of
	 * its four call sites to use it, not a new role). `Deploys`' sparkline
	 * sits beside its OWN row's figure and nowhere else — never restated in
	 * the header, which is the defect `/apps/[name]` shipped with (`5 in
	 * 7d` in the header rollup, the sparkline moved up beside it).
	 */
	import Card from '$lib/components/Card.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import { compactSpan } from '$lib/view-models/lead-time';
	import type { Rollout } from '../../types';
	import {
		ChartMixedOutline,
		RocketSolid,
		ClockOutline,
		HourglassOutline,
		CloseCircleSolid,
		CodeBranchOutline
	} from 'flowbite-svelte-icons';

	type VerdictTone = 'neutral' | 'good' | 'adverse' | 'active';

	/** Below three points a sparkline is two bars and a gap — it draws a
	 *  trend nobody can read. The three existing call sites all agreed on
	 *  this threshold independently; it is not new. */
	const SPARK_MIN = 3;

	let {
		scope,
		verdict = null,
		verdictTone = 'neutral',
		verdictTitle = undefined,

		/** `7d`, `24h` — printed on the `Deploys` row, never the header. */
		windowLabel,
		/** Disambiguates a shared `windowLabel` across pages whose counts
		 *  would otherwise look like the same measurement — `15 rollouts` on
		 *  `/`, `4 apps` on `/apps`. Omit where the page's own title already
		 *  names the one object the card is about. */
		population = null,

		deploys,
		deploysTitle = undefined,
		sparklineRollouts,
		sparklineDays = undefined,
		sparklineHours = undefined,
		sparklineBuckets = undefined,
		/** Overrides the default `deploys >= 3` gate. `/envs/[name]` needs a
		 *  different predicate — its own `sparkBuckets` counts NON-EMPTY
		 *  buckets rather than the raw total, because a total-based gate drew
		 *  eleven hairlines and one green tick for nine deploys landing in one
		 *  hour: a chart needs a SHAPE, not a total. `undefined` keeps the
		 *  default. */
		showSparkline = undefined,

		/** `undefined` omits the row. `null` renders the em dash. */
		typicalDeployMs = undefined,
		typicalDeployTitle = undefined,

		/** `undefined` omits the row. `{ ms: null }` renders the em dash with
		 *  its `no full trip yet` caption — the same shape on every page now,
		 *  not just the two it already shipped on. */
		typicalToProd = undefined,

		/** `undefined` omits the row. */
		failed = undefined,

		/** `undefined` omits the row. `{ entry: null, title }` renders the
		 *  green em dash — nothing is behind. */
		furthestBehind = undefined
	}: {
		scope: HowItsGoingScope;
		verdict?: string | null;
		verdictTone?: VerdictTone;
		verdictTitle?: string;
		windowLabel: string;
		population?: string | null;
		deploys: number;
		deploysTitle?: string;
		sparklineRollouts: Rollout[];
		sparklineDays?: number;
		sparklineHours?: number;
		sparklineBuckets?: number;
		showSparkline?: boolean;
		typicalDeployMs?: number | null;
		typicalDeployTitle?: string;
		typicalToProd?: { ms: number | null; title: string };
		failed?: { count: number; title: string };
		furthestBehind?: { entry: FurthestBehind | null; title: string };
	} = $props();
</script>

<Card icon={ChartMixedOutline} title="How it’s going" {verdict} {verdictTone} {verdictTitle}>
	<dl class="space-y-3">
		<div class="flex items-baseline justify-between gap-3">
			<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
				<RocketSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Deploys · {windowLabel}{population
					? ` · ${population}`
					: ''}
			</dt>
			<dd class="flex items-center gap-2" title={deploysTitle}>
				{#if showSparkline ?? deploys >= SPARK_MIN}
					<DeployVolumeSparkline
						rollouts={sparklineRollouts}
						days={sparklineDays}
						hours={sparklineHours}
						buckets={sparklineBuckets}
					/>
				{/if}
				<span class="t-figure text-gray-900 tabular-nums dark:text-white">{deploys}</span>
			</dd>
		</div>

		{#if typicalDeployMs !== undefined}
			<div class="flex items-baseline justify-between gap-3">
				<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
					<ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical deploy
				</dt>
				<dd
					class="t-figure text-gray-900 tabular-nums dark:text-white"
					title={typicalDeployTitle}
				>
					{typicalDeployMs === null ? '—' : compactSpan(typicalDeployMs)}
				</dd>
			</div>
		{/if}

		{#if typicalToProd}
			<div class="flex items-baseline justify-between gap-3">
				<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
					<HourglassOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical to prod
				</dt>
				<dd
					class="flex items-baseline justify-end gap-1.5 text-gray-900 tabular-nums dark:text-white"
					title={typicalToProd.title}
				>
					{#if typicalToProd.ms === null}
						<!-- `—` ALONE READS AS A RENDERING BUG, NOT AN ANSWER. Every
						     page gets the caption now, not just the two that already
						     shipped it. -->
						<span class="t-figure text-gray-500 dark:text-gray-400">—</span>
						<span class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
							>no full trip yet</span
						>
					{:else}
						<span class="t-figure">{compactSpan(typicalToProd.ms)}</span>
					{/if}
				</dd>
			</div>
		{/if}

		{#if failed}
			<div class="flex items-baseline justify-between gap-3">
				<dt class="t-dense flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
					<CloseCircleSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Failed · {windowLabel}
				</dt>
				<!-- THE INK MARKS THE DEVIATION AND NOTHING ELSE. A zero is the
				     norm and takes the same near-black every other figure on this
				     card takes; a non-zero takes the product's `Failed` red. No
				     green for the zero — green would be a second mark for
				     "everything is fine", which the whole page already is. -->
				<dd
					class="t-figure tabular-nums {failed.count > 0
						? 'text-red-700 dark:text-red-400'
						: 'text-gray-900 dark:text-white'}"
					title={failed.title}
				>
					{failed.count}
				</dd>
			</div>
		{/if}

		{#if furthestBehind}
			<div class="flex items-baseline justify-between gap-3">
				<dt class="t-dense flex min-w-0 items-center gap-1.5 text-gray-500 dark:text-gray-400">
					<CodeBranchOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span class="shrink-0 whitespace-nowrap">Furthest behind</span>
					{#if furthestBehind.entry}
						<a
							href="/apps/{furthestBehind.entry.appName}"
							class="min-w-0 truncate font-mono text-[11px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
							>{furthestBehind.entry.appName}</a
						>
					{/if}
				</dt>
				<dd class="shrink-0" title={furthestBehind.title}>
					{#if furthestBehind.entry}
						<span class="t-figure text-gray-900 tabular-nums dark:text-white"
							>{furthestBehind.entry.by}</span
						>
					{:else}
						<span class="t-figure text-green-700 dark:text-green-400">—</span>
					{/if}
				</dd>
			</div>
		{/if}
	</dl>
</Card>
