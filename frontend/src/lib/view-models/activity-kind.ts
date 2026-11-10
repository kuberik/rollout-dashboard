import type { ActivityKind } from './activity-verb';
import { categorizeFailure } from '$lib/utils';

/**
 * WHAT ONE HISTORY ENTRY WAS, in the one activity vocabulary (`activityVerb`).
 * Shared by every activity surface (ActivityRail — Home, the fleet pages and
 * /apps/<name>), so a deploy is never "promoted" on one page and "deployed"
 * on another.
 *
 *   failedHealthCheck / failed      a `Failed` bake, split by `categorizeFailure`
 *                                   (see below — the SAME split `BlockedRow`'s
 *                                   `blockedFact` already reads off
 *                                   `card.failureCategory`)
 *   deploying / checking            from the entry's bakeStatus (in-flight)
 *   rolledBack                      history-marks' deployActs(r)[i].kind === 'rollback'
 *   promoted                        the controller acting in an environment later
 *                                   than the app's first (it carried a build forward)
 *   deployed                        everything else (a person, CI, or the first stage)
 *
 * ⛔ A HEALTH-CHECK FAILURE IS A HEALTH-CHECK FAILURE EVERYWHERE. (2026-10-11,
 * demo/chain-order.) This used to read every `bakeStatus === 'Failed'` entry
 * as `failed` ("checkout-worker failed to deploy"), no matter why — while
 * the Needs-you row for the SAME event named the real cause
 * (`card.failureCategory`, off the identical `bakeStatusMessage`): "Healthcheck
 * failed". One rollout, one event, two different stories on two pages.
 * `categorizeFailure` is the one classifier both now read: a message that
 * names a health check (`HighErrorRate firing …`, `liveness`, `readiness`, …)
 * is `failedHealthCheck` here and the healthcheck branch there; anything
 * else is a genuine deploy failure and both surfaces say so.
 */
export function activityKindOf(e: {
	bakeStatus: string | null | undefined;
	/** The failing entry's own message — the same field `card.failureCategory`
	 *  (`rollout-cards.ts`) classifies, so the two can never disagree. */
	bakeStatusMessage?: string | null;
	isRollback: boolean;
	actorKind: 'person' | 'ci' | 'controller';
	envRank: number;
	firstEnvRank: number;
}): ActivityKind {
	if (e.bakeStatus === 'Failed') {
		return categorizeFailure(e.bakeStatusMessage) === 'healthcheck' ? 'failedHealthCheck' : 'failed';
	}
	if (e.bakeStatus === 'Deploying') return 'deploying';
	if (e.bakeStatus === 'InProgress') return 'checking';
	if (e.isRollback) return 'rolledBack';
	if (e.actorKind === 'controller' && e.envRank > e.firstEnvRank) return 'promoted';
	return 'deployed';
}
