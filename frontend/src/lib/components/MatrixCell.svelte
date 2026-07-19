<svelte:options runes={true} />

<script lang="ts">
	import type { MatrixCellVM } from '$lib/view-models/matrix';
	import { getStatusCircleClass } from '$lib/bake-status';
	import LagChip from './LagChip.svelte';

	let { vm }: { vm: MatrixCellVM | null } = $props();

	// MatrixCellVM.statusKey uses the Rollouts-list vocabulary
	// (succeeded|failed|active|pending); map it to the bakeStatus values
	// getStatusCircleClass expects so the dot color stays consistent with
	// every other status indicator in the app.
	const statusKeyToBakeStatus: Record<string, string | undefined> = {
		succeeded: 'Succeeded',
		failed: 'Failed',
		active: 'Deploying',
		pending: undefined
	};
</script>

{#if vm === null}
	<span class="text-sm text-gray-400 dark:text-gray-600">—</span>
{:else}
	<div class="flex items-center gap-1.5">
		<span
			class="h-2.5 w-2.5 shrink-0 rounded-full {getStatusCircleClass(
				statusKeyToBakeStatus[vm.statusKey]
			)}"
		></span>
		<span class="text-sm text-gray-900 dark:text-gray-100">{vm.version}</span>
		<LagChip behindBy={vm.behindBy} />
	</div>
{/if}
