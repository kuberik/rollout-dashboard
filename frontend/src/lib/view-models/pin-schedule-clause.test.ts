import { describe, it, expect } from 'vitest';
import type { Rollout } from '../../types';
import { blockingStory, buildGateContext, withSchedules, EMPTY_GATE_CONTEXT } from './blocking-story';
import { withPinScheduleClause } from './pin-schedule-clause';

// The live fixture this finding was filed against: a pinned rollout that
// ALSO carries a schedule-owned gate — `blockingStory`'s pin branch never
// sees it because it short-circuits before the gate-classification code.
function pinnedWithSchedule(over: { candidates?: string[] } = {}): Rollout {
	return {
		metadata: { name: 'hello-world-app', namespace: 'hello-world-dev' },
		spec: { wantedVersion: 'main-1788002370-0afab6f35627254181e41053c51660f26a8ccee2' },
		status: {
			history: [{ version: { tag: '0afab6f', version: '0afab6f' } }],
			availableReleases: [
				{ tag: '0afab6f', version: '0afab6f' },
				...(over.candidates ?? ['rel-2', 'rel-3']).map((t) => ({ tag: t, version: t }))
			],
			releaseCandidates: (over.candidates ?? ['rel-2', 'rel-3']).map((t) => ({ tag: t, version: t })),
			gates: [{ name: 'schedule-gate-fk44d', passing: false, allowedVersions: null }]
		}
	} as unknown as Rollout;
}

function ctxWithSchedule() {
	const base = buildGateContext({ environments: { items: [] }, rolloutDependencies: null });
	return withSchedules(base, 'hello-world-dev', [
		{
			metadata: {
				name: 'business-hours',
				annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
			},
			spec: { action: 'Allow' },
			status: {
				active: false,
				nextTransition: '2026-09-03T13:00:00Z',
				managedGates: ['schedule-gate-fk44d']
			}
		}
	]);
}

describe('withPinScheduleClause (2026-09-03, operator-walk P10)', () => {
	it('names the closed window alongside the pin, ending the sentence once', () => {
		const rollout = pinnedWithSchedule();
		const ctx = ctxWithSchedule();
		const story = blockingStory(rollout, ctx);
		expect(story.consequence).toMatch(/while the pin is set\.$/);

		const augmented = withPinScheduleClause(story, rollout, ctx);
		expect(augmented.consequence).toBe(
			'2 newer builds are available and none of them will deploy while the pin is set, and Business Hours Only reopens 1:00 PM.'
		);
		// Nothing else about the story moved — the pin is still what outranks
		// every gate, this only adds a clause to the sentence.
		expect(augmented.pinnedTo).toBe(story.pinnedTo);
		expect(augmented.severity).toBe(story.severity);
		expect(augmented.headline).toBe(story.headline);
	});

	it('is a no-op on an un-pinned story', () => {
		const rollout = pinnedWithSchedule();
		rollout.spec!.wantedVersion = undefined;
		const ctx = ctxWithSchedule();
		const story = blockingStory(rollout, ctx);
		expect(withPinScheduleClause(story, rollout, ctx)).toBe(story);
	});

	it('is a no-op when nothing else holds the pinned rollout', () => {
		const rollout = pinnedWithSchedule();
		rollout.status!.gates = [];
		const story = blockingStory(rollout, EMPTY_GATE_CONTEXT);
		expect(withPinScheduleClause(story, rollout, EMPTY_GATE_CONTEXT)).toBe(story);
	});

	it('is a no-op when candidateCount is 0 — the "automatic updates are off" branch, appended the same way', () => {
		const rollout = pinnedWithSchedule({ candidates: [] });
		const ctx = ctxWithSchedule();
		const story = blockingStory(rollout, ctx);
		expect(story.consequence).toBe('Automatic updates are off here until the pin is cleared.');
		const augmented = withPinScheduleClause(story, rollout, ctx);
		expect(augmented.consequence).toBe(
			'Automatic updates are off here until the pin is cleared, and Business Hours Only reopens 1:00 PM.'
		);
	});
});
