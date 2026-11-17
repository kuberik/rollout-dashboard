import type { ManagedResourceStatus, KruiseRollout, RolloutTest } from '../../types';

/**
 * What a Retry pressed OUTSIDE the Overview needs to know about the rollout's managed resources, read the way the Overview reads them:
 * the first stalled Kruise Rollout (a retry resumes it, so its name rides along) and whether a Kruise step has a failed test (that
 * retry asks its own, better question, retry or skip the tests, which only the Overview draws).
 */
const KRUISE = 'rollouts.kruise.io/v1beta1/Rollout';
const TEST = 'rollout.kuberik.com/v1alpha1/RolloutTest';

export function stalledKruiseName(managed: Record<string, ManagedResourceStatus[]>): string | undefined {
	for (const resources of Object.values(managed)) {
		for (const r of resources) {
			if (r.groupVersionKind !== KRUISE) continue;
			const kr = r.object as KruiseRollout;
			if (kr?.status?.conditions?.some((c) => c.type === 'Stalled' && c.status === 'True')) return kr.metadata?.name;
		}
	}
	return undefined;
}

export function hasFailedStepTests(managed: Record<string, ManagedResourceStatus[]>): boolean {
	const all = Object.values(managed).flat();
	const krNames = new Set(all.filter((r) => r.groupVersionKind === KRUISE).map((r) => (r.object as KruiseRollout)?.metadata?.name));
	return all
		.filter((r) => r.groupVersionKind === TEST)
		.map((r) => r.object as RolloutTest)
		.some((t) => t.status?.phase === 'Failed' && !!t.spec?.rolloutName && krNames.has(t.spec.rolloutName));
}
