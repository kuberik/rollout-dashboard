/**
 * Which rollout is it, when a name is not enough.
 *
 * The hub merges every cluster's rollouts into one list and stamps each with the cluster it came
 * from (`source-dashboard.ts`), so `<namespace>/<name>` alone can name two objects: the same
 * app deployed to a dev spoke and to the hub, or two clusters that both have a `shared` namespace.
 * A keyed `{#each}` over such a list throws `each_key_duplicate`, and a `find` by namespace and
 * name silently returns the other cluster's rollout.
 */
import { sourceClusterName } from './source-dashboard';

type Annotated = { metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> | null } };

/** `<cluster>/<namespace>/<name>` of a listed rollout; `localCluster` names the hub's own un-annotated objects, so it matches the cluster a `/rollouts/...` path carries for them. */
export const rolloutIdentity = (r: Annotated, localCluster = ''): string => `${sourceClusterName(r) || localCluster}/${r.metadata?.namespace ?? ''}/${r.metadata?.name ?? ''}`;

/** The same identity from a `/rollouts/<cluster>/<ns>/<name>` path, or '' when it is not one. */
export function pathIdentity(path: string): string {
	const w = rolloutPathParts(path);
	return w ? `${w.cluster}/${w.namespace}/${w.name}` : '';
}

/** The parts of a `/rollouts/<cluster>/<namespace>/<name>[/...]` path, or null when it is not one. */
export function rolloutPathParts(path: string): { cluster: string; namespace: string; name: string } | null {
	const p = path.split('?')[0].split('/').filter(Boolean);
	if (p[0] !== 'rollouts' || p.length < 4) return null;
	const d = (s: string) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	return { cluster: d(p[1]), namespace: d(p[2]), name: d(p[3]) };
}

/**
 * The rollout a `/rollouts/<cluster>/<ns>/<name>` path names: the one stamped with that cluster, else
 * an un-annotated one (the hub's own, in a list that does not stamp it), else the first by namespace
 * and name, which is all an old list could say.
 */
export function findRolloutByPath<T extends Annotated>(list: readonly T[], path: string): T | null {
	const w = rolloutPathParts(path);
	if (!w) return null;
	const same = list.filter((r) => r.metadata?.namespace === w.namespace && r.metadata?.name === w.name);
	return same.find((r) => sourceClusterName(r) === w.cluster) ?? same.find((r) => !sourceClusterName(r)) ?? same[0] ?? null;
}

/**
 * The rollouts a set of `/rollouts/...` paths name, each found by `findRolloutByPath`, in list order
 * without repeats. An un-annotated rollout (a single-cluster install, or the hub's own) matches by
 * namespace and name alone, so this never waits on knowing the local cluster's name.
 */
export function rolloutsAtPaths<T extends Annotated>(list: readonly T[], paths: readonly string[]): T[] {
	const hit = new Set<T>();
	for (const p of paths) {
		const r = findRolloutByPath(list, p);
		if (r) hit.add(r);
	}
	return list.filter((r) => hit.has(r));
}
