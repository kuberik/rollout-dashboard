<svelte:options runes={true} />

<script lang="ts">
	import StatusSpinner from './StatusSpinner.svelte';
	import { Spinner } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CircleMinusSolid,
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

	// Spinner sizes match the static-icon sizes so Deploying/InProgress
	// circles don't render visibly bigger than Succeeded/Failed ones on
	// the same row (most visible on the activity rail where running rows
	// sit next to static ones). StatusSpinner accepts '3' for the small
	// case; Flowbite's `Spinner` only goes down to '4', so InProgress
	// uses an extra `scale` class to size-match.
	const spinnerSizes: Record<'small' | 'medium' | 'large', '3' | '6' | '8'> = {
		small: '3',
		medium: '6',
		large: '8'
	};
	const flowbiteSpinnerSizes: Record<'small' | 'medium' | 'large', '4' | '6' | '8'> = {
		small: '4',
		medium: '6',
		large: '8'
	};
	const flowbiteSpinnerScale: Record<'small' | 'medium' | 'large', string> = {
		small: 'scale-75',
		medium: '',
		large: ''
	};

	function getStatusConfig(status?: string) {
		const baseColor = getBakeStatusColor(status);
		const color = `text-${baseColor}-600 dark:text-${baseColor}-400`;

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
				return { icon: CircleMinusSolid, color };
			case 'None':
				return { icon: PauseSolid, color };
			default:
				return { icon: ClockSolid, color };
		}
	}

	const statusInfo = $derived(getStatusConfig(bakeStatus));
	const Icon = $derived(statusInfo.icon);
</script>

<!-- In-flight states: Deploying is an actively-running deploy → rotating
     border spinner. InProgress is the bake window — the rollout is just
     watching health checks — → Flowbite's `pulse` spinner (concentric
     dots radiating out), which reads as "passive watch" rather than
     "actively transferring". -->
{#if bakeStatus === 'InProgress'}
	<Spinner type="pulse" size={flowbiteSpinnerSizes[size]} color="yellow" class="{flowbiteSpinnerScale[size]} {className}" />
{:else if bakeStatus === 'Deploying'}
	<StatusSpinner color="blue" size={spinnerSizes[size]} class={className} />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
