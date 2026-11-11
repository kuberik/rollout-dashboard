/**
 * MOCK MODE, SLICES SHAPE (D4). Serves some mock Rollouts the way
 * rollout-controller does in slices mode: `spec.releaseSourceRef` +
 * `status.releaseSource` + `status.candidates`, with the old
 * `availableReleases` / `releaseCandidates` / `gatedReleaseCandidates`
 * REMOVED, and the catalogue as ReleaseSource / ReleaseSlice objects in the
 * `/api/rollouts` response (`releaseSources` / `releaseSlices`).
 *
 * The conversion runs at SERVE time on whatever the stored fixture currently
 * holds, so every writer that mutates the old fields (state.ts promote /
 * recomputeReleaseCandidates, freshenCandidateAge, scenarios) keeps working
 * unchanged and the slices always agree with it. Rollouts not in
 * `SLICES_MODE_APPS`, and ones lacking all three old lists or having fewer
 * than two releases, stay on the old fields. The single-rollout detail GET is
 * NOT converted: a detail page loaded directly has no catalogue yet, so it
 * must keep the old fields (the real controller dual-writes during the transition).
 *
 * Each converted catalogue is split over two slices (the older half sealed,
 * the rest open); `sequence` = position in the old oldest-first list.
 */
// vite.config.ts loads the mock server in plain Node, so no `$app` imports here:
// the annotation key is spelled out (see source-dashboard.ts).
const SOURCE_CLUSTER_ANNOTATION = 'rollout-dashboard.kuberik.com/source-cluster';
import type { ReleaseCandidate, ReleaseSliceObject, ReleaseSourceObject, SliceRelease } from '../releases/catalogue';

/** Apps (rollout names) whose list entries are served in slices mode. */
export const SLICES_MODE_APPS: ReadonlySet<string> = new Set(['payments-core', 'edge-mesh']);

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hash = (s: string): string => {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return String(h >>> 0);
};

export const sourceNameFor = (rollout: Obj): string => `${rollout.metadata.name}-releases`;

const tagsOf = (l: unknown): string => (Array.isArray(l) && l.length ? (l as Obj[]).map((v) => v.tag).join(',') : '');
/** rollout-controller getNextReleaseCandidates over the old list, compared by tag (empty == absent). */
function controllerConsistent(st: Obj): boolean {
	const rel: Obj[] = st?.availableReleases ?? [];
	const deployed: string | undefined = st?.history?.[0]?.version?.tag;
	const i = deployed === undefined ? -1 : rel.findIndex((v) => v.tag === deployed);
	const expected = deployed === undefined ? [...rel].reverse() : i < 0 ? [] : rel.slice(i + 1).reverse();
	return tagsOf(expected) === tagsOf(st?.releaseCandidates);
}

export function canConvert(r: Obj): boolean {
	const st = r?.status;
	return (
		SLICES_MODE_APPS.has(r?.metadata?.name) &&
		Array.isArray(st?.availableReleases) &&
		st.availableReleases.length >= 2 &&
		// Only fixtures a controller could have produced: the accessor derives
		// "newer than deployed" from the catalogue with the controller's own
		// getNextReleaseCandidates rule, so a hand-built candidate list that
		// disagrees with the fixture's history cannot round-trip (and is not real data).
		controllerConsistent(st)
	);
}

/** One old-shape rollout → its slices-mode twin plus its catalogue objects. */
export function convertRollout(r: Obj): { rollout: Obj; source: ReleaseSourceObject; slices: ReleaseSliceObject[] } {
	const ns: string = r.metadata.namespace;
	const sourceName = sourceNameFor(r);
	const available: Obj[] = r.status.availableReleases;
	const hasCandidates = Array.isArray(r.status.releaseCandidates);
	const gatedTags = new Set(((r.status.gatedReleaseCandidates ?? []) as Obj[]).map((g) => g.tag));
	// Release objects keep their key order (the accessor preserves it), `sequence` goes last.
	const releases = available.map((v, i) => ({ ...v, sequence: i + 1 }) as SliceRelease);
	const cut = Math.ceil(releases.length / 2);
	// Catalogue objects carry the rollout's cluster stamp (respond.ts stamps the
	// rest by namespace, like every other list item).
	const cluster = r.metadata.annotations?.[SOURCE_CLUSTER_ANNOTATION];
	const annotations = cluster ? { [SOURCE_CLUSTER_ANNOTATION]: cluster } : undefined;
	const mk = (suffix: string, rels: SliceRelease[], sealed: boolean): ReleaseSliceObject => ({
		metadata: {
			name: `${sourceName}-${suffix}`,
			namespace: ns,
			labels: { 'kuberik.com/release-source': sourceName },
			...(annotations ? { annotations } : {}),
			resourceVersion: hash(JSON.stringify(rels))
		},
		source: sourceName,
		sealed,
		releases: rels
	});
	const slices = [mk('0001', releases.slice(0, cut), true), mk('0002', releases.slice(cut), false)];
	const newest = available[available.length - 1];
	const source: ReleaseSourceObject = {
		metadata: { name: sourceName, namespace: ns, ...(annotations ? { annotations } : {}) },
		status: { count: available.length, newest: { tag: newest.tag, created: newest.created, revision: newest.revision } }
	};
	const candidates: ReleaseCandidate[] = ((r.status.releaseCandidates ?? []) as Obj[]).map((c) => ({
		tag: c.tag,
		...(c.created ? { created: c.created } : {}),
		gated: gatedTags.has(c.tag)
	}));
	const { availableReleases: _a, releaseCandidates: _c, gatedReleaseCandidates: _g, ...status } = r.status;
	void _a; void _c; void _g;
	return {
		rollout: {
			...r,
			spec: { ...r.spec, releaseSourceRef: { name: sourceName } },
			status: {
				...status,
				...(hasCandidates ? { releaseSource: { name: sourceName, ready: true, count: available.length, newest: newest.tag } } : {}),
				...(candidates.length ? { candidates } : {})
			}
		},
		source,
		slices
	};
}

/** Applies the conversion across a served list; returns the list plus the catalogue objects. */
export function applySlicesMode<T>(rollouts: T[]): { rollouts: T[]; sources: ReleaseSourceObject[]; slices: ReleaseSliceObject[] } {
	const sources: ReleaseSourceObject[] = [];
	const slices: ReleaseSliceObject[] = [];
	const out = rollouts.map((r) => {
		if (!canConvert(r as Obj)) return r;
		const c = convertRollout(r as Obj);
		sources.push(c.source);
		slices.push(...c.slices);
		return c.rollout as T;
	});
	return { rollouts: out, sources, slices };
}
