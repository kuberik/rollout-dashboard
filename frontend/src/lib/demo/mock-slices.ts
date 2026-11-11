/**
 * MOCK MODE, RELEASE CATALOGUE SHAPE. Serves every mock Rollout the way
 * rollout-controller does: `spec.releaseSourceRef` + `status.releaseSource` +
 * `status.candidates`, with `availableReleases` / `releaseCandidates` /
 * `gatedReleaseCandidates` ABSENT, and the catalogue as ReleaseSource /
 * ReleaseSlice objects in the `/api/rollouts` response (`releaseSources` /
 * `releaseSlices`). The one exception is `UNSOURCED_APPS`: those Rollouts have
 * no ref and carry the `ReleaseSourceRequired` condition, so mock mode
 * exercises the "create a ReleaseSource" state too.
 *
 * The fixtures themselves still hold the three lists as authoring input, so
 * every writer that mutates them (state.ts promote / recomputeReleaseCandidates,
 * freshenCandidateAge, scenarios) keeps working unchanged; the conversion runs
 * at SERVE time and nothing downstream ever sees the old fields. The
 * single-rollout detail GET is converted the same way (`sliceDetailRollout`):
 * the page it feeds finds the catalogue through the fleet list.
 *
 * Each converted catalogue is split over two slices (the older half sealed,
 * the rest open); `sequence` = position in the old oldest-first list.
 */
// vite.config.ts loads the mock server in plain Node, so no `$app` imports here:
// the annotation key is spelled out (see source-dashboard.ts).
const SOURCE_CLUSTER_ANNOTATION = 'rollout-dashboard.kuberik.com/source-cluster';
import type {
	ReleaseCandidate,
	ReleaseSliceObject,
	ReleaseSourceObject,
	SliceRelease
} from '../releases/catalogue';

/** Apps (rollout names) served WITHOUT a releaseSourceRef: the controller reports `ReleaseSourceRequired` for them. */
export const UNSOURCED_APPS: ReadonlySet<string> = new Set(['recommender-svc']);

export const RELEASE_SOURCE_REQUIRED_MESSAGE =
	'This Rollout has no spec.releaseSourceRef, so it has no releases. Create a ReleaseSource for its releases repository and reference it to see releases.';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hash = (s: string): string => {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return String(h >>> 0);
};

export const sourceNameFor = (rollout: Obj): string => `${rollout.metadata.name}-releases`;

export function canConvert(r: Obj): boolean {
	return !!r?.metadata?.name && !UNSOURCED_APPS.has(r.metadata.name);
}

/** One old-shape rollout → its slices-mode twin plus its catalogue objects. */
export function convertRollout(r: Obj): {
	rollout: Obj;
	source: ReleaseSourceObject;
	slices: ReleaseSliceObject[];
} {
	const ns: string = r.metadata.namespace;
	const sourceName = sourceNameFor(r);
	const available: Obj[] = r.status?.availableReleases ?? [];
	const gatedTags = new Set(((r.status?.gatedReleaseCandidates ?? []) as Obj[]).map((g) => g.tag));
	// Release objects keep their key order (the accessor preserves it), `sequence` goes last.
	// A candidate's `created` is kept fresh by the scenario writers (freshenCandidateAge); the catalogue entry must agree with it.
	const candCreated = new Map(
		((r.status?.releaseCandidates ?? []) as Obj[]).map((c) => [c.tag, c.created] as const)
	);
	const releases = available.map(
		(v, i) =>
			({
				...v,
				...(candCreated.get(v.tag) ? { created: candCreated.get(v.tag) } : {}),
				sequence: i + 1
			}) as SliceRelease
	);
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
	const slices = releases.length
		? [mk('0001', releases.slice(0, cut), true), mk('0002', releases.slice(cut), false)]
		: [mk('0001', [], false)];
	const newest: Obj | undefined = available[available.length - 1];
	const source: ReleaseSourceObject = {
		metadata: { name: sourceName, namespace: ns, ...(annotations ? { annotations } : {}) },
		spec: { oci: { image: `registry.example.com/${ns}/${r.metadata.name}` } },
		status: {
			count: available.length,
			...(newest
				? { newest: { tag: newest.tag, created: newest.created, revision: newest.revision } }
				: {})
		}
	};
	const candidates: ReleaseCandidate[] = ((r.status?.releaseCandidates ?? []) as Obj[]).map(
		(c) => ({
			tag: c.tag,
			...(c.created ? { created: c.created } : {}),
			gated: gatedTags.has(c.tag)
		})
	);
	const {
		availableReleases: _a,
		releaseCandidates: _c,
		gatedReleaseCandidates: _g,
		...status
	} = r.status ?? {};
	void _a;
	void _c;
	void _g;
	return {
		rollout: {
			...r,
			spec: { ...r.spec, releaseSourceRef: { name: sourceName } },
			status: {
				...status,
				releaseSource: {
					name: sourceName,
					ready: true,
					count: available.length,
					...(newest ? { newest: newest.tag } : {})
				},
				...(candidates.length ? { candidates } : {})
			}
		},
		source,
		slices
	};
}

/** Applies the conversion across a served list; returns the list plus the catalogue objects. */
export function applySlicesMode<T>(rollouts: T[]): {
	rollouts: T[];
	sources: ReleaseSourceObject[];
	slices: ReleaseSliceObject[];
} {
	const sources: ReleaseSourceObject[] = [];
	const slices: ReleaseSliceObject[] = [];
	const out = rollouts.map((r) => {
		if (!canConvert(r as Obj)) return stripUnsourced(r as Obj) as T;
		const c = convertRollout(r as Obj);
		sources.push(c.source);
		slices.push(...c.slices);
		return c.rollout as T;
	});
	return { rollouts: out, sources, slices };
}

const OLD_FIELDS = ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'] as const;

/** A Rollout with no ReleaseSource: no releases, plus the controller's `ReleaseSourceRequired` condition. */
export function stripUnsourced(r: Obj): Obj {
	if (!r?.metadata?.name || !UNSOURCED_APPS.has(r.metadata.name)) return r;
	const status: Obj = { ...(r.status ?? {}) };
	for (const f of OLD_FIELDS) delete status[f];
	const conditions = ((status.conditions ?? []) as Obj[]).filter(
		(c) => c.reason !== 'ReleaseSourceRequired'
	);
	conditions.push({
		type: 'ReleasesUpdated',
		status: 'False',
		reason: 'ReleaseSourceRequired',
		message: RELEASE_SOURCE_REQUIRED_MESSAGE
	});
	return { ...r, status: { ...status, conditions } };
}

/** The detail GET's body with its Rollout in the served shape (no catalogue objects: the fleet list carries those). */
export function sliceDetailRollout<B>(body: B, stamp: (r: Obj) => Obj = (r) => r): B {
	const b = body as Obj;
	if (!b || typeof b !== 'object' || !b.rollout) return body;
	// Like the list, the detail response names its source cluster (the real backend stamps both the same way).
	const rollout = stamp(
		canConvert(b.rollout) ? convertRollout(b.rollout).rollout : stripUnsourced(b.rollout)
	);
	return { ...b, rollout } as B;
}
