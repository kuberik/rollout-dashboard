import { describe, expect, it } from 'vitest';
import { gateFact } from './gate-fact';

describe('gateFact', () => {
	it('says nothing when there are no real gates (chain link only)', () => {
		expect(gateFact(0, 0, false)).toBeNull();
		expect(gateFact(0, 0, true)).toBeNull();
	});
	it('worst first: failing outranks holding outranks calm', () => {
		expect(gateFact(3, 1, true)).toEqual({ text: '1 of 3 gates failing', tone: 'danger' });
		expect(gateFact(1, 0, true)).toEqual({ text: '1 gate failing', tone: 'danger' });
		expect(gateFact(3, 1, false)).toEqual({ text: '1 of 3 gates holding', tone: 'held' });
		expect(gateFact(2, 2, false)).toEqual({ text: '2 gates holding', tone: 'held' });
		expect(gateFact(1, 1, false)).toEqual({ text: '1 gate holding', tone: 'held' });
		expect(gateFact(1, 0, false)).toEqual({ text: '1 gate', tone: 'neutral' });
	});
	it('uses the card rollup denominator verbatim', () => {
		for (const total of [1, 2, 5]) {
			expect(gateFact(total, 0, false)?.text).toContain(`${total} gate`);
		}
	});
});
