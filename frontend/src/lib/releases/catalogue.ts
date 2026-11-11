/**
 * THE ONE PLACE A ROLLOUT'S RELEASES COME FROM.
 *
 * The release catalogue lives in ReleaseSlices (release-controller,
 * `kuberik.com/v1alpha1`), selected by the label `kuberik.com/release-source`.
 * A Rollout names its catalogue in `spec.releaseSourceRef`; its working set
 * lives in `status.candidates` (tag + gated + blockedBy, newest first).
 * rollout-controller no longer writes `status.availableReleases`,
 * `releaseCandidates` or `gatedReleaseCandidates`, so NOTHING reads them: every
 * reader of those three lists goes through the accessors below.
 *
 * Rule, by `state`:
 * - `ready`: `spec.releaseSourceRef` is set AND the catalogue for (cluster,
 *   namespace, source) is known to the registry.
 *     availableReleases      = every slice's releases merged, sorted by
 *                              `sequence` ascending (oldest to newest);
 *     releaseCandidates      = catalogue releases newer than the deployed
 *                              tag (history[0]; all when no history;
 *                              `status.candidates` when the deployed tag has
 *                              left the catalogue), NEWEST FIRST (readers take
 *                              `[0]` as the newest candidate); `undefined`
 *                              when empty;
 *     gatedReleaseCandidates = the same, only those `status.candidates` marks
 *                              `gated: true` (`undefined` when none).
 * - `loading`: a ref is set but the catalogue has not arrived yet (a detail
 *   page loaded before the fleet list). All three lists are `undefined`; the
 *   reader shows a loading state, never old fields.
 * - `source-required`: no `spec.releaseSourceRef`. The controller reports a
 *   condition with reason `ReleaseSourceRequired` whose message tells the user
 *   to create a ReleaseSource; all three lists are `undefined` and readers
 *   show that message (`releaseSourceRequiredMessage`).
 */
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import type { Rollout } from '../../types';

type RolloutStatus = NonNullable<Rollout['status']>;
/** One release as every dashboard reader already consumes it (the old VersionInfo). */
export type VersionInfo = NonNullable<RolloutStatus['availableReleases']>[number] & {
	requires?: Record<string, string>;
	metadataUnresolved?: boolean;
};

/** release-controller `Release` (api/v1alpha1/releaseslice_types.go). */
export type SliceRelease = {
	tag: string;
	digest?: string;
	version?: string;
	revision?: string;
	sequence: number;
	created: string;
	createdObserved?: boolean;
	firstSeen?: string;
	requires?: Record<string, string>;
	metadataUnresolved?: boolean;
	url?: string;
	metadata?: Record<string, string>;
};

/** release-controller `ReleaseSlice` as the API serves it (no spec/status). */
export type ReleaseSliceObject = {
	metadata: {
		name: string;
		namespace?: string;
		labels?: Record<string, string> | null;
		annotations?: Record<string, string> | null;
		resourceVersion?: string;
		/** Bumped by the API server on every change to the slice's content; see `isNewerSlice`. */
		generation?: number;
		uid?: string;
		creationTimestamp?: string;
	};
	source: string;
	sealed?: boolean;
	releases?: SliceRelease[] | null;
};

/** release-controller `ReleaseSource` (only what the dashboard reads). */
export type ReleaseSourceObject = {
	metadata: {
		name: string;
		namespace?: string;
		annotations?: Record<string, string> | null;
		resourceVersion?: string;
	};
	spec?: Record<string, unknown>;
	status?: {
		count?: number;
		newest?: { tag: string; created?: string; revision?: string };
		conditions?: { type: string; status: string; reason?: string; message?: string }[];
		[k: string]: unknown;
	};
};

/** `status.candidates[]` on a slices-mode Rollout (rollout-controller ReleaseCandidate). */
export type ReleaseCandidate = {
	tag: string;
	created?: string;
	firstSeen?: string;
	gated: boolean;
	blockedBy?: string[];
};

export const RELEASE_SOURCE_LABEL = 'kuberik.com/release-source';

type Annotated =
	| { metadata?: { annotations?: Record<string, string> | null } | null }
	| null
	| undefined;
const clusterOf = (o: Annotated): string =>
	o?.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '';

/** Registry key for one catalogue: (cluster, namespace, source name). */
export function catalogueKey(cluster: string, namespace: string, source: string): string {
	return `${cluster}\u0000${namespace}\u0000${source}`;
}

/** The catalogue key a slice belongs to (label first, `.source` as the fallback). */
export function sliceCatalogueKey(slice: ReleaseSliceObject): string {
	const source = slice.metadata.labels?.[RELEASE_SOURCE_LABEL] ?? slice.source;
	return catalogueKey(clusterOf(slice), slice.metadata.namespace ?? '', source);
}

/** The catalogue key a Rollout reads, or null when it has no `spec.releaseSourceRef`. */
export function rolloutCatalogueKey(r: Rollout | null | undefined): string | null {
	const ref = (r?.spec as { releaseSourceRef?: { name?: string } } | undefined)?.releaseSourceRef
		?.name;
	if (!r || !ref) return null;
	return catalogueKey(clusterOf(r as Annotated), r.metadata?.namespace ?? '', ref);
}

/** One slice release in the old VersionInfo shape (field for field, §2 of the design doc). */
export function toVersionInfo(rel: SliceRelease): VersionInfo {
	// Keys follow the slice release's own key order (a JSON object round-trips
	// its order), so a converted catalogue serialises exactly like the old list.
	const v: Record<string, unknown> = {};
	for (const k of Object.keys(rel)) {
		if (!(k in COPIED)) continue;
		const val = rel[k as keyof SliceRelease];
		if (val == null) continue;
		if (k === 'metadataUnresolved' && !val) continue;
		v[k] = val;
	}
	return v as VersionInfo;
}
const COPIED: Record<string, true> = {
	tag: true,
	digest: true,
	version: true,
	revision: true,
	created: true,
	requires: true,
	metadataUnresolved: true
};

/**
 * Merge every slice of ONE source into one list, oldest → newest by
 * `sequence` (design doc §3a.2: readers sort by sequence, never by created).
 * A tag appearing twice (never expected; a crash-replayed write at worst)
 * keeps its highest-sequence entry.
 */
export function mergeSlices(slices: readonly ReleaseSliceObject[]): VersionInfo[] {
	const byTag = new Map<string, SliceRelease>();
	for (const s of slices) {
		for (const rel of s.releases ?? []) {
			const prev = byTag.get(rel.tag);
			if (!prev || rel.sequence > prev.sequence) byTag.set(rel.tag, rel);
		}
	}
	return [...byTag.values()]
		.sort((a, b) => a.sequence - b.sequence || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
		.map(toVersionInfo);
}

export type ReleasesState = 'ready' | 'loading' | 'source-required';

export type RolloutReleases = {
	availableReleases: VersionInfo[] | undefined;
	releaseCandidates: VersionInfo[] | undefined;
	gatedReleaseCandidates: VersionInfo[] | undefined;
	state: ReleasesState;
};

/** Reason rollout-controller sets on the condition of a Rollout that has no `spec.releaseSourceRef`. */
export const RELEASE_SOURCE_REQUIRED_REASON = 'ReleaseSourceRequired';

/** The controller's message for a Rollout without a ReleaseSource, or undefined when it has one / none was reported. */
export function releaseSourceRequiredMessage(r: Rollout | null | undefined): string | undefined {
	if (!r || rolloutCatalogueKey(r)) return undefined;
	const conds = (r.status?.conditions ?? []) as { reason?: string; message?: string }[];
	return conds.find((c) => c.reason === RELEASE_SOURCE_REQUIRED_REASON)?.message || undefined;
}

/**
 * "This Rollout has no releases to show", ONE rule for every surface: either it has no release source at all (the
 * controller's `ReleaseSourceRequired` condition), or its source is known and has published nothing yet (an empty
 * catalogue). Both read as "no releases": never a count, never "newest" or "up to date", never "ready to promote".
 */
export type NoReleases = {
	kind: 'no-source' | 'empty';
	/** the short state word every surface prints */
	label: 'No release source' | 'No releases yet';
	/** one sentence for the surfaces that have room for it */
	message: string;
};

/** The shared rule, over an already-resolved state. See `noReleasesOf` (registry) for the Rollout-level accessor. */
export function noReleasesFrom(
	r: Rollout | null | undefined,
	releases: RolloutReleases
): NoReleases | null {
	const msg = releaseSourceRequiredMessage(r);
	if (msg) return { kind: 'no-source', label: 'No release source', message: msg };
	if (releases.state === 'ready' && (releases.availableReleases?.length ?? 0) === 0) {
		return {
			kind: 'empty',
			label: 'No releases yet',
			message: "This Rollout's release source has not published any releases yet."
		};
	}
	return null;
}

/**
 * Pure core: a Rollout's three release lists given its merged catalogue
 * (`undefined` = catalogue not known yet).
 */
export function rolloutReleases(
	r: Rollout | null | undefined,
	catalogue: readonly VersionInfo[] | undefined
): RolloutReleases {
	const none = (state: ReleasesState): RolloutReleases => ({
		availableReleases: undefined,
		releaseCandidates: undefined,
		gatedReleaseCandidates: undefined,
		state
	});
	if (!rolloutCatalogueKey(r)) return none('source-required');
	if (catalogue === undefined) return none('loading');
	const st = (r?.status ?? undefined) as
		| (RolloutStatus & { candidates?: ReleaseCandidate[] })
		| undefined;
	const available = catalogue as VersionInfo[];
	// Newer-than-deployed comes from the CATALOGUE (status.candidates is capped
	// at K, the old list was not): the controller's getNextReleaseCandidates rule
	// — no history → everything; deployed tag catalogued → everything after it.
	// Only when the deployed tag has left the catalogue do we take the
	// controller's own (lagging-fallback) answer, status.candidates.
	// status.candidates supplies per-release gate state; a release beyond K has
	// none and is treated as not gated (the controller does not offer it).
	const cands = Array.isArray(st?.candidates) ? st.candidates : [];
	const index = new Map(available.map((v, i) => [v.tag, i] as const));
	const deployed = (st?.history as { version?: { tag?: string } }[] | undefined)?.[0]?.version?.tag;
	let newer: VersionInfo[];
	if (!deployed) newer = [...available].reverse();
	else if (index.has(deployed)) newer = available.slice(index.get(deployed)! + 1).reverse();
	else
		newer = cands.map((c) => {
			const i = index.get(c.tag);
			if (i !== undefined) return available[i];
			const v: VersionInfo = { tag: c.tag };
			if (c.created) v.created = c.created;
			return v;
		});
	const gatedTags = new Set(cands.filter((c) => c.gated).map((c) => c.tag));
	const passing = newer.filter((v) => gatedTags.has(v.tag));
	// NEWEST FIRST like the old lists; `undefined` when empty, mirroring the
	// old fields' Go `omitempty` (behind.ts branches on undefined vs []).
	const candidates: VersionInfo[] | undefined = newer.length ? newer : undefined;
	const gated: VersionInfo[] | undefined = passing.length ? passing : undefined;
	return {
		availableReleases: available,
		releaseCandidates: candidates,
		gatedReleaseCandidates: gated,
		state: 'ready'
	};
}
