/**
 * FLEET HEALTH CHECKS (hc-v2, 2026-10-25): one request for every rollout's
 * HealthChecks, so Home can read check-recovered / check-flapping without a
 * per-rollout fan-out.
 *
 * `GET /api/health-checks` (design: .work/home-build/hc-v2/QUESTIONS.md)
 * returns one item per visible rollout with a `healthCheckSelector`, and its
 * `healthChecks` are exactly what `/rollouts/:ns/:name/health-checks` returns
 * for that rollout (the same backend selector call), so the rollout detail page
 * and Home read one truth. The hub fans spokes in like `/rollouts`, annotating
 * each item with its `source-cluster`.
 *
 * A backend without the endpoint answers 404: the query resolves to `null`,
 * stops polling, and Home reads no check signals, as before the endpoint.
 */
import { ApiError, apiJson, pollWhenHealthy, staleTimeWhenHealthy } from './errors';
import { apiPath } from './urls';
import type { HealthCheck } from '../../types';
import type { ClusterError, ClusterInfo } from './rollouts';
import { sourceClusterName } from '../source-dashboard';
import { healthCheckKey } from '../health-check-key';

/** One rollout's selected HealthChecks; `metadata` names the rollout. */
export type RolloutHealthChecks = {
	metadata: { namespace: string; name: string; annotations?: Record<string, string> };
	healthChecks: HealthCheck[];
};

export type FleetHealthChecksResponse = {
	rolloutHealthChecks: { items: RolloutHealthChecks[] | null } | null;
	clusters?: ClusterInfo[];
	clusterErrors?: ClusterError[];
	/**
	 * Namespaces whose HealthCheck read failed: `<cluster>/<namespace>` on the hub
	 * (the cluster part is that cluster's `source-cluster` name), the bare
	 * namespace on a fan-out leg. A rollout there has NO item: its checks are
	 * unknown, never "none".
	 */
	partialReads?: string[];
};

export const FLEET_HEALTH_CHECKS_KEY = ['fleet-health-checks'] as const;

/** Poll cadence: a fallback poll, and a slow safety-net one while the change stream patches in place. */
export const FLEET_HEALTH_CHECKS_POLL_MS = 60_000;
export const FLEET_HEALTH_CHECKS_STREAMED_MS = 300_000;

export async function fetchFleetHealthChecks(): Promise<FleetHealthChecksResponse | null> {
	try {
		return await apiJson<FleetHealthChecksResponse>(apiPath(null, '/health-checks'));
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}

/** TanStack options for the fleet list. Spread into `createQuery(() => ({ ... }))`. */
export function fleetHealthChecksQuery() {
	const poll = pollWhenHealthy(FLEET_HEALTH_CHECKS_POLL_MS, FLEET_HEALTH_CHECKS_STREAMED_MS);
	return {
		queryKey: FLEET_HEALTH_CHECKS_KEY,
		queryFn: fetchFleetHealthChecks,
		// `null` = the backend has no such endpoint: do not keep asking
		refetchInterval: (query: { state: { status: string; error: unknown; data?: unknown } }) =>
			query.state.status === 'success' && query.state.data === null
				? (false as const)
				: poll(query),
		staleTime: staleTimeWhenHealthy(30_000, FLEET_HEALTH_CHECKS_STREAMED_MS)
	};
}

/**
 * The rollout groups whose checks are KNOWN. The endpoint omits a rollout whose
 * HealthCheck read failed and names its namespace in `partialReads`; a group in
 * a namespace `partialReads` covers is dropped too, so absence stays the one
 * spelling of "unknown" and no recovered/flapping claim is ever made from it.
 * `null`/absent lists read as none known.
 */
export function rolloutHealthChecks(
	res: FleetHealthChecksResponse | null | undefined
): RolloutHealthChecks[] {
	const partial = new Set(res?.partialReads ?? []);
	return (res?.rolloutHealthChecks?.items ?? []).filter((g) => {
		const ns = g.metadata.namespace;
		const cluster = sourceClusterName(g);
		return !partial.has(ns) && !(cluster && partial.has(`${cluster}/${ns}`));
	});
}

/** `fleetSignals`' lookup: `healthCheckKey(cluster, ns, rollout)` -> that rollout's checks. */
export function healthChecksByRollout(
	groups: readonly RolloutHealthChecks[] | null | undefined
): Map<string, HealthCheck[]> {
	const out = new Map<string, HealthCheck[]>();
	for (const g of groups ?? []) {
		const k = healthCheckKey(sourceClusterName(g), g.metadata.namespace, g.metadata.name);
		out.set(k, [...(out.get(k) ?? []), ...(g.healthChecks ?? [])]);
	}
	return out;
}
