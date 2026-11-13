import { describe, expect, it } from 'vitest';
import { gateFact } from './gate-fact';

describe('gateFact', () => {
	it('says nothing when there are no real gates (chain link only)', () => {
		expect(gateFact(0, 0, false)).toBeNull();
		expect(gateFact(0, 0, true)).toBeNull();
	});
	it('a gate holds, in held ink; a failing health check is a gate holding, never "gate failing" (visual audit #4)', () => {
		expect(gateFact(3, 1, true)).toEqual({ text: '1 of 3 gates holding', tone: 'held', holding: 1 });
		expect(gateFact(1, 0, true)).toEqual({ text: '1 gate holding', tone: 'held', holding: 1 });
		expect(gateFact(1, 1, true)).toEqual({ text: '1 gate holding', tone: 'held', holding: 1 });
		expect(gateFact(3, 1, false)).toEqual({ text: '1 of 3 gates holding', tone: 'held', holding: 1 });
		expect(gateFact(2, 2, false)).toEqual({ text: '2 gates holding', tone: 'held', holding: 2 });
		expect(gateFact(1, 1, false)).toEqual({ text: '1 gate holding', tone: 'held', holding: 1 });
		expect(gateFact(1, 0, false)).toEqual({ text: '1 gate', tone: 'neutral', holding: 0 });
		for (const t of [1, 2, 5]) for (const h of [0, 1]) for (const f of [true, false]) expect(gateFact(t, h, f)?.text).not.toMatch(/fail/);
	});
	it('uses the card rollup denominator verbatim', () => {
		for (const total of [1, 2, 5]) {
			expect(gateFact(total, 0, false)?.text).toContain(`${total} gate`);
		}
	});
});
