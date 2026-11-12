<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A HOLD CAUSE, DRAWN. Role: the one renderer for every hold sentence ("Held by …", "Waits on …", a "Held by" line in a dialog)
	 * that can name a promotion gate. It takes the typed `Cause` (`gate-label.ts`: plain runs and `GateLabel`s) and draws each label
	 * through `GateLabel` (the » glyph and the source chip, or » Promotion), so no surface prints "Promotion from staging" as text.
	 * No existing component fits: GateLabel draws one label, and a cause is a sentence with the label inside it.
	 */
	import GateLabel from './GateLabel.svelte';
	import type { CausePart } from '$lib/view-models/gate-label';

	let { parts }: { parts: readonly CausePart[] } = $props();
</script>

{#each parts as p, i (i)}{#if typeof p === 'string'}{p}{:else}<GateLabel label={p} />{/if}{/each}
