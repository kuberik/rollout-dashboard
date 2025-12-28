import type { QueryOptions, QueryKey } from '@tanstack/svelte-query';
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

export type RolloutsListResponse = {
    rollouts: { items: Rollout[] };
};

type QueryOverrides<TData> = Omit<
    QueryOptions<TData, Error, TData, QueryKey>,
    'queryKey' | 'queryFn'
>;

export const rolloutQueryKey = (namespace: string, name: string) =>
    ['rollout', namespace, name] as const;

export const rolloutsListQueryKey = ['rollouts', 'all'] as const;

export async function fetchRollout(namespace: string, name: string): Promise<RolloutResponse> {
    const res = await fetch(`/api/rollouts/${namespace}/${name}`);
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

export function rolloutQueryOptions({
    namespace,
    name,
    options
}: {
    namespace: string;
    name: string;
    options?: QueryOverrides<RolloutResponse>;
}): QueryOptions<RolloutResponse, Error> {
    return {
        queryKey: rolloutQueryKey(namespace, name),
        queryFn: () => fetchRollout(namespace, name),
        ...options
    };
}

export function rolloutsListQueryOptions({
    options
}: {
    options?: QueryOverrides<RolloutsListResponse>;
} = {}): QueryOptions<RolloutsListResponse, Error> {
    return {
        queryKey: rolloutsListQueryKey,
        queryFn: () => fetchRolloutsList(),
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
    name: string
): Promise<PermissionsResponse> {
    const res = await fetch(`/api/rollouts/${namespace}/${name}/permissions/all`);
    if (!res.ok) {
        throw new Error('Failed to load permissions');
    }
    return (await res.json()) as PermissionsResponse;
}

export const rolloutPermissionsQueryKey = (namespace: string, name: string) =>
    ['rollout-permissions', namespace, name] as const;

export function rolloutPermissionsQueryOptions({
    namespace,
    name,
    options
}: {
    namespace: string;
    name: string;
    options?: QueryOverrides<PermissionsResponse>;
}): QueryOptions<PermissionsResponse, Error> {
    return {
        queryKey: rolloutPermissionsQueryKey(namespace, name),
        queryFn: () => fetchRolloutPermissions(namespace, name),
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
}): QueryOptions<RolloutTestsResponse, Error> {
    return {
        queryKey: rolloutTestsQueryKey(namespace, name),
        queryFn: () => fetchRolloutTests(namespace, name),
        ...options
    };
}
