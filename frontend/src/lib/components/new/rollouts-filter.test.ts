import { describe, it, expect } from 'vitest';
import { parseFilter, filterParams, filterList, isFiltered, nsOfHref, EMPTY_QUERY, entries, rolloutDefs } from './rollouts-filter';
import { optionsOf, type FilterQuery } from '../filter/filter-model';
import type { RolloutsPage, StrandRow, RestRow } from './rollouts-page';

const strand = (app: string, ns: string, tier: string, version: string): StrandRow => ({ key: `${ns}/${app}`, app, href: `/rollouts/c1/${ns}/${app}`, tier, row: { version } as never } as unknown as StrandRow);
const rest = (app: string, ns: string, tier: string, code: string): RestRow => ({ key: `${ns}/${app}`, app, href: `/rollouts/c1/${ns}/${app}`, tier, code } as unknown as RestRow);
const P: Pick<RolloutsPage, 'groups' | 'rest' | 'counts' | 'restApps'> = {
	groups: [
		{ key: 'moving', word: 'In flight', rows: [strand('billing-api', 'billing-dev', 'dev', 'a1b2c3d'), strand('orders-api', 'orders-prod', 'prod', '9f8e7d6')] },
		{ key: 'held', word: 'Held', rows: [strand('billing-api', 'billing-prod', 'prod', 'a1b2c3d')] }
	],
	rest: [rest('hello-world', 'hello-prod', 'prod', 'deadbee'), rest('hello-world', 'hello-dev', 'dev', 'deadbee')],
	counts: { moving: 2, waiting: 0, held: 1, rest: 2 }, restApps: 1
};
const f = (q = '', ...clauses: FilterQuery['clauses']): FilterQuery => ({ q, clauses });
const names = (r: ReturnType<typeof filterList>) => [...r.groups.flatMap((g) => g.rows.map((x) => x.key)), ...r.rest.map((x) => x.key)];

describe('filterList', () => {
	it('an empty filter keeps everything, untouched', () => {
		const r = filterList(P, EMPTY_QUERY);
		expect(r.groups).toBe(P.groups);
		expect(r.shown).toBe(5);
		expect(isFiltered(EMPTY_QUERY)).toBe(false);
	});
	it('search matches name, namespace and version, case-insensitive', () => {
		expect(names(filterList(P, f('ORDERS')))).toEqual(['orders-prod/orders-api']);
		expect(names(filterList(P, f('9f8e')))).toEqual(['orders-prod/orders-api']);
		expect(names(filterList(P, f('DEADBEE')))).toEqual(['hello-prod/hello-world', 'hello-dev/hello-world']);
	});
	it('is = any of, not = none of, across properties AND', () => {
		expect(names(filterList(P, f('', { key: 'env', op: 'is', values: ['prod', 'dev'] }))).length).toBe(5);
		expect(names(filterList(P, f('', { key: 'env', op: 'is', values: ['prod'] }, { key: 'state', op: 'is', values: ['held', 'rest'] })))).toEqual(['billing-prod/billing-api', 'hello-prod/hello-world']);
		expect(names(filterList(P, f('', { key: 'env', op: 'not', values: ['prod'] })))).toEqual(['billing-dev/billing-api', 'hello-dev/hello-world']);
		expect(names(filterList(P, f('', { key: 'ns', op: 'not', values: ['billing-dev', 'billing-prod'] }))).length).toBe(3);
	});
	it('a group with no match is gone and the counts are the filtered ones', () => {
		const r = filterList(P, f('', { key: 'state', op: 'is', values: ['held'] }));
		expect(r.groups.map((g) => g.key)).toEqual(['held']);
		expect(r.counts).toEqual({ moving: 0, waiting: 0, held: 1, rest: 0 });
		expect(filterList(P, f('nothing-like-this')).shown).toBe(0);
	});
});

describe('url', () => {
	it('round-trips with operators, keeps foreign params', () => {
		const q = f('world', { key: 'state', op: 'is', values: ['held', 'rest'] }, { key: 'env', op: 'not', values: ['dev'] }, { key: 'ns', op: 'is', values: ['a', 'b'] });
		const out = filterParams(new URLSearchParams('scenario=incident&state=old'), q);
		expect(out.toString()).toBe('scenario=incident&q=world&state=held%2Crest&env%21=dev&ns=a%2Cb');
		expect(parseFilter(out)).toEqual({ ...q, clauses: [q.clauses[0], q.clauses[2], q.clauses[1]].map((c) => c!) .sort((a, b) => ['state', 'env', 'ns'].indexOf(a.key) - ['state', 'env', 'ns'].indexOf(b.key)) });
		expect(filterParams(out, EMPTY_QUERY).toString()).toBe('scenario=incident');
	});
	it('drops unknown state words (failing has no group), lowercases env', () => {
		expect(parseFilter(new URLSearchParams('state=failing,held,bogus&env=PROD')).clauses).toEqual([{ key: 'state', op: 'is', values: ['held'] }, { key: 'env', op: 'is', values: ['prod'] }]);
		expect(parseFilter(new URLSearchParams(''))).toEqual(EMPTY_QUERY);
	});
	it('nsOfHref', () => {
		expect(nsOfHref('/rollouts/c1/ns-x/app?tab=1')).toBe('ns-x');
		expect(nsOfHref('/apps/x')).toBe('');
	});
});

describe('options', () => {
	it('state in product order, namespaces busiest first, counts given the other clauses', () => {
		const rows = entries(P);
		const defs = rolloutDefs(rows);
		expect(defs.map((d) => d.key)).toEqual(['state', 'env', 'ns']);
		const q = f('', { key: 'env', op: 'is', values: ['prod'] });
		const text = (e: (typeof rows)[0]) => [e.name];
		expect(optionsOf(rows, q, defs, text, 'state').map((o) => [o.value, o.count])).toEqual([['progress', 1], ['held', 1], ['rest', 1]]);
		expect(optionsOf(rows, q, defs, text, 'env').map((o) => [o.value, o.count, o.selected])).toEqual([['prod', 3, true], ['dev', 2, false]]);
	});
});
