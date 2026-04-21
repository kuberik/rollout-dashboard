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

	const colorClass = $derived(
		{
			yellow: 'border-yellow-500/30 border-t-yellow-500',
			blue: 'border-blue-500/30 border-t-blue-500',
			orange: 'border-orange-500/30 border-t-orange-500',
			red: 'border-red-500/30 border-t-red-500',
			green: 'border-green-500/30 border-t-green-500',
			gray: 'border-gray-400/30 border-t-gray-500 dark:border-gray-500/30 dark:border-t-gray-300',
			white: 'border-white/40 border-t-white'
		}[color]
	);
</script>

<div
	aria-hidden="true"
	class="inline-block shrink-0 animate-spin rounded-full {sizeClass} {colorClass} {extraClass}"
></div>
