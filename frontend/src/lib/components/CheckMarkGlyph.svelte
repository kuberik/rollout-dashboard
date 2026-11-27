<svelte:options runes={true} />

<script lang="ts">
	/** The bare tick drawn white inside a 20px status disc (`Banner`'s success mark); BangGlyph's stroke weight. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={className}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
