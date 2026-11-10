import { describe, expect, it } from 'vitest';
import { activityKindOf } from './activity-kind';

const base = { bakeStatus: 'Succeeded', isRollback: false, actorKind: 'controller' as const, envRank: 3, firstEnvRank: 1 };

describe('activityKindOf', () => {
	it('reads in-flight and failed states from bakeStatus first', () => {
		expect(activityKindOf({ ...base, bakeStatus: 'Failed', isRollback: true })).toBe('failed');
		expect(activityKindOf({ ...base, bakeStatus: 'Deploying' })).toBe('deploying');
		expect(activityKindOf({ ...base, bakeStatus: 'InProgress' })).toBe('checking');
	});
	it('names a rollback before a promotion', () => {
		expect(activityKindOf({ ...base, isRollback: true })).toBe('rolledBack');
	});
	it('the controller in a later environment promoted; in the first one it deployed', () => {
		expect(activityKindOf(base)).toBe('promoted');
		expect(activityKindOf({ ...base, envRank: 1 })).toBe('deployed');
	});
	it('a person or CI deployed, wherever it was', () => {
		expect(activityKindOf({ ...base, actorKind: 'person' })).toBe('deployed');
		expect(activityKindOf({ ...base, actorKind: 'ci' })).toBe('deployed');
	});
});
