<svelte:options runes={true} />

<!--
	Datadog Logo Component

	TRADEMARK NOTICE:
	The Datadog logo and "Bits" are trademarks of Datadog, Inc.
	This component uses official Datadog icon assets in compliance with Datadog's brand guidelines.

	Usage Guidelines:
	- Use white logo on dark/gray backgrounds (variant="white")
	- Use RGB/purple logo on light backgrounds (variant="rgb")
	- Do not modify, invert, or alter the logo's colors, aspect ratio, or proportions
	- Do not contain the logo in a box or shape, use gradients, or outline the logo

	For detailed brand guidelines and official logo assets, refer to:
	https://www.datadoghq.com/about/resources/

	This component is provided for integration purposes only and must be used in accordance
	with Datadog's trademark and brand usage policies.
-->

<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import ddIconWhite from '$lib/assets/dd_icon_white.svg?raw';
	import ddIconRgb from '$lib/assets/dd_icon_rgb.svg?raw';

	interface Props extends SVGAttributes<SVGElement> {
		color?: string;
		variant?: 'white' | 'rgb';
	}

	let { class: className, color, variant = 'white', ...restProps }: Props = $props();

	const iconSvg = $derived(variant === 'white' ? ddIconWhite : ddIconRgb);
	const classString = $derived(
		typeof className === 'string' ? className : className ? String(className) : ''
	);
</script>

<div
	class="flex items-center justify-center {classString} [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
>
	{@html iconSvg}
</div>
