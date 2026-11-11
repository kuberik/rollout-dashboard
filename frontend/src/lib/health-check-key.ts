/**
 * The key a rollout's HealthChecks are looked up by (`fleetSignals`' input, built
 * from the fleet health-checks endpoint by the fleet-health-checks api module): the rollout's cluster
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
