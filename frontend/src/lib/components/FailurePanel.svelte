<svelte:options runes={true} />

<script lang="ts">
	import { canHover } from '$lib/can-hover.svelte';
	import type { Rollout, HealthCheck, KruiseRollout, RolloutTest } from '../../types';
	import { PlaySolid, UndoOutline } from 'flowbite-svelte-icons';
	import { WANTED_VERSION_OWNED_REASON, rollbackTooltip } from '$lib/view-models/pin-hold';
	import StatementBanner from './StatementBanner.svelte';
	import ChangeVersionFlow from './ChangeVersionFlow.svelte';
	import { visibleHealthChecksFor } from '$lib/view-models/change-version-entry';
	import RetryTestsModal from './RetryTestsModal.svelte';
	import RetryConfirmModal from './RetryConfirmModal.svelte';
	import { retryConfirm } from '$lib/view-models/retry-confirm';
	import { checkFailure, deployWindowStart } from '$lib/view-models/health-witness';
	import { historyEntrySince } from '$lib/view-models/event-age';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { failingLead } from '$lib/view-models/attention';
	import type { HealthObservation } from '$lib/../types';
	import FailureDetails from './FailureDetails.svelte';
	import AutoRollbackVerdicts from './AutoRollbackVerdicts.svelte';
	import RollbackGlance from './RollbackGlance.svelte';
	import { autoRollbackView } from '$lib/view-models/auto-rollback';
	import { poolOf, worstOf, bannerEvidence, failingNowList, failingSummary, checkView, failureSince as checksFailingSince, type SnapCheck } from '$lib/view-models/health-failures';

	interface Props {
		open?: boolean;
		rollout: Rollout;
		failedHCList: Array<{ name: string; namespace?: string; message?: string }>;
		/** `null` = the load failed, `undefined` = still loading (see `flowHealthChecksFor`). */
		healthChecks: HealthCheck[] | null | undefined;
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
		/** the Environment's site (`siteOf`), for the confirm titles */
		site?: string | null;
		onRetry: (kruiseRolloutName?: string, testAction?: string, rethrow?: boolean) => Promise<void>;
		onSuccess?: (message: string) => void;
		onError?: (message: string) => void;
		/** arrived by a Retry link (`?action=retry`, the way `?action=rollback` opens Roll back): open the typed confirm once permissions are known; `onRequestHandled` clears the request */
		requestRetry?: boolean;
		onRequestHandled?: () => void;
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
		site = null,
		onRetry,
		onSuccess = () => {},
		onError = () => {},
		/** See `AlertPanel`'s `open`: the panel collapses out instead of vanishing. */
		open = true,
		requestRetry = false,
		onRequestHandled = () => {}
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
	const healthChecks = $derived(held.healthChecks ?? []);
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
	/** "still failing" is read off the check's status now, not the history record */
	const failingNow = $derived(healthChecks.filter((h) => h?.status?.status === 'Unhealthy'));

	/** Retry's risk, decided by the one shared rule (view-models/retry-confirm.ts) */
	const confirm = $derived(retryConfirm(rollout, environmentName, healthChecks, failedHCList, site));
	const intent = $derived(confirm.intent);
	const level = $derived(confirm.level);
	const displayTag = $derived(confirm.displayTag);
	const consequences = $derived(confirm.consequences);

	let showRetryConfirm = $state(false);

	/** `arrived`: opened by a Retry link (`?action=retry`), not a press here, so it always asks first (a URL never fires a deploy) */
	function handleRetry(arrived = false) {
		if (failedStepTests.length > 0) {
			// The failed-tests path already asks, and asks a BETTER question —
			// retry the tests or skip them. Two dialogs in a row would be the
			// friction that teaches people to click through dialogs.
			retryTests = failedStepTests;
			showRetryModal = true;
			return;
		}
		if (level === 'none' && !arrived) {
			onRetry(stalledKruiseRollout?.metadata?.name);
			return;
		}
		showRetryConfirm = true;
	}

	$effect(() => {
		if (!requestRetry || actionsPending) return;
		if (open && canUpdate) handleRetry(true);
		onRequestHandled();
	});

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
	/* counted and named from the checks failing now, not from the history record (a recovered check is not "failing") */
	const shownList = $derived(failingNowList(failedHCList as SnapCheck[], healthChecks));
	const summaryLine = $derived.by(() => {
		const line = failingSummary(shownList, findDisplayName);
		if (line) return line;
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
	/* the same figure the app page's banner and the failure cards lead with: the first drawable observation of the failing check (the live HealthCheck first, the history snapshot otherwise) */
	const observations = $derived<HealthObservation[]>(
		((failingNow[0]?.status as { observations?: HealthObservation[] } | undefined)?.observations
			?? (failedHCList[0] as { observations?: HealthObservation[] } | undefined)?.observations
			?? []) as HealthObservation[]
	);
	const figure = $derived.by(() => { const l = failingLead(null, observations); return l.kind === 'check' ? null : l; });
	/* with a figure the sentence keeps the check's NAME and the budget; the number is not said twice */
	const bannerMessage = $derived(figure?.budget && shownList.length === 1 ? `${findDisplayName(shownList[0])}: ${figure.budget}` : summaryLine);
	/* the checks the banner draws evidence from, read from observations only: the live HealthCheck when we have it, else the history snapshot */
	const pool = $derived(poolOf(healthChecks, failedHCList as SnapCheck[], deployWindowStart(rollout)));
	const worst = $derived(worstOf(pool));
	/* a failing check without observations has no evidence row: the panel keeps its sentence */
	const evidence = $derived(!!worst && (worst.recovered || !!worst.row));
	const allRecovered = $derived(!!worst?.recovered);
	const evAgo = $derived.by(() => {
		const since = checksFailingSince(pool);
		return since ? formatTimeAgoCompact(since, $now) : failureAgo;
	});
	const pendingN = $derived(healthChecks.filter((h) => checkView(h, deployWindowStart(rollout), failedHCList as SnapCheck[]).verdict === 'pending').length);
	/* the one evidence function every failure banner shares (view-models/health-failures.ts bannerEvidence) */
	const ev = $derived(bannerEvidence(pool, pendingN, evAgo));
	const evObservations = $derived<HealthObservation[]>(ev?.observations ?? []);
	const evCheck = $derived(ev?.check);
	const evMessage = $derived(ev?.message);
	const failureAgo = $derived(failureSince ? formatTimeAgoCompact(failureSince, $now) : null);
	/* AUTO-ROLLBACK PREVIEW: the controller's decision for this failed bake (condition AutoRollback=False): the sentence, then which failures would or would not roll back */
	const autoView = $derived(autoRollbackView(rollout));
	const notRolled = $derived(autoView?.state === 'not-rolled-back' ? autoView : null);
	const retryFirst = $derived(allRecovered);
	const retryAct = $derived({ label: 'Retry', icon: PlaySolid, iconClass: 'h-5 w-5', id: 'failure-retry-btn', key: 'retry', disabled: actionsPending, onclick: () => handleRetry() });
	const rollbackAct = $derived({ label: 'Roll back', icon: UndoOutline, id: 'failure-rollback-btn', key: 'rollback', disabled: actionsPending || !isDashboardManagingWantedVersion, onclick: handleRollback, ...(isDashboardManagingWantedVersion ? {} : { ...(canHover.current ? {} : { title: WANTED_VERSION_OWNED_REASON }), describedBy: 'failure-owned-reason' }) });
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
	recovered={allRecovered}
	title={notRolled ? 'Failed · not rolled back' : 'Deployment failed'}
	observations={notRolled ? undefined : evidence ? evObservations : observations}
	check={notRolled ? undefined : evidence ? evCheck : undefined}
	message={notRolled ? undefined : evidence ? evMessage : failureAgo ? `${bannerMessage} \u00b7\u00a0${failureAgo}\u00a0ago` : bannerMessage}
	footnoteLabel="Details"
	pulse={true}
	primary={retryFirst ? (canUpdate ? retryAct : undefined) : rollbackShown ? rollbackAct : undefined}
	secondary={retryFirst ? (rollbackShown ? [rollbackAct] : []) : canUpdate ? [{ ...retryAct, after: true }] : []}
	tooltips={{
		...(canUpdate ? { 'failure-retry-btn': 'Reset health checks and failed tests, then retry the deployment.' } : {}),
		...(rollbackShown ? { 'failure-rollback-btn': rollbackTooltip(isDashboardManagingWantedVersion) } : {})
	}}
	note={rollbackShown && !canHover.current && !isDashboardManagingWantedVersion ? WANTED_VERSION_OWNED_REASON : undefined}
>
	{#snippet body()}
		{#if notRolled}
			<!-- GLANCEABLE (owner rule, 2026-11-26): the headline carries both states, so the body is the reason in one short line;
			     the failing check, its figures and the verdict rows sit behind Details -->
			<div data-not-rolled-back={notRolled.reason} title={notRolled.headline}>
				<RollbackGlance line={[notRolled.why, failureAgo ? `${failureAgo} ago` : ''].filter(Boolean).join(' · ')} />
			</div>
		{/if}
	{/snippet}
	{#snippet footnoteBody()}
		{#if notRolled && notRolled.rows.length > 0}<div class="mb-2"><AutoRollbackVerdicts rows={notRolled.rows} would={notRolled.reason !== 'NotATrigger'} /></div>{/if}
		{#if notRolled && !evidence && bannerMessage}<p class="mb-1 break-words">{bannerMessage}</p>{/if}
		{#if evidence}
			<FailureDetails {pool} />
		{:else if failedHCList.length > 0}
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

{#if rollbackShown && !isDashboardManagingWantedVersion}
	<span id="failure-owned-reason" class="sr-only">{WANTED_VERSION_OWNED_REASON}</span>
{/if}

<RetryConfirmModal
	bind:open={showRetryConfirm}
	{intent}
	{consequences}
	tag={displayTag}
	onConfirm={() => onRetry(stalledKruiseRollout?.metadata?.name, '', true)}
	onClosedFailure={(m) => onError(m)}
/>

<RetryTestsModal
	bind:open={showRetryModal}
	failedTests={retryTests}
	onRetryTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'retry')}
	onSkipTests={() => onRetry(retryTests[0]?.kruiseRolloutName, 'skip')}
/>

<ChangeVersionFlow
	bind:open={showRollbackModal}
	{rollout}
	healthChecks={held.healthChecks ? visibleHealthChecksFor(rollout, held.healthChecks) : held.healthChecks}
	isPinVersionMode={true}
	initialSelectedVersion={rollbackVersionTag}
	initialExplanation={rollbackExplanation}
	cluster={cluster ?? ''}
	{environmentName}
	{site}
	{onSuccess}
	{onError}
/>
