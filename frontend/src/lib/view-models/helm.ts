/**
 * HelmRelease view-model: what a HelmRelease group in the Resources card says about itself, and the small rules that keep a
 * HelmRelease from being drawn twice. Components render this; the rules live here so they can be tested.
 */
import type { HelmRelease, ManagedResourceStatus } from '../../types';

/** the Ready word of a HelmRelease: the same three-state reading the `helmrelease` health check class gives */
export type HelmWord = 'Ready' | 'Pending' | 'Failed';

export type HelmView = {
	name: string;
	namespace: string;
	/** chart name; falls back to the chartRef's name when the release came from an OCIRepository */
	chart: string;
	chartVersion: string;
	appVersion: string;
	/** helm's release revision (status.history[0].version), null before the first install */
	revision: number | null;
	word: HelmWord;
	/** helm-controller's own sentence for a not-Ready release; '' when Ready */
	message: string;
};

/** Ready=False reasons that mean "still working", not "gave up": the helm-controller's retryable states. Everything else is a failure. */
const PENDING_REASONS = new Set(['Progressing', 'ProgressingWithRetry', 'DependencyNotReady', 'ArtifactFailed', 'HealthCheckCanceled', 'ReconciliationInProgress']);

type Cond = { type?: string; status?: string; reason?: string; message?: string; observedGeneration?: number };

export function helmWordOf(hr: HelmRelease): { word: HelmWord; message: string } {
	const conds = (hr.status?.conditions ?? []) as Cond[];
	const ready = conds.find((c) => c.type === 'Ready');
	if (!ready) return { word: 'Pending', message: '' };
	const generation = hr.metadata?.generation;
	const observed = ready.observedGeneration ?? hr.status?.observedGeneration;
	// a Ready written for an older generation says nothing about the release kuberik just wrote
	if (generation !== undefined && observed !== undefined && observed < generation) {
		return { word: 'Pending', message: `generation ${generation} not yet observed` };
	}
	const stalled = conds.find((c) => c.type === 'Stalled' && c.status === 'True');
	if (stalled) return { word: 'Failed', message: stalled.message ?? ready.message ?? '' };
	if (ready.status === 'True') return { word: 'Ready', message: '' };
	if (ready.status === 'False' && !PENDING_REASONS.has(ready.reason ?? '')) return { word: 'Failed', message: ready.message ?? '' };
	return { word: 'Pending', message: ready.message ?? '' };
}

export function helmView(hr: HelmRelease): HelmView {
	const h0 = (hr.status?.history?.[0] ?? {}) as { chartName?: string; chartVersion?: string; appVersion?: string; version?: number };
	const chartSpec = (hr.spec?.chart?.spec ?? {}) as { chart?: string; version?: string };
	const { word, message } = helmWordOf(hr);
	return {
		name: hr.metadata?.name ?? '',
		namespace: hr.metadata?.namespace ?? '',
		chart: h0.chartName || chartSpec.chart || hr.spec?.chartRef?.name || '',
		chartVersion: h0.chartVersion || hr.status?.lastAttemptedRevision || chartSpec.version || '',
		appVersion: h0.appVersion ?? '',
		revision: typeof h0.version === 'number' ? h0.version : null,
		word,
		message
	};
}

/** the managed-resources record keeps each HelmRelease's resources beside the Kustomizations' under this key, so every reader of the record (pipeline, Retry, datadog) sees them */
export const helmKey = (namespace: string, name: string) => `helmrelease/${namespace}/${name}`;
export const isHelmKey = (key: string) => key.startsWith('helmrelease/');

/**
 * A Kustomization that lists a HelmRelease in its inventory gets the HelmRelease and the resources it manages back, in place
 * (backend: expandHelmReleases). The HelmRelease has its own group, fetched from its own endpoint, so those entries are dropped
 * from the Kustomization's list: one object, one drawing.
 */
export function withoutExpandedHelm(resources: ManagedResourceStatus[]): ManagedResourceStatus[] {
	return resources.filter((r) => !r.helmRelease && !(r.groupVersionKind?.startsWith('helm.toolkit.fluxcd.io/') && r.groupVersionKind.endsWith('/HelmRelease')));
}

/**
 * HelmReleases have no event stream (the hub keeps no informer for them), so a page that shows one polls at this ceiling instead
 * of the 300s a streamed page uses: a release going Pending → Ready is the thing the page is for.
 */
export const HELM_POLL_CEILING_MS = 15_000;
export const hasHelm = (data: { helmReleases?: { items?: unknown[] } } | undefined): boolean => (data?.helmReleases?.items?.length ?? 0) > 0;

/** what the per-HelmRelease managed-resources fetch said besides the list: the backend's `hint`, or why the fetch failed */
export type HelmNote = { hint?: string; error?: string };

/** the one quiet line for a group with nothing to list: the error, else the backend's hint, else "not reporting yet" */
export function helmEmptyLine(note?: HelmNote): string {
	return note?.error || note?.hint || 'Not reporting resources yet.';
}
