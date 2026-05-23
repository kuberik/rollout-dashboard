import type { QueryKey, QueryObserverOptions } from '@tanstack/svelte-query';
import type {
    Rollout,
    Kustomization,
    OCIRepository,
    RolloutGate,
    Environment,
    RolloutTest,
    KruiseRollout
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
    // Multi-cluster: discovered spoke clusters (absent when single-cluster).
    clusters?: ClusterInfo[];
    // Multi-cluster: spokes that could not be reached.
    clusterErrors?: ClusterError[];
};

type QueryOverrides<TData> = Omit<
    QueryObserverOptions<TData, Error, TData, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

export const rolloutQueryKey = (namespace: string, name: string, dashboard?: string) =>
    ['rollout', namespace, name, dashboard] as const;

export const rolloutsListQueryKey = ['rollouts', 'all'] as const;

export async function fetchRollout(
    namespace: string,
    name: string,
    dashboard?: string
): Promise<RolloutResponse> {
    const params = dashboard ? `?dashboard=${encodeURIComponent(dashboard)}` : '';
    const res = await fetch(`/api/rollouts/${namespace}/${name}${params}`);
    if (!res.ok) {
        if (res.status === 404) {
            return { rollout: null };
        }
        throw new Error('Failed to load rollout');
    }
    return (await res.json()) as RolloutResponse;
}

export async function fetchRolloutsList(): Promise<RolloutsListResponse> {
    const res = await fetch('/api/rollouts');
    if (!res.ok) {
        throw new Error('Failed to fetch rollouts');
    }
    return (await res.json()) as RolloutsListResponse;
}

export async function fetchRolloutsInNamespace(namespace: string): Promise<RolloutsListResponse> {
    const res = await fetch(`/api/rollouts?namespace=${encodeURIComponent(namespace)}`);
    if (!res.ok) {
        throw new Error('Failed to fetch rollouts');
    }
    return (await res.json()) as RolloutsListResponse;
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
    dashboard,
    options
}: {
    namespace: string;
    name: string;
    dashboard?: string;
    options?: QueryOverrides<RolloutResponse>;
}) {
    return {
        queryKey: rolloutQueryKey(namespace, name, dashboard),
        queryFn: () => fetchRollout(namespace, name, dashboard),
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
    const res = await fetch('/api/cluster');
    if (!res.ok) throw new Error('Failed to fetch cluster info');
    return (await res.json()) as ClusterInfo;
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
    dashboard?: string
): Promise<PermissionsResponse> {
    const params = dashboard ? `?dashboard=${encodeURIComponent(dashboard)}` : '';
    const res = await fetch(`/api/rollouts/${namespace}/${name}/permissions/all${params}`);
    if (!res.ok) {
        throw new Error('Failed to load permissions');
    }
    return (await res.json()) as PermissionsResponse;
}

export const rolloutPermissionsQueryKey = (namespace: string, name: string, dashboard?: string) =>
    ['rollout-permissions', namespace, name, dashboard] as const;

export function rolloutPermissionsQueryOptions({
    namespace,
    name,
    dashboard,
    options
}: {
    namespace: string;
    name: string;
    dashboard?: string;
    options?: QueryOverrides<PermissionsResponse>;
}) {
    return {
        queryKey: rolloutPermissionsQueryKey(namespace, name, dashboard),
        queryFn: () => fetchRolloutPermissions(namespace, name, dashboard),
        ...options
    };
}

export type RolloutTestsResponse = {
    rolloutTests: { items: RolloutTest[] };
    kruiseRollout?: KruiseRollout | null;
};

export async function fetchRolloutTests(
    namespace: string,
    name: string
): Promise<RolloutTestsResponse> {
    const res = await fetch(`/api/rollouts/${namespace}/${name}/rollout-tests`);
    if (!res.ok) {
        if (res.status === 404) {
            return { rolloutTests: { items: [] } };
        }
        throw new Error('Failed to load rollout tests');
    }
    return (await res.json()) as RolloutTestsResponse;
}

export const rolloutTestsQueryKey = (namespace: string, name: string) =>
    ['rollout-tests', namespace, name] as const;

export function rolloutTestsQueryOptions({
    namespace,
    name,
    options
}: {
    namespace: string;
    name: string;
    options?: QueryOverrides<RolloutTestsResponse>;
}) {
    return {
        queryKey: rolloutTestsQueryKey(namespace, name),
        queryFn: () => fetchRolloutTests(namespace, name),
        ...options
    };
}
