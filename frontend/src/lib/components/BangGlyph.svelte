<svelte:options runes={true} />

<script lang="ts">
	/** The bare "!" (kit failed disc): drawn white on a solid danger disc by AlertPanel's error face; same path as StatusMark `failed`. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true" class={className}><path d="M12 5v9M12 19h.01" /></svg>
