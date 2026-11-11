<svelte:options runes={true} />

<script lang="ts">
	// Test double for `UnavailableCard`: proves a region USES the shared card (rather than inlining the same markup).
	let { title, sentence }: { title: string; sentence: string; [k: string]: unknown } = $props();
</script>

<div data-testid="unavailable-card-stub">{title}: {sentence}</div>
