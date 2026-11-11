import { describe, it, expect } from 'vitest';
import { pickBuildInQuestion } from './place-verdict';

describe('pickBuildInQuestion when every candidate is refused by a gate other than the approval or the window', () => {
	it('falls back to the candidate that got furthest through the tiers, not the newest', () => {
		const gates = [{ name: 'ghd-promo', kind: 'promotion', passing: true, allowedVersions: ['0000000'] }, { name: 'release-approval', kind: 'approval', allowedVersions: [] }];
		const reach: Record<string, number> = { newest: -1, older: 1, oldest: 0 };
		expect(pickBuildInQuestion(gates, ['newest', 'older', 'oldest'], (t) => reach[t])).toBe('older');
	});
});
