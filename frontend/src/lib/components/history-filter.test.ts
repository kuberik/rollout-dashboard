import { describe, expect, test } from 'vitest';
import { compareOptions, kindParam, kindQuery, lanesOf, parseKind } from './history-filter';

describe('history compare adapter', () => {
	test('old and new addresses parse', () => {
		expect(parseKind('env+ns')).toEqual(['env', 'ns']);
		expect(parseKind('env ns')).toEqual(['env', 'ns']);
		expect(parseKind('ns,env')).toEqual(['env', 'ns']);
		expect(parseKind('ns')).toEqual(['ns']);
		expect(parseKind(null)).toEqual([]);
	});
	test('written in the model spelling, absent when empty', () => {
		expect(kindParam(['ns', 'env'])).toBe('env,ns');
		expect(kindParam([])).toBeNull();
	});
	test('query round trip', () => {
		expect(lanesOf(kindQuery(['env']))).toEqual(['env']);
		expect(kindQuery([]).clauses).toEqual([]);
	});
	test('options: environments only with other environments; namespace count unknown until fetched', () => {
		expect(compareOptions([], 0, null).map((o) => o.value)).toEqual(['ns']);
		const o = compareOptions(['env'], 2, 5);
		expect(o.map((x) => [x.value, x.count, x.selected])).toEqual([['env', 2, true], ['ns', 5, false]]);
		expect(compareOptions([], 1, null)[1]!.count).toBe(-1);
	});
});
