import { describe, it, expect } from 'vitest';
import { heldChipLead } from './held-chip';

describe('the held candidate chip on the rollout detail', () => {
	it('a candidate only an approval refuses says the product approval word, not "Held by a rule"', () => {
		expect(heldChipLead([{ clears: 'person' }])).toBe('Waiting for approval');
		expect(heldChipLead([{ clears: 'person' }, { clears: 'person' }])).toBe('Waiting for approval');
	});
	it('any other refuser keeps the count', () => {
		expect(heldChipLead([{ clears: 'clock' }])).toBe('Held by a rule');
		expect(heldChipLead([{ clears: 'person' }, { clears: 'clock' }])).toBe('Held by 2 rules');
	});
	it('a pin outranks the rules, so every build it holds reads Held by the pin', () => {
		expect(heldChipLead([{ clears: 'clock' }], true)).toBe('Held by the pin');
		expect(heldChipLead([{ clears: 'person' }, { clears: 'clock' }], true)).toBe('Held by the pin');
		expect(heldChipLead([], true)).toBe('Held by the pin');
	});
});
