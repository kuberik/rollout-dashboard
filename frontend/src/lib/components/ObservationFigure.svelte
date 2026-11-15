<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE MEASURED FIGURE OF A FAILING CHECK, as a line inside a banner ("4.2%  error rate").
	 * Role: the failure cards (AttentionCard on Home / Changes / Rollouts) lead with the check's first drawable
	 * observation as a big figure; the app page's StatementBanner carried the same fact only as message text
	 * ("error-rate: 4.2% of requests failed, over a 1% budget"). Same model (`failingLead` / `drawable` in
	 * `view-models/attention.ts`), same words (value · unit · the observation's name); only the size differs.
	 * Why AttentionCard is not used: it is a whole card with identity, change line and actions; the banner already owns those.
	 * Proportions: AttentionCard's figure row, at the SAME size: 32/40 (36 line-height under 640), semibold tabular
	 * figure, 16px muted unit, `t-body` muted label. One figure, one size: a hero that printed it at 24 above cards
	 * printing the same fact at 32 read as the weaker of the two (the cards are the reference: `.ac-fig`).
	 */
	import type { FigureLead } from '$lib/view-models/attention';

	let { fig, class: className = '' }: { fig: FigureLead; class?: string } = $props();
</script>

<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 {className}" data-lead={fig.kind} data-observation-figure>
	<span class="of-fig whitespace-nowrap font-semibold tabular-nums text-fg">{fig.value}{#if fig.unit}<small class="ml-0.5 whitespace-pre text-base tracking-normal font-normal text-fg-muted">{fig.unit.startsWith('of ') ? ' ' : ''}{fig.unit}</small>{/if}</span>
	<span class="t-body min-w-0 text-fg-muted [overflow-wrap:anywhere]">{fig.label}</span>
</div>

<style>
	.of-fig { font-size: 32px; line-height: 40px; letter-spacing: -0.025em; }
	@media (max-width: 639px) {
		.of-fig { line-height: 36px; }
	}
</style>
