import { describe, it, expect } from 'vitest';
import { catalogueOrder, newestOf, behindIn } from './order';

describe('the release catalogue order of an app\'s builds', () => {
	it('one list is its own order', () => {
		expect(catalogueOrder([['c0', 'c1', 'c2']])).toEqual(['c0', 'c1', 'c2']);
	});
	it('catalogues of different length and start are windows of one sequence (S3)', () => {
		const stg = ['c3', 'c4', 'c5', 'c6'];
		const prod = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
		expect(catalogueOrder([stg, prod])).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
		expect(catalogueOrder([prod, stg])).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
	});
	it('equal-length sliding windows give the same order whichever place is read first (S4)', () => {
		const a = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
		const b = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
		expect(catalogueOrder([a, b])).toEqual(catalogueOrder([b, a]));
		expect(newestOf(catalogueOrder([a, b]))).toBe('c6');
		expect(newestOf(catalogueOrder([b, a]))).toBe('c6');
	});
	it('no catalogue: no newest', () => {
		expect(catalogueOrder([])).toEqual([]);
		expect(newestOf([])).toBeNull();
	});
	it('behind is the distance in the order: c1 is 2 behind c3 whatever happened to c2', () => {
		const o = ['c0', 'c1', 'c2', 'c3'];
		expect(behindIn(o, 'c3')).toBe(0);
		expect(behindIn(o, 'c1')).toBe(2);
		expect(behindIn(o, 'c0')).toBe(3);
		expect(behindIn(o, 'zzz')).toBeNull();
		expect(behindIn(o, null)).toBeNull();
	});
	it('two lists that disagree still give every build exactly once', () => {
		const o = catalogueOrder([['a', 'b'], ['b', 'a']]);
		expect([...o].sort()).toEqual(['a', 'b']);
	});
});
