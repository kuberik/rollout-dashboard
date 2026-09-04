<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE ATOM. One placeholder rectangle, sized by its caller.
	 *
	 * Used for a meta row, a rollup that cannot be computed yet, or the
	 * hero gate-claim reason line (see `../../CLAUDE.md`'s "Loading states"
	 * section — a rollup or a gate's kind may never be printed before it is
	 * known; this is what stands in for it instead). `width`/`height` are
	 * Tailwind classes, not px numbers, so the caller can pass a class that
	 * approximates the FINAL text's own width (`w-48` for "Outside the
	 * Business Hours Only deploy window", say) rather than a generic
	 * placeholder that visibly resizes once the real text lands.
	 */
	let {
		width = 'w-24',
		height = 'h-3.5',
		/** `block` for a line of its own; `inline-block` to sit beside text. */
		inline = false,
		class: className = ''
	}: {
		width?: string;
		height?: string;
		inline?: boolean;
		class?: string;
	} = $props();
</script>

<span
	class="skel-block {inline ? 'inline-block' : 'block'} {height} {width} {className}"
	aria-hidden="true"
></span>
