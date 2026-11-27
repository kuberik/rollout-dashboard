import type { DependencyBreak } from '../../types';
import { apiPath } from './urls';

/**
 * WHAT A ROLLBACK TO `tag` WOULD BREAK: GET /api/rollouts/:ns/:name/rollback-check?tag=, `{ tag, breaks }`.
 * It FAILS QUIET: an older backend (404), a missing build, a network error all resolve to "nothing to warn about",
 * because the check is advice and the Roll back dialog must never be blocked, or look broken, because of it.
 */
export function rollbackCheckQueryOptions(namespace: string, name: string, cluster: string | undefined, tag: string) {
	return {
		queryKey: ['rollback-check', namespace, name, cluster ?? '', tag] as const,
		queryFn: async (): Promise<{ tag: string; breaks: DependencyBreak[]; hiddenConsumers: number }> => {
			try {
				const res = await fetch(apiPath(cluster ?? null, `/rollouts/${namespace}/${name}/rollback-check?tag=${encodeURIComponent(tag)}`));
				if (!res.ok) return { tag, breaks: [], hiddenConsumers: 0 };
				const body = (await res.json()) as { breaks?: DependencyBreak[] | null; hiddenConsumers?: number };
				return { tag, breaks: body.breaks ?? [], hiddenConsumers: body.hiddenConsumers ?? 0 };
			} catch {
				return { tag, breaks: [], hiddenConsumers: 0 };
			}
		},
		retry: false as const,
		staleTime: 30_000,
		refetchInterval: false as const
	};
}
