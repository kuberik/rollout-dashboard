<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A STRING THAT MAY CARRY A GATE LABEL, DRAWN. Role: the one renderer for every hold sentence ("Held by …", "Waits on …",
	 * a step name, a "Held by" line in a dialog) that can name a promotion gate. The string comes from the cause formatters with
	 * the promotion label wrapped in invisible marks (`gateLabelMarked`); this splits it and draws each marked span through
	 * `GateLabel` (the » glyph and the source chip, or » Promotion), so no surface prints "Promotion from staging" as text.
	 * No existing component fits: GateLabel takes a structured label, but a cause reaches the surface as a sentence.
	 */
	import GateLabel from './GateLabel.svelte';
	import { splitGateText } from '$lib/view-models/gate-label';

	let { text }: { text: string } = $props();
	const parts = $derived(splitGateText(text));
</script>

{#each parts as p, i (i)}{#if 'label' in p}<GateLabel label={p.label} />{:else}{p.text}{/if}{/each}
