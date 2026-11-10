<svelte:options runes={true} />

<script lang="ts">
	import { canHover } from '$lib/can-hover.svelte';
	import type { Rollout, HealthCheck, KruiseRollout, RolloutTest } from '../../types';
	import { PlaySolid, UndoOutline } from 'flowbite-svelte-icons';
	import StatementBanner from './StatementBanner.svelte';
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
	import { checkFailure } from '$lib/view-models/health-witness';
	import { historyEntrySince } from '$lib/view-models/event-age';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';

	interface Props {
		open?: boolean;
		rollout: Rollout;
		failedHCList: Array<{ name: string; namespace?: string; message?: string }>;
		healthChecks: HealthCheck[];
		failedStepTests: Array<{ test: RolloutTest; kruiseRolloutName: string }>;
		stalledKruiseRollout: KruiseRollout | null | undefined;
		canUpdate: boolean;
		canModify: boolean;
		/** r34 tabs-nb r3 (#6): the permissions answer is still pending. The caller passes `canUpdate`/
		 *  `canModify` as true so the action row is drawn at its final height from the first paint
		 *  (it grew 56px, 144 -> 200, when the answer landed); both buttons stay disabled until then. */
		actionsPending?: boolean;
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
		rollout: liveRollout,
		failedHCList: liveFailedHCList,
		healthChecks: liveHealthChecks,
		failedStepTests: liveFailedStepTests,
		stalledKruiseRollout: liveStalledKruiseRollout,
		canUpdate,
		canModify,
		actionsPending = false,
		isDashboardManagingWantedVersion,
		cluster,
		environmentName = null,
		onRetry,
		onSuccess = () => {},
		onError = () => {},
		/** See `AlertPanel`'s `open`: the panel collapses out instead of vanishing. */
		open = true
	}: Props = $props();

	/**
	 * THE FAILURE IT WAS DESCRIBING, HELD WHILE IT LEAVES. `AlertPanel` freezes
	 * its own props on the way out, but this panel's message and record are
	 * snippets that read these inputs live, so a Retry would re-render them
	 * from the cleared state (44px shorter) one frame before the collapse
	 * began. The data is frozen here instead, at its last open value.
	 */
	type Frozen = Pick<
		Props,
		'rollout' | 'failedHCList' | 'healthChecks' | 'failedStepTests' | 'stalledKruiseRollout'
	>;
	const live = $derived<Frozen>({
		rollout: liveRollout,
		failedHCList: liveFailedHCList,
		healthChecks: liveHealthChecks,
		failedStepTests: liveFailedStepTests,
		stalledKruiseRollout: liveStalledKruiseRollout
	});
	// svelte-ignore state_referenced_locally
	let held = $state.raw<Frozen>(live);
	$effect.pre(() => {
		const next = live;
		if (open) held = next;
	});
	const rollout = $derived(held.rollout);
	const failedHCList = $derived(held.failedHCList);
	const healthChecks = $derived(held.healthChecks);
	const failedStepTests = $derived(held.failedStepTests);
	const stalledKruiseRollout = $derived(held.stalledKruiseRollout);

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
		rollbackExplanation = ''; // the operator writes the reason; nothing is pre-asserted
		showRollbackModal = true;
	}
	// One sentence for the banner body: the failing check and its first fact.
	const summaryLine = $derived.by(() => {
		if (failedHCList.length === 1) {
			const first = (failedHCList[0].message || '').split(/;\s*/).filter(Boolean)[0];
			return `${findDisplayName(failedHCList[0])}${first ? `: ${first}` : ' is failing'}`;
		}
		if (failedHCList.length > 1)
			return `${failedHCList.length} health checks failing: ${failedHCList
				.slice(0, 3)
				.map((hc) => findDisplayName(hc))
				.join(', ')}${failedHCList.length > 3 ? '…' : ''}`;
		const msg = (rollout.status?.history?.[0] as any)?.bakeStatusMessage as string | undefined;
		return msg ? msg.split(/;\s*/).filter(Boolean)[0] : 'An error occurred during deployment.';
	});

	/**
	 * ⭐ shared/age-lag-total: ONE AGE PER EVENT. This banner used to state no
	 * instant at all — a reader had no way to tell "this just happened" from
	 * "this has been failing since yesterday" except by opening the history
	 * tab. `checkFailure(rollout)?.since` (the `DeploymentBlocked` condition's
	 * own transition) when a health check is what is holding the rollout —
	 * the deploy itself can have succeeded well before that — else
	 * `historyEntrySince` (`bakeEndTime ?? timestamp`), the SAME instant
	 * `event-age.ts`'s `eventAge(card, 'failed')` reads for every OTHER
	 * failed-card surface (FleetRow, BlockedRow/NeedsYouCard, PromotionMap).
	 */
	const failureSince = $derived(
		checkFailure(rollout)?.since ?? historyEntrySince(rollout.status?.history?.[0])
	);
	const failureAgo = $derived(failureSince ? formatTimeAgoCompact(failureSince, $now) : null);
	const rollbackShown = $derived(!!(rollout?.status?.history && rollout.status.history.length > 1 && canModify));
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
<!-- ⭐ AD ROUND 1 (2026-10-08): ONE LINE OF MESSAGE, THE DETAIL IN THE
     DISCLOSURE. The banner is the page's one statement of the failure:
     headline + the failing check in one sentence + actions inline. The
     per-check bullets and the "deployments are paused" note live under
     `Details`; the `N issues` chip is gone (the sentence already counts). -->
<StatementBanner
	{open}
	class="mb-4"
	severity="failed"
	title="Deployment failed"
	message={failureAgo ? `${summaryLine} · ${failureAgo} ago` : summaryLine}
	footnoteLabel="Details"
	pulse
	primary={rollbackShown ? { label: 'Roll back', icon: UndoOutline, id: 'failure-rollback-btn', key: 'rollback', disabled: actionsPending || !isDashboardManagingWantedVersion, onclick: handleRollback } : undefined}
	secondary={canUpdate ? [{ label: 'Retry', icon: PlaySolid, iconClass: 'h-5 w-5', id: 'failure-retry-btn', key: 'retry', disabled: actionsPending, onclick: handleRetry }] : []}
	tooltips={{
		...(canUpdate ? { 'failure-retry-btn': 'Reset health checks and failed tests, then retry the deployment.' } : {}),
		...(rollbackShown ? { 'failure-rollback-btn': 'Revert to the previous version.' + (!isDashboardManagingWantedVersion ? ' Disabled: wantedVersion managed externally.' : '') } : {})
	}}
	note={rollbackShown && !canHover.current && !isDashboardManagingWantedVersion ? "Another controller owns this rollout's wanted version, so the dashboard cannot pin it." : undefined}
>
	{#snippet footnoteBody()}
		{#if failedHCList.length > 0}
			<ul class="list-disc space-y-0.5 pl-4">
				{#each failedHCList.slice(0, 6) as hc}
					{@const parts = (hc.message || '').split(/;\s*/).filter(Boolean)}
					<li class="break-words">
						<span class="text-fg">{findDisplayName(hc)}</span>{#if parts.length} — {parts.join('; ')}{/if}
					</li>
				{/each}
				{#if failedHCList.length > 6}
					<li class="opacity-60">+{failedHCList.length - 6} more</li>
				{/if}
			</ul>
		{:else if (rollout.status?.history?.[0] as any)?.bakeStatusMessage}
			<p class="break-words">{(rollout.status?.history?.[0] as any).bakeStatusMessage}</p>
		{/if}
		<p class="mt-1">Automated deployments are held until this is resolved.</p>
	{/snippet}
</StatementBanner>

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
