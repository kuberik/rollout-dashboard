<svelte:options runes={true} />

<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';

	interface Props {
		data: {
			label: string;
			isStartEnd: boolean;
		};
	}

	let { data }: Props = $props();
</script>

<div
	class="min-w-[120px] max-w-[120px] rounded-xl border-2 border-gray-300 bg-white p-4 text-center text-gray-700 font-semibold shadow-xl transition-all dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
>
	{#if data.label === 'start'}
		<Handle type="source" position={Position.Bottom} />
	{:else}
		<Handle type="target" position={Position.Top} />
	{/if}
	{data.label}
</div>
