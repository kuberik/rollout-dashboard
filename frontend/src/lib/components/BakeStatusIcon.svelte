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

	// All icons (static and spinning) share the same h-_ w-_ footprint
	// at each size, so running rows on the activity rail don't read
	// bigger than settled ones. `small` is `h-4 w-4` (16px) which is
	// the smallest Flowbite `Spinner` accepts.
	const sizeClasses = {
		small: 'h-4 w-4',
		medium: 'h-6 w-6',
		large: 'h-8 w-8'
	};

	const spinnerSizes: Record<'small' | 'medium' | 'large', '4' | '6' | '8'> = {
		small: '4',
		medium: '6',
		large: '8'
	};

	// Literal class map, not a `text-${family}-600` template. Two reasons:
	// Tailwind cannot see an interpolated class name (these only ever got
	// generated because the same strings happened to appear elsewhere in
	// the source), and the status ink is a design token that should be
	// greppable. -700 rather than -600: it is the shade that clears 4.5:1
	// on white, and there is exactly ONE green in the product — this one —
	// which the `newest` rank chip also uses. Pending/None recedes to gray.
	const TONE: Record<string, string> = {
		green: 'text-green-700 dark:text-green-400',
		red: 'text-red-700 dark:text-red-400',
		yellow: 'text-yellow-700 dark:text-yellow-400',
		blue: 'text-blue-700 dark:text-blue-400',
		gray: 'text-gray-500 dark:text-gray-400'
	};

	function getStatusConfig(status?: string) {
		const baseColor = getBakeStatusColor(status);
		const color = TONE[baseColor] ?? TONE.gray;

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
	<Spinner type="pulse" size={spinnerSizes[size]} color="yellow" class={className} />
{:else if bakeStatus === 'Deploying'}
	<StatusSpinner color="blue" size={spinnerSizes[size]} class={className} />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
