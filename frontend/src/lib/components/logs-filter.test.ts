import { describe, expect, test } from 'vitest';
import { effective, logDefs, logFilterParams, logOptions, parseLogFilter, LEVELS } from './logs-filter';

const P = (s: string) => new URLSearchParams(s);

describe('logs filter adapter', () => {
	test('level and pod parse, negation too; warning means warn', () => {
		const q = parseLogFilter(P('tab=tests&level=error,Warning&pod!=checkout-1&q=timeout'));
		expect(q).toEqual({ q: 'timeout', clauses: [{ key: 'level', op: 'is', values: ['error', 'warn'] }, { key: 'pod', op: 'not', values: ['checkout-1'] }] });
	});
	test('unknown levels are dropped; round trip keeps ?tab=', () => {
		const q = parseLogFilter(P('level=error,loud'));
		expect(q.clauses[0]!.values).toEqual(['error']);
		const out = logFilterParams(P('tab=tests&level=info'), { q: 'x', clauses: [{ key: 'level', op: 'not', values: ['debug'] }] });
		expect(out.toString()).toBe('tab=tests&q=x&level%21=debug');
	});
	test('effective: is = values, not = the rest, none = empty', () => {
		expect([...effective({ key: 'level', op: 'is', values: ['error'] }, LEVELS)]).toEqual(['error']);
		expect([...effective({ key: 'level', op: 'not', values: ['debug', 'info'] }, LEVELS)]).toEqual(['error', 'warn']);
		expect(effective(undefined, LEVELS).size).toBe(0);
	});
	test('pod is offered only with 2+ pods', () => {
		expect(logDefs(1).map((d) => d.key)).toEqual(['level']);
		expect(logDefs(2).map((d) => d.key)).toEqual(['level', 'pod']);
	});
	test('options carry buffer counts; zero levels stay selectable', () => {
		const o = logOptions('level', { q: '', clauses: [{ key: 'level', op: 'is', values: ['warn'] }] }, { error: 0, warn: 0, info: 3, debug: 1 }, []);
		expect(o.map((x) => [x.value, x.count, x.selected])).toEqual([['error', 0, false], ['warn', 0, true], ['info', 3, false], ['debug', 1, false]]);
		expect(logOptions('pod', { q: '', clauses: [] }, { error: 0, warn: 0, info: 0, debug: 0 }, [{ name: 'a', lines: 1 }, { name: 'b', lines: 5 }]).map((x) => x.value)).toEqual(['b', 'a']);
	});
});
