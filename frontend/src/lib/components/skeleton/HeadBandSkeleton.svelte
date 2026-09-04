<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * The page head band's own height (`src/lib/CLAUDE.md`, "VERTICAL — the
	 * head band is chrome and is identical everywhere"): `y=24` a 24px lead,
	 * on its baseline the page's rollup at `t-dense`, row height 28px, then
	 * `mb-5` (20px) to the first content element at `y=72`. Exported so a
	 * caller's own spacing math (and this file's test) reads the one number.
	 */
	export const HEAD_BAND_HEIGHT = 28;
</script>

<script lang="ts">
	/**
	 * The 28px page head band — reserved FIRST, per the audit's principle 2
	 * ("reserve fixed chrome first: free, and where the tap targets are").
	 * Every list page (`/`, `/apps`, `/rollouts`, `/versions`, `/activity`,
	 * `/dependencies`) opens on this exact row: a leading figure at
	 * `t-display` (24px) and the rest of the sentence at `t-dense` on its
	 * baseline. This skeleton stands in for BOTH halves so the row's total
	 * width — and therefore whether it wraps at 390 — does not visibly
	 * change shape once the real figures land.
	 */
	let {
		leadWidth = 'w-10',
		rollupWidth = 'w-48',
		class: className = ''
	}: {
		/** Width of the 24px leading figure (a count, usually 1-3 digits). */
		leadWidth?: string;
		/** Width of the trailing `t-dense` sentence. */
		rollupWidth?: string;
		class?: string;
	} = $props();
</script>

<div
	class="flex h-7 flex-wrap items-baseline gap-x-2 gap-y-1 {className}"
	aria-hidden="true"
	data-skel-headband
>
	<!-- `t-display` is 24px at line-height 1.15, a 28px box: the bar matches the box. -->
	<span class="skel-block h-7 {leadWidth}"></span>
	<span class="skel-block h-3.5 {rollupWidth}"></span>
</div>
