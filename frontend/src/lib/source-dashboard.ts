// The hub annotates every item it returns with the cluster it came from, so the
// frontend can tell apart identically-named resources that live on different
// clusters. Without this, an Environment from one cluster can match a Rollout of
// the same name/namespace on another cluster.
//
// Two annotations are stamped: the cluster NAME (used for name-based routing) and
// the dashboard URL (legacy; kept for compatibility).
export const SOURCE_CLUSTER_ANNOTATION = 'rollout-dashboard.kuberik.com/source-cluster';
export const SOURCE_DASHBOARD_ANNOTATION = 'rollout-dashboard.kuberik.com/source-dashboard';

type Annotated = { metadata?: { annotations?: Record<string, string> | null } } | null | undefined;

// The cluster NAME an item came from (empty for un-annotated items, e.g. a
// single-rollout detail fetch — those get their cluster from the route instead).
export function sourceClusterName(obj: Annotated): string {
	return obj?.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '';
}

export function sourceDashboardURL(obj: Annotated): string {
	return obj?.metadata?.annotations?.[SOURCE_DASHBOARD_ANNOTATION] ?? '';
}

type RolloutLike = {
	metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> | null };
};
type EnvironmentLike = {
	metadata?: { namespace?: string; annotations?: Record<string, string> | null };
	spec?: { rolloutRef?: { name?: string } };
};

// True when the rollout is the one the environment points at AND both come from
// the same cluster. The source-cluster check is what stops a prod-cluster rollout
// from matching a dev-cluster environment of the same name/namespace once the hub
// has merged both clusters' resources into one list.
export function rolloutMatchesEnvironment(rollout: RolloutLike, env: EnvironmentLike): boolean {
	return (
		sourceClusterName(rollout) === sourceClusterName(env) &&
		rollout.metadata?.namespace === env.metadata?.namespace &&
		env.spec?.rolloutRef?.name === rollout.metadata?.name
	);
}

// Build a rollout detail route with the cluster name embedded in the path, e.g.
// /rollouts/prod/checkout-prod/checkout-app[/history]. The cluster name is
// resolved to a URL server-side by the proxy, so no ?dashboard=<url> is needed.
export function rolloutPath(
	cluster: string,
	namespace: string,
	name: string,
	sub?: string
): string {
	const base = `/rollouts/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
	return sub ? `${base}/${sub}` : base;
}
