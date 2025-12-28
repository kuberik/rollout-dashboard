<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Button } from 'flowbite-svelte';
	import LogsViewer from '$lib/components/LogsViewer.svelte';

	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	let activeTab = $state<'pods' | 'tests'>('pods');
</script>

<svelte:head>
	<title>kuberik | {name} ({namespace}) Logs</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden p-4 dark:bg-gray-900">
	<div class="mb-4 flex-shrink-0">
		<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Logs</h1>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<!-- Tab buttons -->
		<div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
			<button
				class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'pods'
					? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
					: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
				onclick={() => (activeTab = 'pods')}
			>
				Pod Logs
			</button>
			<button
				class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'tests'
					? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
					: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
				onclick={() => (activeTab = 'tests')}
			>
				Test Logs
			</button>
		</div>

		<!-- Tab content -->
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			{#if activeTab === 'pods'}
				<LogsViewer {namespace} {name} filterType="pod" />
			{:else}
				<LogsViewer {namespace} {name} filterType="test" />
			{/if}
		</div>
	</div>
</div>
