<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A GATE'S NAME, DRAWN BY KIND (owner decision 2026-11-11). Role: the one way a gate is named where a surface can draw.
	 * A promotion gate is `» [STAGING]` (the promotion glyph, the source environment's chip) or `» Promotion` when the
	 * source is unknown; it never prints the gate's display name. Any other kind prints its name as text. The decision is
	 * `view-models/gate-label.ts`; this only renders it. Borrows the rollout detail's own `Chip role="env"` and the
	 * `ChevronDoubleRightOutline` mark `gateMark` gives a promotion gate, so it is the same glyph and chip the rest of the
	 * product already uses, not a new drawing.
	 */
	import { ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { PROMOTION_WORD, type GateLabel } from '$lib/view-models/gate-label';

	let { label, glyph = true }: { label: GateLabel; /** the host already draws the kind's glyph beside this (GateRecord's name line does) */ glyph?: boolean } = $props();
</script>

{#if label.kind === 'promotion'}
	<span class="inline-flex min-w-0 items-center gap-1.5" data-gate-label="promotion" data-gate-source={label.source ?? ''}>
		{#if glyph}<ChevronDoubleRightOutline class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />{/if}
		{#if label.source}
			<span class="sr-only">{PROMOTION_WORD} from </span>
			<Chip role="env" label={label.source} theme={getRolloutEnvironmentTheme(null, label.source)} wide />
		{:else}
			<span class="min-w-0">{PROMOTION_WORD}</span>
		{/if}
	</span>
{:else}
	<span class="min-w-0 break-words" data-gate-label="named">{label.text}</span>
{/if}
