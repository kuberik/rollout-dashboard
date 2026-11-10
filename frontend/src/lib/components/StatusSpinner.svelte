<svelte:options runes={true} />

<script lang="ts">
	type Size = '3' | '4' | '5' | '6' | '8';
	type Color = 'yellow' | 'blue' | 'orange' | 'red' | 'green' | 'gray' | 'white';

	interface Props {
		size?: Size;
		color?: Color;
		class?: string;
	}

	let { size = '4', color = 'blue', class: extraClass = '' }: Props = $props();

	const sizeClass = $derived(
		{
			'3': 'h-3 w-3 border-2',
			'4': 'h-4 w-4 border-2',
			'5': 'h-5 w-5 border-2',
			'6': 'h-6 w-6 border-[3px]',
			'8': 'h-8 w-8 border-[3px]'
		}[size]
	);

	// The `border-t` arc IS the mark; the other three sides are its 30% track,
	// which is decoration and is not held to a floor.
	//
	// ⛔ `yellow` and `orange` are -700/-400 PAIRS, not a single -500. Measured
	// in-browser on their real grounds: `yellow-500` was **1.91:1 on white and
	// 1.85:1 on the `yellow-50` health-check row** — invisible in light, and it
	// renders nine times inside `ResourcesCard` alone, i.e. on the rollout
	// detail reference page. `orange-500` on white is **2.84:1**. Both are
	// under the 3:1 a non-text mark needs, and both were single-value inks in a
	// two-theme product, which `DESIGN.md` counts as a defect on its own.
	// The steps are the ones `BakeStatusIcon.TONE` already declares, so the
	// spinning yellow and the settled yellow are one colour. Zero new values.
	// ⭐ MIGRATED TO THE DESIGN LANGUAGE'S STATUS HUES. (2026-10-08) `yellow`
	// is `progress` (checking/baking), `blue` is `active` (deploying), `red`
	// is `danger`, `green` is `success`, `orange` stays its own held-family
	// hue for the one caller (`ClearPinModal`) that still asks for it
	// explicitly as `orange` rather than through a status role.
	const colorClass = $derived(
		{
			yellow: 'border-progress-line border-t-progress',
			blue: 'border-active-line border-t-active',
			orange: 'border-held-line border-t-held',
			red: 'border-danger-line border-t-danger',
			green: 'border-success-line border-t-success',
			gray: 'border-line-strong border-t-fg-subtle',
			white: 'border-white/40 border-t-white'
		}[color]
	);
</script>

<div
	aria-hidden="true"
	class="inline-block shrink-0 animate-spin rounded-full {sizeClass} {colorClass} {extraClass}"
></div>
