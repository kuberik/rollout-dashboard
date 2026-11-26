<svelte:options runes={true} />

<script lang="ts">
	/**
	 * WHAT A ROLLBACK WOULD BREAK, ONE DRAWN ROW EACH (rollback dependency safety).
	 * Role: under the "Rollback held" headline, in the Roll back dialog's warning and under a "Skipped" build, the rollouts the
	 * target build would break: `checkout [ledger|^6.0.0] -> [5.1.0] x` (a consumer, what it needs, the build that does not serve
	 * it) or `ledger-books [ledger|6.0.0] -> [^5.0.0] x` (a provider, what it serves, what the build needs). Drawn, never also
	 * written: the sentence form (runs, needs, does not satisfy) is the row's title only (glanceable-UI rule, 2026-11-26).
	 * Why new: `AutoRollbackVerdicts` rows are about a failed SOURCE (a test, an alert) and whether it rolls back; a break is about
	 * another ROLLOUT and a version constraint. Drawing borrowed from: `BlockReason`'s contract branch (the subject at full ink, the
	 * joined `[contract|version]` Chip, an arrow between two operands, the identifier-only Chip). Proportions from
	 * `AutoRollbackVerdicts` / `FailedCheckLine` (14px mark column, 8px gap), so the two lists share one text column.
	 */
	import { ArrowRightOutline, CloseOutline, ShareNodesOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import { rolloutPath } from '$lib/source-dashboard';
	import type { BreakRow } from '$lib/view-models/rollback-deps';

	let { rows, cluster = '', self = '' }: { rows: BreakRow[]; cluster?: string; /** this rollout's own name: a row naming it (a TargetRequires provider that is this rollout) is text, not a link to itself */ self?: string } = $props();
</script>

<ul class="flex min-w-0 flex-col gap-1.5" data-testid="break-rows">
	{#each rows as r (r.key)}
		<li class="grid grid-cols-[14px_minmax(0,1fr)] items-center gap-x-2" data-testid="break-row" title={r.text}>
			<ShareNodesOutline class="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
			<span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				{#if r.namespace && r.name !== self}
					<a class="t-card-title min-w-0 truncate text-fg hover:underline" href={rolloutPath(cluster, r.namespace, r.name)}>{r.name}</a>
				{:else}
					<span class="t-card-title min-w-0 truncate text-fg">{r.name}</span>
				{/if}
				<span class="flex min-w-0 items-center gap-1">
					<Chip role="count" label={r.contract} value={r.left} valueIsBuild={false} wide={r.contract.length > 14} />
					<ArrowRightOutline class="h-3 w-3 shrink-0 text-fg-muted" aria-hidden="true" />
					<Chip role="count" label="" value={r.right} valueIsBuild={false} />
					<CloseOutline class="h-3.5 w-3.5 shrink-0 text-danger" aria-label="does not satisfy" />
				</span>
			</span>
		</li>
	{/each}
</ul>
