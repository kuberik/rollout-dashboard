import { describe, it, expect } from 'vitest';
import { regionSquares } from './change-truth';
import { regionStates } from './data';

describe('changes-11 V1: prod squares are the region state in the tab colours', () => {
	it('invoice-api: red / orange / orange, sentence derived from the same inks', () => {
		const r = regionSquares('invoice-api', 'incident');
		const tab = regionStates('invoice-api', 'incident').map((x) => x.ink);
		expect(r.inks.length).toBe(tab.length);
		expect(r.inks[0]).toBe('failed');
		expect(r.inks.slice(1).every((i) => i === 'waiting')).toBe(true);
		expect(r.sentence).toBe('1 failing · 2 waiting');
	});
	it('no coloured square without a coloured word', () => {
		const r = regionSquares('invoice-api', 'incident');
		const n = (k: string) => r.inks.filter((i) => i === k).length;
		for (const [k, w] of [['failed', 'failing'], ['waiting', r.heldRule ? 'held' : 'waiting']] as const) if (n(k)) expect(r.sentence).toContain(`${n(k)} ${w}`);
	});
});
