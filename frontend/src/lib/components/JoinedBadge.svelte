<svelte:options runes={true} />

<script lang="ts">
	import { Badge } from 'flowbite-svelte';
	import { ArrowUpRightFromSquareOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		value: string;
		icon?: Snippet;
		valueColor?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'pink' | 'indigo';
		large?: boolean;
		href?: string;
		containerClass?: string;
		containerStyle?: string;
		labelClass?: string;
		valueClass?: string;
	}

	let {
		label,
		value,
		icon,
		valueColor = 'gray',
		large = false,
		href,
		containerClass = '',
		containerStyle,
		labelClass = '',
		valueClass = ''
	}: Props = $props();

	const hasLink = $derived(!!href);
</script>

<div class="inline-flex items-center {containerClass}" style={containerStyle}>
	<!-- Left part: Label with optional icon -->
	<Badge color="gray" {large} class="flex items-center gap-1.5 rounded-r-none border-r-0 {labelClass}">
		{#if icon}
			{@render icon()}
		{/if}
		<span>{label}</span>
	</Badge>

	<!-- Right part: Value -->
	{#if hasLink}
		<a {href} target="_blank" rel="noopener noreferrer" class="inline-flex items-center">
			<Badge color={valueColor} {large} class="flex items-center gap-1 rounded-l-none {valueClass}">
				{value}
				<ArrowUpRightFromSquareOutline class="h-3 w-3 flex-shrink-0" />
			</Badge>
		</a>
	{:else}
		<Badge color={valueColor} {large} class="flex items-center gap-1 rounded-l-none {valueClass}">
			{value}
		</Badge>
	{/if}
</div>
