/**
 * The key a rollout's HealthChecks are looked up by (`fleetSignals`' input, built
 * from `GET /api/health-checks` by `api/health-checks.ts`): the rollout's cluster
 * (its `source-cluster` name, '' when the list carries none), namespace and name.
 * `ns/name` alone collides across clusters (one app in one namespace on two spokes).
 */
export function healthCheckKey(
	cluster: string | null | undefined,
	namespace: string,
	rollout: string
): string {
	return `${cluster ?? ''}|${namespace}/${rollout}`;
}
