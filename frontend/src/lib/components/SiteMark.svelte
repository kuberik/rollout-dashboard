<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE SITE'S MARK in the environment strip's site picker. It is the strip's own mark: `WaveMark` of a one-site wave, so the dot
	 * you clicked in the strip is the dot its row shows in the picker (same colour, same shape, same pulse), read from the one
	 * state-tone table. Before 2026-11-13 this drew StatusMark icons (clock, arc, pause) and the dot changed shape when you opened it.
	 */
	import WaveMark from './WaveMark.svelte';
	import { waveMark, type MarkSiteState } from '$lib/view-models/wave-mark';

	export type SiteState = MarkSiteState;
	let { state }: { state: SiteState } = $props();
</script>

<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true"><WaveMark mark={waveMark([{ state }])} /></span>
