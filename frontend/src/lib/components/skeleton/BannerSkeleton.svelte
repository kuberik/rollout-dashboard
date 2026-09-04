<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * The measured height of the full-width blocking banner (`AlertPanel`
	 * via `BlockingStoryPanel`) on the audit's own fixtures — `/environments`
	 * and `/apps` both measured `1201×142`. Exported for the same reason
	 * `CARD_HEADER_HEIGHT` is.
	 */
	export const BANNER_HEIGHT = 142;
</script>

<script lang="ts">
	/**
	 * ⭐ ONLY RENDER THIS WHEN THE BLOCK STATE IS ALREADY KNOWN. (audit
	 * principle 7: "The blocking banner gets a placeholder when the block
	 * state is already known from `/api/rollouts` — it usually is;
	 * otherwise its insertion is the only thing allowed to move.")
	 *
	 * `/api/rollouts` already carries the rollout's `DeploymentBlocked`
	 * condition, so a caller almost always knows BEFORE `blockingStory()`
	 * has a full `GateContext` (schedules, environments, dependencies may
	 * still be in flight) whether a banner will render at all — only its
	 * exact wording, hue and icon are still unknown. Render this while that
	 * is true; render nothing at all (not this component) while the block
	 * state itself is still unknown, per the same principle.
	 *
	 * Neutral gray, deliberately: `warning` (amber) vs `info` (blue) is
	 * itself part of what is not yet known, and a placeholder that guesses
	 * a colour is the exact "confident wrong answer" the truth rules ban.
	 *
	 * ⭐ `minHeight`/`minHeightMobile`, NOT a class override. (load-state
	 * audit finding 2: `/environments` passed
	 * `!min-h-[239px] sm:!min-h-[142px]` and it rendered 40px at BOTH
	 * widths.) Two `!important` `min-height` declarations for the same
	 * property compete on CASCADE ORDER, not on which one a caller "meant"
	 * — this primitive's own `min-h-[142px]` and the caller's override are
	 * both `!important`, so whichever one Tailwind happens to emit LATER in
	 * the compiled stylesheet wins, regardless of source order in this
	 * file. An inline `style` attribute has no such ambiguity: it always
	 * wins over any non-`!important` stylesheet rule, so the RESPONSIVE
	 * part is done with a component-scoped style block (below) reading a
	 * custom property this element's own inline style sets — never with a
	 * second `!important` class a caller has to out-cascade.
	 */
	let {
		minHeight = BANNER_HEIGHT,
		minHeightMobile = null,
		class: className = ''
	}: {
		/** min-height in px from `sm` (640px) up. Defaults to `BANNER_HEIGHT`. */
		minHeight?: number;
		/** min-height in px below `sm`. `null` (the default) reuses `minHeight` at every width. */
		minHeightMobile?: number | null;
		class?: string;
	} = $props();
</script>

<div
	class="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:gap-x-8 sm:px-6 sm:py-5 dark:border-gray-700 dark:bg-gray-800/60 {className}"
	style="--skel-banner-min-h: {minHeightMobile ?? minHeight}px; --skel-banner-min-h-sm: {minHeight}px"
	aria-hidden="true"
	data-skel-banner
>
	<div class="flex items-center gap-4">
		<span class="skel-block h-10 w-10 shrink-0 rounded-full"></span>
		<div class="flex flex-col gap-2">
			<span class="skel-block h-4 w-56"></span>
			<span class="skel-block h-3.5 w-72"></span>
		</div>
	</div>
</div>

<style>
	[data-skel-banner] {
		min-height: var(--skel-banner-min-h);
	}
	@media (min-width: 640px) {
		[data-skel-banner] {
			min-height: var(--skel-banner-min-h-sm);
		}
	}
</style>
