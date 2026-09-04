<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * `.chip`'s own geometry (`app.css`), read once here so a test — or a
	 * future caller — can assert against the SAME numbers rather than a
	 * second hand-typed pair that could drift from them.
	 */
	export const CHIP_HEIGHT = 20;
	export const CHIP_RADIUS = 4;
</script>

<script lang="ts">
	/**
	 * A pill matching `Chip`'s own box: `height: 20px`, `border-radius: 4px`
	 * (`.chip` in `app.css`). `.skel-block`'s default `rounded` is already
	 * that same 4px — see its own doc comment — so only the height and
	 * width are set here. No padding: a solid placeholder block carries no
	 * text to pad around, so the WIDTH prop is what stands in for the
	 * chip's real content width.
	 */
	let {
		width = 'w-16',
		class: className = ''
	}: {
		width?: string;
		class?: string;
	} = $props();
</script>

<span class="skel-block inline-block h-5 shrink-0 {width} {className}" aria-hidden="true"></span>
