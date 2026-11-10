/**
 * THE ONE WAY INTO "CHANGE VERSION", FROM EVERY TAB. (PALROW r8, AD palette
 * round 7, item 2; squad-rollout coordinator, 2026-10-10.)
 *
 * The Overview gated its Change-version picker behind a recovery warning
 * ("The previous deployment failed. Continuing will start a new deployment
 * in recovery mode") and History did not: the same palette command, run from
 * History, skipped a step the Overview shows. The decision lived inline in
 * `+page.svelte` (`recoveryModeReason`), so the second page that mounted the
 * picker could not reach it. It lives here now, with the two display helpers
 * the warning's sentence needs, and `ChangeVersionFlow.svelte` is the one
 * component that mounts the warning and the picker together.
 *
 * The predicate is the Overview's, moved verbatim (including its 2026-09-13
 * fix: only `Failed` is a failure; an in-flight deploy is not).
 */
import type { HealthCheck, Rollout } from '../../types';
import { getDisplayVersion } from '$lib/utils';

export type RecoveryReason =
	| 'previous-failed'
	| 'unhealthy-health-checks'
	/** The checks could not be loaded, so the dashboard cannot tell. The
	 *  controller (rollout_controller.go setBakeFailureDisabledForNewDeploy)
	 *  decides recovery mode itself and does not enter it when it cannot list
	 *  checks either, so this reason never claims recovery mode. */
	| 'health-checks-unavailable';

/**
 * The cutoff before which a failing check's last error no longer counts: the
 * current deploy's start, or its last retry, whichever is later. A check
 * whose `lastErrorTime` predates it failed against an older attempt (see the
 * HealthCheck `LastErrorTime` semantics: it survives recovery as a witness).
 * Same expression the Overview's `errorCutoff` uses.
 */
export function healthCheckErrorCutoff(rollout: Rollout | null | undefined): Date | null {
	const h = rollout?.status?.history?.[0];
	if (!h?.timestamp) return null;
	return new Date(
		Math.max(
			new Date(h.timestamp).getTime(),
			h.lastRetryTimestamp ? new Date(h.lastRetryTimestamp).getTime() : 0
		)
	);
}

/** The Overview's `visibleHealthChecks` filter, for a caller that has only
 *  the raw list (History). Failing checks whose last error predates the
 *  current attempt are dropped; everything else is kept. */
export function visibleHealthChecksFor(
	rollout: Rollout | null | undefined,
	healthChecks: HealthCheck[]
): HealthCheck[] {
	const cutoff = healthCheckErrorCutoff(rollout);
	if (cutoff === null) return healthChecks;
	return healthChecks.filter((hc) => {
		if (hc.status?.status !== 'Failed' && hc.status?.status !== 'Unhealthy') return true;
		const lastErrorTime = hc.status?.lastErrorTime;
		if (!lastErrorTime) return false;
		return new Date(lastErrorTime) >= cutoff;
	});
}

/**
 * Would a new deploy of this rollout run in recovery mode, and why. `null`
 * when it would not, and the picker opens directly.
 */
export function recoveryModeReason(
	rollout: Rollout | null | undefined,
	visibleHealthChecks: HealthCheck[] | null
): RecoveryReason | null {
	// The controller's rule (rollout_controller.go setBakeFailureDisabledForNewDeploy):
	// ANY bake status other than Succeeded on the running entry is a recovery
	// trigger, not only 'Failed'. This predicts the controller; how the page
	// DRAWS a failed state is a separate rule (only 'Failed' reads as failing).
	const bake = rollout?.status?.history?.[0]?.bakeStatus;
	if (bake && bake !== 'Succeeded') return 'previous-failed';
	// `null` = the list could not be loaded. Never read that as "no checks".
	if (visibleHealthChecks === null) return 'health-checks-unavailable';
	if (visibleHealthChecks.some((hc) => hc.status?.status === 'Unhealthy')) {
		return 'unhealthy-health-checks';
	}
	return null;
}

/** The build that is running now (the one that failed, in recovery), as the
 *  warning names it. `null` before anything has deployed. */
export function previousVersionDisplay(rollout: Rollout | null | undefined): string | null {
	const running = rollout?.status?.history?.[0]?.version;
	return running ? getDisplayVersion(running) : null;
}

/** The build about to deploy, as the warning names it: its release's display
 *  label when the tag is a known release, else the tag itself. */
export function selectedVersionDisplay(
	rollout: Rollout | null | undefined,
	selectedTag: string | null
): string | null {
	if (!selectedTag) return null;
	const release = rollout?.status?.availableReleases?.find((ar) => ar.tag === selectedTag);
	return release ? getDisplayVersion(release) : selectedTag;
}

/**
 * What a page hands `ChangeVersionFlow` / `FailurePanel` as `healthChecks`.
 * `null` = the load FAILED (the flow says it cannot tell); `undefined` = still
 * loading or never asked (the flow fetches/waits itself, so an unloaded list
 * is never read as "no checks"); an array = the page's visible checks.
 */
export function flowHealthChecksFor(
	q: { hasSelector: boolean; isSuccess: boolean; isError: boolean },
	visible: HealthCheck[]
): HealthCheck[] | null | undefined {
	if (!q.hasSelector) return visible;
	if (q.isError) return null;
	return q.isSuccess ? visible : undefined;
}
