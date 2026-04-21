<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, HealthCheck, KruiseRollout, RolloutTest } from '../../types';
	import { blur } from 'svelte/transition';
	import { ExclamationCircleSolid, PlaySolid, ReplyOutline } from 'flowbite-svelte-icons';
	import { Tooltip } from 'flowbite-svelte';
	import DeployModal from './DeployModal.svelte';
	import RetryTestsModal from './RetryTestsModal.svelte';
	import { getDisplayVersion } from '$lib/utils';

	interface Props {
		rollout: Rollout;
		failedHCList: Array<{ name: string; namespace?: string; message?: string }>;
		healthChecks: HealthCheck[];
		failedStepTests: Array<{ test: RolloutTest; kruiseRolloutName: string }>;
		stalledKruiseRollout: KruiseRollout | null | undefined;
		canUpdate: boolean;
		canModify: boolean;
		isDashboardManagingWantedVersion: boolean;
		onRetry: (kruiseRolloutName?: string, testAction?: string) => Promise<void>;
		onSuccess?: (message: string) => void;
		onError?: (message: string) => void;
	}

	let {
		rollout,
		failedHCList,
		healthChecks,
		failedStepTests,
		stalledKruiseRollout,
		canUpdate,
		canModify,
		isDashboardManagingWantedVersion,
		onRetry,
		onSuccess = () => {},
		onError = () => {}
	}: Props = $props();

	let showRetryModal = $state(false);
	let retryTests = $state<Array<{ test: RolloutTest; kruiseRolloutName: string }>>([]);
	let showRollbackModal = $state(false);
	let rollbackVersionTag = $state<string | null>(null);
	let rollbackExplanation = $state('');

	function findDisplayName(hc: { name: string; namespace?: string }): string {
		const full = healthChecks.find(
			(h) =>
				h.metadata?.name === hc.name &&
				(!hc.namespace || h.metadata?.namespace === hc.namespace)
		);
		return full?.metadata?.annotations?.['kuberik.com/display-name'] || hc.name || 'A health check';
	}

	function handleRetry() {
		if (failedStepTests.length > 0) {
			retryTests = failedStepTests;
			showRetryModal = true;
		} else {
			onRetry(stalledKruiseRollout?.metadata?.name);
		}
	}

	function handleRollback() {
		if (!isDashboardManagingWantedVersion) return;
		const history = rollout?.status?.history;
		if (!history || history.length < 2) return;
		const current = history[0];
		const previous = history[1];
		rollbackVersionTag = previous.version.tag;
		rollbackExplanation = `Rollback from ${getDisplayVersion(current.version)} to ${getDisplayVersion(previous.version)} due to issues with the current deployment.`;
		showRollbackModal = true;
	}
</script>

<div class="mb-4">
	<div class="relative overflow-hidden rounded-xl bg-gradient-to-r from-red-950 via-red-900 to-red-950 shadow-2xl shadow-red-950/50 ring-1 ring-red-800/60">
		<!-- Background glow decorations -->
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-red-500/10 blur-3xl"></div>
			<div class="absolute -bottom-6 left-1/4 h-32 w-32 rounded-full bg-red-400/8 blur-2xl"></div>
		</div>

		<div class="relative flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-x-8 sm:px-6 sm:py-5">
			<!-- Icon + text -->
			<div class="flex min-w-0 flex-1 items-center gap-4">
				<div class="relative shrink-0">
					<div class="absolute inset-0 animate-ping rounded-full bg-red-500/40"></div>
					<div class="relative flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 ring-2 ring-red-500/50">
						<ExclamationCircleSolid class="h-6 w-6 text-red-300" />
					</div>
				</div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<p class="text-base font-bold tracking-tight text-white">Deployment Failed</p>
						{#if failedHCList.length > 0}
							<span class="inline-flex items-center rounded-full bg-red-800/60 px-2 py-0.5 text-xs font-medium text-red-300 ring-1 ring-red-700/60">
								{failedHCList.length} issue{failedHCList.length > 1 ? 's' : ''}
							</span>
						{/if}
					</div>
					<p class="mt-0.5 break-words text-sm text-red-200/75">
						{#if failedHCList.length > 0}
							{findDisplayName(failedHCList[0])}{failedHCList.length > 1 ? ` (+${failedHCList.length - 1} more)` : ''} · {failedHCList[0].message || 'No details available'}
						{:else if (rollout.status?.history?.[0] as any)?.bakeStatusMessage}
							{(rollout.status?.history?.[0] as any).bakeStatusMessage}
						{:else}
							An error occurred during deployment.
						{/if}
					</p>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-3 sm:shrink-0">
				{#if canUpdate}
					<button
						id="failure-retry-btn"
						class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/90 ring-1 ring-white/20 transition hover:bg-white/15 hover:ring-white/30 active:bg-white/20"
						onclick={handleRetry}
					>
						<PlaySolid class="h-3.5 w-3.5" />
						Retry
					</button>
					<Tooltip triggeredBy="#failure-retry-btn" placement="bottom" class="max-w-xs" transition={blur} transitionParams={{ duration: 300 }}>
						Reset health checks and failed tests, then retry the deployment.
					</Tooltip>
				{/if}
				{#if rollout?.status?.history && rollout.status.history.length > 1 && canModify}
					<button
						id="failure-rollback-btn"
						class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-900 shadow-lg transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={!isDashboardManagingWantedVersion}
						onclick={handleRollback}
					>
						<ReplyOutline class="h-3.5 w-3.5" />
						Rollback
					</button>
					<Tooltip triggeredBy="#failure-rollback-btn" placement="bottom" class="max-w-xs" transition={blur} transitionParams={{ duration: 300 }}>
						Revert to the previous version.
						{#if !isDashboardManagingWantedVersion}
							<br /><span class="text-yellow-300">Disabled: wantedVersion managed externally.</span>
						{/if}
					</Tooltip>
				{/if}
			</div>
		</div>
	</div>
</div>

<RetryTestsModal
	bind:open={showRetryModal}
	failedTests={retryTests}
	onRetryTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'retry')}
	onSkipTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'skip')}
/>

<DeployModal
	bind:open={showRollbackModal}
	{rollout}
	selectedVersionTag={rollbackVersionTag}
	selectedVersionDisplay={rollbackVersionTag}
	isPinVersionMode={true}
	initialExplanation={rollbackExplanation}
	{onSuccess}
	{onError}
/>
