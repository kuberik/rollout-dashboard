/**
 * The one feed into the release-catalogue registry (D4).
 *
 * Every rollouts-list response (`['rollouts','all']`, `['rollouts',
 * 'namespace',<ns>]`) carries `releaseSources` / `releaseSlices` next to
 * `rollouts`, stamped with the same source-cluster annotation. This installs
 * ONE QueryCache subscription that ingests them into the registry whenever
 * such a query's data changes (fetch success, `setQueryData`, an SSE patch
 * via `applyChangeEvents`), and once for whatever is already cached.
 *
 * ORDERING (measured, feed.svelte.test.ts): on a fetch success TanStack
 * notifies the observer FIRST ("obs:success") and the QueryCache listener
 * immediately after ("cache:updated:success"), but both run in the SAME
 * synchronous notifyManager flush, i.e. before any microtask. Svelte renders
 * (and evaluates `$derived`) in a later microtask, so the registry is already
 * populated when a slices-mode rollout first renders: no one-frame fallback to
 * the old fields. Code reading the registry synchronously INSIDE an observer
 * callback would still see the previous catalogue; nothing does (readers are
 * `$derived`s). Data already cached at install time is ingested by the
 * initial pass; `setQueryData` / `applyChangeEvents` ingest synchronously.
 */
import type { QueryClient } from '@tanstack/svelte-query';
import { catalogueKey, type ReleaseSliceObject, type ReleaseSourceObject } from './catalogue';
import { ingestReleaseSlices } from './registry.svelte';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';

type ListLike = {
	releaseSources?: { items?: ReleaseSourceObject[] | null } | null;
	releaseSlices?: { items?: ReleaseSliceObject[] | null } | null;
	partialReads?: string[] | null;
	clusterErrors?: unknown[] | null;
};
const CATALOGUE_PARTIAL = /(^|\/)(releaseSlices|releaseSources)$/;

/**
 * Ingest one rollouts-list payload. `releaseSlices` / `releaseSources` that
 * are absent, null or `{items: null}` (the hub fan-out's re-marshalled nil)
 * mean "no catalogue on that cluster": nothing is ingested and rollouts fall
 * back to their old fields. A key named in `partialReads` failed to read this
 * time, so the registry keeps its previous catalogues rather than being wiped.
 */
export function ingestListResponse(data: unknown, opts: { fleetWide?: boolean } = {}): void {
	if (!data || typeof data !== 'object') return;
	const d = data as ListLike;
	// bare on the hub, "<cluster>/releaseSlices" for a spoke's failed read
	if ((d.partialReads ?? []).some((k) => CATALOGUE_PARTIAL.test(k))) return;
	const sources = d.releaseSources?.items;
	const slices = d.releaseSlices?.items;
	// A complete fleet-wide list (no failed spoke, no failed read) is the whole
	// truth: catalogues it no longer names (source deleted, CRDs uninstalled)
	// are dropped. Anything less only replaces what it names.
	const complete = !!opts.fleetWide && !(d.clusterErrors?.length);
	if (!Array.isArray(sources) && !Array.isArray(slices)) {
		if (complete) ingestReleaseSlices([], [], { dropUnnamed: true });
		return;
	}
	const known = (Array.isArray(sources) ? sources : []).map((s) =>
		catalogueKey(
			s.metadata.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '',
			s.metadata.namespace ?? '',
			s.metadata.name
		)
	);
	ingestReleaseSlices(Array.isArray(slices) ? slices : [], known, { dropUnnamed: complete });
}

const isRolloutsList = (key: readonly unknown[]) => key[0] === 'rollouts' && (key[1] === 'all' || key[1] === 'namespace');

export function installReleaseCatalogueFeed(queryClient: QueryClient): () => void {
	const cache = queryClient.getQueryCache();
	const feed = (q: { queryKey: readonly unknown[]; state: { data: unknown } }) =>
		ingestListResponse(q.state.data, { fleetWide: q.queryKey[1] === 'all' });
	for (const q of cache.findAll({ predicate: (q) => isRolloutsList(q.queryKey) })) feed(q);
	const unsubscribe = cache.subscribe((event) => {
		if (event.type !== 'updated' && event.type !== 'added') return;
		const q = event.query;
		if (!isRolloutsList(q.queryKey)) return;
		if (event.type === 'updated' && event.action.type !== 'success' && event.action.type !== 'setState') return;
		feed(q);
	});
	return unsubscribe;
}
