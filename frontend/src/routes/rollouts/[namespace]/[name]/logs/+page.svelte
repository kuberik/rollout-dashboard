<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Button } from 'flowbite-svelte';
	import LogsViewer from '$lib/components/LogsViewer.svelte';

	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// Support ?tab=tests or ?tab=pods query parameter
	const tabFromUrl = $derived(page.url.searchParams.get('tab'));
	const initialTab = $derived.by(() => {
		if (tabFromUrl === 'tests') return 'tests';
		return 'pods';
	});

	let activeTab = $state<'pods' | 'tests'>('pods');

	// Set initial tab from URL on mount
	$effect(() => {
		if (tabFromUrl === 'tests' || tabFromUrl === 'pods') {
			activeTab = tabFromUrl;
		}
	});
</script>

<svelte:head>
	<title>kuberik | {name} ({namespace}) Logs</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden p-3 dark:bg-gray-900 sm:p-4">
	<div class="mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-2 sm:mb-4">
		<h1 class="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">Logs</h1>
		<!-- Tab buttons inline on mobile -->
		<div class="flex rounded-lg border border-gray-200 dark:border-gray-700">
			<button
				class="px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:py-2 sm:text-sm {activeTab === 'pods'
					? 'bg-blue-600 text-white'
					: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'} rounded-l-lg"
				onclick={() => (activeTab = 'pods')}
			>
				Pods
			</button>
			<button
				class="px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:py-2 sm:text-sm {activeTab === 'tests'
					? 'bg-blue-600 text-white'
					: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'} rounded-r-lg"
				onclick={() => (activeTab = 'tests')}
			>
				Tests
			</button>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">

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
