import { describe, it, expect } from 'vitest';
import { approvalIn, rowPlaceName, failedInkParts, failedRollup } from './state-words';

describe('approval wording names its place (subject test)', () => {
	it('the approval word carries the environment it waits in', () => {
		expect(approvalIn(false, 'prod')).toBe('Waiting for approval in prod');
		expect(approvalIn(true, 'staging')).toBe('Needs your approval in staging');
		expect(approvalIn(false, '')).toBe('Waiting for approval');
	});
	it('a folded prod row is "prod", one site is prod-<site>, else its own place', () => {
		expect(rowPlaceName({ regions: ['a', 'b'], place: 'prod', tier: 'prod' })).toBe('prod');
		expect(rowPlaceName({ regions: ['eu'], place: 'eu', tier: 'prod' })).toBe('prod-eu');
		expect(rowPlaceName({ regions: [], place: 'staging', tier: 'staging' })).toBe('staging');
	});
});

describe('one failure vocabulary', () => {
	it('Failing is a check failing now; a recovered failure reads Failed', async () => {
		const { failedWord, stateWord } = await import('./state-words');
		expect(failedWord(false)).toBe('Failing');
		expect(failedWord(true)).toBe('Failed');
		expect(stateWord('failed')).toBe('Failing');
		expect(stateWord('failed', { recovered: true })).toBe('Failed');
		expect(stateWord('failing', { recovered: true })).toBe('Failed');
	});
	it('the Attention rollup uses the cards\' words', async () => {
		const { attentionRollup } = await import('./rollouts-page');
		expect(attentionRollup({ failing: 6, recovered: 2, toApprove: 1 })).toEqual([{ text: '4 failing', ink: 'danger' }, '2 failed', { text: '1 to approve', ink: 'held' }]);
		expect(attentionRollup({ failing: 0, recovered: 0, toApprove: 0 })).toEqual([]);
	}, 30000);
});

describe('the one ink rule of the failure words', () => {
	it('failing is danger, failed is neutral, zero parts are left out', () => {
		expect(failedInkParts(3, 1)).toEqual([{ text: '2 failing', ink: 'danger' }, { text: '1 failed', ink: 'muted' }]);
		expect(failedInkParts(2, 2)).toEqual([{ text: '2 failed', ink: 'muted' }]);
		expect(failedInkParts(0, 0)).toEqual([]);
	});
	it('a rollup keeps the neutral part a plain string', () => {
		expect(failedRollup(3, 1)).toEqual([{ text: '2 failing', ink: 'danger' }, '1 failed']);
	});
});
