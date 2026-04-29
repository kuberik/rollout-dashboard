<svelte:options runes={true} />

<script lang="ts">
	import { Modal, Button } from 'flowbite-svelte';
	import { ExclamationCircleSolid } from 'flowbite-svelte-icons';

	type Reason = 'previous-failed' | 'unhealthy-health-checks';

	interface Props {
		open: boolean;
		reason: Reason;
		versionDisplay?: string | null;
		onContinue: () => void;
		onCancel?: () => void;
	}

	let {
		open = $bindable(),
		reason,
		versionDisplay = null,
		onContinue,
		onCancel = () => {}
	}: Props = $props();

	const title = $derived(
		reason === 'previous-failed' ? 'Recovery deploy' : 'Deploy during incident'
	);

	const summary = $derived.by(() => {
		if (reason === 'previous-failed') {
			return 'The previous deployment failed. Continuing will start a new deployment in recovery mode.';
		}
		return 'Health checks are currently unhealthy. Continuing will force-deploy into an active incident in recovery mode.';
	});
</script>

<Modal bind:open size="md" autoclose={false}>
	<div class="space-y-4">
		<div class="flex items-start gap-3">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-2 ring-amber-300/60 dark:bg-amber-500/20 dark:ring-amber-500/50">
				<ExclamationCircleSolid class="h-6 w-6 text-amber-600 dark:text-amber-300" />
			</div>
			<div class="min-w-0">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
				{#if versionDisplay}
					<p class="text-sm text-gray-500 dark:text-gray-400">Version {versionDisplay}</p>
				{/if}
			</div>
		</div>

		<p class="text-sm text-gray-700 dark:text-gray-300">{summary}</p>

		<div class="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
			<p class="font-medium">In recovery mode:</p>
			<ul class="mt-1.5 list-disc space-y-1 pl-5">
				<li>Health check failures will <strong>not</strong> mark this deployment as failed.</li>
				<li>The deployment will sit waiting for health checks to recover.</li>
				{#if reason === 'unhealthy-health-checks'}
					<li>Once health checks become healthy and bake starts, normal failure detection resumes.</li>
				{:else}
					<li>If the new deployment also fails to recover, the rollout will not transition to Failed.</li>
				{/if}
				<li>If the deployment is genuinely broken, watch logs and health checks closely.</li>
			</ul>
		</div>

		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					open = false;
					onCancel();
				}}
			>
				Cancel
			</Button>
			<Button
				color="yellow"
				onclick={() => {
					open = false;
					onContinue();
				}}
			>
				I understand, continue
			</Button>
		</div>
	</div>
</Modal>
