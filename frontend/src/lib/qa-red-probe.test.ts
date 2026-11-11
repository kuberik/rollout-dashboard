import { it, expect } from 'vitest';

// QA probe for PR #100: must turn frontend-test red. DO NOT MERGE.
it('qa red probe fails on purpose', () => {
	expect(1).toBe(2);
});
