// The hub annotates every item it returns with the URL of the cluster it came
// from, so the frontend can tell apart identically-named resources that live on
// different clusters. Without this, an Environment from one cluster can match a
// Rollout of the same name/namespace on another cluster.
export const SOURCE_DASHBOARD_ANNOTATION = 'rollout-dashboard.kuberik.com/source-dashboard';

export function sourceDashboardURL(
	obj: { metadata?: { annotations?: Record<string, string> | null } } | null | undefined
): string {
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
		sourceDashboardURL(rollout) === sourceDashboardURL(env) &&
		rollout.metadata?.namespace === env.metadata?.namespace &&
		env.spec?.rolloutRef?.name === rollout.metadata?.name
	);
}

// Append ?dashboard=<sourceURL> so a link opens the resource on the cluster it
// actually lives on. No-op when the resource is local to this dashboard (empty
// sourceURL, or the same URL as the cluster currently being viewed).
export function withDashboardParam(path: string, sourceURL: string, localClusterURL: string): string {
	if (sourceURL && sourceURL !== localClusterURL) {
		const sep = path.includes('?') ? '&' : '?';
		return `${path}${sep}dashboard=${encodeURIComponent(sourceURL)}`;
	}
	return path;
}
