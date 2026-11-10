<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE EMPTY GLYPH — nothing deployed yet. (Design language, 2026-10-08.)
	 *
	 * ROLE: the mark for EMPTY (a rollout that has never deployed, a build
	 * that runs nowhere yet). It used to share `PauseSolid` with HELD, so
	 * "nothing here" and "a rule is holding a newer build" were the same
	 * picture. Held is now `HeldGlyph` (a gate); empty is a hollow dashed
	 * 8px ring centred in the glyph's own box: no hue, no fill, the
	 * line-strong ink — absence, drawn as an outline.
	 *
	 * WHY A COMPONENT: it stands in wherever an icon component is passed
	 * (`BakeStatusIcon`'s `statusInfo.icon`, `UpToDate`'s `Icon`), so it takes
	 * the same `class` (box size from `h-*`/`w-*`; any colour class is
	 * ignored on purpose — empty never wears a status hue). Proportions: the
	 * 8px slot RestGlyph's dot uses inside a 16px glyph box.
	 */
	let {
		class: className = '',
		title = undefined
	}: {
		class?: string;
		title?: string;
	} = $props();
</script>

<span
	class="inline-flex shrink-0 items-center justify-center {className}"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
>
	<span class="block h-2 w-2 rounded-full border border-dashed border-line-strong"></span>
</span>
