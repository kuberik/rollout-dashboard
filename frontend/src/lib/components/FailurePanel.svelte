<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, HealthCheck, KruiseRollout, RolloutTest } from '../../types';
	import { blur } from 'svelte/transition';
	import { PlaySolid, ReplyOutline } from 'flowbite-svelte-icons';
	import { Tooltip } from 'flowbite-svelte';
	import AlertPanel from './AlertPanel.svelte';
	import ChangeVersionModal from './ChangeVersionModal.svelte';
	import RetryTestsModal from './RetryTestsModal.svelte';
	import RetryConfirmModal from './RetryConfirmModal.svelte';
	import { getDisplayVersion } from '$lib/utils';
	import {
		confirmLevel,
		retryIntent,
		retryConsequences,
		retryTag
	} from '$lib/view-models/deploy-risk';

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
		/**
		 * The environment as the CLUSTER spells it (`prod`, `staging`), when the
		 * caller has the `Environment` object. `deploy-risk` falls back to the
		 * rollout's own labels and then its namespace, which is deliberately
		 * loose in one direction only — see `rolloutEnvironmentName`.
		 */
		environmentName?: string | null;
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
		environmentName = null,
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

	/**
	 * ⭐ THE RETRY RISK, DECIDED BY THE SAME RULE AS A MANUAL DEPLOY.
	 *
	 * `Retry` used to fire on the first click into ANY environment — while
	 * `Change Version` demanded a typed sha to send that identical build. This
	 * is the one line that closes that gap, and it deliberately delegates:
	 * `deploy-risk` weighs direction, whether the target is production, and
	 * whether the gates allow this build right now, and it returns `none` for a
	 * retry in a non-production environment whose rules already allow the build.
	 * That case still fires on one click, which is the point.
	 */
	const intent = $derived(retryIntent(rollout, environmentName));
	const level = $derived(confirmLevel(intent));

	/**
	 * ⛔ THE RULE READS THE TAG; THE READER READS THE SHA.
	 *
	 * `retryTag` returns the object's real tag — `main-1788132205-064b655b…`,
	 * 55 characters — because that is what `gatesAllow` has to match against.
	 * Printing it, and worse asking someone to TRANSCRIBE it, is not a speed
	 * bump, it is a copy-paste exercise that wraps to three lines at 390. Every
	 * other surface in this product, `ChangeVersionModal`'s own typed confirm
	 * included, shows `getDisplayVersion`'s seven characters, so this does too.
	 */
	const currentTag = $derived(retryTag(rollout));
	const displayTag = $derived.by(() => {
		const v = rollout?.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) : currentTag;
	});

	/**
	 * ⛔ "STILL FAILING" IS READ OFF THE CHECK'S STATUS NOW, NOT OFF THE HISTORY
	 * ENTRY. `failedHCList` is `history[0].failedHealthChecks` — a RECORD of what
	 * failed during that bake, which does not expire when the check recovers.
	 * Sourcing the sentence from it would assert "is still failing right now"
	 * about a check that went green ten minutes ago, which is the same
	 * confident-wrong shape as the banner this pass is fixing. Verified on the
	 * live cluster: the recovered check kept its history entry and read `Healthy`.
	 */
	const failingNow = $derived(
		healthChecks.filter((h) => h?.status?.status === 'Unhealthy')
	);

	/**
	 * ⛔ AND THE ERASURE CLAUSE IS CONDITIONAL ON THERE BEING EVIDENCE TO ERASE.
	 * The controller's reset writes `Pending`, overwrites `message` and sets
	 * `lastErrorTime` to nil — so a check that is failing NOW and a check that
	 * merely *errored* during this deploy both lose their account of it.
	 * `lastErrorTime` is the witness the rest of the product reads "recovered"
	 * from, so its presence counts as evidence worth warning about.
	 */
	const clearsFailureDetail = $derived(
		healthChecks.some(
			(h) => h?.status?.status === 'Unhealthy' || !!h?.status?.lastErrorTime
		) || failedHCList.length > 0
	);

	const consequences = $derived(
		retryConsequences(
			intent,
			{
				failingChecks: failingNow.map((h) =>
					findDisplayName({ name: h?.metadata?.name ?? '', namespace: h?.metadata?.namespace })
				),
				clearsFailureDetail
			},
			displayTag
		)
	);

	let showRetryConfirm = $state(false);

	function handleRetry() {
		if (failedStepTests.length > 0) {
			// The failed-tests path already asks, and asks a BETTER question —
			// retry the tests or skip them. Two dialogs in a row would be the
			// friction that teaches people to click through dialogs.
			retryTests = failedStepTests;
			showRetryModal = true;
			return;
		}
		if (level === 'none') {
			onRetry(stalledKruiseRollout?.metadata?.name);
			return;
		}
		showRetryConfirm = true;
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
	footnoteLabel="What this stops"
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

<RetryConfirmModal
	bind:open={showRetryConfirm}
	{intent}
	{consequences}
	tag={displayTag}
	onConfirm={() => onRetry(stalledKruiseRollout?.metadata?.name)}
/>

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
