<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, HealthCheck, KruiseRollout, RolloutTest } from '../../types';
	import { blur } from 'svelte/transition';
	import { PlaySolid, ReplyOutline } from 'flowbite-svelte-icons';
	import { Tooltip } from 'flowbite-svelte';
	import AlertPanel from './AlertPanel.svelte';
	import ChangeVersionModal from './ChangeVersionModal.svelte';
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
		cluster?: string;
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
		cluster,
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

<!--
	⛔ THIS WAS A HAND-ROLLED COPY OF `AlertPanel`'s `error` SEVERITY, AND THE
	COPY IS WHY IT WAS BROKEN. Every colour string below — the gradient, the
	two glows, the ping, the 40px disc, the icon, the title, the message and
	the footnote — was byte-identical to `AlertPanel`'s `error` palette at the
	moment the copy was taken, so `AlertPanel`'s later ALPHA-LADDER FIX
	(`red-700/75` and `/60` -> the full `red-900` step in light) simply never
	arrived here. It had to be re-applied BY HAND on 2026-08-30, one file
	later, at 4.06 -> 8.51 and 3.12 -> 8.46. That is the whole argument for
	this fold: a shared object copied into a second file does not receive the
	shared object's next fix, and nobody notices until someone renders the
	state the copy lives in.

	THE ONE THING IT CARRIED THAT `AlertPanel` DID NOT was a message that is a
	LIST, not a sentence — a rollout can fail on six health checks at once, and
	`message: string` can only print that as a run-on line. That is now
	`AlertPanel`'s `messageBody` snippet, rendered inside the component's own
	`{palette.message}` wrapper at the same 14px, so the fold loses nothing and
	cannot introduce a second ink ladder.

	IT ALSO GAINS THE GLYPH FIX. `AlertPanel` centres the 40px disc on the
	HEADLINE'S LINE BOX via a two-row grid; this copy used `flex items-center`,
	which centres the glyph against whatever the text column happens to be — one
	line at 1440, five lines at 390. That is the identical defect `AlertPanel`
	documents at 87px on `/versions`, and it was still live here.
-->
<AlertPanel
	severity="error"
	title="Deployment Failed"
	footnote="Automated deployments are paused until this is resolved."
	pulse
>
	{#snippet extra()}
		{#if failedHCList.length > 0}
			<span class="inline-flex items-center rounded-full bg-red-200/80 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-300/60 dark:bg-red-800/60 dark:text-red-300 dark:ring-red-700/60">
				{failedHCList.length} issue{failedHCList.length > 1 ? 's' : ''}
			</span>
		{/if}
	{/snippet}

	{#snippet messageBody()}
		{#if failedHCList.length === 1}
			{@const hcMsg = failedHCList[0].message || ''}
			{@const hcParts = hcMsg.split(/;\s*/).filter(Boolean)}
			<p class="break-words font-medium">{findDisplayName(failedHCList[0])}</p>
			{#if hcParts.length > 1}
				<ul class="mt-0.5 list-disc space-y-0.5 pl-4">
					{#each hcParts as part}
						<li class="break-words">{part}</li>
					{/each}
				</ul>
			{:else if hcMsg}
				<p class="break-words">{hcMsg}</p>
			{/if}
		{:else if failedHCList.length > 1}
			<ul class="list-disc space-y-0.5 pl-4">
				{#each failedHCList.slice(0, 6) as hc}
					<li class="break-words">{findDisplayName(hc)}{hc.message ? ` — ${hc.message}` : ''}</li>
				{/each}
				{#if failedHCList.length > 6}
					<li class="opacity-60">+{failedHCList.length - 6} more</li>
				{/if}
			</ul>
		{:else if (rollout.status?.history?.[0] as any)?.bakeStatusMessage}
			{@const msg = (rollout.status?.history?.[0] as any).bakeStatusMessage as string}
			{@const parts = msg.split(/;\s*/).filter(Boolean)}
			{#if parts.length > 1}
				<ul class="list-disc space-y-0.5 pl-4">
					{#each parts as part}
						<li class="break-words">{part}</li>
					{/each}
				</ul>
			{:else}
				<p class="break-words">{msg}</p>
			{/if}
		{:else}
			<p>An error occurred during deployment.</p>
		{/if}
	{/snippet}

	{#snippet actions()}
		{#if canUpdate}
			<button
				id="failure-retry-btn"
				class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-800/10 px-4 py-2 text-sm font-medium text-red-900 ring-1 ring-red-400/30 transition hover:bg-red-800/15 hover:ring-red-400/50 active:bg-red-800/20 dark:bg-white/10 dark:text-white/90 dark:ring-white/20 dark:hover:bg-white/15 dark:hover:ring-white/30 dark:active:bg-white/20"
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
				class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-red-900 dark:hover:bg-red-50"
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
	{/snippet}
</AlertPanel>

<RetryTestsModal
	bind:open={showRetryModal}
	failedTests={retryTests}
	onRetryTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'retry')}
	onSkipTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'skip')}
/>

<ChangeVersionModal
	bind:open={showRollbackModal}
	{rollout}
	isPinVersionMode={true}
	initialSelectedVersion={rollbackVersionTag}
	initialExplanation={rollbackExplanation}
	{cluster}
	{onSuccess}
	{onError}
/>
