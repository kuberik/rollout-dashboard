import { describe, it, expect } from 'vitest';
import { approvalIn, rowPlaceName } from './state-words';

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
