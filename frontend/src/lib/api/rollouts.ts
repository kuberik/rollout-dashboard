import type { QueryKey, QueryObserverOptions } from '@tanstack/svelte-query';
import { apiJson } from './errors';
import type {
    Rollout,
    Kustomization,
    OCIRepository,
    RolloutGate,
    Environment,
    RolloutTest,
    KruiseRollout,
    RolloutDependency
} from '../../types';

export type RolloutResponse = {
    rollout: Rollout | null;
    kustomizations?: { items: Kustomization[] };
    ociRepositories?: { items: OCIRepository[] };
    rolloutGates?: { items: RolloutGate[] };
    environment?: Environment;
    kruiseRollout?: KruiseRollout | null;
    rolloutTests?: { items: RolloutTest[] };
};

export type ClusterInfo = {
    url: string;
    name: string;
};

export type ClusterError = {
    url: string;
    name: string;
    error: string;
};

export type RolloutsListResponse = {
    rollouts: { items: Rollout[] };
    environments?: { items: Environment[] };
    kustomizations?: { items: Kustomization[] };
    // Lightweight KruiseRollout list across queried namespaces. Frontend
    // correlates each kuberik Rollout to its KruiseRollouts via the linked
    // Kustomization's inventory entries (group: rollouts.kruise.io).
    kruiseRollouts?: { items: KruiseRollout[] };
    // RolloutDependency objects across the queried namespaces and clusters. Each
    // item carries the same source-cluster annotation as `rollouts`; a consumer,
    // its provider and the dependency always share one namespace on one cluster.
    // Null/absent when the source cluster has no RolloutDependency CRD installed —
    // that is not an error and is not reported in clusterErrors.
    rolloutDependencies?: { items: RolloutDependency[] } | null;
    // Multi-cluster: discovered spoke clusters (absent when single-cluster).
    clusters?: ClusterInfo[];
    // Multi-cluster: spokes that could not be reached.
    clusterErrors?: ClusterError[];
};

type QueryOverrides<TData> = Omit<
    QueryObserverOptions<TData, Error, TData, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

export const rolloutQueryKey = (namespace: string, name: string, cluster?: string) =>
    ['rollout', namespace, name, cluster] as const;

export const rolloutsListQueryKey = ['rollouts', 'all'] as const;

/**
 * ⛔ A 404 IS NO LONGER SWALLOWED INTO `{ rollout: null }`.
 *
 * It used to be, and the result was a page that could not tell "this rollout
 * has no history yet" from "this rollout does not exist". It also never fired
 * on the live cluster, because the backend answers **500** for a missing
 * rollout (verified: `500` + `details: '... "does-not-exist" not found'`), so
 * the branch that existed to handle absence was dead code while the real case
 * fell through to `throw new Error('Failed to load rollout')` — a string that
 * threw the server's sentence away and left the query retrying forever.
 *
 * Both now become an `ApiError` carrying `status` and the server's `details`,
 * and `ApiError.isMissing` is the single place that knows both shapes.
 */
export async function fetchRollout(
    namespace: string,
    name: string,
    cluster?: string
): Promise<RolloutResponse> {
    const params = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return apiJson<RolloutResponse>(`/api/rollouts/${namespace}/${name}${params}`);
}

export async function fetchRolloutsList(): Promise<RolloutsListResponse> {
    return apiJson<RolloutsListResponse>('/api/rollouts');
}

export async function fetchRolloutsInNamespace(namespace: string): Promise<RolloutsListResponse> {
    return apiJson<RolloutsListResponse>(`/api/rollouts?namespace=${encodeURIComponent(namespace)}`);
}

export const rolloutsInNamespaceQueryKey = (namespace: string) =>
    ['rollouts', 'namespace', namespace] as const;

export function rolloutsInNamespaceQueryOptions({
    namespace,
    options
}: {
    namespace: string;
    options?: QueryOverrides<RolloutsListResponse>;
}) {
    return {
        queryKey: rolloutsInNamespaceQueryKey(namespace),
        queryFn: () => fetchRolloutsInNamespace(namespace),
        ...options
    };
}

export function rolloutQueryOptions({
    namespace,
    name,
    cluster,
    options
}: {
    namespace: string;
    name: string;
    cluster?: string;
    options?: QueryOverrides<RolloutResponse>;
}) {
    return {
        queryKey: rolloutQueryKey(namespace, name, cluster),
        queryFn: () => fetchRollout(namespace, name, cluster),
        ...options
    };
}

export function rolloutsListQueryOptions({
    options
}: {
    options?: QueryOverrides<RolloutsListResponse>;
} = {}) {
    return {
        queryKey: rolloutsListQueryKey,
        queryFn: () => fetchRolloutsList(),
        ...options
    };
}

export async function fetchClusterInfo(): Promise<ClusterInfo> {
    return apiJson<ClusterInfo>('/api/cluster');
}

export const clusterInfoQueryKey = ['cluster-info'] as const;

export function clusterInfoQueryOptions(options?: QueryOverrides<ClusterInfo>) {
    return {
        queryKey: clusterInfoQueryKey,
        queryFn: fetchClusterInfo,
        staleTime: 60000,
        ...options
    };
}

export type PermissionsResponse = {
    permissions: {
        update: boolean;
        patch: boolean;
    };
    resource: {
        apiGroup: string;
        kind: string;
        name: string;
        namespace: string;
    };
};

export async function fetchRolloutPermissions(
    namespace: string,
    name: string,
    cluster?: string
): Promise<PermissionsResponse> {
    const params = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return apiJson<PermissionsResponse>(
        `/api/rollouts/${namespace}/${name}/permissions/all${params}`
    );
}

export const rolloutPermissionsQueryKey = (namespace: string, name: string, cluster?: string) =>
    ['rollout-permissions', namespace, name, cluster] as const;

export function rolloutPermissionsQueryOptions({
    namespace,
    name,
    cluster,
    options
}: {
    namespace: string;
    name: string;
    cluster?: string;
    options?: QueryOverrides<PermissionsResponse>;
}) {
    return {
        queryKey: rolloutPermissionsQueryKey(namespace, name, cluster),
        queryFn: () => fetchRolloutPermissions(namespace, name, cluster),
        ...options
    };
}

export type RolloutTestsResponse = {
    rolloutTests: { items: RolloutTest[] };
    kruiseRollout?: KruiseRollout | null;
};

export async function fetchRolloutTests(
    namespace: string,
    name: string,
    cluster?: string
): Promise<RolloutTestsResponse> {
    const params = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return apiJson<RolloutTestsResponse>(`/api/rollouts/${namespace}/${name}/rollout-tests${params}`);
}

// `cluster` rides the key (matching `rolloutQueryKey`'s own shape) so a
// RolloutTest event's `applyChangeEvents` predicate — namespace AND cluster —
// can't invalidate the wrong cluster's same-named entry, and so a rollout
// detail visit on one cluster doesn't serve another cluster's cached tests.
export const rolloutTestsQueryKey = (namespace: string, name: string, cluster?: string) =>
    ['rollout-tests', namespace, name, cluster] as const;

export function rolloutTestsQueryOptions({
    namespace,
    name,
    cluster,
    options
}: {
    namespace: string;
    name: string;
    cluster?: string;
    options?: QueryOverrides<RolloutTestsResponse>;
}) {
    return {
        queryKey: rolloutTestsQueryKey(namespace, name, cluster),
        queryFn: () => fetchRolloutTests(namespace, name, cluster),
        ...options
    };
}
