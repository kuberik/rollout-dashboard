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
import {
	mergeSlices,
	rolloutCatalogueKey,
	rolloutReleases,
	sliceCatalogueKey,
	type ReleaseSliceObject,
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
 * Replace the catalogues a full list response covers. Every source that
 * appears in `slices` (or is named in `knownSources`, keys from
 * `catalogueKey`) is replaced wholesale, so a slice deleted by retention
 * disappears. Sources absent from both are left untouched.
 */
export function ingestReleaseSlices(
	slices: readonly ReleaseSliceObject[],
	knownSources: readonly string[] = [],
	opts: { dropUnnamed?: boolean } = {}
): void {
	const next = new Map<string, Map<string, ReleaseSliceObject>>();
	for (const k of knownSources) next.set(k, new Map());
	for (const s of slices) {
		const k = sliceCatalogueKey(s);
		let m = next.get(k);
		if (!m) next.set(k, (m = new Map()));
		m.set(s.metadata.name, s);
	}
	if (opts.dropUnnamed) for (const k of [...catalogues.keys()]) if (!next.has(k)) catalogues.delete(k);
	for (const [k, m] of next) {
		const prev = catalogues.get(k);
		if (prev && sameSlices(prev, m)) continue;
		catalogues.set(k, m);
	}
}

/** One slice added or updated (an SSE event carrying the object). */
export function upsertReleaseSlice(slice: ReleaseSliceObject): void {
	const k = sliceCatalogueKey(slice);
	const m = new Map(catalogues.get(k) ?? []);
	m.set(slice.metadata.name, slice);
	catalogues.set(k, m);
}

/** One slice deleted. `key` from `catalogueKey(cluster, namespace, source)`; unknown source → scan. */
export function removeReleaseSlice(cluster: string, namespace: string, name: string): void {
	for (const [k, m] of catalogues) {
		const s = m.get(name);
		if (!s || (s.metadata.namespace ?? '') !== namespace) continue;
		if (!k.startsWith(`${cluster}\u0000`)) continue;
		const next = new Map(m);
		next.delete(name);
		catalogues.set(k, next);
	}
}

/** Tests only. */
export function resetReleaseCatalogue(): void {
	catalogues.clear();
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
