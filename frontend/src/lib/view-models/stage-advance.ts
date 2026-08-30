/**
 * ⛔ THE CONFIRMATION GRADIENT WAS INVERTED, AND THIS WAS THE CHEAP END OF IT.
 *
 * A live UX critique pressed a filled blue `Continue to next stage`, expecting
 * a dialog, and **it fired instantly**: a production canary went 1/9 → 2/9,
 * skipping **13 seconds of remaining bake**. Meanwhile deploying a single
 * listed version, on the same page, made the reader **type the sha**.
 *
 * Three facts were missing from the label and every one of them is on the
 * object already:
 *
 * - **which track** it advances — a rollout can have several parallel
 *   `KruiseRollout`s and the button appears once per track;
 * - **what traffic share** the next step moves to — `spec.strategy.canary.
 *   steps[i].traffic`, e.g. `40%`;
 * - **that it cuts the bake short** — the stepgate publishes
 *   `internal.rollout.kuberik.io/step-N-ready-at` and
 *   `rollout.kuberik.io/step-N-bake-time`, which the pipeline card already
 *   renders as a progress bar four rows above the button and never mentioned
 *   in the button itself.
 *
 * Pure, so the label, the caption and the confirmation dialog cannot disagree
 * about what pressing it will do.
 */

export type CanaryStep = { traffic?: string | null; replicas?: string | number | null };

export type StageAdvanceInput = {
	/** 1-based index of the stage currently paused. */
	stepNum: number;
	isLastStep: boolean;
	canarySteps: CanaryStep[];
	/** The KruiseRollout's own annotations — where the stepgate writes bake state. */
	annotations?: Record<string, string>;
	/** The track's name. Only rendered when a rollout has more than one. */
	trackName?: string | null;
	/** True when the rollout has several parallel tracks. */
	multipleTracks?: boolean;
};

export type StageAdvance = {
	isLast: boolean;
	fromStage: number;
	toStage: number | null;
	totalStages: number;
	/**
	 * What the next step moves to, as a PHRASE, because the two shapes read
	 * differently in a sentence: `40% of traffic` (weight-based routing) or
	 * `3 replicas` (count-based). Verified against the live cluster, where
	 * `hello-worker`'s steps are `[1, 2, 3, '100%']` — the first three are
	 * replica counts and only the last is a weight. Gluing one template onto
	 * both produced `3 replicas of traffic`, which is not a thing.
	 * null when the step declares neither.
	 */
	nextTraffic: string | null;
	/** Milliseconds of bake still owed on the CURRENT stage. null when unknown. */
	remainingBakeMs: number | null;
	/** The button's own words. */
	label: string;
	/** The always-visible caption under the button, and the dialog's body. */
	consequence: string;
	/** The dialog's headline. */
	confirmTitle: string;
};

function parseGoish(duration: string | undefined): number {
	if (!duration) return 0;
	const m = duration.match(/^(\d+)([smhd])$/);
	if (!m) return 0;
	const v = parseInt(m[1], 10);
	return { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] as 's' | 'm' | 'h' | 'd'] * v;
}

export function formatShortDuration(ms: number): string {
	if (ms <= 0) return '0s';
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}h ${m % 60}m`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}

/**
 * ⚠️ `replicas` IS AN IntOrString AND BOTH SHAPES SHIP ON THE LIVE CLUSTER.
 * `hello-worker`'s steps are `[1, 2, 3, '100%']` — three counts and one
 * PERCENTAGE OF replicas, in the same field. One template over all three
 * produced `3 replicas of traffic` and then `100% replicas`, neither of which
 * is a thing anyone says. Three shapes, three phrases.
 */
function trafficOf(step: CanaryStep | undefined): string | null {
	if (!step) return null;
	if (step.traffic) return `${step.traffic} of traffic`;
	if (step.replicas === undefined || step.replicas === null) return null;
	const v = String(step.replicas);
	if (v.endsWith('%')) return `${v} of replicas`;
	return `${v} replica${v === '1' ? '' : 's'}`;
}

export function stageAdvance(input: StageAdvanceInput, now: Date = new Date()): StageAdvance {
	const totalStages = input.canarySteps.length;
	const fromStage = input.stepNum;
	const toStage = input.isLastStep ? null : fromStage + 1;
	// `canarySteps` is 0-based and `stepNum` is 1-based, so index `stepNum` IS
	// the next step.
	const nextTraffic = input.isLastStep ? null : trafficOf(input.canarySteps[input.stepNum]);

	const ann = input.annotations ?? {};
	const readyAt = ann[`internal.rollout.kuberik.io/step-${fromStage}-ready-at`];
	const bakeTime = ann[`rollout.kuberik.io/step-${fromStage}-bake-time`];
	let remainingBakeMs: number | null = null;
	const totalBake = parseGoish(bakeTime);
	if (readyAt && totalBake > 0) {
		const started = new Date(readyAt).getTime();
		if (!Number.isNaN(started)) {
			remainingBakeMs = Math.max(0, totalBake - (now.getTime() - started));
		}
	}

	const label = input.isLastStep
		? 'Finish rollout — all traffic'
		: `Continue to stage ${toStage} of ${totalStages}`;

	/**
	 * The track is named ONLY when there is more than one. On the common
	 * single-track rollout `hello-world-app on hello-world-app` is noise, and
	 * the critique's complaint was the opposite case: several parallel tracks,
	 * one button each, no way to tell which one you were about to move.
	 */
	const subject = input.multipleTracks && input.trackName ? input.trackName : 'this rollout';

	const sentences: string[] = [];
	if (input.isLastStep) {
		sentences.push(`Sends all traffic to the new version of ${subject} and completes it.`);
	} else if (nextTraffic) {
		sentences.push(`Moves ${subject} to ${nextTraffic}.`);
	} else {
		sentences.push(`Moves ${subject} to stage ${toStage} of ${totalStages}.`);
	}
	// ⭐ THE SENTENCE THE OLD BUTTON OWED ITS READER. The bake is not
	// decoration: it is the window in which a bad version is caught.
	if (remainingBakeMs !== null && remainingBakeMs > 0) {
		sentences.push(
			`${formatShortDuration(remainingBakeMs)} of bake time is left on stage ${fromStage} and will be skipped.`
		);
	}

	return {
		isLast: input.isLastStep,
		fromStage,
		toStage,
		totalStages,
		nextTraffic,
		remainingBakeMs,
		label,
		consequence: sentences.join(' '),
		confirmTitle: input.isLastStep
			? 'Finish this rollout?'
			: `Continue to stage ${toStage} of ${totalStages}?`
	};
}
