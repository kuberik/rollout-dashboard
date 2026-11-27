<svelte:options runes={true} />

<script lang="ts">
	/** The bare "i" drawn white inside a 20px status disc (`Banner`'s info mark); BangGlyph's stroke, turned over. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true" class={className}><path d="M12 10v9M12 5h.01" /></svg>
