<svelte:options runes={true} />

<script lang="ts">
	import type { MatrixCellVM } from '$lib/view-models/matrix';
	import { getStatusCircleClass, statusKeyToBakeStatus } from '$lib/bake-status';
	import LagChip from './LagChip.svelte';

	let { vm }: { vm: MatrixCellVM | null } = $props();

	// MatrixCellVM.statusKey uses the Rollouts-list vocabulary
	// (succeeded|failed|active|pending); map it to the bakeStatus values
	// getStatusCircleClass expects so the dot color stays consistent with
	// every other status indicator in the app. 'active' collapses both
	// Deploying and baking (InProgress) rollouts — the enforced palette
	// rule reserves yellow for baking, so fall back to the cell's own
	// bakeStatus to tell them apart instead of always rendering blue.
	const cellBakeStatus = $derived(
		vm && vm.statusKey === 'active' && vm.bakeStatus === 'InProgress'
			? 'InProgress'
			: statusKeyToBakeStatus(vm?.statusKey ?? '')
	);
</script>

{#if vm === null}
	<span class="text-sm text-gray-400 dark:text-gray-600">—</span>
{:else}
	<div class="flex items-center gap-1.5">
		<span class="h-2.5 w-2.5 shrink-0 rounded-full {getStatusCircleClass(cellBakeStatus)}"></span>
		<span class="font-mono text-sm text-gray-900 dark:text-gray-100">{vm.version}</span>
		<LagChip behindBy={vm.behindBy} />
	</div>
{/if}
