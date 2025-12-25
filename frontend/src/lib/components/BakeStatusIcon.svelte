<svelte:options runes={true} />

<script lang="ts">
	import { Spinner } from 'flowbite-svelte';
	import { getBakeStatusIcon } from '$lib/bake-status';

	interface Props {
		bakeStatus?: string;
		size?: 'small' | 'medium' | 'large';
		class?: string;
	}

	let { bakeStatus, size = 'medium', class: className = '' }: Props = $props();

	const sizeClasses = {
		small: 'h-3 w-3',
		medium: 'h-6 w-6',
		large: 'h-8 w-8'
	};

	const spinnerSizes: Record<'small' | 'medium' | 'large', '4' | '6' | '8'> = {
		small: '4',
		medium: '6',
		large: '8'
	};

	const statusInfo = $derived(getBakeStatusIcon(bakeStatus));
	const Icon = $derived(statusInfo.icon);
</script>

{#if bakeStatus === 'InProgress'}
	<Spinner color="yellow" size={spinnerSizes[size]} class="{sizeClasses[size]} {className}" />
{:else if bakeStatus === 'Deploying'}
	<Spinner color="blue" size={spinnerSizes[size]} class="{sizeClasses[size]} {className}" />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
