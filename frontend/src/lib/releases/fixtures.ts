/** Test helpers for the release catalogue (not imported by app code). */
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import type { ReleaseSliceObject, SliceRelease, ReleaseSourceObject } from './catalogue';
import type { Rollout } from '../../types';

export const rel = (tag: string, sequence: number, extra: Partial<SliceRelease> = {}): SliceRelease => ({
	tag,
	sequence,
	created: `2026-01-0${(sequence % 9) + 1}T00:00:00Z`,
	...extra
});

export const slice = (
	name: string,
	source: string,
	releases: SliceRelease[],
	o: { ns?: string; cluster?: string; sealed?: boolean; rv?: string } = {}
): ReleaseSliceObject => ({
	metadata: {
		name,
		namespace: o.ns ?? 'ns',
		labels: { 'kuberik.com/release-source': source },
		annotations: o.cluster === undefined ? null : { [SOURCE_CLUSTER_ANNOTATION]: o.cluster },
		resourceVersion: o.rv
	},
	source,
	sealed: o.sealed,
	releases
});

export const source = (name: string, o: { ns?: string; cluster?: string } = {}): ReleaseSourceObject => ({
	metadata: {
		name,
		namespace: o.ns ?? 'ns',
		annotations: o.cluster === undefined ? null : { [SOURCE_CLUSTER_ANNOTATION]: o.cluster }
	}
});

export const rollout = (
	o: {
		ns?: string;
		cluster?: string;
		ref?: string;
		status?: Record<string, unknown>;
	} = {}
): Rollout =>
	({
		metadata: {
			name: 'app',
			namespace: o.ns ?? 'ns',
			annotations: o.cluster === undefined ? undefined : { [SOURCE_CLUSTER_ANNOTATION]: o.cluster }
		},
		spec: o.ref ? { releaseSourceRef: { name: o.ref } } : {},
		status: o.status ?? {}
	}) as unknown as Rollout;
