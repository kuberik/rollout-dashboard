import type { CreateQueryOptions, QueryKey } from '@tanstack/svelte-query';
import type {
    Rollout,
    Kustomization,
    OCIRepository,
    RolloutGate,
    Environment
} from '../../types';

export type RolloutResponse = {
    rollout: Rollout | null;
    kustomizations?: { items: Kustomization[] };
    ociRepositories?: { items: OCIRepository[] };
    rolloutGates?: { items: RolloutGate[] };
    environment?: Environment;
};

export type RolloutsListResponse = {
    rollouts: { items: Rollout[] };
};

type QueryOverrides<TData> = Omit<
    CreateQueryOptions<TData, Error, TData, QueryKey>,
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
}): CreateQueryOptions<RolloutResponse, Error> {
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
} = {}): CreateQueryOptions<RolloutsListResponse, Error> {
    return {
        queryKey: rolloutsListQueryKey,
        queryFn: () => fetchRolloutsList(),
        ...options
    };
}
