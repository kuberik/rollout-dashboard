import { describe, expect, it } from 'vitest';
import { activityVerb, type ActivityKind } from './activity-verb';

describe('activityVerb', () => {
	it('spends hue only on states that need a person or are in flight', () => {
		const quiet: ActivityKind[] = ['deployed', 'promoted', 'rolledBack', 'approved', 'pinned'];
		for (const k of quiet) expect(activityVerb(k).tone).toBeNull();
		expect(activityVerb('failed').tone).toBe('failed');
		expect(activityVerb('deploying').tone).toBe('deploying');
		expect(activityVerb('checking').tone).toBe('checking');
		expect(activityVerb('held').tone).toBe('held');
	});

	it('uses the product words (held, rolled back), never retired spellings', () => {
		const all: ActivityKind[] = ['deployed', 'promoted', 'rolledBack', 'failed', 'deploying', 'checking', 'held', 'approved', 'pinned'];
		for (const k of all) expect(activityVerb(k).verb).not.toMatch(/paused|blocked|gate|stuck/i);
		expect(activityVerb('rolledBack').verb).toBe('rolled back');
		expect(activityVerb('held').verb).toBe('held');
	});

	it('has an app-subject form for automatic rows', () => {
		expect(activityVerb('deploying').appVerb).toBe('is deploying');
		expect(activityVerb('promoted').appVerb).toBe('was promoted');
		expect(activityVerb('held').appVerb).toBe('is held');
	});
});
