import { describe, it, expect } from 'vitest';
import { parseChangeFilter, changeParams, keepChange, changeEntries } from './changes-filter';

const e = (repo: string, title = 't', ref = '#1') => ({ repo, ref, title });
describe('changes filter', () => {
	it('reads the old repeated ?repo=a&repo=b and the comma form alike', () => {
		expect(parseChangeFilter(new URLSearchParams('repo=a&repo=b')).clauses).toEqual([{ key: 'repo', op: 'is', values: ['a', 'b'] }]);
		expect(parseChangeFilter(new URLSearchParams('repo=a,b')).clauses).toEqual([{ key: 'repo', op: 'is', values: ['a', 'b'] }]);
	});
	it('reads a negation and search words', () => {
		const f = parseChangeFilter(new URLSearchParams('repo!=a&q=retry'));
		expect(f).toEqual({ q: 'retry', clauses: [{ key: 'repo', op: 'not', values: ['a'] }] });
		expect(keepChange(f)(e('a', 'retry x'))).toBe(false);
		expect(keepChange(f)(e('b', 'Retry webhook'))).toBe(true);
		expect(keepChange(f)(e('b', 'other'))).toBe(false);
	});
	it('writes the model spelling and keeps other params', () => {
		const f = parseChangeFilter(new URLSearchParams('repo=a&repo=b&scenario=x'));
		expect(changeParams(new URLSearchParams('repo=a&repo=b&scenario=x'), f).toString()).toBe('scenario=x&repo=a%2Cb');
	});
	it('flattens the stops into entries', () => {
		expect(changeEntries({ stops: [{ col: 'dev', rows: [{ repo: 'a', ref: '#1', title: 'x' }] }] } as never)).toEqual([e('a', 'x')]);
	});
});
