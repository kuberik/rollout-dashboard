<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE GLYPH LOOKUP BY CHECK CLASS (take C rule 2): kustomization = cube, datadog / datadog-monitor-crd = chart line,
	 * prometheus-alert = bell, datadog-incidents = fire. Ink is the caller's (state). Used by the Overview rows, History,
	 * the banner's details and every cause line (Attention cards on Home and /rollouts), so one class never has two glyphs.
	 */
	import { CubeSolid, ChartLineUpOutline, BellRingOutline, FireOutline } from 'flowbite-svelte-icons';

	let { cls, class: className = '' }: { cls?: string; class?: string } = $props();
	const Glyph = $derived(cls === 'kustomization' ? CubeSolid : cls === 'prometheus' ? BellRingOutline : cls === 'incidents' ? FireOutline : ChartLineUpOutline);
</script>

<Glyph class={className} aria-hidden="true" />
