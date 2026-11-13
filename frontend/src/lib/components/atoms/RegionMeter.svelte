<svelte:options runes={true} />

<script lang="ts">
	/**
	 * r42 ATOM "Region meter" (/design/atoms, opt-in; no page draws it yet).
	 *
	 * ROLE: "k of N regions" as a drawing — how much of a prod set the act covers (an approval releases 5 of 6 regions; a
	 * failing wave is 1 of 3). One segment per region, BUTTED with a 1px seam (a fraction bar you can count, not a strip of
	 * squares: one hue, no per-region colours); the k segments in the state's solid, the rest the gauge's track. The figure
	 * always travels with it ("5 of 6"), the meter never stands alone.
	 *
	 * WHY a new part: the Attention card draws its threshold as a 4px bar under the figure (AttentionCard `data-gauge`), the
	 * ratio card had no drawing at all; this is that same bar, counted. Proportions: the gauge's own h-1 / rounded-full /
	 * bg-subtle track (Polar's credits bar, Mercury's share bar: 4px, round caps, track 2-4% off the surface).
	 */
	import { TONE } from '$lib/view-models/state-tone';
	let {
		k,
		n,
		ink = 'held',
		width = 256,
		label = undefined,
		class: className = ''
	}: {
		/** segments in the state's solid (counted from the left) */
		k: number;
		/** all segments (regions) */
		n: number;
		ink?: 'held' | 'danger' | 'active' | 'progress' | 'neutral';
		/** px; the card form is the gauge's max-w-64 (256), the inline form ~32 */
		width?: number;
		label?: string;
		class?: string;
	} = $props();
	/** ink -> the on-segment fill: the table's solids (neutral is the muted ink, not a state) */
	const FILL = { held: TONE.held.solid, danger: TONE.failed.solid, active: TONE.deploying.solid, progress: TONE.checking.solid, neutral: 'var(--k-fg-muted)' } as const;
	const segs = $derived(Array.from({ length: Math.max(1, n) }, (_, i) => i < k));
</script>

<span class="rm {className}" style:width="{width}px" role="img" aria-label={label ?? `${k} of ${n}`} data-region-meter>
	{#each segs as on, i (i)}<span class="rm-s" class:on style:background={on ? FILL[ink] : undefined}></span>{/each}
</span>

<style>
	.rm { display: inline-flex; gap: 1px; height: 4px; border-radius: 9999px; overflow: hidden; flex-shrink: 1; min-width: 0; max-width: 100%; vertical-align: middle; }
	.rm-s { flex: 1 1 0; background: var(--k-subtle); }
</style>
