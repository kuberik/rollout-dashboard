/**
 * The traffic weight of a canary stage, for the pipeline card's stage rows and the stage pane's split meter.
 *
 * Role: the Continue help text already says "Moves this rollout to 40% of traffic" (`stage-advance.ts`,
 * `trafficOf`); this reads the SAME field, `spec.strategy.canary.steps[i].traffic`, so an operator sees the
 * share on the stage itself, not only in the sentence about the next one. No new data.
 *
 * Only a `traffic` percentage is a weight. A `replicas` count or percentage (`3`, `'100%'`) is how many pods,
 * not how much traffic, so a step that declares only replicas has no weight and keeps today's label ("Stage 2").
 *
 * Pure so the row suffix, the pane heading and the meter cannot disagree.
 */
import type { CanaryStep } from './stage-advance';

export type StageWeight = {
	/** 0-100, clamped. Drives the meter's fill. */
	pct: number;
	/** `10%` — the suffix on the stage row (`Stage 1 · 10%`). */
	label: string;
};

export function stageWeight(step: CanaryStep | undefined | null): StageWeight | null {
	const raw = step?.traffic;
	if (typeof raw !== 'string') return null;
	const m = raw.trim().match(/^(\d+(?:\.\d+)?)%$/);
	if (!m) return null;
	const n = parseFloat(m[1]);
	if (!Number.isFinite(n)) return null;
	const pct = Math.min(100, Math.max(0, n));
	return { pct, label: `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%` };
}

export type StageSplitState = 'past' | 'current' | 'pending';

/**
 * The sentence under the meter. `build` is the display version of the build being rolled out. It is always
 * one line of fixed shape per state, and the meter is present for every stage with a weight, so selecting a
 * different stage changes words, not layout.
 */
export function stageSplitText(w: StageWeight, state: StageSplitState, build: string | null): string {
	const on = build ? ` on ${build}` : ' on the new version';
	if (state === 'current') return `${w.label} of traffic${on}`;
	if (state === 'past') return `Ran at ${w.label} of traffic${on}`;
	return `Will move to ${w.label} of traffic${on}`;
}
