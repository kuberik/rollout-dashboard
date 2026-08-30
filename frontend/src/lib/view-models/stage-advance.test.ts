import { describe, it, expect } from 'vitest';
import { stageAdvance, formatShortDuration } from './stage-advance';

const steps = [
	{ traffic: '10%' },
	{ traffic: '40%' },
	{ traffic: '100%' }
];

const NOW = new Date('2026-08-30T12:00:00Z');

describe('stageAdvance — the three facts the old button never said', () => {
	it('names the stage it is going TO, not "next"', () => {
		const a = stageAdvance({ stepNum: 1, isLastStep: false, canarySteps: steps }, NOW);
		expect(a.label).toBe('Continue to stage 2 of 3');
		expect(a.toStage).toBe(2);
	});

	it('names the traffic share the next step moves to', () => {
		const a = stageAdvance({ stepNum: 1, isLastStep: false, canarySteps: steps }, NOW);
		expect(a.nextTraffic).toBe('40% of traffic');
		expect(a.consequence).toContain('40% of traffic');
	});

	/**
	 * ⚠️ THE LIVE `hello-worker` STEPS ARE `[1, 2, 3, '100%']` — three replica
	 * COUNTS and one weight. One template over both shapes shipped
	 * `Moves hello-worker to 3 replicas of traffic`, which is not a thing.
	 */
	it('says replicas when the step routes by count, and does not call them traffic', () => {
		const a = stageAdvance(
			{ stepNum: 1, isLastStep: false, canarySteps: [{}, { replicas: 3 }] },
			NOW
		);
		expect(a.nextTraffic).toBe('3 replicas');
		expect(a.consequence).toBe('Moves this rollout to 3 replicas.');
	});

	it('reads a percentage of replicas as a percentage, not as a count', () => {
		const a = stageAdvance(
			{ stepNum: 3, isLastStep: false, canarySteps: [{}, {}, {}, { replicas: '100%' }] },
			NOW
		);
		expect(a.nextTraffic).toBe('100% of replicas');
	});

	it('says "1 replica", not "1 replicas"', () => {
		const a = stageAdvance(
			{ stepNum: 1, isLastStep: false, canarySteps: [{}, { replicas: 1 }] },
			NOW
		);
		expect(a.nextTraffic).toBe('1 replica');
	});

	/**
	 * THE LIVE DEFECT. The critique advanced a prod canary 1/9 → 2/9 and
	 * skipped 13 seconds of bake without being told. `ready-at` + `bake-time`
	 * are the stepgate's own annotations, already rendered as a progress bar
	 * four rows above the button.
	 */
	it('says how much bake is left and that pressing this skips it', () => {
		const a = stageAdvance(
			{
				stepNum: 1,
				isLastStep: false,
				canarySteps: steps,
				annotations: {
					'internal.rollout.kuberik.io/step-1-ready-at': '2026-08-30T11:59:43Z',
					'rollout.kuberik.io/step-1-bake-time': '30s'
				}
			},
			NOW
		);
		expect(a.remainingBakeMs).toBe(13000);
		expect(a.consequence).toContain('13s of bake time is left');
		expect(a.consequence).toContain('will be skipped');
	});

	it('says nothing about bake when the bake has already elapsed', () => {
		const a = stageAdvance(
			{
				stepNum: 1,
				isLastStep: false,
				canarySteps: steps,
				annotations: {
					'internal.rollout.kuberik.io/step-1-ready-at': '2026-08-30T11:50:00Z',
					'rollout.kuberik.io/step-1-bake-time': '30s'
				}
			},
			NOW
		);
		expect(a.remainingBakeMs).toBe(0);
		expect(a.consequence).not.toContain('skipped');
	});

	it('says nothing about bake when the stepgate published nothing', () => {
		const a = stageAdvance({ stepNum: 1, isLastStep: false, canarySteps: steps }, NOW);
		expect(a.remainingBakeMs).toBeNull();
		expect(a.consequence).not.toContain('bake');
	});

	it('names the track only when there is more than one to confuse', () => {
		const single = stageAdvance(
			{ stepNum: 1, isLastStep: false, canarySteps: steps, trackName: 'kr-a' },
			NOW
		);
		expect(single.consequence).toContain('this rollout');
		expect(single.consequence).not.toContain('kr-a');

		const multi = stageAdvance(
			{
				stepNum: 1,
				isLastStep: false,
				canarySteps: steps,
				trackName: 'kr-a',
				multipleTracks: true
			},
			NOW
		);
		expect(multi.consequence).toContain('kr-a');
	});

	it('the last step says what it really does: all traffic, rollout complete', () => {
		const a = stageAdvance({ stepNum: 3, isLastStep: true, canarySteps: steps }, NOW);
		expect(a.label).toBe('Finish rollout — all traffic');
		expect(a.toStage).toBeNull();
		expect(a.consequence).toContain('all traffic');
		expect(a.confirmTitle).toBe('Finish this rollout?');
	});
});

describe('formatShortDuration', () => {
	it('reads in seconds under a minute — the scale a bake window actually uses', () => {
		expect(formatShortDuration(13000)).toBe('13s');
	});
	it('reads minutes and seconds', () => {
		expect(formatShortDuration(95000)).toBe('1m 35s');
	});
	it('reads hours and minutes', () => {
		expect(formatShortDuration(3 * 3600000 + 4 * 60000)).toBe('3h 4m');
	});
	it('never counts backwards', () => {
		expect(formatShortDuration(-1)).toBe('0s');
	});
});
