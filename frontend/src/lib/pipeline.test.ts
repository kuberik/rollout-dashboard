import { it, expect } from 'vitest';
import { derivePipeline, kruiseStatusIsPreviousDeploy } from './pipeline';

/* QA #5: right after Deploy the KruiseRollout still holds the previous deploy's finished canaryStatus. */
const kr = (lastUpdateTime: string, idx = 4, state = 'Completed') =>
	({ metadata: { name: 'kr', namespace: 'ns' }, spec: { strategy: { canary: { steps: [{}, {}, {}, {}] } } }, status: { canaryStatus: { currentStepIndex: idx, currentStepState: state, lastUpdateTime } } }) as any;
const rollout = (bakeStatus: string) => ({ metadata: { name: 'r', namespace: 'ns' }, status: { history: [{ bakeStatus, timestamp: '2026-11-09T14:10:00Z' }] } }) as any;

it('a KruiseRollout last updated before the new Deploying entry has finished none of its steps', () => {
	expect(kruiseStatusIsPreviousDeploy(kr('2026-11-09T14:00:00Z'), rollout('Deploying'))).toBe(true);
	const { tracks, bake } = derivePipeline(rollout('Deploying'), [kr('2026-11-09T14:00:00Z')]);
	expect(tracks[0].stages.every((s) => s === 'pending')).toBe(true);
	expect(bake).toBe('pending');
});
it('a KruiseRollout updated after the deploy started, or a settled deploy, counts normally', () => {
	expect(kruiseStatusIsPreviousDeploy(kr('2026-11-09T14:10:05Z', 1, 'StepPaused'), rollout('Deploying'))).toBe(false);
	expect(kruiseStatusIsPreviousDeploy(kr('2026-11-09T14:00:00Z'), rollout('Succeeded'))).toBe(false);
	expect(derivePipeline(rollout('Succeeded'), [kr('2026-11-09T14:00:00Z')]).tracks[0].stages.every((s) => s === 'done')).toBe(true);
});

import { freshestKruise } from './pipeline';
it('A1: of two copies of one KruiseRollout the one with the newer canaryStatus.lastUpdateTime wins', () => {
	const old = kr('2026-11-09T14:00:00Z', 1, 'StepPaused');
	const fresh = kr('2026-11-09T14:10:05Z', 2, 'StepUpgrade');
	expect(freshestKruise(old, fresh)).toBe(fresh);
	expect(freshestKruise(fresh, old)).toBe(fresh);
	expect(freshestKruise(old, undefined)).toBe(old);
});
