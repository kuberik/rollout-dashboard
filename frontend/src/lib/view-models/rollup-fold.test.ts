import { describe, expect, it } from 'vitest';
import { foldsOnPhone } from './rollup-fold';

describe('rollup phone fold (QA2 #7)', () => {
	it('zero counts fold; every non-zero count and inked part stays', () => {
		expect(foldsOnPhone('0 moving')).toBe(true);
		expect(foldsOnPhone('1 waiting')).toBe(false);
		expect(foldsOnPhone('20 at rest')).toBe(false);
		expect(foldsOnPhone({ text: '2 failing', ink: 'danger' })).toBe(false);
		expect(foldsOnPhone('5h ago')).toBe(true);
	});
});
