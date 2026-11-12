<svelte:options runes={true} />

<script lang="ts" module>
	let uid = 0;
</script>

<script lang="ts">
	/**
	 * ONE WAVE'S MARK in the environment strip (strip-dots). ROLE: the strip's only mark: a dot per tier (or per wave when the tier has
	 * waves), a pie when the wave's sites are in different states. WHY NEW: SiteMark drew one glyph per site (clock, spinner); the owner
	 * wants dots only, one per wave. BORROWS: the 16px slot and the state solids of StatusMark / the tabs' rest dot, Linear's pie status.
	 *
	 * FIXED SIZE (0px rule): always a 16px slot holding a 10px disc, whatever the state, so a state change repaints and moves nothing.
	 * MOTION: only the checking slice breathes (opacity halo, 1.6s) and only the deploying slice sweeps (a rotating wedge, 2.4s, no
	 * real progress is exposed per site, so it is indeterminate). transform + opacity only, inside the slot. Off under
	 * prefers-reduced-motion; CSS animations also pause in hidden tabs and off-screen.
	 */
	import { slicePath, type WaveMark } from '$lib/view-models/wave-mark';

	let { mark }: { mark: WaveMark } = $props();
	const id = `wm${uid++}`;
	const R = 5;
	const hollow = $derived(mark.slices.length === 1 && (mark.slices[0].kind === 'notreached' || mark.slices[0].kind === 'notaffected'));
	const wedge = `M8 8L8 ${8 - R}A${R} ${R} 0 0 1 ${(8 + R * Math.sin(Math.PI / 2)).toFixed(3)} 8Z`;
</script>

<svg class="wm" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={mark.label} data-wave-mark data-kinds={mark.slices.map((s) => s.kind).join(' ')}>
	{#if hollow}
		<circle cx="8" cy="8" r={R - 0.5} fill="none" stroke="var(--k-fg-subtle)" stroke-width="1" stroke-dasharray={mark.slices[0].kind === 'notreached' ? '2 1.5' : undefined} />
	{:else}
		<defs>
			{#each mark.slices as s, i (s.kind)}<clipPath id="{id}-c{i}"><path d={slicePath(s.from, s.to, R)} /></clipPath>{/each}
		</defs>
		{#each mark.slices as s, i (s.kind)}
			{#if s.kind === 'notreached' || s.kind === 'notaffected'}
				<path d={slicePath(s.from, s.to, R)} fill="var(--k-fg-subtle)" fill-opacity="0.3" />
			{:else if s.kind === 'checking'}
				<path class="wm-halo" d={slicePath(s.from, s.to, R + 1.5)} fill="var(--k-progress-solid)" />
				<path class="wm-solid" d={slicePath(s.from, s.to, R)} fill="var(--k-progress-solid)" />
			{:else if s.kind === 'deploying'}
				<path class="wm-track" d={slicePath(s.from, s.to, R)} fill="var(--k-active-solid)" fill-opacity="0.5" />
				<g clip-path="url(#{id}-c{i})"><path class="wm-sweep" d={wedge} fill="var(--k-active-solid)" /></g>
			{:else}
				<path d={slicePath(s.from, s.to, R)} fill="var(--k-{s.kind === 'done' ? 'success' : s.kind === 'held' ? 'held' : s.kind === 'stuck' ? 'warning' : 'danger'}-solid)" />
			{/if}
		{/each}
	{/if}
</svg>

<style>
	.wm {
		display: block;
		flex: none;
		overflow: visible;
	}
	.wm-halo,
	.wm-sweep {
		transform-box: view-box;
		transform-origin: 8px 8px;
	}
	/* animation lives in the media query: reduced motion (and no-preference-less engines) get the static mark */
	@media (prefers-reduced-motion: no-preference) {
		.wm-halo {
			animation: wm-breathe 1.6s ease-in-out infinite;
		}
		.wm-sweep {
			animation: wm-sweep 2.4s linear infinite;
		}
	}
	/* static halo for reduced motion: none (the amber slice itself is the state) */
	@media (prefers-reduced-motion: reduce) {
		.wm-halo,
		.wm-sweep {
			opacity: 0;
		}
		/* static deploying: the whole slice in the active solid (no wedge, so it never reads as a partial pie) */
		.wm-track {
			fill-opacity: 1;
		}
	}
	@keyframes wm-breathe {
		0%, 100% { opacity: 0; transform: scale(0.9); }
		50% { opacity: 0.3; transform: scale(1); }
	}
	@keyframes wm-sweep {
		to { transform: rotate(360deg); }
	}
</style>
