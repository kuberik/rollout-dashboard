<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE MEASURED FIGURE OF A FAILING CHECK, as a line inside a banner ("4.2%  error rate").
	 * Role: the failure cards (AttentionCard on Home / Changes / Rollouts) lead with the check's first drawable
	 * observation as a big figure; the app page's StatementBanner carried the same fact only as message text
	 * ("error-rate: 4.2% of requests failed, over a 1% budget"). Same model (`failingLead` / `drawable` in
	 * `view-models/attention.ts`), same words (value · unit · the observation's name); only the size differs.
	 * Why AttentionCard is not used: it is a whole card with identity, change line and actions; the banner already owns those.
	 * Proportions: AttentionCard's figure row (semibold tabular figure, muted unit, `t-body` muted label), at the
	 * `t-heading` step so it sits under the banner title instead of out-shouting it.
	 */
	import type { FigureLead } from '$lib/view-models/attention';

	let { fig, class: className = '' }: { fig: FigureLead; class?: string } = $props();
</script>

<div class="flex min-w-0 items-baseline gap-2 whitespace-nowrap {className}" data-lead={fig.kind} data-observation-figure>
	<span class="text-2xl font-semibold leading-8 tabular-nums tracking-[-0.025em] text-fg">{fig.value}{#if fig.unit}<small class="ml-0.5 whitespace-pre text-base font-normal text-fg-muted">{fig.unit.startsWith('of ') ? ' ' : ''}{fig.unit}</small>{/if}</span>
	<span class="t-body min-w-0 truncate text-fg-muted">{fig.label}</span>
</div>
