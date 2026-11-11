/**
 * The release-catalogue registry: every ReleaseSlice the dashboard has seen,
 * keyed by (cluster, namespace, source), and the three accessors every
 * reader of a Rollout's releases calls. See `./catalogue.ts` for the rule.
 *
 * Fed from ONE place (`installReleaseCatalogueFeed`, wired in the root layout
 * on the shared QueryClient), so readers never thread a catalogue through
 * their signatures. Reactive: a `$derived` that calls `availableReleases(r)`
 * re-runs when that Rollout's slices change.
 */
import { SvelteMap } from 'svelte/reactivity';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import {
	catalogueKey,
	mergeSlices,
	noReleasesFrom,
	type NoReleases,
	rolloutCatalogueKey,
	rolloutReleases,
	sliceCatalogueKey,
	type ReleaseSliceObject,
	type ReleaseSourceObject,
	type RolloutReleases,
	type VersionInfo
} from './catalogue';
import type { Rollout } from '../../types';

/** key → (slice name → slice). An entry with an empty inner map = a known catalogue with no slices yet. */
const catalogues = new SvelteMap<string, Map<string, ReleaseSliceObject>>();
/** key → merged list, recomputed lazily when the key's slice map is replaced. */
const merged = new WeakMap<Map<string, ReleaseSliceObject>, VersionInfo[]>();

function mergedFor(key: string): VersionInfo[] | undefined {
	const slices = catalogues.get(key);
	if (!slices) return undefined;
	let m = merged.get(slices);
	if (!m) {
		m = mergeSlices([...slices.values()]);
		merged.set(slices, m);
	}
	return m;
}

/**
 * Is `incoming` at least as new as `held`? A slice must never be replaced by
 * an older copy of itself: the hub's fan-in cache serves spoke lists up to
 * tens of seconds stale, so a refetch that follows an SSE event can carry
 * the slice as it was BEFORE the event.
 *
 * The monotonic field is `metadata.generation`. ReleaseSlice has no status
 * subresource, so the API server bumps generation on every content change
 * (a release added, backfilled, retired, or `sealed` flipped) and never lowers
 * it. `resourceVersion` is opaque and is deliberately not compared. A slice
 * deleted and recreated under the same name is a new object (different uid):
 * the later `creationTimestamp` wins. When either copy carries no generation
 * (an old API, a mock), nothing proves the incoming one older, so it wins.
 */
export function isNewerSlice(incoming: ReleaseSliceObject, held: ReleaseSliceObject): boolean {
	const a = incoming.metadata;
	const h = held.metadata;
	if (a.uid && h.uid && a.uid !== h.uid) return Date.parse(a.creationTimestamp ?? '') >= Date.parse(h.creationTimestamp ?? '') || Number.isNaN(Date.parse(h.creationTimestamp ?? ''));
	if (typeof a.generation !== 'number' || typeof h.generation !== 'number') return true;
	return a.generation >= h.generation;
}

/** Slices that arrived by SSE and no list has confirmed yet (key: catalogue key + name) → arrival ms. */
const pending = new Map<string, number>();
/**
 * How long a list that lacks an SSE-delivered slice is assumed stale rather
 * than a deletion (the hub fan-in cache window is 10s; deletions arrive as SSE
 * events of their own).
 */
const PENDING_GRACE_MS = 60_000;
const pendingKey = (k: string, name: string) => `${k}\u0001${name}`;
/** Slices deleted over SSE: a stale list (the hub's fan-in cache) must not bring them back. Key as `pendingKey`, value = deletion ms. */
const tombstones = new Map<string, number>();
const TOMBSTONE_MS = 60_000;
const isTombstoned = (key: string, now: number) => {
	const at = tombstones.get(key);
	if (at === undefined) return false;
	if (now - at < TOMBSTONE_MS) return true;
	tombstones.delete(key);
	return false;
};

/**
 * Fold a full list response into the catalogues it covers. Every source that
 * appears in `slices` (or is named in `knownSources`, keys from
 * `catalogueKey`) is replaced, so a slice deleted by retention disappears,
 * EXCEPT that a listed slice never replaces a newer one already held, and a
 * slice delivered by SSE a moment ago is kept when the list does not mention
 * it yet. Sources absent from both are left untouched.
 */
export function ingestReleaseSlices(
	slices: readonly ReleaseSliceObject[],
	knownSources: readonly string[] = [],
	opts: { dropUnnamed?: boolean; now?: number } = {}
): void {
	const now = opts.now ?? Date.now();
	const next = new Map<string, Map<string, ReleaseSliceObject>>();
	for (const k of knownSources) next.set(k, new Map());
	for (const s of slices) {
		const k = sliceCatalogueKey(s);
		if (isTombstoned(pendingKey(k, s.metadata.name), now)) continue;
		let m = next.get(k);
		if (!m) next.set(k, (m = new Map()));
		m.set(s.metadata.name, s);
	}
	if (opts.dropUnnamed) for (const k of [...catalogues.keys()]) if (!next.has(k)) catalogues.delete(k);
	for (const [k, listed] of next) {
		const prev = catalogues.get(k);
		const m = new Map(listed);
		if (prev) {
			for (const [name, held] of prev) {
				const l = listed.get(name);
				const pk = pendingKey(k, name);
				if (l) {
					if (!isNewerSlice(l, held)) m.set(name, held);
					else pending.delete(pk);
				} else if (now - (pending.get(pk) ?? -Infinity) < PENDING_GRACE_MS) m.set(name, held);
				else pending.delete(pk);
			}
		}
		if (prev && sameSlices(prev, m)) continue;
		catalogues.set(k, m);
	}
}

/** One slice added or updated (an SSE event carrying the object). Never replaces a newer copy. */
export function upsertReleaseSlice(slice: ReleaseSliceObject, now: number = Date.now()): void {
	const k = sliceCatalogueKey(slice);
	tombstones.delete(pendingKey(k, slice.metadata.name));
	const held = catalogues.get(k)?.get(slice.metadata.name);
	if (held && !isNewerSlice(slice, held)) return;
	const m = new Map(catalogues.get(k) ?? []);
	m.set(slice.metadata.name, slice);
	catalogues.set(k, m);
	pending.set(pendingKey(k, slice.metadata.name), now);
}

/** One slice deleted. `key` from `catalogueKey(cluster, namespace, source)`; unknown source → scan. */
export function removeReleaseSlice(cluster: string, namespace: string, name: string, now: number = Date.now()): void {
	for (const [k, m] of catalogues) {
		const s = m.get(name);
		if (!s || (s.metadata.namespace ?? '') !== namespace) continue;
		if (!k.startsWith(`${cluster}\u0000`)) continue;
		const next = new Map(m);
		next.delete(name);
		pending.delete(pendingKey(k, name));
		tombstones.set(pendingKey(k, name), now);
		catalogues.set(k, next);
	}
}

/** Every ReleaseSource the dashboard has seen, keyed like the catalogues (the latest list wins). */
const sources = new SvelteMap<string, ReleaseSourceObject>();

/** Fold the ReleaseSources of a list response in; a complete fleet list also drops the ones it no longer names. */
export function ingestReleaseSources(list: readonly ReleaseSourceObject[], opts: { replaceAll?: boolean } = {}): void {
	if (opts.replaceAll) sources.clear();
	for (const s of list) {
		const k = catalogueKey(
			s.metadata.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '',
			s.metadata.namespace ?? '',
			s.metadata.name
		);
		sources.set(k, s);
	}
}

/** The registry image a Rollout's ReleaseSource reads from (`spec.oci.image`), when that source is known. */
export function releaseSourceImage(r: Rollout | null | undefined): string | undefined {
	const key = rolloutCatalogueKey(r);
	const img = (key ? sources.get(key) : undefined)?.spec?.oci as { image?: string } | undefined;
	return img?.image || undefined;
}

/** Tests only. */
export function resetReleaseCatalogue(): void {
	catalogues.clear();
	pending.clear();
	tombstones.clear();
	sources.clear();
}

function sameSlices(a: Map<string, ReleaseSliceObject>, b: Map<string, ReleaseSliceObject>): boolean {
	if (a.size !== b.size) return false;
	for (const [n, s] of a) {
		const o = b.get(n);
		if (!o) return false;
		const ra = s.metadata.resourceVersion;
		const rb = o.metadata.resourceVersion;
		if (ra === undefined || ra !== rb) return false;
	}
	return true;
}

/** No releases to show for this Rollout (no source, or a source with an empty catalogue), else null. The ONE rule. */
export function noReleasesOf(r: Rollout | null | undefined): NoReleases | null {
	return noReleasesFrom(r, releasesOf(r));
}

/** All three lists at once (use when a reader needs more than one). */
export function releasesOf(r: Rollout | null | undefined): RolloutReleases {
	const key = rolloutCatalogueKey(r);
	return rolloutReleases(r, key ? mergedFor(key) : undefined);
}

/** Replaces `rollout.status.availableReleases` (oldest → newest). */
export function availableReleases(r: Rollout | null | undefined): VersionInfo[] | undefined {
	return releasesOf(r).availableReleases;
}

/** Replaces `rollout.status.releaseCandidates` (NEWEST FIRST, like the old field). */
export function releaseCandidates(r: Rollout | null | undefined): VersionInfo[] | undefined {
	return releasesOf(r).releaseCandidates;
}

/** Replaces `rollout.status.gatedReleaseCandidates` (NEWEST FIRST, like the old field). */
export function gatedReleaseCandidates(r: Rollout | null | undefined): VersionInfo[] | undefined {
	return releasesOf(r).gatedReleaseCandidates;
}
