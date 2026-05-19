// Pipeline-stage derivation shared between the rollouts list (compact
// glyph) and any future component that needs a structured view of a
// kuberik Rollout's deployment pipeline. Mirrors the logic in
// `DeploymentPipelineCard.svelte` so both surfaces stay in sync — keep
// changes here and there together.

import { categorizeFailure } from '$lib/utils';
import type { Rollout, Kustomization, KruiseRollout } from '../types';

export type StageState = 'done' | 'active' | 'fail' | 'cancelled' | 'pending';

export type PipelineTrack = {
	name: string;
	stages: StageState[];
};

export type PipelineSummary = {
	// One track per KruiseRollout. Multiple tracks run in parallel; render
	// them as stacked rows in the glyph so the eye doesn't read step 4 of
	// track B as following step 3 of track A.
	tracks: PipelineTrack[];
	// The trailing kuberik-level bake cell. Only flips out of `pending`
	// once every track is completed — matches the controller's behaviour.
	bake: StageState;
	// True when no KruiseRollouts could be linked yet. UI may fall back to
	// a synthesised glyph that still encodes the bake status.
	isSynthetic: boolean;
};

const SUBSTITUTE_FROM_RE = /^rollout\.kuberik\.com\/substitute\.[^/]+\.from$/;

// Find every KruiseRollout that belongs to a given kuberik Rollout. Walks
// the Kustomizations in the same namespace, picks those whose
// `rollout.kuberik.com/substitute.*.from` annotations name this rollout,
// and reads their inventory entries for `rollouts.kruise.io/_/Rollout` IDs.
export function kruiseRolloutsForRollout(
	rollout: Rollout,
	kustomizations: Kustomization[],
	kruiseRollouts: KruiseRollout[]
): KruiseRollout[] {
	const ns = rollout.metadata?.namespace;
	const name = rollout.metadata?.name;
	if (!ns || !name) return [];

	const ids = new Set<string>();
	for (const k of kustomizations) {
		if (k.metadata?.namespace !== ns) continue;
		const annotations = k.metadata?.annotations || {};
		const linked = Object.entries(annotations).some(
			([key, value]) => SUBSTITUTE_FROM_RE.test(key) && value === name
		);
		if (!linked) continue;
		const entries = (k as any).status?.inventory?.entries ?? [];
		for (const e of entries) {
			if (typeof e?.id !== 'string') continue;
			if (e.id.endsWith('_rollouts.kruise.io_Rollout')) ids.add(e.id);
		}
	}
	if (ids.size === 0) return [];

	const out: KruiseRollout[] = [];
	for (const kr of kruiseRollouts) {
		const krNs = kr.metadata?.namespace;
		const krName = kr.metadata?.name;
		if (!krNs || !krName) continue;
		if (ids.has(`${krNs}_${krName}_rollouts.kruise.io_Rollout`)) out.push(kr);
	}
	return out;
}

// Derive the per-step state of a single KruiseRollout — same conditions
// DeploymentPipelineCard.svelte uses.
function trackStagesForKR(kr: KruiseRollout): StageState[] {
	const steps = (kr.spec as any)?.strategy?.canary?.steps ?? [];
	const currentStepIndex = (kr.status as any)?.canaryStatus?.currentStepIndex;
	const currentStepState = (kr.status as any)?.canaryStatus?.currentStepState;
	const conditions: any[] = (kr.status as any)?.conditions ?? [];
	const isStalled = conditions.some((c) => c.type === 'Stalled' && c.status === 'True');
	const isBakeFailed = conditions.some(
		(c) => c.type === 'KuberikBakeHealthy' && c.status === 'False'
	);
	const isCompleted = currentStepState === 'Completed';

	const out: StageState[] = [];
	for (let i = 0; i < steps.length; i++) {
		const stepNum = i + 1;
		const isCurrent = currentStepIndex === stepNum;
		const isPast =
			isCompleted || (currentStepIndex !== undefined && stepNum < currentStepIndex);
		if (isPast) out.push('done');
		else if (isCurrent && (isStalled || isBakeFailed)) out.push('fail');
		else if (isCurrent) out.push('active');
		else out.push('pending');
	}
	return out;
}

// Has this single KruiseRollout finished all of its canary steps?
function isKrCompleted(kr: KruiseRollout): boolean {
	const currentStepState = (kr.status as any)?.canaryStatus?.currentStepState;
	return currentStepState === 'Completed';
}

// Build the structured pipeline summary for a kuberik Rollout, given the
// KruiseRollouts that drive it. The bake cell only goes "active"/"done"/
// "fail" once every track is completed — same gating as the detail page.
export function derivePipeline(rollout: Rollout, krs: KruiseRollout[]): PipelineSummary {
	if (krs.length === 0) {
		return {
			tracks: [{ name: '', stages: syntheticGlyph(rollout, 5) }],
			bake: 'pending',
			isSynthetic: true
		};
	}

	const allStagesDone = krs.every(isKrCompleted);
	const bakeStatus = rollout.status?.history?.[0]?.bakeStatus || 'None';

	let bake: StageState = 'pending';
	if (allStagesDone) {
		if (bakeStatus === 'Succeeded') bake = 'done';
		else if (bakeStatus === 'Failed') bake = 'fail';
		else if (bakeStatus === 'InProgress') bake = 'active';
		else if (bakeStatus === 'Deploying') bake = 'active';
		else if (bakeStatus === 'Cancelled') bake = 'cancelled';
	}

	const tracks: PipelineTrack[] = krs.map((kr) => ({
		name: kr.metadata?.name ?? '',
		stages: trackStagesForKR(kr)
	}));

	return { tracks, bake, isSynthetic: false };
}

// Synthesised glyph for rollouts without linked KruiseRollouts (pipeline
// data hasn't propagated yet). Encodes the bake status alone in N cells.
function syntheticGlyph(rollout: Rollout, count: number): StageState[] {
	const latest = rollout.status?.history?.[0];
	const status = latest?.bakeStatus || 'None';
	if (status === 'Succeeded') return Array<StageState>(count).fill('done');
	if (status === 'InProgress') {
		const out: StageState[] = [];
		for (let i = 0; i < count - 1; i++) out.push('done');
		out.push('active');
		return out;
	}
	if (status === 'Deploying') {
		const out: StageState[] = ['active'];
		for (let i = 1; i < count; i++) out.push('pending');
		return out;
	}
	if (status === 'Cancelled') {
		const out: StageState[] = ['done', 'cancelled'];
		while (out.length < count) out.push('pending');
		return out.slice(0, count);
	}
	if (status === 'Failed') {
		const cat = categorizeFailure(latest?.bakeStatusMessage);
		const failPos = (() => {
			switch (cat) {
				case 'test': return 0;
				case 'image': return 1;
				case 'gate': return Math.min(2, count - 1);
				case 'healthcheck': return count - 1;
				case 'timeout': return count - 1;
				default: return Math.floor(count / 2);
			}
		})();
		const out: StageState[] = [];
		for (let i = 0; i < count; i++) {
			if (i < failPos) out.push('done');
			else if (i === failPos) out.push('fail');
			else out.push('pending');
		}
		return out;
	}
	return Array<StageState>(count).fill('pending');
}
