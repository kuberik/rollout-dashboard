<svelte:options runes={true} />

<script lang="ts">
	import { Badge } from 'flowbite-svelte';
	import type { Component } from 'svelte';
	import type { SVGAttributes } from 'svelte/elements';

	interface Props {
		label: string;
		value: string;
		icon?: Component<SVGAttributes<SVGElement> & { color?: string }>;
		iconColor?: string;
		valueColor?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'pink' | 'indigo';
		large?: boolean;
	}

	let { label, value, icon, iconColor = '', valueColor = 'gray', large = false }: Props = $props();

	const Icon = $derived(icon);
</script>

<div class="inline-flex items-center">
	<!-- Left part: Label with optional icon -->
	<Badge color="gray" {large} class="flex items-center gap-1.5 rounded-r-none border-r-0">
		{#if Icon}
			<Icon class="h-3 w-3 flex-shrink-0 {iconColor}" />
		{/if}
		<span>{label}</span>
	</Badge>

	<!-- Right part: Value -->
	<Badge color={valueColor} {large} class="flex items-center gap-1 rounded-l-none">
		{value}
	</Badge>
</div>
