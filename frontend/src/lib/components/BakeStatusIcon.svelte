<svelte:options runes={true} />

<script lang="ts">
	import { Spinner } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CloseOutline,
		RefreshOutline
	} from 'flowbite-svelte-icons';
	import { getBakeStatusColor } from '$lib/bake-status';

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

	const colorMap: Record<string, string> = {
		green: 'text-green-600 dark:text-green-400',
		red: 'text-red-600 dark:text-red-400',
		yellow: 'text-yellow-600 dark:text-yellow-400',
		blue: 'text-blue-600 dark:text-blue-400',
		gray: 'text-gray-600 dark:text-gray-400'
	};

	function getStatusConfig(status?: string) {
		const baseColor = getBakeStatusColor(status);
		const color = colorMap[baseColor];

		switch (status) {
			case 'Succeeded':
				return { icon: CheckCircleSolid, color };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color };
			case 'InProgress':
				return { icon: ClockSolid, color };
			case 'Deploying':
				return { icon: RefreshOutline, color };
			case 'Cancelled':
				return { icon: CloseOutline, color };
			case 'None':
				return { icon: PauseSolid, color };
			default:
				return { icon: ClockSolid, color };
		}
	}

	const statusInfo = $derived(getStatusConfig(bakeStatus));
	const Icon = $derived(statusInfo.icon);
</script>

{#if bakeStatus === 'InProgress'}
	<Spinner
		type="pulse"
		color="yellow"
		size={spinnerSizes[size]}
		class="{sizeClasses[size]} {className}"
	/>
{:else if bakeStatus === 'Deploying'}
	<Spinner color="blue" size={spinnerSizes[size]} class="{sizeClasses[size]} {className}" />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
