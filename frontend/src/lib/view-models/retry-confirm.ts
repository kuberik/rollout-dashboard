import type { Rollout, HealthCheck } from '../../types';
import { getDisplayVersion } from '$lib/utils';
import { confirmLevel, retryIntent, retryConsequences, retryTag } from './deploy-risk';

/**
 * The one decision "does this Retry ask first, and what does it say", shared by
 * every surface that offers Retry (the rollout Overview's failure panel and the
 * app page's failed-place statement). The risk rule is `deploy-risk`'s own;
 * this only assembles its inputs from a rollout and its health checks so no
 * surface re-derives them.
 *
 * `level === 'none'` means fire on click; otherwise open `RetryConfirmModal`
 * with `intent`, `consequences` and `tag`.
 */
export function retryConfirm(
	rollout: Rollout | null | undefined,
	environmentName: string | null | undefined,
	healthChecks: HealthCheck[],
	/** the failed checks recorded on the deployed history entry */
	failedHCList: Array<{ name: string; namespace?: string }> = []
) {
	const intent = retryIntent(rollout, environmentName);
	const level = confirmLevel(intent);
	const currentTag = retryTag(rollout);
	const v = rollout?.status?.history?.[0]?.version;
	const displayTag = v ? getDisplayVersion(v) : currentTag;
	const displayName = (hc: { name: string; namespace?: string }): string => {
		const full = healthChecks.find(
			(h) => h.metadata?.name === hc.name && (!hc.namespace || h.metadata?.namespace === hc.namespace)
		);
		return full?.metadata?.annotations?.['kuberik.com/display-name'] || hc.name || 'A health check';
	};
	// "still failing" is read off the check's status now, never the history record.
	const failingNow = healthChecks.filter((h) => h?.status?.status === 'Unhealthy');
	const clearsFailureDetail =
		healthChecks.some((h) => h?.status?.status === 'Unhealthy' || !!h?.status?.lastErrorTime) ||
		failedHCList.length > 0;
	const consequences = retryConsequences(
		intent,
		{
			failingChecks: failingNow.map((h) =>
				displayName({ name: h?.metadata?.name ?? '', namespace: h?.metadata?.namespace })
			),
			clearsFailureDetail
		},
		displayTag
	);
	return { intent, level, displayTag, consequences };
}
