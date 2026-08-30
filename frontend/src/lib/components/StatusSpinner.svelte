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
	const colorClass = $derived(
		{
			yellow:
				'border-yellow-700/30 border-t-yellow-700 dark:border-yellow-400/30 dark:border-t-yellow-400',
			blue: 'border-blue-500/30 border-t-blue-500',
			orange:
				'border-orange-700/30 border-t-orange-700 dark:border-orange-400/30 dark:border-t-orange-400',
			red: 'border-red-500/30 border-t-red-500',
			green: 'border-green-700/30 border-t-green-700 dark:border-green-400/30 dark:border-t-green-400',
			gray: 'border-gray-400/30 border-t-gray-500 dark:border-gray-500/30 dark:border-t-gray-300',
			white: 'border-white/40 border-t-white'
		}[color]
	);
</script>

<div
	aria-hidden="true"
	class="inline-block shrink-0 animate-spin rounded-full {sizeClass} {colorClass} {extraClass}"
></div>
