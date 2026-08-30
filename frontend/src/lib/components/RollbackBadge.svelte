<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ GOING BACKWARDS IS A DIFFERENT EVENT FROM GOING FORWARDS.
	 *
	 * A live UX critique rolled production back to a one-hour-old build and
	 * found that *"`/` rendered it exactly like a forward deploy"* — same
	 * circle, same rank chip, same sha. Every list surface drew the two events
	 * identically, so the one move an operator most needs to notice was the one
	 * the product refused to name.
	 *
	 * ⭐ IT IS `PinBadge`'S GEOMETRY, CHARACTER FOR CHARACTER. Same 9px
	 * uppercase mark, same `rounded-full`, same `px-1.5 py-0.5`, same amber
	 * ring — because it sits in the same slot, on the same rows, and a second
	 * badge shape there would be the exact defect the chip census exists to
	 * catch. Zero new colour values, zero new geometry: only the glyph and the
	 * word differ, which is the only thing that differs about the fact.
	 *
	 * The count and the two versions ride in the `title`. A badge on a dense
	 * row states the KIND of event; the arithmetic belongs one hover or one
	 * click away, on the rollout's own page.
	 */
	import { UndoOutline } from 'flowbite-svelte-icons';

	let {
		from,
		to,
		by,
		size = 'sm'
	}: {
		/** Display version the rollout came from. */
		from: string;
		/** Display version it went back to. */
		to: string;
		/** How many releases backwards. */
		by: number;
		size?: 'xs' | 'sm';
	} = $props();

	const iconSize = $derived(size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3');
</script>

<span
	class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-700 uppercase ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/60"
	title={`Rolled back ${by} version${by === 1 ? '' : 's'}: ${from} → ${to}`}
>
	<UndoOutline class="{iconSize} -ml-0.5" />
	<span>rolled back</span>
</span>
