import { describe, expect, it } from 'vitest';
import { stageSplitText, stageWeight } from './stage-weight';

describe('stageWeight', () => {
	it('reads a traffic percentage', () => {
		expect(stageWeight({ traffic: '10%' })).toEqual({ pct: 10, label: '10%' });
		expect(stageWeight({ traffic: '100%', replicas: 3 })).toEqual({ pct: 100, label: '100%' });
	});
	it('has no weight for replica-only, missing or malformed steps', () => {
		expect(stageWeight({ replicas: '100%' })).toBeNull();
		expect(stageWeight({ replicas: 2 })).toBeNull();
		expect(stageWeight({})).toBeNull();
		expect(stageWeight(undefined)).toBeNull();
		expect(stageWeight({ traffic: 'abc' })).toBeNull();
		expect(stageWeight({ traffic: '' })).toBeNull();
	});
	it('clamps and keeps a fractional label', () => {
		expect(stageWeight({ traffic: '250%' })?.pct).toBe(100);
		expect(stageWeight({ traffic: '2.5%' })).toEqual({ pct: 2.5, label: '2.5%' });
		expect(stageWeight({ traffic: '12.25%' })?.label).toBe('12.25%');
	});
});

describe('stageSplitText', () => {
	const w = { pct: 10, label: '10%' };
	it('names the share and the build per state', () => {
		expect(stageSplitText(w, 'current', 'a1b2c3d')).toBe('10% of traffic on a1b2c3d');
		expect(stageSplitText(w, 'past', 'a1b2c3d')).toBe('Ran at 10% of traffic on a1b2c3d');
		expect(stageSplitText(w, 'pending', 'a1b2c3d')).toBe('Will move to 10% of traffic on a1b2c3d');
	});
	it('falls back without a build name', () => {
		expect(stageSplitText(w, 'current', null)).toBe('10% of traffic on the new version');
	});
});
