import { describe, expect, it } from 'vitest';
import { deployKey, isDeployInFlight, leadOpenKey, pipelineSlots, showNewerBuildsCard, steadyStep } from './pipeline-card';

describe('isDeployInFlight', () => {
	it('is true while the newest entry is Deploying or InProgress', () => {
		expect(isDeployInFlight([{ bakeStatus: 'Deploying' }])).toBe(true);
		expect(isDeployInFlight([{ bakeStatus: 'InProgress' }, { bakeStatus: 'Succeeded' }])).toBe(true);
	});
	it('is false once settled, and only the newest entry counts', () => {
		expect(isDeployInFlight([{ bakeStatus: 'Succeeded' }, { bakeStatus: 'InProgress' }])).toBe(false);
		expect(isDeployInFlight([{ bakeStatus: 'Failed' }])).toBe(false);
		expect(isDeployInFlight([])).toBe(false);
		expect(isDeployInFlight(undefined)).toBe(false);
	});
});

describe('showNewerBuildsCard (rule 2)', () => {
	const base = { deployInFlight: true, newerCount: 0 };
	it('hides while a deploy is in flight and nothing newer waits', () => {
		expect(showNewerBuildsCard(base)).toBe(false);
	});
	it('shows a waiting newer build even mid-deploy', () => {
		expect(showNewerBuildsCard({ ...base, newerCount: 1 })).toBe(true);
	});
	it('shows when a pin, a hold or an unknown release list needs the card', () => {
		expect(showNewerBuildsCard({ ...base, pinned: true })).toBe(true);
		expect(showNewerBuildsCard({ ...base, held: true })).toBe(true);
		expect(showNewerBuildsCard({ ...base, releasesLoading: true })).toBe(true);
	});
	it('always shows when no deploy is in flight', () => {
		expect(showNewerBuildsCard({ deployInFlight: false, newerCount: 0 })).toBe(true);
	});
});

describe('steadyStep (rule 1)', () => {
	it('only grows within one deploy', () => {
		let s = { key: 'a:v1', max: 0 };
		const seen: number[] = [];
		for (const h of [200, 320, 260, 300, 340, 180]) {
			s = steadyStep(s, 'a:v1', h);
			seen.push(s.max);
		}
		expect(seen).toEqual([200, 320, 320, 320, 340, 340]);
	});
	it('a new deploy starts from its own height', () => {
		let s = steadyStep({ key: 'a:v1', max: 0 }, 'a:v1', 400);
		s = steadyStep(s, 'b:v2', 180);
		expect(s).toEqual({ key: 'b:v2', max: 180 });
	});
	it('deployKey changes with the entry id or the build', () => {
		expect(deployKey({ id: 1, version: { tag: 'x' } })).not.toBe(deployKey({ id: 2, version: { tag: 'x' } }));
		expect(deployKey({ id: 1, version: { tag: 'x' } })).not.toBe(deployKey({ id: 1, version: { tag: 'y' } }));
		expect(deployKey(null)).toBe(':::done');
	});
	it('deployKey changes when the deploy settles and per rollout, so the card lets go', () => {
		const live = { id: 1, version: { tag: 'x' }, bakeStatus: 'InProgress' };
		expect(deployKey(live)).not.toBe(deployKey({ ...live, bakeStatus: 'Succeeded' }));
		expect(deployKey(live, 'a/b')).not.toBe(deployKey(live, 'a/c'));
	});
});

describe('leadOpenKey (rule 3)', () => {
	const row = (key: string, group: string) => ({ key, group });
	it('opens nothing when more than one place is moving (a wave)', () => {
		expect(leadOpenKey([row('a', 'moving'), row('b', 'moving'), row('c', 'moving')])).toBeNull();
	});
	it('still opens the lead when a single place is moving', () => {
		expect(leadOpenKey([row('a', 'moving'), row('b', 'quiet')])).toBe('a');
	});
	it('opens the first row when nothing moves, and nothing when there are no rows', () => {
		expect(leadOpenKey([row('a', 'needs')])).toBe('a');
		expect(leadOpenKey([])).toBeNull();
	});
});

describe('pipelineSlots — rows keep their slot while a deploy is in flight', () => {
	const all = { canUpdate: true, stageCheckConfigured: true, timerConfigured: true };
	it('reserves the action, the Check line and the timer line from the first frame of a deploy', () => {
		expect(pipelineSlots({ ...all, deployInFlight: true })).toEqual({ advance: true, checkLine: true, timerLine: true });
	});
	it('reserves nothing once the deploy has settled', () => {
		expect(pipelineSlots({ ...all, deployInFlight: false })).toEqual({ advance: false, checkLine: false, timerLine: false });
	});
	it('reserves only what can actually appear', () => {
		expect(pipelineSlots({ deployInFlight: true, canUpdate: false, stageCheckConfigured: false, timerConfigured: false })).toEqual({
			advance: false,
			checkLine: false,
			timerLine: false
		});
	});
});
