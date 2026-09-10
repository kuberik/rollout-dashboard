<svelte:options runes={true} />

<script lang="ts">
	/**
	 * "NOT EVERYWHERE YET"'S CARD. CHANGES-2026-09-10.md ROUND 2, §R2.2.
	 *
	 * A change, drawn as a `Card` — not a bare `<a>`: the landing marks
	 * inside carry their own `href`s, so an anchor-wrapped card would nest
	 * anchors (invalid HTML, doubled tab stops). The header is a `.tap-zone`
	 * via `Card`'s own `titleHref`, same pattern as every other titled panel
	 * in the product.
	 *
	 * ```
	 * ┌ [icon] #4 fix(frontend): retry on 502          held in prod ┐  47px header
	 * ├───────────────────────────────────────────────────────────────┤
	 * │  hello-api-app       [✓DEV] [◻STG] [◻PRD]                    │  landing grid
	 * │  hello-frontend-app  [⏸DEV] [◻STG] [◻PRD]                    │  block 1
	 * ├───────────────────────────────────────────────────────────────┤
	 * │  waiting on hello-api-app — its build does not exist yet      │  reason
	 * ├───────────────────────────────────────────────────────────────┤
	 * │  kuberik-testing · 5h ago · @LittleChimera   Open change › ↗  │  meta + actions
	 * └───────────────────────────────────────────────────────────────┘
	 * ```
	 *
	 * ⛔ NOT four `Card`s whose body is one gray sentence — the round-1
	 * defect this supersedes (`cpr4-1440-light.png`). ONE card, three
	 * `divide-y`-separated blocks; the ALL-SAME fold (every cell the
	 * identical state) collapses block 1 to a single `t-dense` line
	 * (`row.grid.allSameLabel`) while blocks 2/3 render unchanged — "a card
	 * that would draw fifteen identical dashed marks draws one sentence
	 * instead."
	 */
	import Card from './Card.svelte';
	import LandingGrid from './LandingGrid.svelte';
	import { CodePullRequestOutline, CodeBranchOutline } from 'flowbite-svelte-icons';
	import type { ChangeRowVM, ChangeVerdictTone } from '$lib/view-models/changes';
	import { standingWords, standingWordsCompact } from '$lib/view-models/changes';
	import { formatTimeAgoCompact } from '$lib/utils';

	let {
		row,
		now = new Date()
	}: {
		row: ChangeRowVM;
		now?: Date;
	} = $props();

	// R2.2's own table: `live`→`good`, `failed`/`held`→`adverse`, `active`
	// (deploying/baking alike, since `Card`'s own palette has no separate
	// yellow)→`active`, `not-built`→`neutral`. Deliberately NOT `Card`'s own
	// `held` (orange) tone — the design doc's literal mapping for THIS card
	// puts held on the same adverse red as failed, distinct from the
	// per-mark amber `LandingMark` still carries inside block 1.
	const CARD_TONE: Record<ChangeVerdictTone, 'neutral' | 'good' | 'adverse' | 'active' | 'held'> = {
		live: 'good',
		failed: 'adverse',
		held: 'adverse',
		active: 'active',
		'not-built': 'neutral'
	};

	const Icon = $derived(row.kind === 'pr' ? CodePullRequestOutline : CodeBranchOutline);
	const cardTitle = $derived(row.kind === 'pr' && row.number != null ? `#${row.number} ${row.title}` : row.title);
	const titleTooltip = $derived(`${row.title} — ${row.owner}/${row.repo}`);
	const verdict = $derived(standingWords(row));
	const verdictCompact = $derived(standingWordsCompact(row));
	const verdictTone = $derived(CARD_TONE[row.verdictTone]);
	const mergedAgo = $derived(formatTimeAgoCompact(row.mergedAt, now));
</script>

<Card
	icon={Icon}
	title={cardTitle}
	{titleTooltip}
	titleHref={row.href}
	{verdict}
	{verdictCompact}
	{verdictTone}
	padded={false}
>
	<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
		<!-- BLOCK 1 — the landing grid, or its all-same fold. -->
		<div class="px-4 py-3">
			{#if row.grid.allSameLabel}
				<span class="t-dense text-gray-500 dark:text-gray-400">{row.grid.allSameLabel}</span>
			{:else}
				<LandingGrid services={row.grid.visible} fold={6} />
			{/if}
		</div>

		<!-- BLOCK 2 — the frontier's own reason, omitted when nothing blocks. -->
		{#if row.frontierReason}
			<div class="px-4 py-2.5">
				<span class="t-dense text-gray-600 dark:text-gray-400">{row.frontierReason}</span>
			</div>
		{/if}

		<!-- BLOCK 3 — meta + actions. Both sides `min-w-0`, the row WRAPS —
		     `justify-between` without wrap is the recorded 390 overlap defect
		     (`ActivityRail`, `MyPullListRow`; `lib/CLAUDE.md`). -->
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5">
			<span class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
				>{row.repo} · {mergedAgo} ago{row.author ? ` · @${row.author}` : ''}</span
			>
			<span class="flex min-w-0 shrink-0 items-baseline gap-3">
				<a href={row.href} class="nav-link">Open change ›</a>
				{#if row.htmlUrl}
					<a href={row.htmlUrl} class="nav-link" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
				{/if}
			</span>
		</div>
	</div>
</Card>
