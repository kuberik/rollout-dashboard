import { describe, it, expect } from 'vitest';
import {
	parseQuery, queryParams, queryString, isFiltered, setValues, toggleValue, setOp, removeClause, applyQuery, optionsOf, pillParts, rankBy, EMPTY_QUERY,
	type FacetDef
} from './filter-model';

type Row = { name: string; env: string; ns: string; state: string };
const rows: Row[] = [
	{ name: 'checkout-api', env: 'prod', ns: 'payments', state: 'held' },
	{ name: 'checkout-api', env: 'dev', ns: 'payments', state: 'rest' },
	{ name: 'hello-world', env: 'prod', ns: 'hello', state: 'progress' },
	{ name: 'hello-world', env: 'staging', ns: 'hello', state: 'rest' },
	{ name: 'orders-api', env: 'dev', ns: 'orders', state: 'rest' }
];
const defs: FacetDef<Row>[] = [
	{ key: 'state', label: 'State', of: (r) => r.state, values: ['progress', 'waiting', 'held', 'rest'], order: rankBy(['progress', 'waiting', 'held', 'rest']) },
	{ key: 'env', label: 'Environment', of: (r) => r.env, order: rankBy(['prod', 'staging', 'test', 'dev']) },
	{ key: 'ns', label: 'Namespace', of: (r) => r.ns }
];
const text = (r: Row) => [r.name, r.ns];

describe('filter-model', () => {
	it('empty query keeps everything', () => {
		expect(applyQuery(rows, EMPTY_QUERY, defs, text)).toHaveLength(5);
		expect(isFiltered(EMPTY_QUERY)).toBe(false);
	});
	it('is = any of (OR within), clauses AND', () => {
		let q = setValues(EMPTY_QUERY, 'env', ['prod', 'staging']);
		expect(applyQuery(rows, q, defs, text).map((r) => r.name)).toEqual(['checkout-api', 'hello-world', 'hello-world']);
		q = setValues(q, 'ns', ['hello']);
		expect(applyQuery(rows, q, defs, text)).toHaveLength(2);
	});
	it('not = none of', () => {
		const q = setValues(EMPTY_QUERY, 'env', ['dev'], 'not');
		expect(applyQuery(rows, q, defs, text).every((r) => r.env !== 'dev')).toBe(true);
		expect(applyQuery(rows, setOp(q, 'env', 'is'), defs, text).every((r) => r.env === 'dev')).toBe(true);
	});
	it('search ANDs, case-insensitive over the text fields', () => {
		const q = { ...setValues(EMPTY_QUERY, 'env', ['prod']), q: 'HELLO' };
		expect(applyQuery(rows, q, defs, text).map((r) => r.name)).toEqual(['hello-world']);
	});
	it('toggle adds then removes; the last value removes the clause', () => {
		let q = toggleValue(EMPTY_QUERY, 'ns', 'orders');
		expect(q.clauses).toEqual([{ key: 'ns', op: 'is', values: ['orders'] }]);
		q = toggleValue(q, 'ns', 'orders');
		expect(q.clauses).toEqual([]);
		expect(removeClause(setValues(EMPTY_QUERY, 'env', ['dev']), 'env').clauses).toEqual([]);
	});
	it('URL round-trip, other params kept, not spelt key!', () => {
		const base = new URLSearchParams('scenario=home-incident');
		let q = setValues(EMPTY_QUERY, 'env', ['prod', 'dev']);
		q = setValues(q, 'ns', ['payments'], 'not');
		q = { ...q, q: 'api' };
		const p = queryParams(base, q, defs);
		expect(queryString(p)).toBe('?scenario=home-incident&q=api&env=prod,dev&ns!=payments');
		expect(parseQuery(new URLSearchParams(queryString(p).slice(1)), defs)).toEqual({ q: 'api', clauses: [{ key: 'env', op: 'is', values: ['prod', 'dev'] }, { key: 'ns', op: 'not', values: ['payments'] }] });
	});
	it('a fixed vocabulary drops unknown words from the URL', () => {
		expect(parseQuery(new URLSearchParams('state=failing,held'), defs).clauses).toEqual([{ key: 'state', op: 'is', values: ['held'] }]);
	});
	it('options count against the OTHER clauses, keep selected values, order by rank', () => {
		const q = setValues(setValues(EMPTY_QUERY, 'env', ['prod']), 'ns', ['gone']);
		const env = optionsOf(rows, q, defs, text, 'env');
		expect(env.map((o) => o.value)).toEqual(['prod', 'staging', 'dev']);
		expect(env.every((o) => o.count === 0)).toBe(true); // ns=gone matches nothing
		const ns = optionsOf(rows, q, defs, text, 'ns');
		expect(ns.find((o) => o.value === 'gone')).toMatchObject({ selected: true, total: 0 });
		expect(ns.find((o) => o.value === 'payments')).toMatchObject({ count: 1, total: 2 });
	});
	it('pill phrase', () => {
		expect(pillParts({ key: 'env', op: 'is', values: ['prod'] })).toEqual({ op: 'is', value: 'prod', many: false });
		expect(pillParts({ key: 'env', op: 'not', values: ['prod', 'dev'] }).op).toBe('is none of');
		expect(pillParts({ key: 'ns', op: 'is', values: ['a', 'b', 'c'] }).value).toBe('3 values');
	});
});
