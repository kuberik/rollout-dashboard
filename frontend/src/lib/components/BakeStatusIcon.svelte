<svelte:options runes={true} />

<script lang="ts">
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

<!-- All status icons are static. Earlier iterations animated the
     in-flight ones (rotating border for Deploying, pulsing dots for
     InProgress) but the motion read as "anxious" — and the dashboard
     refetches every 10s anyway, so a changing version/state already
     signals progress. Keep the icons calm; let the data move. -->
<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
