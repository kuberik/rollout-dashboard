<svelte:options runes={true} />

<script lang="ts">
	import { Modal, Button } from 'flowbite-svelte';
	import { ExclamationCircleSolid, RefreshOutline, ForwardStepOutline } from 'flowbite-svelte-icons';
	import type { RolloutTest } from '../../types';

	interface Props {
		open: boolean;
		failedTests: { test: RolloutTest; kruiseRolloutName: string }[];
		onRetryTests: () => void;
		onSkipTests: () => void;
	}

	let { open = $bindable(), failedTests, onRetryTests, onSkipTests }: Props = $props();

	function getDisplayName(test: RolloutTest): string {
		return test.metadata?.annotations?.['kuberik.com/display-name'] || test.metadata?.name || 'Unknown test';
	}
</script>

<Modal bind:open title="" size="sm" class="[&>div]:p-0">
	<div class="p-6">
		<!-- Header with icon -->
		<div class="mb-5 flex flex-col items-center text-center">
			<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
				<ExclamationCircleSolid class="h-6 w-6 text-red-600 dark:text-red-400" />
			</div>
			<h3 class="text-lg font-semibold text-gray-900 dark:text-white">
				{failedTests.length === 1 ? '1 Test Failed' : `${failedTests.length} Tests Failed`}
			</h3>
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
				How would you like to proceed?
			</p>
		</div>

		<!-- Failed tests list -->
		<div class="mb-5 space-y-1">
			{#each failedTests as { test }}
				<div class="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 dark:bg-red-900/20">
					<ExclamationCircleSolid class="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
					<span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{getDisplayName(test)}</span>
					{#if (test.status?.retryCount ?? 0) > 0}
						<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
							{test.status?.retryCount}× retried
						</span>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Actions -->
		<div class="space-y-3">
			<button
				type="button"
				class="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
				onclick={() => { open = false; onRetryTests(); }}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
					<RefreshOutline class="h-4 w-4 text-blue-600 dark:text-blue-400" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold text-gray-900 dark:text-white">Retry Tests</p>
					<p class="text-xs text-gray-500 dark:text-gray-400">Re-run tests. Pipeline stays paused until they pass.</p>
				</div>
			</button>

			<button
				type="button"
				class="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
				onclick={() => { open = false; onSkipTests(); }}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-600">
					<ForwardStepOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold text-gray-900 dark:text-white">Skip Tests</p>
					<p class="text-xs text-gray-500 dark:text-gray-400">Continue pipeline and ignore test results.</p>
				</div>
			</button>

			<button
				type="button"
				class="w-full rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
				onclick={() => { open = false; }}
			>
				Cancel
			</button>
		</div>
	</div>
</Modal>
